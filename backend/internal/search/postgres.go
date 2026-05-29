package search

import (
	"fmt"

	"gorm.io/gorm"
)

// PostgresEngine implements full-text search using pg_trgm.
type PostgresEngine struct {
	DB *gorm.DB
}

func (e *PostgresEngine) Search(query *SearchQuery) (*SearchResponse, error) {
	var results []SearchResult
	var total int64

	likePattern := "%" + query.Keyword + "%"

	baseQuery := e.DB.Table("messages m").
		Joins("JOIN conversations c ON c.id = m.conv_id").
		Where("c.user_id = ? AND m.content ILIKE ?", query.UserID, likePattern)

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

	// Count
	baseQuery.Count(&total)

	// Order
	offset := (query.Page - 1) * query.PageSize
	orderClause := "m.timestamp DESC"
	if query.SortBy == "relevance" {
		orderClause = fmt.Sprintf("similarity(m.content, '%s') DESC", query.Keyword)
	}

	err := baseQuery.
		Select("c.id as conversation_id, c.platform, c.title, m.id as message_id, m.role, m.content as context, m.timestamp, c.created_at").
		Order(orderClause).
		Offset(offset).
		Limit(query.PageSize).
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	// Process results
	for i := range results {
		results[i].Context = extractContext(results[i].Context, query.Keyword, 50)
		results[i].Highlight = fmt.Sprintf("<em>%s</em>", query.Keyword)
		results[i].Score = 1.0
	}

	return &SearchResponse{
		Items:    results,
		Total:    total,
		Page:     query.Page,
		PageSize: query.PageSize,
	}, nil
}
