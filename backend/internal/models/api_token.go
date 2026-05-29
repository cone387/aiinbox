package models

import "time"

type APIToken struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	Name      string    `gorm:"size:128;not null" json:"name"`
	Token     string    `gorm:"size:512;uniqueIndex;not null" json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}
