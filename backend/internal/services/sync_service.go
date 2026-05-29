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

	// Update if newer
	if req.UpdatedAt.After(existing.UpdatedAt) {
		return s.updateConversation(&existing, req)
	}

	return &dto.SyncResult{
		Success:        true,
		ConversationID: req.ConversationID,
		Action:         "skipped",
	}, nil
}

func (s *SyncService) createConversation(userID uint, req *dto.ConversationSync) (*dto.SyncResult, error) {
	conv := models.Conversation{
		UserID:         userID,
		Platform:       req.Platform,
		ConversationID: req.ConversationID,
		Title:          req.Title,
		MessageCount:   len(req.Messages),
		CreatedAt:      req.CreatedAt,
		UpdatedAt:      req.UpdatedAt,
		SyncedAt:       time.Now(),
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

	s.logSync(userID, &conv.ID, "created", "")

	return &dto.SyncResult{
		Success:        true,
		ConversationID: req.ConversationID,
		Action:         "created",
	}, nil
}

func (s *SyncService) updateConversation(existing *models.Conversation, req *dto.ConversationSync) (*dto.SyncResult, error) {
	existing.Title = req.Title
	existing.UpdatedAt = req.UpdatedAt
	existing.MessageCount = len(req.Messages)
	existing.SyncedAt = time.Now()

	if err := s.DB.Save(existing).Error; err != nil {
		return nil, err
	}

	// Replace messages
	if err := s.DB.Where("conv_id = ?", existing.ID).Delete(&models.Message{}).Error; err != nil {
		return nil, err
	}

	messages := make([]models.Message, 0, len(req.Messages))
	for _, m := range req.Messages {
		messages = append(messages, models.Message{
			ConvID:     existing.ID,
			Role:       m.Role,
			Content:    m.Content,
			Timestamp:  m.Timestamp,
			IsComplete: m.IsComplete,
		})
	}

	if err := s.DB.CreateInBatches(messages, 100).Error; err != nil {
		return nil, err
	}

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
