package services

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/cone387/aiinbox/backend/internal/config"
	"github.com/cone387/aiinbox/backend/internal/middleware"
	"github.com/cone387/aiinbox/backend/internal/models"
)

var (
	ErrUserExists       = errors.New("username already exists")
	ErrInvalidCredentials = errors.New("invalid username or password")
	ErrTokenExpired     = errors.New("token expired")
)

type AuthService struct {
	DB  *gorm.DB
	Cfg *config.AuthConfig
}

func NewAuthService(db *gorm.DB, cfg *config.AuthConfig) *AuthService {
	return &AuthService{DB: db, Cfg: cfg}
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
}

// Register creates a new user.
func (s *AuthService) Register(username, password string) (*models.User, error) {
	// Check if user exists
	var count int64
	s.DB.Model(&models.User{}).Where("username = ?", username).Count(&count)
	if count > 0 {
		return nil, ErrUserExists
	}

	// Hash password
	hash, err := bcrypt.GenerateFromPassword([]byte(password), s.Cfg.BcryptCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	user := &models.User{
		Username:     username,
		PasswordHash: string(hash),
	}

	if err := s.DB.Create(user).Error; err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	return user, nil
}

// Login validates credentials and returns a token pair.
func (s *AuthService) Login(username, password string) (*TokenPair, error) {
	var user models.User
	if err := s.DB.Where("username = ?", username).First(&user).Error; err != nil {
		return nil, ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	return s.generateTokenPair(&user)
}

// GenerateAPIToken creates a long-lived API token for the user.
func (s *AuthService) GenerateAPIToken(userID uint) (string, time.Time, error) {
	token, err := generateRandomToken(32)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to generate token: %w", err)
	}

	apiToken := "aic_" + token
	expires := time.Now().Add(time.Duration(s.Cfg.APITokenExpireDays) * 24 * time.Hour)

	if err := s.DB.Model(&models.User{}).Where("id = ?", userID).Updates(map[string]interface{}{
		"api_token":         apiToken,
		"api_token_expires": expires,
	}).Error; err != nil {
		return "", time.Time{}, fmt.Errorf("failed to save token: %w", err)
	}

	return apiToken, expires, nil
}

// RefreshToken generates a new token pair from a valid refresh token.
func (s *AuthService) RefreshToken(refreshToken string) (*TokenPair, error) {
	claims, err := s.parseToken(refreshToken)
	if err != nil {
		return nil, err
	}

	var user models.User
	if err := s.DB.First(&user, claims.UserID).Error; err != nil {
		return nil, ErrInvalidCredentials
	}

	return s.generateTokenPair(&user)
}

func (s *AuthService) generateTokenPair(user *models.User) (*TokenPair, error) {
	expireMinutes := s.Cfg.JWTExpireMinutes
	if expireMinutes == 0 {
		expireMinutes = 1440
	}

	// Access token
	accessClaims := &middleware.UserClaims{
		UserID:   user.ID,
		Username: user.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(expireMinutes) * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessStr, err := accessToken.SignedString([]byte(s.Cfg.JWTSecret))
	if err != nil {
		return nil, fmt.Errorf("failed to sign access token: %w", err)
	}

	// Refresh token (7 days)
	refreshClaims := &middleware.UserClaims{
		UserID:   user.ID,
		Username: user.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	refreshTokenJWT := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshStr, err := refreshTokenJWT.SignedString([]byte(s.Cfg.JWTSecret))
	if err != nil {
		return nil, fmt.Errorf("failed to sign refresh token: %w", err)
	}

	return &TokenPair{
		AccessToken:  accessStr,
		RefreshToken: refreshStr,
		TokenType:    "bearer",
		ExpiresIn:    expireMinutes * 60,
	}, nil
}

func (s *AuthService) parseToken(tokenStr string) (*middleware.UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &middleware.UserClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(s.Cfg.JWTSecret), nil
	})
	if err != nil {
		return nil, ErrTokenExpired
	}

	claims, ok := token.Claims.(*middleware.UserClaims)
	if !ok || !token.Valid {
		return nil, ErrTokenExpired
	}

	return claims, nil
}

func generateRandomToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
