package models

import "time"

type Conversation struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	UserID         uint      `gorm:"index:idx_user_platform;index:idx_user_created;not null" json:"user_id"`
	Platform       string    `gorm:"size:32;index:idx_user_platform;not null" json:"platform"`
	ConversationID string    `gorm:"size:256;uniqueIndex:idx_user_conv_id;not null" json:"conversation_id"`
	Title          string    `gorm:"size:500" json:"title"`
	MessageCount   int       `gorm:"default:0" json:"message_count"`
	CreatedAt      time.Time `gorm:"index:idx_user_created;not null" json:"created_at"`
	UpdatedAt      time.Time `gorm:"not null" json:"updated_at"`
	SyncedAt       time.Time `json:"synced_at"`
	Messages       []Message `gorm:"foreignKey:ConvID" json:"messages,omitempty"`
}
