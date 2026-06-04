package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cone387/aiinbox/backend/internal/config"
	"github.com/cone387/aiinbox/backend/internal/database"
	"github.com/cone387/aiinbox/backend/internal/handlers"
	"github.com/cone387/aiinbox/backend/internal/middleware"
	"github.com/cone387/aiinbox/backend/internal/search"
	"github.com/cone387/aiinbox/backend/internal/services"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	configPath := flag.String("config", "", "path to config file")
	flag.Parse()

	// Load configuration
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Resolve relative SQLite DSN to be relative to the executable's directory,
	// so the server always finds the same database regardless of the working directory.
	if cfg.Database.Driver == "sqlite" && !filepath.IsAbs(cfg.Database.DSN) {
		exePath, err := os.Executable()
		if err == nil {
			cfg.Database.DSN = filepath.Join(filepath.Dir(exePath), cfg.Database.DSN)
		}
	}

	// Set Gin mode
	if cfg.Server.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Initialize database
	db, err := database.Init(&cfg.Database)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// Auto-migrate models
	if err := database.AutoMigrate(db); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	// Initialize full-text search
	if err := database.InitFTS(db, cfg.Database.Driver); err != nil {
		log.Printf("Warning: Failed to initialize FTS: %v", err)
	}

	// Setup services
	authService := services.NewAuthService(db, &cfg.Auth)
	syncService := services.NewSyncService(db)
	searchEngine := search.NewEngine(db, cfg.Database.Driver)

	// Setup handlers
	authHandler := handlers.NewAuthHandler(authService)
	syncHandler := handlers.NewSyncHandler(syncService)
	convHandler := handlers.NewConversationHandler(db)
	searchHandler := handlers.NewSearchHandler(searchEngine)
	statsHandler := handlers.NewStatsHandler(db)

	// Setup middleware
	authMiddleware := middleware.NewAuthMiddleware(cfg.Auth.JWTSecret, db)
	apiLimiter := middleware.NewRateLimiter(cfg.RateLimit.APIPerMinute, time.Minute)
	authLimiter := middleware.NewRateLimiter(cfg.RateLimit.AuthMaxAttempts, time.Duration(cfg.RateLimit.AuthBlockMinutes)*time.Minute)

	// Setup router
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	// CORS - Allow all origins for self-hosted app
	// Security is handled by API token authentication
	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     cfg.CORS.AllowedMethods,
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
	}))

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "database": cfg.Database.Driver})
	})

	// Authenticated health check (verifies token is valid)
	r.GET("/health/auth", authMiddleware.RequireAuth(), func(c *gin.Context) {
		userID := middleware.GetUserID(c)
		c.JSON(http.StatusOK, gin.H{"status": "ok", "user_id": userID, "database": cfg.Database.Driver})
	})

	// API v1 routes
	v1 := r.Group("/api/v1")

	// Auth routes (public)
	auth := v1.Group("/auth")
	{
		// Rate-limited auth endpoints to prevent brute-force / mass registration
		auth.POST("/register", authLimiter.Limit(middleware.IPKeyFunc), authHandler.Register)
		auth.POST("/login", authLimiter.Limit(middleware.IPKeyFunc), authHandler.Login)
		auth.POST("/refresh", authHandler.RefreshToken)
		// Auth code exchange: the extension calls this without a JWT (it's how it obtains one).
		// Security relies on one-time code + state verification + IP rate limit.
		auth.POST("/exchange", authLimiter.Limit(middleware.IPKeyFunc), authHandler.ExchangeAuthCode)
	}

	// Authorize endpoint: consent flow for browser extension.
	// GET /authorize falls through to NoRoute (serves the SPA page).
	// Validation uses a dedicated API endpoint; POST creates the auth code.
	v1.GET("/authorize/validate", authHandler.AuthorizeRequest)
	v1.POST("/authorize", authMiddleware.RequireAuth(), authHandler.Authorize)

	// Protected routes
	protected := v1.Group("")
	protected.Use(authMiddleware.RequireAuth())
	if cfg.RateLimit.Enabled {
		protected.Use(apiLimiter.Limit(middleware.UserKeyFunc))
	}
	{
		protected.POST("/auth/token", authHandler.GenerateAPIToken)
		protected.GET("/auth/tokens", authHandler.ListAPITokens)
		protected.DELETE("/auth/token", authHandler.DeleteAPIToken)

		// Sync routes
		protected.POST("/conversations/sync", syncHandler.SyncConversation)
		protected.POST("/conversations/batch", syncHandler.BatchSync)
		protected.GET("/sync/status", syncHandler.GetSyncStatus)

		// Query routes
		protected.GET("/conversations", convHandler.ListConversations)
		protected.GET("/conversations/:id", convHandler.GetConversation)
		protected.GET("/conversations/:id/messages", convHandler.GetMessages)
		protected.POST("/conversations/:id/read", convHandler.MarkRead)
		protected.DELETE("/conversations", convHandler.BatchDelete)

		// Search routes
		protected.GET("/search", searchHandler.Search)

		// Stats routes
		protected.GET("/stats/overview", statsHandler.GetOverview)
		protected.GET("/stats/timeline", statsHandler.GetTimeline)
	}

	// Serve frontend static files (SPA)
	frontendDist := filepath.Join("frontend", "dist")
	if _, err := os.Stat(frontendDist); err == nil {
		fileServer := http.FileServer(http.Dir(frontendDist))
		indexHTML := filepath.Join(frontendDist, "index.html")

		r.NoRoute(func(c *gin.Context) {
			// Skip API routes
			if strings.HasPrefix(c.Request.URL.Path, "/api/") ||
				strings.HasPrefix(c.Request.URL.Path, "/health") {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
			// Try to serve as static file
			staticPath := filepath.Join(frontendDist, c.Request.URL.Path)
			if _, err := os.Stat(staticPath); err == nil {
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
			// SPA fallback: serve index.html
			c.File(indexHTML)
		})
	} else {
		log.Printf("Warning: frontend dist not found at %s, SPA routes will not be served", frontendDist)
	}

	// Start server
	addr := cfg.Address()
	fmt.Printf("AI Chat Collector server starting on %s (database: %s)\n", addr, cfg.Database.Driver)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
