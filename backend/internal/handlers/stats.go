package handlers

import (
	"net/http"
	"strconv"
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
	TotalConversations      int64          `json:"total_conversations"`
	TotalMessages           int64          `json:"total_messages"`
	ThisWeekNew             int64          `json:"this_week_new"`
	PlatformDistribution    map[string]int `json:"platform_distribution"`
	AvgMessagesPerConv      float64        `json:"avg_messages_per_conv"`
	UnreadCount             int64          `json:"unread_count"`
	PlatformMsgDistribution map[string]int `json:"platform_msg_distribution"`
}

// parseTZOffset reads the tz_offset query param (minutes, JS getTimezoneOffset
// convention: UTC+8 → -480) and returns the duration to add to a stored UTC
// time to get local time: local = utc + (-tzOffset)min, so UTC+8 → +8h.
func parseTZOffset(c *gin.Context) time.Duration {
	off, _ := strconv.Atoi(c.DefaultQuery("tz_offset", "0"))
	return time.Duration(-off) * time.Minute
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

	// Unread: never read, or last read before the latest update.
	var unreadCount int64
	h.DB.Model(&models.Conversation{}).
		Where("user_id = ? AND (last_read_at IS NULL OR last_read_at < updated_at)", userID).
		Count(&unreadCount)

	type PlatformCount struct {
		Platform string
		Count    int
	}

	// Platform distribution by conversation count.
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

	// Platform distribution by message count.
	var platformMsgCounts []PlatformCount
	h.DB.Model(&models.Message{}).
		Select("c.platform as platform, count(*) as count").
		Joins("JOIN conversations c ON c.id = messages.conv_id").
		Where("c.user_id = ?", userID).
		Group("c.platform").
		Scan(&platformMsgCounts)

	msgDistribution := make(map[string]int)
	for _, pc := range platformMsgCounts {
		msgDistribution[pc.Platform] = pc.Count
	}

	var avgMsg float64
	if totalConv > 0 {
		avgMsg = float64(totalMsg) / float64(totalConv)
	}

	c.JSON(http.StatusOK, StatsOverview{
		TotalConversations:      totalConv,
		TotalMessages:           totalMsg,
		ThisWeekNew:             thisWeekNew,
		PlatformDistribution:    distribution,
		AvgMessagesPerConv:      avgMsg,
		UnreadCount:             unreadCount,
		PlatformMsgDistribution: msgDistribution,
	})
}

