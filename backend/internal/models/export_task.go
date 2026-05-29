package models

import "time"

type ExportTask struct {
	ID                 string     `gorm:"primaryKey;size:36" json:"id"`
	UserID             uint       `gorm:"index;not null" json:"user_id"`
	Format             string     `gorm:"size:16;not null" json:"format"`
	Status             string     `gorm:"size:16;not null;default:processing" json:"status"`
	Filters            string     `gorm:"type:text" json:"filters,omitempty"`
	FilePath           string     `gorm:"size:512" json:"-"`
	FileSize           int64      `json:"file_size,omitempty"`
	TotalConversations int        `json:"total_conversations"`
	DownloadURL        string     `gorm:"size:1024" json:"download_url,omitempty"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	CompletedAt        *time.Time `json:"completed_at,omitempty"`
}
