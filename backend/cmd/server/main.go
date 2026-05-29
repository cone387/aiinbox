package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"

	"github.com/cone387/aiinbox/backend/internal/config"
	"github.com/cone387/aiinbox/backend/internal/database"
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
	_ = v1 // Routes will be registered in subsequent tasks
	_ = db // DB will be injected into handlers

	// Start server
	addr := cfg.Address()
	fmt.Printf("AI Chat Collector server starting on %s (database: %s)\n", addr, cfg.Database.Driver)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
