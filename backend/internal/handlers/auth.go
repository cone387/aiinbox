package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/cone387/aiinbox/backend/internal/middleware"
	"github.com/cone387/aiinbox/backend/internal/services"
)

type AuthHandler struct {
	AuthService *services.AuthService
}

func NewAuthHandler(authService *services.AuthService) *AuthHandler {
	return &AuthHandler{AuthService: authService}
}

type RegisterRequest struct {
	Username string `json:"username" binding:"required,min=3,max=64"`
	Password string `json:"password" binding:"required,min=6,max=128"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

// Register handles user registration.
func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	user, err := h.AuthService.Register(req.Username, req.Password)
	if err != nil {
		if err == services.ErrUserExists {
			c.JSON(http.StatusConflict, gin.H{
				"error":   "user_exists",
				"message": "username already exists",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "internal_error",
			"message": "failed to create user",
		})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"user_id":    user.ID,
		"username":   user.Username,
		"created_at": user.CreatedAt,
	})
}

// Login handles user login and returns JWT tokens.
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	tokenPair, err := h.AuthService.Login(req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "invalid username or password",
		})
		return
	}

	c.JSON(http.StatusOK, tokenPair)
}

// GenerateAPIToken creates a long-lived API token.
func (h *AuthHandler) GenerateAPIToken(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req struct {
		Name string `json:"name" binding:"required,min=1,max=128"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		// Default name if not provided
		req.Name = "Default"
	}

	token, err := h.AuthService.GenerateAPIToken(userID, req.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "internal_error",
			"message": "failed to generate API token",
		})
		return
	}

	c.JSON(http.StatusOK, token)
}

// ListAPITokens returns all tokens for the user.
func (h *AuthHandler) ListAPITokens(c *gin.Context) {
	userID := middleware.GetUserID(c)

	tokens, err := h.AuthService.ListAPITokens(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "internal_error",
			"message": "failed to list tokens",
		})
		return
	}

	// Mask token values for security (show first 8 chars + last 4)
	type TokenView struct {
		ID        uint   `json:"id"`
		Name      string `json:"name"`
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
		LastUsed  string `json:"last_used,omitempty"`
		CreatedAt string `json:"created_at"`
	}

	views := make([]TokenView, 0, len(tokens))
	for _, t := range tokens {
		masked := t.Token
		if len(masked) > 12 {
			masked = masked[:8] + "..." + masked[len(masked)-4:]
		}
		lastUsed := ""
		if t.LastUsed != nil {
			lastUsed = t.LastUsed.Format("2006-01-02 15:04:05")
		}
		views = append(views, TokenView{
			ID:        t.ID,
			Name:      t.Name,
			Token:     masked,
			ExpiresAt: t.ExpiresAt.Format("2006-01-02 15:04:05"),
			LastUsed:  lastUsed,
			CreatedAt: t.CreatedAt.Format("2006-01-02 15:04:05"),
		})
	}

	c.JSON(http.StatusOK, gin.H{"tokens": views})
}

// DeleteAPIToken deletes a specific token.
func (h *AuthHandler) DeleteAPIToken(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req struct {
		ID uint `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "validation_error", "message": err.Error()})
		return
	}

	if err := h.AuthService.DeleteAPIToken(userID, req.ID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "token not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// RefreshToken generates new tokens from a refresh token.
func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	tokenPair, err := h.AuthService.RefreshToken(req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "token_expired",
			"message": "invalid or expired refresh token",
		})
		return
	}

	c.JSON(http.StatusOK, tokenPair)
}
