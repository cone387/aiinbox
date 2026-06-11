// Package server provides a reusable, self-contained AI Inbox HTTP server
// that can be embedded by both the standalone CLI binary (cmd/server) and
// the desktop systray app (cmd/desktop).
package server

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
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
	"gorm.io/gorm"
)

// Server wraps the Gin engine and the underlying config so callers can
// start and stop the HTTP server on demand.
type Server struct {
	Cfg      *config.Config
	DB       *gorm.DB
	Engine   *gin.Engine
	listener net.Listener
	httpSrv  *http.Server
}

// New loads configuration, initialises the database, registers routes and
// returns a ready-to-start *Server.
func New(configPath string) (*Server, error) {
	cfg, err := config.Load(configPath)
	if err != nil {
		return nil, fmt.Errorf("load config: %w", err)
	}

	// Resolve relative SQLite DSN relative to the config file's directory.
	if cfg.Database.Driver == "sqlite" && !filepath.IsAbs(cfg.Database.DSN) {
		cfg.Database.DSN = filepath.Join(cfg.ConfigDir, cfg.Database.DSN)
	}

	// Ensure a strong JWT secret.
	secretDir := filepath.Join(cfg.ConfigDir, "data")
	if cfg.Database.Driver == "sqlite" && cfg.Database.DSN != "" {
		secretDir = filepath.Dir(cfg.Database.DSN)
	}
	if generated, err := config.EnsureJWTSecret(cfg, secretDir); err != nil {
		return nil, fmt.Errorf("ensure jwt secret: %w", err)
	} else if generated {
		log.Printf("Generated a new random JWT secret at %s", filepath.Join(secretDir, "jwt_secret"))
	}

	if cfg.Server.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	db, err := database.Init(&cfg.Database)
	if err != nil {
		return nil, fmt.Errorf("init database: %w", err)
	}

	if err := database.AutoMigrate(db); err != nil {
		return nil, fmt.Errorf("auto migrate: %w", err)
	}

	if err := database.InitFTS(db, cfg.Database.Driver); err != nil {
		log.Printf("Warning: Failed to initialize FTS: %v", err)
	}

	// Services
	authService := services.NewAuthService(db, &cfg.Auth)
	syncService := services.NewSyncService(db)
	searchEngine := search.NewEngine(db, cfg.Database.Driver)

	// Handlers
	authHandler := handlers.NewAuthHandler(authService)
	syncHandler := handlers.NewSyncHandler(syncService)
	convHandler := handlers.NewConversationHandler(db)
	searchHandler := handlers.NewSearchHandler(searchEngine)
	statsHandler := handlers.NewStatsHandler(db)

	// Middleware
	authMiddleware := middleware.NewAuthMiddleware(cfg.Auth.JWTSecret, db)
	apiLimiter := middleware.NewRateLimiter(cfg.RateLimit.APIPerMinute, time.Minute)
	authLimiter := middleware.NewRateLimiter(cfg.RateLimit.AuthMaxAttempts, time.Duration(cfg.RateLimit.AuthBlockMinutes)*time.Minute)

	// Router
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	// CORS
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

	// Health
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "database": cfg.Database.Driver})
	})
	r.GET("/health/auth", authMiddleware.RequireAuth(), func(c *gin.Context) {
		userID := middleware.GetUserID(c)
		c.JSON(http.StatusOK, gin.H{"status": "ok", "user_id": userID, "database": cfg.Database.Driver})
	})

	// API v1
	v1 := r.Group("/api/v1")

	auth := v1.Group("/auth")
	{
		auth.POST("/register", authLimiter.Limit(middleware.IPKeyFunc), authHandler.Register)
		auth.POST("/login", authLimiter.Limit(middleware.IPKeyFunc), authHandler.Login)
		auth.POST("/refresh", authHandler.RefreshToken)
		auth.POST("/exchange", authLimiter.Limit(middleware.IPKeyFunc), authHandler.ExchangeAuthCode)
	}

	v1.GET("/authorize/validate", authHandler.AuthorizeRequest)
	v1.POST("/authorize", authMiddleware.RequireAuth(), authHandler.Authorize)

	protected := v1.Group("")
	protected.Use(authMiddleware.RequireAuth())
	if cfg.RateLimit.Enabled {
		protected.Use(apiLimiter.Limit(middleware.UserKeyFunc))
	}
	{
		protected.POST("/auth/token", authHandler.GenerateAPIToken)
		protected.GET("/auth/tokens", authHandler.ListAPITokens)
		protected.DELETE("/auth/token", authHandler.DeleteAPIToken)
		protected.PUT("/auth/password", authHandler.ChangePassword)

		protected.POST("/conversations/sync", syncHandler.SyncConversation)
		protected.POST("/conversations/batch", syncHandler.BatchSync)
		protected.GET("/sync/status", syncHandler.GetSyncStatus)

		protected.GET("/conversations", convHandler.ListConversations)
		protected.GET("/conversations/synced", convHandler.GetSyncedConversations)
		protected.GET("/conversations/:id", convHandler.GetConversation)
		protected.GET("/conversations/:id/messages", convHandler.GetMessages)
		protected.POST("/conversations/:id/read", convHandler.MarkRead)
		protected.POST("/conversations/read-all", convHandler.MarkAllRead)
		protected.DELETE("/conversations", convHandler.BatchDelete)
		protected.DELETE("/conversations/all", convHandler.DeleteAll)

		protected.GET("/search", searchHandler.Search)

		protected.GET("/stats/overview", statsHandler.GetOverview)
		protected.GET("/stats/timeline", statsHandler.GetTimeline)
		protected.GET("/stats/activity", statsHandler.GetActivity)
		protected.GET("/stats/insights", statsHandler.GetInsights)
	}

	// SPA static files
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
			if strings.HasPrefix(c.Request.URL.Path, "/api/") ||
				strings.HasPrefix(c.Request.URL.Path, "/health") {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
			if f, err := webFS.Open(c.Request.URL.Path); err == nil {
				f.Close()
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
			serveIndex(c)
		})
	} else {
		log.Printf("Warning: no frontend build found (disk or embedded), SPA routes will not be served")
	}

	return &Server{Cfg: cfg, DB: db, Engine: r}, nil
}

// Addr returns the configured listen address (host:port).
func (s *Server) Addr() string {
	return s.Cfg.Address()
}

// DataDir returns the directory where the SQLite database lives,
// useful for "open data directory" actions.
func (s *Server) DataDir() string {
	if s.Cfg.Database.Driver == "sqlite" && s.Cfg.Database.DSN != "" {
		return filepath.Dir(s.Cfg.Database.DSN)
	}
	return filepath.Join(s.Cfg.ConfigDir, "data")
}

// Start begins listening and serving. It blocks until the server is stopped.
func (s *Server) Start() error {
	ln, err := net.Listen("tcp", s.Addr())
	if err != nil {
		return err
	}
	s.listener = ln
	s.httpSrv = &http.Server{Handler: s.Engine}
	return s.httpSrv.Serve(ln)
}

// Shutdown gracefully shuts down the server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpSrv != nil {
		return s.httpSrv.Shutdown(ctx)
	}
	return nil
}