// GetTimeline returns conversation or message count over time.
//
// Time bucketing is done in Go (not SQL) for two reasons: portability (strftime
// is sqlite-only and breaks on postgres) and correct timezone handling. Stored
// timestamps are UTC; we shift each into the caller's local zone via tz_offset
// before bucketing, so a conversation just before local midnight lands on the
// right local day instead of being pushed across the date boundary.
func (h *StatsHandler) GetTimeline(c *gin.Context) {
	userID := middleware.GetUserID(c)
	granularity := c.DefaultQuery("granularity", "day")
	metric := c.DefaultQuery("metric", "conversations")
	rangeParam := c.DefaultQuery("range", "30d")
	tzShift := parseTZOffset(c)

	// Window is driven by the `range` selector. "all" anchors the start at the
	// user's earliest record so the day-bucket zero-fill spans real data instead
	// of the epoch.
	endTime := time.Now()
	var startTime time.Time
	switch rangeParam {
	case "90d":
		startTime = endTime.AddDate(0, 0, -90)
	case "1y":
		startTime = endTime.AddDate(-1, 0, 0)
	case "all":
		// Anchor far enough back to predate any real data; sparse bucketing (and
		// the day-span cap below) keep this from emitting empty buckets.
		startTime = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	default:
		startTime = endTime.AddDate(0, 0, -30)
	}

	// Explicit start_time/end_time override the range selector.
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

	// Pull (timestamp, platform) for the chosen metric within the range so we
	// can break the trend down per platform.
	type tsRow struct {
		T        time.Time
		Platform string
	}
	var rows []tsRow
	if metric == "messages" {
		var rr []struct {
			Timestamp time.Time
			Platform  string
		}
		h.DB.Model(&models.Message{}).
			Select("messages.timestamp as timestamp, c.platform as platform").
			Joins("JOIN conversations c ON c.id = messages.conv_id").
			Where("c.user_id = ? AND messages.timestamp >= ? AND messages.timestamp <= ?", userID, startTime, endTime).
			Scan(&rr)
		for _, r := range rr {
			rows = append(rows, tsRow{r.Timestamp, r.Platform})
		}
	} else {
		var rr []struct {
			CreatedAt time.Time
			Platform  string
		}
		h.DB.Model(&models.Conversation{}).
			Select("created_at, platform").
			Where("user_id = ? AND created_at >= ? AND created_at <= ?", userID, startTime, endTime).
			Scan(&rr)
		for _, r := range rr {
			rows = append(rows, tsRow{r.CreatedAt, r.Platform})
		}
	}

	// counts[platform][bucket] and the set of buckets/platforms seen.
	counts := make(map[string]map[string]int)
	platformSet := make(map[string]bool)
	bucketSet := make(map[string]bool)
	for _, r := range rows {
		key := bucketKey(r.T.Add(tzShift), granularity)
		if counts[r.Platform] == nil {
			counts[r.Platform] = make(map[string]int)
		}
		counts[r.Platform][key]++
		platformSet[r.Platform] = true
		bucketSet[key] = true
	}

	// Build the shared date axis. Zero-fill day buckets for short spans; over
	// long ranges (e.g. "全部" covering years) fall back to the sparse, sorted
	// union of buckets that actually carry data.
	var dates []string
	ls := startTime.Add(tzShift)
	le := endTime.Add(tzShift)
	spanDays := int(le.Sub(ls).Hours()/24) + 1
	if granularity == "day" && spanDays <= 120 {
		day := time.Date(ls.Year(), ls.Month(), ls.Day(), 0, 0, 0, 0, time.UTC)
		last := time.Date(le.Year(), le.Month(), le.Day(), 0, 0, 0, 0, time.UTC)
		for !day.After(last) {
			dates = append(dates, day.Format("2006-01-02"))
			day = day.AddDate(0, 0, 1)
		}
	} else {
		for k := range bucketSet {
			dates = append(dates, k)
		}
		sortStrings(dates)
	}
	if dates == nil {
		dates = []string{}
	}

	platforms := make([]string, 0, len(platformSet))
	for p := range platformSet {
		platforms = append(platforms, p)
	}
	sortStrings(platforms)

	// One aligned series per platform.
	series := make([]gin.H, 0, len(platforms))
	for _, p := range platforms {
		data := make([]int, len(dates))
		for i, d := range dates {
			data[i] = counts[p][d]
		}
		series = append(series, gin.H{"platform": p, "data": data})
	}

	c.JSON(http.StatusOK, gin.H{
		"granularity": granularity,
		"metric":      metric,
		"dates":       dates,
		"series":      series,
	})
}

// bucketKey formats a local time into a bucket label for the given granularity.
func bucketKey(t time.Time, granularity string) string {
	switch granularity {
	case "week":
		y, w := t.ISOWeek()
		return y0pad(y) + "-W" + w0pad(w)
	case "month":
		return t.Format("2006-01")
	default:
		return t.Format("2006-01-02")
	}
}

func y0pad(y int) string { return strconv.Itoa(y) }
func w0pad(w int) string {
	s := strconv.Itoa(w)
	if len(s) < 2 {
		return "0" + s
	}
	return s
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}

// ActivityStats describes when (local time) the user is active.
type ActivityStats struct {
	ByHour    [24]int       `json:"by_hour"`
	ByWeekday [7]int        `json:"by_weekday"`
	Heatmap   []HeatmapCell `json:"heatmap"`
}

type HeatmapCell struct {
	Weekday int `json:"weekday"` // Monday=0 ... Sunday=6
	Hour    int `json:"hour"`    // 0-23
	Count   int `json:"count"`
}

