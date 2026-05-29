package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
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

	// Setup router
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	// CORS
	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CORS.AllowedOrigins,
		AllowMethods:     cfg.CORS.AllowedMethods,
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "database": cfg.Database.Driver})
	})

	// API v1 routes
	v1 := r.Group("/api/v1")

	// Auth routes (public)
	auth := v1.Group("/auth")
	{
		auth.POST("/register", authHandler.Register)
		auth.POST("/login", authHandler.Login)
		auth.POST("/refresh", authHandler.RefreshToken)
	}

	// Protected routes
	protected := v1.Group("")
	protected.Use(authMiddleware.RequireAuth())
	if cfg.RateLimit.Enabled {
		protected.Use(apiLimiter.Limit(middleware.UserKeyFunc))
	}
	{
		protected.POST("/auth/token", authHandler.GenerateAPIToken)

		// Sync routes
		protected.POST("/conversations/sync", syncHandler.SyncConversation)
		protected.POST("/conversations/batch", syncHandler.BatchSync)

		// Query routes
		protected.GET("/conversations", convHandler.ListConversations)
		protected.GET("/conversations/:id", convHandler.GetConversation)
		protected.GET("/conversations/:id/messages", convHandler.GetMessages)
		protected.DELETE("/conversations", convHandler.BatchDelete)

		// Search routes
		protected.GET("/search", searchHandler.Search)

		// Stats routes
		protected.GET("/stats/overview", statsHandler.GetOverview)
		protected.GET("/stats/timeline", statsHandler.GetTimeline)
	}

	// Start server
	addr := cfg.Address()
	fmt.Printf("AI Chat Collector server starting on %s (database: %s)\n", addr, cfg.Database.Driver)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
