package middleware

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"

	"github.com/cone387/aiinbox/backend/internal/models"
)

type AuthMiddleware struct {
	JWTSecret string
	DB        *gorm.DB
}

type UserClaims struct {
	UserID    uint   `json:"user_id"`
	Username  string `json:"username"`
	TokenType string `json:"token_type"` // "access" or "refresh"
	jwt.RegisteredClaims
}

func NewAuthMiddleware(jwtSecret string, db *gorm.DB) *AuthMiddleware {
	return &AuthMiddleware{
		JWTSecret: jwtSecret,
		DB:        db,
	}
}

// RequireAuth is a Gin middleware that validates JWT or API Token.
func (m *AuthMiddleware) RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "missing authorization header",
			})
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == authHeader {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "invalid authorization format, use: Bearer <token>",
			})
			return
		}

		// Debug: log token prefix
		tokenLen := len(token)
		if tokenLen > 15 {
			tokenLen = 15
		}
		fmt.Printf("[Auth] Token received: %s...\n", token[:tokenLen])

		// Try JWT first
		claims, err := m.validateJWT(token)
		if err == nil {
			if claims.TokenType != "access" {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
					"error":   "unauthorized",
					"message": "invalid token type, expected access token",
				})
				return
			}
			c.Set("user_id", claims.UserID)
			c.Set("username", claims.Username)
			c.Next()
			return
		}
		fmt.Printf("[Auth] JWT validation failed: %v\n", err)

		// Try API Token
		user, err := m.validateAPIToken(token)
		if err == nil {
			c.Set("user_id", user.ID)
			c.Set("username", user.Username)
			c.Next()
			return
		}
		fmt.Printf("[Auth] API token validation failed: %v\n", err)

		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "invalid or expired token",
		})
	}
}

func (m *AuthMiddleware) validateJWT(tokenStr string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &UserClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(m.JWTSecret), nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*UserClaims)
	if !ok || !token.Valid {
		return nil, jwt.ErrTokenInvalidClaims
	}

	return claims, nil
}

func (m *AuthMiddleware) validateAPIToken(token string) (*models.User, error) {
	var apiToken models.APIToken
	err := m.DB.Where("token = ?", token).First(&apiToken).Error
	if err != nil {
		return nil, err
	}

	// Check expiry manually
	if !apiToken.ExpiresAt.IsZero() && apiToken.ExpiresAt.Before(time.Now()) {
		return nil, fmt.Errorf("token expired")
	}

	// Update last_used
	now := time.Now()
	m.DB.Model(&apiToken).Update("last_used", &now)

	var user models.User
	if err := m.DB.First(&user, apiToken.UserID).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// GetUserID extracts user ID from gin context (set by RequireAuth middleware).
func GetUserID(c *gin.Context) uint {
	userID, _ := c.Get("user_id")
	return userID.(uint)
}

// ParseRefreshToken validates that a JWT is a refresh token and returns its claims.
func (m *AuthMiddleware) ParseRefreshToken(tokenStr string) (*UserClaims, error) {
	claims, err := m.validateJWT(tokenStr)
	if err != nil {
		return nil, err
	}
	if claims.TokenType != "refresh" {
		return nil, fmt.Errorf("invalid token type, expected refresh token")
	}
	return claims, nil
}
