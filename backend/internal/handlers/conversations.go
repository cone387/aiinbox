package handlers

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/cone387/aiinbox/backend/internal/middleware"
	"github.com/cone387/aiinbox/backend/internal/models"
	"gorm.io/gorm"
)

type ConversationHandler struct {
	DB *gorm.DB
}

func NewConversationHandler(db *gorm.DB) *ConversationHandler {
	return &ConversationHandler{DB: db}
}

type PaginatedResponse struct {
	Items      interface{} `json:"items"`
	Total      int64       `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	TotalPages int         `json:"total_pages"`
}

// ListConversations returns paginated conversation list with filters.
func (h *ConversationHandler) ListConversations(c *gin.Context) {
	userID := middleware.GetUserID(c)

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	sortBy := c.DefaultQuery("sort_by", "synced_at")
	order := c.DefaultQuery("order", "desc")
	if sortBy != "created_at" && sortBy != "updated_at" && sortBy != "synced_at" {
		sortBy = "synced_at"
	}
	if order != "asc" && order != "desc" {
		order = "desc"
	}

	query := h.DB.Model(&models.Conversation{}).Where("user_id = ?", userID)

	// Platform filter
	platforms := c.QueryArray("platform")
	if len(platforms) > 0 {
		query = query.Where("platform IN ?", platforms)
	}

	// Time range filter
	if startTime := c.Query("start_time"); startTime != "" {
		if t, err := time.Parse(time.RFC3339, startTime); err == nil {
			query = query.Where("created_at >= ?", t)
		}
	}
	if endTime := c.Query("end_time"); endTime != "" {
		if t, err := time.Parse(time.RFC3339, endTime); err == nil {
			query = query.Where("created_at <= ?", t)
		}
	}

	// Count total
	var total int64
	query.Count(&total)

	// Fetch page
	var conversations []models.Conversation
	offset := (page - 1) * pageSize
	query.Order(sortBy + " " + order).Offset(offset).Limit(pageSize).Find(&conversations)

	totalPages := int(math.Ceil(float64(total) / float64(pageSize)))

	// Add has_unread computed field
	type ConversationWithUnread struct {
		models.Conversation
		HasUnread bool `json:"has_unread"`
	}
	items := make([]ConversationWithUnread, 0, len(conversations))
	for _, conv := range conversations {
		hasUnread := conv.LastReadAt == nil || conv.SyncedAt.After(*conv.LastReadAt)
		items = append(items, ConversationWithUnread{
			Conversation: conv,
			HasUnread:    hasUnread,
		})
	}

	c.JSON(http.StatusOK, PaginatedResponse{
		Items:      items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	})
}

// GetConversation returns a single conversation with all messages.
func (h *ConversationHandler) GetConversation(c *gin.Context) {
	userID := middleware.GetUserID(c)
	id := c.Param("id")

	var conv models.Conversation
	err := h.DB.Where("user_id = ? AND id = ?", userID, id).
		Preload("Messages", func(db *gorm.DB) *gorm.DB {
			return db.Order("timestamp ASC")
		}).
		First(&conv).Error

	if err == gorm.ErrRecordNotFound {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "not_found",
			"message": "conversation not found",
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "internal_error",
			"message": "failed to fetch conversation",
		})
		return
	}

	c.JSON(http.StatusOK, conv)
}

// GetMessages returns paginated messages for a conversation.
func (h *ConversationHandler) GetMessages(c *gin.Context) {
	userID := middleware.GetUserID(c)
	id := c.Param("id")

	// Verify ownership
	var conv models.Conversation
	if err := h.DB.Where("user_id = ? AND id = ?", userID, id).First(&conv).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error":   "not_found",
			"message": "conversation not found",
		})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}

	var total int64
	h.DB.Model(&models.Message{}).Where("conv_id = ?", conv.ID).Count(&total)

	var messages []models.Message
	offset := (page - 1) * pageSize
	h.DB.Where("conv_id = ?", conv.ID).Order("timestamp ASC").Offset(offset).Limit(pageSize).Find(&messages)

	totalPages := int(math.Ceil(float64(total) / float64(pageSize)))

	c.JSON(http.StatusOK, PaginatedResponse{
		Items:      messages,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	})
}

// BatchDelete deletes conversations by IDs.
func (h *ConversationHandler) BatchDelete(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req struct {
		IDs []uint `json:"ids" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	// Delete messages first, then conversations
	var convIDs []uint
	h.DB.Model(&models.Conversation{}).Where("user_id = ? AND id IN ?", userID, req.IDs).Pluck("id", &convIDs)

	if len(convIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{"deleted": 0})
		return
	}

	h.DB.Where("conv_id IN ?", convIDs).Delete(&models.Message{})
	result := h.DB.Where("id IN ? AND user_id = ?", convIDs, userID).Delete(&models.Conversation{})

	c.JSON(http.StatusOK, gin.H{"deleted": result.RowsAffected})
}

