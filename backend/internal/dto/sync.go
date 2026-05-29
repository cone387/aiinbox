package dto

import "time"

type MessageCreate struct {
	Role       string    `json:"role" binding:"required,oneof=user assistant system unknown"`
	Content    string    `json:"content" binding:"required"`
	Timestamp  time.Time `json:"timestamp" binding:"required"`
	IsComplete bool      `json:"is_complete"`
}

type ConversationSync struct {
	Platform       string          `json:"platform" binding:"required,oneof=chatgpt gemini tongyi doubao"`
	ConversationID string          `json:"conversation_id" binding:"required,max=256"`
	Title          string          `json:"title"`
	Messages       []MessageCreate `json:"messages" binding:"required,min=1"`
	CreatedAt      time.Time       `json:"created_at" binding:"required"`
	UpdatedAt      time.Time       `json:"updated_at" binding:"required"`
}

type BatchSyncRequest struct {
	Conversations []ConversationSync `json:"conversations" binding:"required,min=1,max=50"`
}

type SyncResult struct {
	Success        bool   `json:"success"`
	ConversationID string `json:"conversation_id"`
	Action         string `json:"action"`
}

type BatchSyncResult struct {
	Total   int          `json:"total"`
	Created int          `json:"created"`
	Updated int          `json:"updated"`
	Failed  int          `json:"failed"`
	Results []SyncResult `json:"results"`
	Errors  []SyncError  `json:"errors"`
}

type SyncError struct {
	ConversationID string `json:"conversation_id"`
	Error          string `json:"error"`
}
