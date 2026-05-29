package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/cone387/aiinbox/backend/internal/middleware"
	"github.com/cone387/aiinbox/backend/internal/search"
)

type SearchHandler struct {
	Engine search.Engine
}

func NewSearchHandler(engine search.Engine) *SearchHandler {
	return &SearchHandler{Engine: engine}
}

// Search handles full-text search requests.
func (h *SearchHandler) Search(c *gin.Context) {
	keyword := c.Query("q")
	if len(keyword) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": "search keyword must be at least 2 characters",
		})
		return
	}
	if len(keyword) > 200 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": "search keyword must not exceed 200 characters",
		})
		return
	}

	userID := middleware.GetUserID(c)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	query := &search.SearchQuery{
		Keyword:   keyword,
		UserID:    userID,
		Platforms: c.QueryArray("platform"),
		SortBy:    c.DefaultQuery("sort_by", "relevance"),
		Page:      page,
		PageSize:  pageSize,
	}

	// Time range
	if startTime := c.Query("start_time"); startTime != "" {
		if t, err := time.Parse(time.RFC3339, startTime); err == nil {
			query.StartTime = &t
		}
	}
	if endTime := c.Query("end_time"); endTime != "" {
		if t, err := time.Parse(time.RFC3339, endTime); err == nil {
			query.EndTime = &t
		}
	}

	result, err := h.Engine.Search(query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "internal_error",
			"message": "search failed",
		})
		return
	}

	c.JSON(http.StatusOK, result)
}