// GetActivity returns usage-habit stats: message volume by local hour and
// weekday, plus a 7x24 heatmap. Timestamps are bucketed in Go after shifting
// into the caller's local zone (tz_offset).
func (h *StatsHandler) GetActivity(c *gin.Context) {
	userID := middleware.GetUserID(c)
	tzShift := parseTZOffset(c)

	var rows []struct{ Timestamp time.Time }
	h.DB.Model(&models.Message{}).
		Select("messages.timestamp as timestamp").
		Joins("JOIN conversations c ON c.id = messages.conv_id").
		Where("c.user_id = ?", userID).
		Scan(&rows)

	var stats ActivityStats
	grid := [7][24]int{}
	for _, r := range rows {
		lt := r.Timestamp.Add(tzShift)
		hour := lt.Hour()
		// Go: Sunday=0..Saturday=6; remap to Monday=0..Sunday=6.
		wd := (int(lt.Weekday()) + 6) % 7
		stats.ByHour[hour]++
		stats.ByWeekday[wd]++
		grid[wd][hour]++
	}

	stats.Heatmap = make([]HeatmapCell, 0, 7*24)
	for wd := 0; wd < 7; wd++ {
		for hr := 0; hr < 24; hr++ {
			stats.Heatmap = append(stats.Heatmap, HeatmapCell{Weekday: wd, Hour: hr, Count: grid[wd][hr]})
		}
	}

	c.JSON(http.StatusOK, stats)
}

// InsightsStats describes content-level metrics.
type InsightsStats struct {
	UserMessages           int64              `json:"user_messages"`
	AssistantMessages      int64              `json:"assistant_messages"`
	UserChars              int64              `json:"user_chars"`
	AssistantChars         int64              `json:"assistant_chars"`
	AvgUserChars           float64            `json:"avg_user_chars"`
	AvgAssistantChars      float64            `json:"avg_assistant_chars"`
	PlatformAvgReplyLength map[string]float64 `json:"platform_avg_reply_length"`
}

// GetInsights returns content-level metrics computed with portable ANSI SQL
// aggregates (COUNT, SUM(LENGTH()), AVG(LENGTH()), GROUP BY) so the queries run
// unchanged on both sqlite and postgres. LENGTH() over a text column returns a
// character count (not bytes) in both drivers, so CJK content is measured
// correctly.
func (h *StatsHandler) GetInsights(c *gin.Context) {
	userID := middleware.GetUserID(c)

	type RoleAgg struct {
		Role  string
		Cnt   int64
		Chars int64
	}
	var roleAggs []RoleAgg
	h.DB.Model(&models.Message{}).
		Select("messages.role as role, count(*) as cnt, COALESCE(SUM(LENGTH(messages.content)), 0) as chars").
		Joins("JOIN conversations c ON c.id = messages.conv_id").
		Where("c.user_id = ?", userID).
		Group("messages.role").
		Scan(&roleAggs)

	var stats InsightsStats
	for _, a := range roleAggs {
		switch a.Role {
		case "user":
			stats.UserMessages = a.Cnt
			stats.UserChars = a.Chars
		case "assistant":
			stats.AssistantMessages = a.Cnt
			stats.AssistantChars = a.Chars
		}
	}
	if stats.UserMessages > 0 {
		stats.AvgUserChars = float64(stats.UserChars) / float64(stats.UserMessages)
	}
	if stats.AssistantMessages > 0 {
		stats.AvgAssistantChars = float64(stats.AssistantChars) / float64(stats.AssistantMessages)
	}

	// Average reply length per platform (assistant messages only).
	type PlatformAvg struct {
		Platform string
		Avg      float64
	}
	var platformAvgs []PlatformAvg
	h.DB.Model(&models.Message{}).
		Select("c.platform as platform, AVG(LENGTH(messages.content)) as avg").
		Joins("JOIN conversations c ON c.id = messages.conv_id").
		Where("c.user_id = ? AND messages.role = ?", userID, "assistant").
		Group("c.platform").
		Scan(&platformAvgs)

	stats.PlatformAvgReplyLength = make(map[string]float64)
	for _, pa := range platformAvgs {
		stats.PlatformAvgReplyLength[pa.Platform] = pa.Avg
	}

	c.JSON(http.StatusOK, stats)
}
