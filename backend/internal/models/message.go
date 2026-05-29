package models

import "time"

type Message struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	ConvID     uint      `gorm:"index:idx_conv_timestamp;not null" json:"conv_id"`
	Role       string    `gorm:"size:16;not null" json:"role"`
	Content    string    `gorm:"type:text;not null" json:"content"`
	Timestamp  time.Time `gorm:"index:idx_conv_timestamp;not null" json:"timestamp"`
	IsComplete bool      `gorm:"default:true" json:"is_complete"`
	CreatedAt  time.Time `json:"created_at"`
}
