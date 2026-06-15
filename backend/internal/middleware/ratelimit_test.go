package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func setupRateLimitRouter(rl *RateLimiter) *gin.Engine {
	router := gin.New()
	router.Use(rl.Limit(IPKeyFunc))
	router.GET("/api", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})
	return router
}

func TestRateLimiter_AllowsWithinLimit(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)
	router := setupRateLimitRouter(rl)

	for i := 0; i < 5; i++ {
		req := httptest.NewRequest("GET", "/api", nil)
		req.RemoteAddr = "10.0.0.1:12345"
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want %d", i+1, w.Code, http.StatusOK)
		}
	}
}

func TestRateLimiter_BlocksOverLimit(t *testing.T) {
	rl := NewRateLimiter(3, time.Minute)
	router := setupRateLimitRouter(rl)

	// First 3 should pass
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("GET", "/api", nil)
		req.RemoteAddr = "10.0.0.2:12345"
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want %d", i+1, w.Code, http.StatusOK)
		}
	}

	// 4th should be rate limited
	req := httptest.NewRequest("GET", "/api", nil)
	req.RemoteAddr = "10.0.0.2:12345"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("request 4: status = %d, want %d", w.Code, http.StatusTooManyRequests)
	}
}

func TestRateLimiter_DifferentIPsIndependent(t *testing.T) {
	rl := NewRateLimiter(2, time.Minute)
	router := setupRateLimitRouter(rl)

	for _, ip := range []string{"10.0.0.3", "10.0.0.4"} {
		for i := 0; i < 2; i++ {
			req := httptest.NewRequest("GET", "/api", nil)
			req.RemoteAddr = ip + ":12345"
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Errorf("IP %s request %d: status = %d, want %d", ip, i+1, w.Code, http.StatusOK)
			}
		}
	}
}

func TestRateLimiter_Block(t *testing.T) {
	rl := NewRateLimiter(100, time.Minute)
	router := setupRateLimitRouter(rl)

	// Block a specific IP
	rl.Block("10.0.0.5", time.Minute)

	req := httptest.NewRequest("GET", "/api", nil)
	req.RemoteAddr = "10.0.0.5:12345"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Errorf("blocked IP: status = %d, want %d", w.Code, http.StatusTooManyRequests)
	}
}

func TestRateLimiter_WindowReset(t *testing.T) {
	// Use a very short window for testing
	rl := NewRateLimiter(1, 50*time.Millisecond)
	router := setupRateLimitRouter(rl)

	// First request passes
	req := httptest.NewRequest("GET", "/api", nil)
	req.RemoteAddr = "10.0.0.6:12345"
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("first request: status = %d, want %d", w.Code, http.StatusOK)
	}

	// Second fails
	req = httptest.NewRequest("GET", "/api", nil)
	req.RemoteAddr = "10.0.0.6:12345"
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("second request: status = %d, want %d", w.Code, http.StatusTooManyRequests)
	}

	// Wait for window to expire
	time.Sleep(60 * time.Millisecond)

	// Should pass again
	req = httptest.NewRequest("GET", "/api", nil)
	req.RemoteAddr = "10.0.0.6:12345"
	w = httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("after reset: status = %d, want %d", w.Code, http.StatusOK)
	}
}

// ---------------------------------------------------------------------------
// Key functions
// ---------------------------------------------------------------------------

func TestIPKeyFunc(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req

	key := IPKeyFunc(c)
	if key != "192.168.1.1" {
		t.Errorf("IPKeyFunc = %q, want %q", key, "192.168.1.1")
	}
}

func TestUserKeyFunc_WithUser(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("user_id", uint(42))

	key := UserKeyFunc(c)
	if key != "user:42" {
		t.Errorf("UserKeyFunc = %q, want %q", key, "user:42")
	}
}

func TestUserKeyFunc_WithoutUser(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.1:9999"
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = req

	key := UserKeyFunc(c)
	if key != "10.0.0.1" {
		t.Errorf("UserKeyFunc = %q, want %q", key, "10.0.0.1")
	}
}
