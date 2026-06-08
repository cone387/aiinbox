package services

import (
	"time"

	"gorm.io/gorm"

	"github.com/cone387/aiinbox/backend/internal/dto"
	"github.com/cone387/aiinbox/backend/internal/models"
)

type SyncService struct {
	DB *gorm.DB
}

func NewSyncService(db *gorm.DB) *SyncService {
	return &SyncService{DB: db}
}

// SyncOne syncs a single conversation.
func (s *SyncService) SyncOne(userID uint, req *dto.ConversationSync) (*dto.SyncResult, error) {
	result, err := s.syncConversation(userID, req)
	if err != nil {
		s.logSync(userID, nil, "failed", err.Error())
		return nil, err
	}
	return result, nil
}

// SyncBatch syncs multiple conversations.
func (s *SyncService) SyncBatch(userID uint, conversations []dto.ConversationSync) (*dto.BatchSyncResult, error) {
	result := &dto.BatchSyncResult{
		Total:   len(conversations),
		Results: make([]dto.SyncResult, 0, len(conversations)),
		Errors:  make([]dto.SyncError, 0),
	}

	for i := range conversations {
		syncResult, err := s.syncConversation(userID, &conversations[i])
		if err != nil {
			result.Failed++
			result.Errors = append(result.Errors, dto.SyncError{
				ConversationID: conversations[i].ConversationID,
				Error:          err.Error(),
			})
			continue
		}

		result.Results = append(result.Results, *syncResult)
		switch syncResult.Action {
		case "created":
			result.Created++
		case "updated":
			result.Updated++
		}
	}

	return result, nil
}

func (s *SyncService) syncConversation(userID uint, req *dto.ConversationSync) (*dto.SyncResult, error) {
	var existing models.Conversation
	err := s.DB.Where("user_id = ? AND conversation_id = ?", userID, req.ConversationID).First(&existing).Error

	if err == gorm.ErrRecordNotFound {
		return s.createConversation(userID, req)
	} else if err != nil {
		return nil, err
	}

	return s.updateConversation(&existing, req)
}

func (s *SyncService) createConversation(userID uint, req *dto.ConversationSync) (*dto.SyncResult, error) {
	conv := models.Conversation{
		UserID:         userID,
		Platform:       req.Platform,
		ConversationID: req.ConversationID,
		Title:          req.Title,
		MessageCount:   len(req.Messages),
		CreatedAt:      req.CreatedAt.UTC(),
		UpdatedAt:      req.UpdatedAt.UTC(),
		SyncedAt:       time.Now().UTC(),
	}

	if err := s.DB.Create(&conv).Error; err != nil {
		return nil, err
	}

	// Create messages
	messages := make([]models.Message, 0, len(req.Messages))
	for _, m := range req.Messages {
		messages = append(messages, models.Message{
			ConvID:     conv.ID,
			Role:       m.Role,
			Content:    m.Content,
			Timestamp:  m.Timestamp,
			IsComplete: m.IsComplete,
		})
	}

	if err := s.DB.CreateInBatches(messages, 100).Error; err != nil {
		return nil, err
	}

	s.updateSyncStatus(userID, req.Platform)
	s.logSync(userID, &conv.ID, "created", "")

	return &dto.SyncResult{
		Success:        true,
		ConversationID: req.ConversationID,
		Action:         "created",
	}, nil
}

func (s *SyncService) updateConversation(existing *models.Conversation, req *dto.ConversationSync) (*dto.SyncResult, error) {
	// Incremental sync: find existing message timestamps to avoid duplicates
	var existingTimestamps []time.Time
	s.DB.Model(&models.Message{}).Where("conv_id = ?", existing.ID).Pluck("timestamp", &existingTimestamps)

	tsSet := make(map[int64]bool, len(existingTimestamps))
	for _, t := range existingTimestamps {
		tsSet[t.UnixMilli()] = true
	}

	// Only insert messages that don't already exist
	var newMessages []models.Message
	for _, m := range req.Messages {
		if !tsSet[m.Timestamp.UnixMilli()] {
			newMessages = append(newMessages, models.Message{
				ConvID:     existing.ID,
				Role:       m.Role,
				Content:    m.Content,
				Timestamp:  m.Timestamp,
				IsComplete: m.IsComplete,
			})
		}
	}

	if len(newMessages) > 0 {
		if err := s.DB.CreateInBatches(newMessages, 100).Error; err != nil {
			return nil, err
		}
	}

	// Update conversation metadata. updated_at is set explicitly from the
	// platform's update time (req.UpdatedAt); GORM's autoUpdateTime is disabled
	// on the model so .Updates never overwrites it with the local wall clock.
	updates := map[string]interface{}{
		"message_count": len(existingTimestamps) + len(newMessages),
	}
	if req.Title != "" && req.Title != existing.Title {
		updates["title"] = req.Title
	}
	if len(newMessages) > 0 {
		updates["synced_at"] = time.Now().UTC()
	}
	if req.UpdatedAt.After(existing.UpdatedAt) {
		updates["updated_at"] = req.UpdatedAt.UTC()
	}

	if err := s.DB.Model(existing).Updates(updates).Error; err != nil {
		return nil, err
	}

	s.updateSyncStatus(existing.UserID, existing.Platform)
	s.logSync(existing.UserID, &existing.ID, "updated", "")

	return &dto.SyncResult{
		Success:        true,
		ConversationID: req.ConversationID,
		Action:         "updated",
	}, nil
}

func (s *SyncService) logSync(userID uint, convID *uint, action, errMsg string) {
	log := models.SyncLog{
		UserID:         userID,
		ConversationID: convID,
		Action:         action,
		ErrorMessage:   errMsg,
	}
	s.DB.Create(&log)
}

func (s *SyncService) updateSyncStatus(userID uint, platform string) {
	now := time.Now().UTC()
	var status models.SyncStatus
	err := s.DB.Where("user_id = ? AND platform = ?", userID, platform).First(&status).Error
	if err != nil {
		s.DB.Create(&models.SyncStatus{
			UserID:       userID,
			Platform:     platform,
			LastSyncedAt: now,
		})
	} else {
		s.DB.Model(&status).Update("last_synced_at", now)
	}
}

// GetSyncStatus returns per-platform sync status with unread counts.
func (s *SyncService) GetSyncStatus(userID uint) ([]dto.PlatformSyncStatus, error) {
	var statuses []models.SyncStatus
	s.DB.Where("user_id = ?", userID).Find(&statuses)

	platforms := []string{"chatgpt", "gemini", "tongyi", "doubao", "deepseek"}
	statusMap := make(map[string]*models.SyncStatus)
	for i := range statuses {
		statusMap[statuses[i].Platform] = &statuses[i]
	}

	result := make([]dto.PlatformSyncStatus, 0, len(platforms))
	for _, p := range platforms {
		ps := dto.PlatformSyncStatus{Platform: p}
		if s, ok := statusMap[p]; ok {
			ps.LastSyncedAt = &s.LastSyncedAt
		}
		// Count unread conversations: synced_at > last_read_at OR last_read_at IS NULL
		var unread int64
		s.DB.Model(&models.Conversation{}).
			Where("user_id = ? AND platform = ? AND (last_read_at IS NULL OR synced_at > last_read_at)", userID, p).
			Count(&unread)
		ps.UnreadCount = int(unread)
		result = append(result, ps)
	}
	return result, nil
}
