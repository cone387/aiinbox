package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/cone387/aiinbox/backend/internal/database"
	"github.com/cone387/aiinbox/backend/internal/models"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// ---------------------------------------------------------------------------
// LocalhostOnly
// ---------------------------------------------------------------------------

func TestLocalhostOnly_AllowsLoopback(t *testing.T) {
	router := gin.New()
	router.Use(LocalhostOnly())
	router.GET("/test", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d (RemoteAddr=127.0.0.1)", w.Code, http.StatusOK)
	}
}

func TestLocalhostOnly_AllowsIPv6Loopback(t *testing.T) {
	router := gin.New()
	router.Use(LocalhostOnly())
	router.GET("/test", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "[::1]:12345"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d (RemoteAddr=[::1])", w.Code, http.StatusOK)
	}
}

func TestLocalhostOnly_BlocksExternal(t *testing.T) {
	router := gin.New()
	router.Use(LocalhostOnly())
	router.GET("/test", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "203.0.113.5:12345"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d (RemoteAddr=203.0.113.5)", w.Code, http.StatusForbidden)
	}
}

func TestLocalhostOnly_BlocksPrivateIP(t *testing.T) {
	router := gin.New()
	router.Use(LocalhostOnly())
	router.GET("/test", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "192.168.1.100:54321"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d (RemoteAddr=192.168.1.100)", w.Code, http.StatusForbidden)
	}
}

// ---------------------------------------------------------------------------
// RequireAuth
// ---------------------------------------------------------------------------

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func generateTestJWT(secret, tokenType string, userID uint, username string, expires time.Time) string {
	claims := &UserClaims{
		UserID:    userID,
		Username:  username,
		TokenType: tokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expires),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := token.SignedString([]byte(secret))
	return s
}

func TestRequireAuth_ValidJWT(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long-1234567890"
	db := newTestDB(t)
	mw := NewAuthMiddleware(secret, db)

	router := gin.New()
	router.Use(mw.RequireAuth())
	router.GET("/me", func(c *gin.Context) {
		uid, _ := c.Get("user_id")
		c.String(http.StatusOK, "%d", uid.(uint))
	})

	token := generateTestJWT(secret, "access", 42, "alice", time.Now().Add(time.Hour))
	req := httptest.NewRequest("GET", "/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", w.Code, http.StatusOK, w.Body.String())
	}
	if w.Body.String() != "42" {
		t.Errorf("body = %q, want %q", w.Body.String(), "42")
	}
}

func TestRequireAuth_ExpiredJWT(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long-1234567890"
	db := newTestDB(t)
	mw := NewAuthMiddleware(secret, db)

	router := gin.New()
	router.Use(mw.RequireAuth())
	router.GET("/me", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	token := generateTestJWT(secret, "access", 1, "alice", time.Now().Add(-time.Hour))
	req := httptest.NewRequest("GET", "/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestRequireAuth_RefreshTokenRejected(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long-1234567890"
	db := newTestDB(t)
	mw := NewAuthMiddleware(secret, db)

	router := gin.New()
	router.Use(mw.RequireAuth())
	router.GET("/me", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	// A refresh token should not pass as access token
	token := generateTestJWT(secret, "refresh", 1, "alice", time.Now().Add(time.Hour))
	req := httptest.NewRequest("GET", "/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestRequireAuth_MissingHeader(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long-1234567890"
	db := newTestDB(t)
	mw := NewAuthMiddleware(secret, db)

	router := gin.New()
	router.Use(mw.RequireAuth())
	router.GET("/me", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest("GET", "/me", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestRequireAuth_BadFormat(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long-1234567890"
	db := newTestDB(t)
	mw := NewAuthMiddleware(secret, db)

	router := gin.New()
	router.Use(mw.RequireAuth())
	router.GET("/me", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest("GET", "/me", nil)
	req.Header.Set("Authorization", "Token xyz") // wrong format
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestRequireAuth_ValidAPIToken(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long-1234567890"
	db := newTestDB(t)
	mw := NewAuthMiddleware(secret, db)

	// Create a user and API token
	user := &models.User{Username: "alice", PasswordHash: "dummy"}
	db.Create(user)
	apiToken := &models.APIToken{
		UserID:    user.ID,
		Name:      "test",
		Token:     "aic_test_token_value",
		ExpiresAt: time.Now().Add(24 * time.Hour),
	}
	db.Create(apiToken)

	router := gin.New()
	router.Use(mw.RequireAuth())
	router.GET("/me", func(c *gin.Context) {
		uname, _ := c.Get("username")
		c.String(http.StatusOK, "%s", uname.(string))
	})

	req := httptest.NewRequest("GET", "/me", nil)
	req.Header.Set("Authorization", "Bearer aic_test_token_value")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d, body = %s", w.Code, http.StatusOK, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "alice") {
		t.Errorf("body = %q, expected to contain 'alice'", w.Body.String())
	}
}

func TestRequireAuth_ExpiredAPIToken(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long-1234567890"
	db := newTestDB(t)
	mw := NewAuthMiddleware(secret, db)

	user := &models.User{Username: "alice", PasswordHash: "dummy"}
	db.Create(user)
	apiToken := &models.APIToken{
		UserID:    user.ID,
		Name:      "test",
		Token:     "aic_expired_token",
		ExpiresAt: time.Now().Add(-time.Hour),
	}
	db.Create(apiToken)

	router := gin.New()
	router.Use(mw.RequireAuth())
	router.GET("/me", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest("GET", "/me", nil)
	req.Header.Set("Authorization", "Bearer aic_expired_token")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

// ---------------------------------------------------------------------------
// ParseRefreshToken
// ---------------------------------------------------------------------------

func TestParseRefreshToken_Valid(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long-1234567890"
	db := newTestDB(t)
	mw := NewAuthMiddleware(secret, db)

	token := generateTestJWT(secret, "refresh", 7, "bob", time.Now().Add(time.Hour))
	claims, err := mw.ParseRefreshToken(token)
	if err != nil {
		t.Fatalf("ParseRefreshToken: %v", err)
	}
	if claims.UserID != 7 || claims.Username != "bob" {
		t.Errorf("claims = %+v, want userID=7 username=bob", claims)
	}
}

func TestParseRefreshToken_AccessTokenFails(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long-1234567890"
	db := newTestDB(t)
	mw := NewAuthMiddleware(secret, db)

	token := generateTestJWT(secret, "access", 1, "alice", time.Now().Add(time.Hour))
	_, err := mw.ParseRefreshToken(token)
	if err == nil {
		t.Error("ParseRefreshToken with access token should fail")
	}
}
