package models

import "time"

type SyncLog struct {
	ID             uint   `gorm:"primaryKey" json:"id"`
	UserID         uint   `gorm:"index;not null" json:"user_id"`
	ConversationID *uint  `json:"conversation_id,omitempty"`
	Action         string `gorm:"size:32;not null" json:"action"`
	SourceIP       string `gorm:"size:45" json:"source_ip"`
	RequestSize    int    `json:"request_size"`
	ErrorMessage   string `gorm:"type:text" json:"error_message,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}
