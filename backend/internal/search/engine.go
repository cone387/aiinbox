package search

import (
	"time"

	"gorm.io/gorm"
)

// SearchResult represents a single search result item.
type SearchResult struct {
	ConversationID uint      `json:"conversation_id"`
	Platform       string    `json:"platform"`
	Title          string    `json:"title"`
	MessageID      uint      `json:"message_id"`
	Role           string    `json:"role"`
	Context        string    `json:"context"`
	Highlight      string    `json:"highlight"`
	Timestamp      time.Time `json:"timestamp"`
	CreatedAt      time.Time `json:"created_at"`
	Score          float64   `json:"relevance_score"`
}

// SearchQuery represents search parameters.
type SearchQuery struct {
	Keyword   string
	UserID    uint
	Platforms []string
	StartTime *time.Time
	EndTime   *time.Time
	SortBy    string // "relevance" | "time"
	Page      int
	PageSize  int
}

// SearchResponse represents the search response.
type SearchResponse struct {
	Items    []SearchResult `json:"items"`
	Total    int64          `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
}

// Engine is the interface for full-text search implementations.
type Engine interface {
	Search(query *SearchQuery) (*SearchResponse, error)
}

// NewEngine creates a search engine based on the database driver.
func NewEngine(db *gorm.DB, driver string) Engine {
	switch driver {
	case "sqlite":
		return &SQLiteEngine{DB: db}
	case "postgres":
		return &PostgresEngine{DB: db}
	default:
		return &SQLiteEngine{DB: db}
	}
}