// DeleteAll deletes all conversations and messages for the authenticated user.
func (h *ConversationHandler) DeleteAll(c *gin.Context) {
	userID := middleware.GetUserID(c)

	// Delete all messages belonging to user's conversations
	h.DB.Where("conv_id IN (SELECT id FROM conversations WHERE user_id = ?)", userID).Delete(&models.Message{})
	result := h.DB.Where("user_id = ?", userID).Delete(&models.Conversation{})

	c.JSON(http.StatusOK, gin.H{"deleted": result.RowsAffected})
}

// MarkRead marks a conversation as read.
func (h *ConversationHandler) MarkRead(c *gin.Context) {
	userID := middleware.GetUserID(c)
	id := c.Param("id")

	now := time.Now().UTC()
	result := h.DB.Model(&models.Conversation{}).
		Where("user_id = ? AND id = ?", userID, id).
		UpdateColumn("last_read_at", &now)

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "conversation not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetSyncedConversations returns a lightweight summary of all synced conversations,
// grouped by platform, for the client to compare with local cache.
// Response: { platforms: { chatgpt: { total: 42, items: [...] }, ... }, total: 42 }
func (h *ConversationHandler) GetSyncedConversations(c *gin.Context) {
	userID := middleware.GetUserID(c)

	type ConvSummary struct {
		ConversationID string    `json:"conversation_id"`
		MessageCount   int       `json:"message_count"`
		UpdatedAt      time.Time `json:"updated_at"`
	}

	type PlatformGroup struct {
		Total int           `json:"total"`
		Items []ConvSummary `json:"items"`
	}

	// Fetch all conversations with lightweight fields only
	var conversations []struct {
		Platform       string
		ConversationID string
		MessageCount   int
		UpdatedAt      time.Time
	}
	h.DB.Model(&models.Conversation{}).
		Select("platform, conversation_id, message_count, updated_at").
		Where("user_id = ?", userID).
		Find(&conversations)

	// Group by platform
	platforms := make(map[string]*PlatformGroup)
	for _, conv := range conversations {
		group, ok := platforms[conv.Platform]
		if !ok {
			group = &PlatformGroup{Items: []ConvSummary{}}
			platforms[conv.Platform] = group
		}
		group.Items = append(group.Items, ConvSummary{
			ConversationID: conv.ConversationID,
			MessageCount:   conv.MessageCount,
			UpdatedAt:      conv.UpdatedAt,
		})
		group.Total++
	}

	c.JSON(http.StatusOK, gin.H{
		"platforms": platforms,
		"total":     len(conversations),
	})
}

// MarkAllRead marks all unread conversations as read, optionally scoped to a platform.
func (h *ConversationHandler) MarkAllRead(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var req struct {
		Platform string `json:"platform"`
	}
	c.ShouldBindJSON(&req)

	now := time.Now().UTC()
	query := h.DB.Model(&models.Conversation{}).
		Where("user_id = ? AND (last_read_at IS NULL OR synced_at > last_read_at)", userID)
	if req.Platform != "" {
		query = query.Where("platform = ?", req.Platform)
	}
	query.UpdateColumn("last_read_at", &now)

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
