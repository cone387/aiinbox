package models

import "time"

type SyncStatus struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	UserID       uint      `gorm:"uniqueIndex:idx_user_platform_sync;not null" json:"user_id"`
	Platform     string    `gorm:"size:32;uniqueIndex:idx_user_platform_sync;not null" json:"platform"`
	LastSyncedAt time.Time `json:"last_synced_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}
