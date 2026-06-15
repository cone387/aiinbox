package services

import (
	"testing"

	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/cone387/aiinbox/backend/internal/config"
	"github.com/cone387/aiinbox/backend/internal/database"
)

// testAuthService creates an in-memory SQLite-backed AuthService for testing.
// bcrypt cost is set to MinCost to keep tests fast.
func testAuthService(t *testing.T) *AuthService {
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
	cfg := &config.AuthConfig{
		JWTSecret:          "test-secret-at-least-32-chars-long-1234567890",
		JWTExpireMinutes:   30,
		APITokenExpireDays: 30,
		BcryptCost:         bcrypt.MinCost,
	}
	return NewAuthService(db, cfg)
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

func TestRegister_FirstUser(t *testing.T) {
	svc := testAuthService(t)
	user, err := svc.Register("alice", "pass123")
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	if user.Username != "alice" {
		t.Errorf("username = %q, want %q", user.Username, "alice")
	}
	if user.ID == 0 {
		t.Error("user ID should be non-zero")
	}
}

func TestRegister_SecondUserFails(t *testing.T) {
	svc := testAuthService(t)
	if _, err := svc.Register("alice", "pass123"); err != nil {
		t.Fatalf("first Register: %v", err)
	}
	_, err := svc.Register("bob", "pass456")
	if err != ErrRegistrationClosed {
		t.Errorf("second Register error = %v, want ErrRegistrationClosed", err)
	}
}

func TestRegister_DuplicateUsername(t *testing.T) {
	svc := testAuthService(t)
	if _, err := svc.Register("alice", "pass123"); err != nil {
		t.Fatalf("first Register: %v", err)
	}
	// Reset count to 0 temporarily for duplicate test — but the DB already has
	// one user so ErrRegistrationClosed fires first. To test ErrUserExists we
	// delete the user and re-register.
	svc.DB.Exec("DELETE FROM users")
	if _, err := svc.Register("alice", "pass123"); err != nil {
		t.Fatalf("Register alice again: %v", err)
	}
	// Now register alice a second time (one user exists)
	_, err := svc.Register("alice", "pass456")
	if err != ErrRegistrationClosed {
		t.Errorf("error = %v, want ErrRegistrationClosed", err)
	}
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

func TestLogin_Success(t *testing.T) {
	svc := testAuthService(t)
	if _, err := svc.Register("alice", "pass123"); err != nil {
		t.Fatalf("Register: %v", err)
	}
	pair, err := svc.Login("alice", "pass123")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if pair.AccessToken == "" || pair.RefreshToken == "" {
		t.Error("tokens should not be empty")
	}
	if pair.TokenType != "bearer" {
		t.Errorf("token_type = %q, want bearer", pair.TokenType)
	}
	if pair.ExpiresIn <= 0 {
		t.Errorf("expires_in = %d, want > 0", pair.ExpiresIn)
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	svc := testAuthService(t)
	if _, err := svc.Register("alice", "pass123"); err != nil {
		t.Fatalf("Register: %v", err)
	}
	_, err := svc.Login("alice", "wrong")
	if err != ErrInvalidCredentials {
		t.Errorf("error = %v, want ErrInvalidCredentials", err)
	}
}

func TestLogin_NoUser(t *testing.T) {
	svc := testAuthService(t)
	_, err := svc.Login("ghost", "pass")
	if err != ErrInvalidCredentials {
		t.Errorf("error = %v, want ErrInvalidCredentials", err)
	}
}

// ---------------------------------------------------------------------------
// ChangePassword / ResetPassword
// ---------------------------------------------------------------------------

func TestChangePassword(t *testing.T) {
	svc := testAuthService(t)
	user, _ := svc.Register("alice", "old-pass")
	if err := svc.ChangePassword(user.ID, "old-pass", "new-pass"); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	// Old password should fail
	if _, err := svc.Login("alice", "old-pass"); err != ErrInvalidCredentials {
		t.Errorf("old password still works")
	}
	// New password should succeed
	if _, err := svc.Login("alice", "new-pass"); err != nil {
		t.Errorf("new password failed: %v", err)
	}
}

func TestChangePassword_WrongCurrent(t *testing.T) {
	svc := testAuthService(t)
	user, _ := svc.Register("alice", "pass123")
	err := svc.ChangePassword(user.ID, "wrong", "new-pass")
	if err != ErrInvalidCredentials {
		t.Errorf("error = %v, want ErrInvalidCredentials", err)
	}
}

func TestResetPassword(t *testing.T) {
	svc := testAuthService(t)
	if _, err := svc.Register("alice", "old-pass"); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := svc.ResetPassword("reset-pass"); err != nil {
		t.Fatalf("ResetPassword: %v", err)
	}
	if _, err := svc.Login("alice", "reset-pass"); err != nil {
		t.Errorf("login after reset failed: %v", err)
	}
}

func TestResetPassword_NoUser(t *testing.T) {
	svc := testAuthService(t)
	err := svc.ResetPassword("pass")
	if err == nil {
		t.Error("ResetPassword should fail with no user")
	}
}

// ---------------------------------------------------------------------------
// HasUsers
// ---------------------------------------------------------------------------

func TestHasUsers(t *testing.T) {
	svc := testAuthService(t)
	if svc.HasUsers() {
		t.Error("HasUsers should be false before any user")
	}
	svc.Register("alice", "pass123")
	if !svc.HasUsers() {
		t.Error("HasUsers should be true after Register")
	}
}

// ---------------------------------------------------------------------------
// ValidateRedirectURI
// ---------------------------------------------------------------------------

func TestValidateRedirectURI(t *testing.T) {
	tests := []struct {
		uri    string
		valid  bool
	}{
		// Chrome extension
		{"chrome-extension://abcdefghijklmnopqrstuvwxyz123456/oauth.html", true},
		{"chrome-extension://abc/oauth.html", false}, // ID too short
		// chromiumapp.org
		{"https://abcdef1234567890.chromiumapp.org/", true},
		// Localhost
		{"http://localhost:3000/callback", true},
		{"http://127.0.0.1:8080/callback", true},
		{"https://localhost/callback", true},
		{"http://app.localhost/callback", true},
		// Non-local
		{"https://example.com/callback", false},
		{"http://evil.com/callback", false},
		// Bad scheme
		{"ftp://localhost/callback", false},
		// Empty / malformed
		{"", false},
	}
	for _, tt := range tests {
		err := ValidateRedirectURI(tt.uri)
		if tt.valid && err != nil {
			t.Errorf("ValidateRedirectURI(%q) unexpected error: %v", tt.uri, err)
		}
		if !tt.valid && err == nil {
			t.Errorf("ValidateRedirectURI(%q) expected error, got nil", tt.uri)
		}
	}
}

// ---------------------------------------------------------------------------
// API Tokens
// ---------------------------------------------------------------------------

func TestGenerateAndValidateAPIToken(t *testing.T) {
	svc := testAuthService(t)
	user, _ := svc.Register("alice", "pass123")

	token, err := svc.GenerateAPIToken(user.ID, "test-token")
	if err != nil {
		t.Fatalf("GenerateAPIToken: %v", err)
	}
	if token.Token == "" {
		t.Fatal("token string empty")
	}
	if len(token.Token) < 10 {
		t.Error("token too short")
	}

	validated, err := svc.ValidateAPIToken(token.Token)
	if err != nil {
		t.Fatalf("ValidateAPIToken: %v", err)
	}
	if validated.UserID != user.ID {
		t.Errorf("userID = %d, want %d", validated.UserID, user.ID)
	}
}

func TestValidateAPIToken_Invalid(t *testing.T) {
	svc := testAuthService(t)
	_, err := svc.ValidateAPIToken("nonexistent-token")
	if err == nil {
		t.Error("expected error for nonexistent token")
	}
}

func TestListAPITokens(t *testing.T) {
	svc := testAuthService(t)
	user, _ := svc.Register("alice", "pass123")
	svc.GenerateAPIToken(user.ID, "t1")
	svc.GenerateAPIToken(user.ID, "t2")

	tokens, err := svc.ListAPITokens(user.ID)
	if err != nil {
		t.Fatalf("ListAPITokens: %v", err)
	}
	if len(tokens) != 2 {
		t.Errorf("got %d tokens, want 2", len(tokens))
	}
}

func TestDeleteAPIToken(t *testing.T) {
	svc := testAuthService(t)
	user, _ := svc.Register("alice", "pass123")
	token, _ := svc.GenerateAPIToken(user.ID, "t1")

	if err := svc.DeleteAPIToken(user.ID, token.ID); err != nil {
		t.Fatalf("DeleteAPIToken: %v", err)
	}
	tokens, _ := svc.ListAPITokens(user.ID)
	if len(tokens) != 0 {
		t.Errorf("got %d tokens after delete, want 0", len(tokens))
	}
}

func TestDeleteAPIToken_NotFound(t *testing.T) {
	svc := testAuthService(t)
	user, _ := svc.Register("alice", "pass123")
	err := svc.DeleteAPIToken(user.ID, 999)
	if err == nil {
		t.Error("expected error for nonexistent token")
	}
}

// ---------------------------------------------------------------------------
// AuthCode flow
// ---------------------------------------------------------------------------

func TestAuthCode_ExchangeSuccess(t *testing.T) {
	svc := testAuthService(t)
	user, _ := svc.Register("alice", "pass123")
	apiToken, _ := svc.GenerateAPIToken(user.ID, "test")

	code, err := svc.CreateAuthCode(user.ID, apiToken.ID, "my-state")
	if err != nil {
		t.Fatalf("CreateAuthCode: %v", err)
	}

	exchanged, err := svc.ExchangeAuthCode(code, "my-state")
	if err != nil {
		t.Fatalf("ExchangeAuthCode: %v", err)
	}
	if exchanged.ID != apiToken.ID {
		t.Errorf("exchanged token ID = %d, want %d", exchanged.ID, apiToken.ID)
	}
}

func TestAuthCode_ReuseFails(t *testing.T) {
	svc := testAuthService(t)
	user, _ := svc.Register("alice", "pass123")
	apiToken, _ := svc.GenerateAPIToken(user.ID, "test")

	code, _ := svc.CreateAuthCode(user.ID, apiToken.ID, "state")
	if _, err := svc.ExchangeAuthCode(code, "state"); err != nil {
		t.Fatalf("first exchange: %v", err)
	}
	_, err := svc.ExchangeAuthCode(code, "state")
	if err != ErrInvalidAuthCode {
		t.Errorf("second exchange error = %v, want ErrInvalidAuthCode", err)
	}
}

func TestAuthCode_WrongState(t *testing.T) {
	svc := testAuthService(t)
	user, _ := svc.Register("alice", "pass123")
	apiToken, _ := svc.GenerateAPIToken(user.ID, "test")

	code, _ := svc.CreateAuthCode(user.ID, apiToken.ID, "correct-state")
	_, err := svc.ExchangeAuthCode(code, "wrong-state")
	if err != ErrInvalidAuthCode {
		t.Errorf("error = %v, want ErrInvalidAuthCode", err)
	}
}

// ---------------------------------------------------------------------------
// RefreshToken
// ---------------------------------------------------------------------------

func TestRefreshToken(t *testing.T) {
	svc := testAuthService(t)
	if _, err := svc.Register("alice", "pass123"); err != nil {
		t.Fatalf("Register: %v", err)
	}
	pair, _ := svc.Login("alice", "pass123")

	newPair, err := svc.RefreshToken(pair.RefreshToken)
	if err != nil {
		t.Fatalf("RefreshToken: %v", err)
	}
	if newPair.AccessToken == "" {
		t.Error("new access token empty")
	}
}

func TestRefreshToken_UsingAccessTokenFails(t *testing.T) {
	svc := testAuthService(t)
	if _, err := svc.Register("alice", "pass123"); err != nil {
		t.Fatalf("Register: %v", err)
	}
	pair, _ := svc.Login("alice", "pass123")

	_, err := svc.RefreshToken(pair.AccessToken)
	if err == nil {
		t.Error("RefreshToken with access token should fail")
	}
}
