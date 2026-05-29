package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/cone387/aiinbox/backend/internal/middleware"
	"github.com/cone387/aiinbox/backend/internal/models"
	"gorm.io/gorm"
)

type StatsHandler struct {
	DB *gorm.DB
}

func NewStatsHandler(db *gorm.DB) *StatsHandler {
	return &StatsHandler{DB: db}
}

type StatsOverview struct {
	TotalConversations   int64          `json:"total_conversations"`
	TotalMessages        int64          `json:"total_messages"`
	ThisWeekNew          int64          `json:"this_week_new"`
	PlatformDistribution map[string]int `json:"platform_distribution"`
}

type TimelinePoint struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// GetOverview returns stats overview.
func (h *StatsHandler) GetOverview(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var totalConv int64
	h.DB.Model(&models.Conversation{}).Where("user_id = ?", userID).Count(&totalConv)

	var totalMsg int64
	h.DB.Model(&models.Message{}).
		Joins("JOIN conversations c ON c.id = messages.conv_id").
		Where("c.user_id = ?", userID).
		Count(&totalMsg)

	// This week new
	weekStart := time.Now().AddDate(0, 0, -7)
	var thisWeekNew int64
	h.DB.Model(&models.Conversation{}).Where("user_id = ? AND created_at >= ?", userID, weekStart).Count(&thisWeekNew)

	// Platform distribution
	type PlatformCount struct {
		Platform string
		Count    int
	}
	var platformCounts []PlatformCount
	h.DB.Model(&models.Conversation{}).
		Select("platform, count(*) as count").
		Where("user_id = ?", userID).
		Group("platform").
		Scan(&platformCounts)

	distribution := make(map[string]int)
	for _, pc := range platformCounts {
		distribution[pc.Platform] = pc.Count
	}

	c.JSON(http.StatusOK, StatsOverview{
		TotalConversations:   totalConv,
		TotalMessages:        totalMsg,
		ThisWeekNew:          thisWeekNew,
		PlatformDistribution: distribution,
	})
}

// GetTimeline returns conversation count over time.
func (h *StatsHandler) GetTimeline(c *gin.Context) {
	userID := middleware.GetUserID(c)
	granularity := c.DefaultQuery("granularity", "day")

	// Default: last 30 days
	endTime := time.Now()
	startTime := endTime.AddDate(0, 0, -30)

	if st := c.Query("start_time"); st != "" {
		if t, err := time.Parse(time.RFC3339, st); err == nil {
			startTime = t
		}
	}
	if et := c.Query("end_time"); et != "" {
		if t, err := time.Parse(time.RFC3339, et); err == nil {
			endTime = t
		}
	}

	var dateFormat string
	switch granularity {
	case "week":
		dateFormat = "%Y-W%W"
	case "month":
		dateFormat = "%Y-%m"
	default:
		dateFormat = "%Y-%m-%d"
	}

	type DateCount struct {
		Date  string
		Count int
	}
	var dateCounts []DateCount
	h.DB.Model(&models.Conversation{}).
		Select("strftime('"+dateFormat+"', created_at) as date, count(*) as count").
		Where("user_id = ? AND created_at >= ? AND created_at <= ?", userID, startTime, endTime).
		Group("date").
		Order("date ASC").
		Scan(&dateCounts)

	points := make([]TimelinePoint, 0, len(dateCounts))
	for _, dc := range dateCounts {
		points = append(points, TimelinePoint{Date: dc.Date, Count: dc.Count})
	}

	c.JSON(http.StatusOK, gin.H{
		"granularity": granularity,
		"data":        points,
	})
}
