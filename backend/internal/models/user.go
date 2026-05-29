package models

import "time"

type User struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	Username        string     `gorm:"uniqueIndex;size:64;not null" json:"username"`
	PasswordHash    string     `gorm:"size:256;not null" json:"-"`
	APIToken        string     `gorm:"size:512" json:"-"`
	APITokenExpires *time.Time `json:"-"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}
