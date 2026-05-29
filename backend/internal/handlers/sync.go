package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/cone387/aiinbox/backend/internal/dto"
	"github.com/cone387/aiinbox/backend/internal/middleware"
	"github.com/cone387/aiinbox/backend/internal/services"
)

type SyncHandler struct {
	SyncService *services.SyncService
}

func NewSyncHandler(syncService *services.SyncService) *SyncHandler {
	return &SyncHandler{SyncService: syncService}
}

// SyncConversation handles single conversation sync.
func (h *SyncHandler) SyncConversation(c *gin.Context) {
	var req dto.ConversationSync
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	userID := middleware.GetUserID(c)
	result, err := h.SyncService.SyncOne(userID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "internal_error",
			"message": "failed to sync conversation",
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

// BatchSync handles batch conversation sync.
func (h *SyncHandler) BatchSync(c *gin.Context) {
	var req dto.BatchSyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "validation_error",
			"message": err.Error(),
		})
		return
	}

	userID := middleware.GetUserID(c)
	result, err := h.SyncService.SyncBatch(userID, req.Conversations)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "internal_error",
			"message": "failed to batch sync",
		})
		return
	}

	c.JSON(http.StatusOK, result)
}
