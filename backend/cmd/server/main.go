package main

import (
	"flag"
	"fmt"
	"io"
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
	"github.com/cone387/aiinbox/backend/internal/webui"
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

	// Resolve relative SQLite DSN to be relative to the config file's directory,
	// so the server always finds the same database regardless of the working directory.
	if cfg.Database.Driver == "sqlite" && !filepath.IsAbs(cfg.Database.DSN) {
		cfg.Database.DSN = filepath.Join(cfg.ConfigDir, cfg.Database.DSN)
	}

	// Ensure a strong signing key. The single-file binary ships without a config,
	// so without this it would sign JWTs using the public placeholder secret.
	secretDir := filepath.Join(cfg.ConfigDir, "data")
	if cfg.Database.Driver == "sqlite" && cfg.Database.DSN != "" {
		secretDir = filepath.Dir(cfg.Database.DSN)
	}
	if generated, err := config.EnsureJWTSecret(cfg, secretDir); err != nil {
		log.Fatalf("Failed to ensure JWT secret: %v", err)
	} else if generated {
		log.Printf("Generated a new random JWT secret at %s (set auth.jwt_secret in config to override)", filepath.Join(secretDir, "jwt_secret"))
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

	// CORS whitelist from config (cors.allowed_origins, which always has a
	// default). AllowWildcard/AllowBrowserExtensions let entries like
	// "chrome-extension://*" match the extension's origin. Only if the list is
	// explicitly emptied do we fall back to allowing all origins.
	corsCfg := cors.Config{
		AllowMethods:           cfg.CORS.AllowedMethods,
		AllowHeaders:           []string{"Origin", "Content-Type", "Authorization"},
		AllowWildcard:          true,
		AllowBrowserExtensions: true,
	}
	if len(cfg.CORS.AllowedOrigins) > 0 {
		corsCfg.AllowOrigins = cfg.CORS.AllowedOrigins
	} else {
		corsCfg.AllowAllOrigins = true
	}
	r.Use(cors.New(corsCfg))

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
		protected.GET("/conversations/synced", convHandler.GetSyncedConversations)
		protected.GET("/conversations/:id", convHandler.GetConversation)
		protected.GET("/conversations/:id/messages", convHandler.GetMessages)
		protected.POST("/conversations/:id/read", convHandler.MarkRead)
		protected.POST("/conversations/read-all", convHandler.MarkAllRead)
		protected.DELETE("/conversations", convHandler.BatchDelete)

		// Search routes
		protected.GET("/search", searchHandler.Search)

		// Stats routes
		protected.GET("/stats/overview", statsHandler.GetOverview)
		protected.GET("/stats/timeline", statsHandler.GetTimeline)
		protected.GET("/stats/activity", statsHandler.GetActivity)
		protected.GET("/stats/insights", statsHandler.GetInsights)
	}

	// Serve frontend static files (SPA). Prefer an on-disk build when present
	// (running from the repo root during development), otherwise fall back to
	// the frontend embedded in the binary so a standalone executable still
	// serves the web UI.
	var webFS http.FileSystem
	diskDist := filepath.Join("frontend", "dist")
	if _, err := os.Stat(filepath.Join(diskDist, "index.html")); err == nil {
		webFS = http.Dir(diskDist)
	} else if sub, err := webui.Dist(); err == nil {
		webFS = http.FS(sub)
	}

	if webFS != nil {
		fileServer := http.FileServer(webFS)
		serveIndex := func(c *gin.Context) {
			f, err := webFS.Open("/index.html")
			if err != nil {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
			defer f.Close()
			c.Status(http.StatusOK)
			c.Header("Content-Type", "text/html; charset=utf-8")
			io.Copy(c.Writer, f)
		}

		r.NoRoute(func(c *gin.Context) {
			// Skip API routes
			if strings.HasPrefix(c.Request.URL.Path, "/api/") ||
				strings.HasPrefix(c.Request.URL.Path, "/health") {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
			// Try to serve as a static file
			if f, err := webFS.Open(c.Request.URL.Path); err == nil {
				f.Close()
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
			// SPA fallback: serve index.html
			serveIndex(c)
		})
	} else {
		log.Printf("Warning: no frontend build found (disk or embedded), SPA routes will not be served")
	}

	// Start server
	addr := cfg.Address()
	fmt.Printf("AI Chat Collector server starting on %s (database: %s)\n", addr, cfg.Database.Driver)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
