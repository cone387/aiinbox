package search

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// SQLiteEngine implements full-text search using FTS5.
type SQLiteEngine struct {
	DB *gorm.DB
}

func (e *SQLiteEngine) Search(query *SearchQuery) (*SearchResponse, error) {
	// Build the search query using FTS5 or LIKE fallback
	var results []SearchResult
	var total int64

	baseQuery := e.DB.Table("messages m").
		Joins("JOIN conversations c ON c.id = m.conv_id").
		Where("c.user_id = ?", query.UserID)

	// Platform filter
	if len(query.Platforms) > 0 {
		baseQuery = baseQuery.Where("c.platform IN ?", query.Platforms)
	}

	// Time range
	if query.StartTime != nil {
		baseQuery = baseQuery.Where("m.timestamp >= ?", query.StartTime)
	}
	if query.EndTime != nil {
		baseQuery = baseQuery.Where("m.timestamp <= ?", query.EndTime)
	}

	// Try FTS5 first, fallback to LIKE
	keyword := query.Keyword
	ftsQuery := baseQuery.Session(&gorm.Session{})

	// Use FTS5 match
	ftsQuery = ftsQuery.
		Joins("JOIN messages_fts fts ON fts.rowid = m.id").
		Where("messages_fts MATCH ?", keyword)

	// Count total
	countQuery := ftsQuery.Session(&gorm.Session{})
	if err := countQuery.Count(&total).Error; err != nil {
		// FTS5 failed, fallback to LIKE
		return e.searchWithLike(query)
	}

	// Select fields
	offset := (query.Page - 1) * query.PageSize
	orderClause := "m.timestamp DESC"
	if query.SortBy == "relevance" {
		orderClause = "rank"
	}

	err := ftsQuery.
		Select("c.id as conversation_id, c.platform, c.title, m.id as message_id, m.role, m.content as context, m.timestamp, c.created_at").
		Order(orderClause).
		Offset(offset).
		Limit(query.PageSize).
		Scan(&results).Error

	if err != nil {
		return e.searchWithLike(query)
	}

	// Add highlights
	for i := range results {
		results[i].Context = extractContext(results[i].Context, keyword, 50)
		results[i].Highlight = fmt.Sprintf("<em>%s</em>", keyword)
		results[i].Score = 1.0
	}

	return &SearchResponse{
		Items:    results,
		Total:    total,
		Page:     query.Page,
		PageSize: query.PageSize,
	}, nil
}

func (e *SQLiteEngine) searchWithLike(query *SearchQuery) (*SearchResponse, error) {
	var results []SearchResult
	var total int64

	likePattern := "%" + query.Keyword + "%"

	baseQuery := e.DB.Table("messages m").
		Joins("JOIN conversations c ON c.id = m.conv_id").
		Where("c.user_id = ? AND m.content LIKE ?", query.UserID, likePattern)

	if len(query.Platforms) > 0 {
		baseQuery = baseQuery.Where("c.platform IN ?", query.Platforms)
	}
	if query.StartTime != nil {
		baseQuery = baseQuery.Where("m.timestamp >= ?", query.StartTime)
	}
	if query.EndTime != nil {
		baseQuery = baseQuery.Where("m.timestamp <= ?", query.EndTime)
	}

	baseQuery.Count(&total)

	offset := (query.Page - 1) * query.PageSize
	err := baseQuery.
		Select("c.id as conversation_id, c.platform, c.title, m.id as message_id, m.role, m.content as context, m.timestamp, c.created_at").
		Order("m.timestamp DESC").
		Offset(offset).
		Limit(query.PageSize).
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	for i := range results {
		results[i].Context = extractContext(results[i].Context, query.Keyword, 50)
		results[i].Highlight = fmt.Sprintf("<em>%s</em>", query.Keyword)
		results[i].Score = 0.5
	}

	return &SearchResponse{
		Items:    results,
		Total:    total,
		Page:     query.Page,
		PageSize: query.PageSize,
	}, nil
}

// extractContext extracts surrounding context around the keyword.
func extractContext(content, keyword string, contextLen int) string {
	lower := strings.ToLower(content)
	kw := strings.ToLower(keyword)
	idx := strings.Index(lower, kw)
	if idx == -1 {
		if len(content) > contextLen*2+len(keyword) {
			return content[:contextLen*2+len(keyword)] + "..."
		}
		return content
	}

	start := idx - contextLen
	if start < 0 {
		start = 0
	}
	end := idx + len(keyword) + contextLen
	if end > len(content) {
		end = len(content)
	}

	result := ""
	if start > 0 {
		result = "..."
	}
	result += content[start:end]
	if end < len(content) {
		result += "..."
	}
	return result
}
