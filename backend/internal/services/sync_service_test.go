package services

import (
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/cone387/aiinbox/backend/internal/database"
	"github.com/cone387/aiinbox/backend/internal/dto"
	"github.com/cone387/aiinbox/backend/internal/models"
)

func testSyncService(t *testing.T) *SyncService {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := database.AutoMigrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return NewSyncService(db)
}

func makeConversationSync(platform, convID, title string, msgCount int) dto.ConversationSync {
	now := time.Now().UTC()
	msgs := make([]dto.MessageCreate, msgCount)
	for i := 0; i < msgCount; i++ {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		msgs[i] = dto.MessageCreate{
			Role:       role,
			Content:    "hello " + convID,
			Timestamp:  now.Add(time.Duration(i) * time.Second),
			IsComplete: true,
		}
	}
	return dto.ConversationSync{
		Platform:       platform,
		ConversationID: convID,
		Title:          title,
		Messages:       msgs,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
}

// ---------------------------------------------------------------------------
// SyncOne - create
// ---------------------------------------------------------------------------

func TestSyncOne_Create(t *testing.T) {
	svc := testSyncService(t)
	req := makeConversationSync("chatgpt", "conv-1", "First Chat", 4)

	result, err := svc.SyncOne(1, &req)
	if err != nil {
		t.Fatalf("SyncOne: %v", err)
	}
	if !result.Success {
		t.Error("result.Success = false")
	}
	if result.Action != "created" {
		t.Errorf("action = %q, want %q", result.Action, "created")
	}
	if result.ConversationID != "conv-1" {
		t.Errorf("conversation_id = %q, want %q", result.ConversationID, "conv-1")
	}

	// Verify in DB
	var conv models.Conversation
	if err := svc.DB.Where("conversation_id = ?", "conv-1").First(&conv).Error; err != nil {
		t.Fatalf("conversation not found in DB")
	}
	if conv.Title != "First Chat" {
		t.Errorf("title = %q, want %q", conv.Title, "First Chat")
	}
	if conv.MessageCount != 4 {
		t.Errorf("message_count = %d, want 4", conv.MessageCount)
	}

	var msgCount int64
	svc.DB.Model(&models.Message{}).Where("conv_id = ?", conv.ID).Count(&msgCount)
	if msgCount != 4 {
		t.Errorf("messages in DB = %d, want 4", msgCount)
	}
}

// ---------------------------------------------------------------------------
// SyncOne - update (incremental)
// ---------------------------------------------------------------------------

func TestSyncOne_Update(t *testing.T) {
	svc := testSyncService(t)
	req := makeConversationSync("chatgpt", "conv-2", "My Chat", 2)

	// Create first
	result, err := svc.SyncOne(1, &req)
	if err != nil {
		t.Fatalf("first SyncOne: %v", err)
	}
	if result.Action != "created" {
		t.Fatalf("first action = %q, want created", result.Action)
	}

	// Add more messages and sync again
	req.Title = "Updated Chat"
	newMsg := dto.MessageCreate{
		Role:       "user",
		Content:    "new message",
		Timestamp:  time.Now().UTC().Add(time.Minute),
		IsComplete: true,
	}
	req.Messages = append(req.Messages, newMsg)
	req.UpdatedAt = time.Now().UTC().Add(time.Minute)

	result2, err := svc.SyncOne(1, &req)
	if err != nil {
		t.Fatalf("second SyncOne: %v", err)
	}
	if result2.Action != "updated" {
		t.Errorf("second action = %q, want updated", result2.Action)
	}

	var conv models.Conversation
	svc.DB.Where("conversation_id = ?", "conv-2").First(&conv)
	if conv.Title != "Updated Chat" {
		t.Errorf("title = %q, want %q", conv.Title, "Updated Chat")
	}
	if conv.MessageCount != 3 {
		t.Errorf("message_count = %d, want 3", conv.MessageCount)
	}
}

// ---------------------------------------------------------------------------
// SyncOne - update with duplicate messages (should not double-insert)
// ---------------------------------------------------------------------------

func TestSyncOne_UpdateNoDuplicateMessages(t *testing.T) {
	svc := testSyncService(t)
	req := makeConversationSync("chatgpt", "conv-3", "Dup Test", 2)

	svc.SyncOne(1, &req)

	// Sync same data again (no new messages)
	result, err := svc.SyncOne(1, &req)
	if err != nil {
		t.Fatalf("second SyncOne: %v", err)
	}
	if result.Action != "updated" {
		t.Errorf("action = %q, want updated", result.Action)
	}

	var conv models.Conversation
	svc.DB.Where("conversation_id = ?", "conv-3").First(&conv)
	if conv.MessageCount != 2 {
		t.Errorf("message_count = %d, want 2 (no duplicates)", conv.MessageCount)
	}
}

// ---------------------------------------------------------------------------
// SyncBatch
// ---------------------------------------------------------------------------

func TestSyncBatch(t *testing.T) {
	svc := testSyncService(t)

	batch := []dto.ConversationSync{
		makeConversationSync("chatgpt", "b-1", "Batch 1", 2),
		makeConversationSync("gemini", "b-2", "Batch 2", 3),
		makeConversationSync("tongyi", "b-3", "Batch 3", 1),
	}

	result, err := svc.SyncBatch(1, batch)
	if err != nil {
		t.Fatalf("SyncBatch: %v", err)
	}
	if result.Total != 3 {
		t.Errorf("total = %d, want 3", result.Total)
	}
	if result.Created != 3 {
		t.Errorf("created = %d, want 3", result.Created)
	}
	if result.Failed != 0 {
		t.Errorf("failed = %d, want 0", result.Failed)
	}
	if len(result.Errors) != 0 {
		t.Errorf("errors = %v, want none", result.Errors)
	}
}

func TestSyncBatch_MixedCreateAndUpdate(t *testing.T) {
	svc := testSyncService(t)

	// Pre-create one conversation
	pre := makeConversationSync("chatgpt", "pre-1", "Existing", 1)
	svc.SyncOne(1, &pre)

	// Batch includes existing and new
	batch := []dto.ConversationSync{
		makeConversationSync("chatgpt", "pre-1", "Existing Updated", 1),
		makeConversationSync("chatgpt", "new-1", "New One", 2),
	}

	result, err := svc.SyncBatch(1, batch)
	if err != nil {
		t.Fatalf("SyncBatch: %v", err)
	}
	if result.Total != 2 {
		t.Errorf("total = %d, want 2", result.Total)
	}
	created := 0
	updated := 0
	for _, r := range result.Results {
		if r.Action == "created" {
			created++
		} else if r.Action == "updated" {
			updated++
		}
	}
	if created != 1 || updated != 1 {
		t.Errorf("created=%d updated=%d, want 1 and 1", created, updated)
	}
}

// ---------------------------------------------------------------------------
// GetSyncStatus
// ---------------------------------------------------------------------------

func TestGetSyncStatus(t *testing.T) {
	svc := testSyncService(t)

	req := makeConversationSync("chatgpt", "s-1", "Status Test", 1)
	svc.SyncOne(1, &req)

	statuses, err := svc.GetSyncStatus(1)
	if err != nil {
		t.Fatalf("GetSyncStatus: %v", err)
	}
	if len(statuses) == 0 {
		t.Fatal("statuses empty")
	}

	found := false
	for _, s := range statuses {
		if s.Platform == "chatgpt" {
			found = true
			if s.LastSyncedAt == nil {
				t.Error("chatgpt LastSyncedAt should not be nil")
			}
			if s.UnreadCount != 1 {
				t.Errorf("chatgpt unread = %d, want 1", s.UnreadCount)
			}
		}
	}
	if !found {
		t.Error("chatgpt status not found")
	}
}

// ---------------------------------------------------------------------------
// SyncStatus per-platform isolation
// ---------------------------------------------------------------------------

func TestSyncStatus_MultiPlatform(t *testing.T) {
	svc := testSyncService(t)

	svc.SyncOne(1, &dto.ConversationSync{
		Platform:       "chatgpt",
		ConversationID: "cp-1",
		Title:          "ChatGPT",
		Messages: []dto.MessageCreate{
			{Role: "user", Content: "hi", Timestamp: time.Now(), IsComplete: true},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})
	svc.SyncOne(1, &dto.ConversationSync{
		Platform:       "gemini",
		ConversationID: "gm-1",
		Title:          "Gemini",
		Messages: []dto.MessageCreate{
			{Role: "user", Content: "hello", Timestamp: time.Now(), IsComplete: true},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	statuses, _ := svc.GetSyncStatus(1)
	platformCount := map[string]bool{}
	for _, s := range statuses {
		if s.LastSyncedAt != nil {
			platformCount[s.Platform] = true
		}
	}
	if !platformCount["chatgpt"] || !platformCount["gemini"] {
		t.Errorf("expected both chatgpt and gemini to have sync status, got %v", platformCount)
	}
}
