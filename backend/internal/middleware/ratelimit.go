package middleware

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type RateLimiter struct {
	mu       sync.RWMutex
	visitors map[string]*visitor
	limit    int
	window   time.Duration
}

type visitor struct {
	count    int
	lastSeen time.Time
	blocked  bool
	blockEnd time.Time
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		visitors: make(map[string]*visitor),
		limit:    limit,
		window:   window,
	}
	// Cleanup goroutine
	go rl.cleanup()
	return rl
}

func (rl *RateLimiter) cleanup() {
	for {
		time.Sleep(time.Minute)
		rl.mu.Lock()
		for key, v := range rl.visitors {
			if time.Since(v.lastSeen) > rl.window*2 {
				delete(rl.visitors, key)
			}
		}
		rl.mu.Unlock()
	}
}

// Limit returns a Gin middleware that rate-limits by the given key function.
func (rl *RateLimiter) Limit(keyFunc func(*gin.Context) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := keyFunc(c)

		rl.mu.Lock()
		v, exists := rl.visitors[key]
		if !exists {
			v = &visitor{}
			rl.visitors[key] = v
		}

		// Check if blocked
		if v.blocked {
			if time.Now().Before(v.blockEnd) {
				rl.mu.Unlock()
				retryAfter := int(time.Until(v.blockEnd).Seconds())
				c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
					"error":       "rate_limited",
					"retry_after": retryAfter,
				})
				return
			}
			// Block expired, reset
			v.blocked = false
			v.count = 0
		}

		// Reset counter if window expired
		if time.Since(v.lastSeen) > rl.window {
			v.count = 0
		}

		v.count++
		v.lastSeen = time.Now()

		if v.count > rl.limit {
			rl.mu.Unlock()
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error":       "rate_limited",
				"retry_after": int(rl.window.Seconds()),
			})
			return
		}

		rl.mu.Unlock()
		c.Next()
	}
}

// Block blocks a key for the specified duration.
func (rl *RateLimiter) Block(key string, duration time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, exists := rl.visitors[key]
	if !exists {
		v = &visitor{}
		rl.visitors[key] = v
	}
	v.blocked = true
	v.blockEnd = time.Now().Add(duration)
}

// IPKeyFunc returns the client IP as the rate limit key.
func IPKeyFunc(c *gin.Context) string {
	return c.ClientIP()
}

// UserKeyFunc returns the user ID as the rate limit key.
func UserKeyFunc(c *gin.Context) string {
	userID, exists := c.Get("user_id")
	if !exists {
		return c.ClientIP()
	}
	return fmt.Sprintf("user:%d", userID.(uint))
}
