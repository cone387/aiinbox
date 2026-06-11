package services

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
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
	ErrInvalidAuthCode  = errors.New("invalid or expired auth code")
)

// authCodeEntry represents a short-lived authorization code.
type authCodeEntry struct {
	UserID    uint
	TokenID   uint // the API token ID to return when exchanged
	State     string
	CreatedAt time.Time
}

type AuthService struct {
	DB  *gorm.DB
	Cfg *config.AuthConfig

	authCodes   sync.Map // code -> authCodeEntry
	authCodesMu sync.Mutex
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

// ChangePassword verifies the current password and updates to the new one.
func (s *AuthService) ChangePassword(userID uint, currentPassword, newPassword string) error {
	var user models.User
	if err := s.DB.First(&user, userID).Error; err != nil {
		return ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(currentPassword)); err != nil {
		return ErrInvalidCredentials
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), s.Cfg.BcryptCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	return s.DB.Model(&user).Update("password_hash", string(hash)).Error
}

// GenerateAPIToken creates a long-lived API token for the user.
func (s *AuthService) GenerateAPIToken(userID uint, name string) (*models.APIToken, error) {
	token, err := generateRandomToken(32)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	apiToken := &models.APIToken{
		UserID:    userID,
		Name:      name,
		Token:     "aic_" + token,
		ExpiresAt: time.Now().Add(time.Duration(s.Cfg.APITokenExpireDays) * 24 * time.Hour),
	}

	if err := s.DB.Create(apiToken).Error; err != nil {
		return nil, fmt.Errorf("failed to save token: %w", err)
	}

	return apiToken, nil
}

// ListAPITokens returns all API tokens for a user.
func (s *AuthService) ListAPITokens(userID uint) ([]models.APIToken, error) {
	var tokens []models.APIToken
	err := s.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&tokens).Error
	return tokens, err
}

// DeleteAPIToken deletes a specific API token.
func (s *AuthService) DeleteAPIToken(userID uint, tokenID uint) error {
	result := s.DB.Where("id = ? AND user_id = ?", tokenID, userID).Delete(&models.APIToken{})
	if result.RowsAffected == 0 {
		return errors.New("token not found")
	}
	return result.Error
}

// ValidateAPIToken checks if an API token is valid and updates last_used.
func (s *AuthService) ValidateAPIToken(token string) (*models.APIToken, error) {
	var apiToken models.APIToken
	err := s.DB.Where("token = ? AND expires_at > ?", token, time.Now()).First(&apiToken).Error
	if err != nil {
		return nil, err
	}
	// Update last_used
	now := time.Now()
	s.DB.Model(&apiToken).Update("last_used", &now)
	return &apiToken, nil
}

// ValidateRedirectURI checks whether a redirect URI is acceptable for the OAuth flow.
// Allowed: chrome-extension://<id>/..., https://<id>.chromiumapp.org/ (chrome.identity),
// and http(s)://localhost/127.0.0.1 for development.
func ValidateRedirectURI(rawURI string) error {
	u, err := url.Parse(rawURI)
	if err != nil {
		return fmt.Errorf("invalid redirect_uri")
	}
	switch u.Scheme {
	case "chrome-extension":
		if len(u.Host) < 10 {
			return fmt.Errorf("invalid chrome extension id")
		}
		return nil
	case "https":
		// chrome.identity.getRedirectURL() returns https://<id>.chromiumapp.org/
		if strings.HasSuffix(u.Hostname(), ".chromiumapp.org") {
			return nil
		}
		host := u.Hostname()
		if host == "localhost" || host == "127.0.0.1" || host == "::1" || strings.HasSuffix(host, ".localhost") {
			return nil
		}
		return fmt.Errorf("non-local redirect_uri not allowed")
	case "http":
		host := u.Hostname()
		if host == "localhost" || host == "127.0.0.1" || host == "::1" || strings.HasSuffix(host, ".localhost") {
			return nil
		}
		return fmt.Errorf("non-local redirect_uri not allowed")
	default:
		return fmt.Errorf("unsupported redirect_uri scheme")
	}
}

// CreateAuthCode generates a short-lived authorization code tied to a user + API token.
// The code must be exchanged within 60 seconds.
func (s *AuthService) CreateAuthCode(userID uint, tokenID uint, state string) (string, error) {
	code, err := generateRandomToken(32)
	if err != nil {
		return "", err
	}
	s.authCodes.Store(code, authCodeEntry{
		UserID:    userID,
		TokenID:   tokenID,
		State:     state,
		CreatedAt: time.Now(),
	})
	// Best-effort cleanup of expired codes
	go s.cleanupAuthCodes()
	return code, nil
}

// ExchangeAuthCode consumes a one-time auth code and returns the associated API token.
// The code is single-use and expires after 60 seconds.
func (s *AuthService) ExchangeAuthCode(code, state string) (*models.APIToken, error) {
	v, ok := s.authCodes.LoadAndDelete(code)
	if !ok {
		return nil, ErrInvalidAuthCode
	}
	entry := v.(authCodeEntry)
	if time.Since(entry.CreatedAt) > 60*time.Second {
		return nil, ErrInvalidAuthCode
	}
	if entry.State != state {
		return nil, ErrInvalidAuthCode
	}
	var token models.APIToken
	if err := s.DB.Where("id = ? AND user_id = ?", entry.TokenID, entry.UserID).First(&token).Error; err != nil {
		return nil, ErrInvalidAuthCode
	}
	return &token, nil
}

func (s *AuthService) cleanupAuthCodes() {
	now := time.Now()
	s.authCodes.Range(func(key, value any) bool {
		if e, ok := value.(authCodeEntry); ok && now.Sub(e.CreatedAt) > 5*time.Minute {
			s.authCodes.Delete(key)
		}
		return true
	})
}

// RefreshToken generates a new token pair from a valid refresh token.
func (s *AuthService) RefreshToken(refreshToken string) (*TokenPair, error) {
	claims, err := s.parseToken(refreshToken)
	if err != nil {
		return nil, err
	}
	if claims.TokenType != "refresh" {
		return nil, ErrTokenExpired
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
		UserID:    user.ID,
		Username:  user.Username,
		TokenType: "access",
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
		UserID:    user.ID,
		Username:  user.Username,
		TokenType: "refresh",
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
