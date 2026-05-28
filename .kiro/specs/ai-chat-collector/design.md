# Design Document

## Overview

AI Chat Collector 是一个完整的 AI 对话数据管理系统，由三个核心模块组成：

1. **浏览器扩展插件（Extension）**：通过拦截网络请求，无感知地收集用户在 ChatGPT、Gemini、通义千问、豆包等 AI 平台的对话数据，缓存到本地并同步到后端服务。
2. **后端服务（Backend）**：接收、存储、索引对话数据，提供认证、查询、搜索、统计和导出 API。
3. **前端 Web 应用（Frontend）**：提供对话浏览、全文搜索、数据统计和用户管理界面。

系统采用网络请求拦截方式而非 DOM 解析，以降低因平台 UI 变更带来的维护成本。

## 技术栈

| 模块 | 技术选型 | 说明 |
|------|----------|------|
| Extension | TypeScript, Chrome Manifest V3, Vite + CRXJS | 现代浏览器扩展开发框架 |
| Extension 存储 | Dexie.js (IndexedDB) | 本地结构化缓存 |
| Extension UI | React (Popup & Options) | 轻量弹窗和设置页 |
| Backend | Go (Gin/Echo) | 单二进制部署，高性能 |
| Backend 数据库 | SQLite (本地模式) / PostgreSQL (远程模式) | 通过配置切换 |
| Backend ORM | GORM + golang-migrate | ORM + 数据库迁移 |
| Backend 认证 | JWT + API Token | 双重认证机制 |
| Frontend | React + TypeScript, Vite | SPA 应用（内嵌到 Go 二进制中） |
| Frontend UI | Ant Design + TailwindCSS | 组件库 + 原子化 CSS |
| Frontend 状态 | Zustand | 轻量状态管理 |
| Frontend 图表 | ECharts | 数据可视化 |
| 部署（本地） | 单二进制 (Go embed) | 下载即用，内嵌前端 + SQLite |
| 部署（远程） | Docker + Docker Compose | PostgreSQL + 多用户 |

### 部署模式

| 模式 | 数据库 | 适用场景 | 部署方式 |
|------|--------|----------|----------|
| 本地模式 | SQLite | 个人使用，单机 | 下载 exe，双击运行 |
| 远程模式 | PostgreSQL | 多设备同步，团队使用 | Docker Compose |

## Architecture


```
┌──────────────────────────────────────────────────────────────────────────┐
│                           用户浏览器                                      │
│                                                                          │
│  ┌─────────────────────┐        ┌──────────────────────────────────────┐│
│  │   AI 平台 Web 端    │        │       浏览器插件 (Extension)          ││
│  │                     │ 拦截   │                                      ││
│  │ • ChatGPT           │───────▶│ Interceptor → Parser → Collector     ││
│  │ • Gemini            │        │                         │            ││
│  │ • 通义千问          │        │                    IndexedDB (Dexie)  ││
│  │ • 豆包              │        │                         │            ││
│  │                     │        │                    Sync Service       ││
│  └─────────────────────┘        └─────────────────────────┬────────────┘│
└───────────────────────────────────────────────────────────┼──────────────┘
                                                            │ HTTPS POST
                                                            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         后端服务 (Backend - Go/Gin)                        │
│                                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │Auth Module│  │ Sync API │  │Query API │  │Search API│  │Stats API │  │
│  └─────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│        └─────────────┴─────────────┴─────────────┴─────────────┘         │
│                                    │                                      │
│                         ┌──────────▼──────────┐                           │
│                         │  PostgreSQL Database │                           │
│                         │  or SQLite (local)   │                           │
│                         └─────────────────────┘                           │
└───────────────────────────────────────────────────────────────────────────┘
                                                            │ HTTPS GET
                                                            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                    前端 Web 应用 (Frontend - React + Vite)                 │
│                                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 对话列表 │  │ 对话详情 │  │ 全文搜索 │  │ 统计面板 │  │ 用户设置 │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

### 模块交互关系

- **Extension → Backend**：插件通过 HTTPS POST 将对话数据推送到后端 Sync API
- **Frontend → Backend**：前端通过 HTTPS GET/POST 调用后端 Query/Search/Stats API
- **Extension ↔ IndexedDB**：插件在本地缓存对话数据，支持离线场景
- **Backend ↔ PostgreSQL**：后端使用 SQLAlchemy ORM 操作数据库

## Components and Interfaces

### 1. Extension - Interceptor（网络请求拦截器）

**职责**：通过 Chrome webRequest API 拦截 AI 平台的对话 API 请求和响应，支持流式响应（SSE）处理。

**关键接口**：

```typescript
// 拦截器核心接口
interface Interceptor {
  // 注册/注销监听器
  start(platforms: Platform[]): void;
  stop(): void;

  // 事件回调
  onRequestCaptured: (request: CapturedRequest) => void;
  onResponseComplete: (response: CapturedResponse) => void;
  onStreamChunk: (chunk: StreamChunk) => void;
  onError: (error: InterceptError) => void;
}

// 拦截的请求数据
interface CapturedRequest {
  tabId: number;
  requestId: string;
  platform: Platform;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: string; // ISO 8601
}

// 流式数据块
interface StreamChunk {
  requestId: string;
  data: string;
  index: number;
  timestamp: string;
}

// 拦截的响应数据
interface CapturedResponse {
  requestId: string;
  tabId: number;
  platform: Platform;
  statusCode: number;
  headers: Record<string, string>;
  body: string; // 完整拼接后的响应体
  isComplete: boolean; // 流是否完整结束
  timestamp: string;
}
```

**数据流**：
1. Service Worker 启动时根据用户配置注册 `chrome.webRequest.onBeforeRequest` 监听器
2. 仅监听各平台对话 API 端点的 URL Pattern
3. 对流式响应（SSE），使用 `chrome.webRequest.onResponseStarted` + Fetch API 重新读取流
4. 维护每个 requestId 的独立缓冲区，按序拼接数据块
5. 流结束或超时（30s 无新数据）后，将完整响应传递给 Parser

**监听的 URL Pattern**：

| 平台 | URL Pattern | 方法 |
|------|-------------|------|
| ChatGPT | `https://chat.openai.com/backend-api/conversation` | POST |
| Gemini | `https://gemini.google.com/_/BardChatUi/data/*` | POST |
| 通义千问 | `https://qianwen.biz.aliyun.com/dialog/conversation` | POST |
| 豆包 | `https://www.doubao.com/chat/api/chat` | POST |

### 2. Extension - Platform Adapters（平台适配器）

**职责**：将各平台特定的 API 响应格式解析为统一的 Unified Format。每个平台一个适配器实现。

**关键接口**：

```typescript
// 平台适配器接口
interface PlatformAdapter {
  platform: Platform;
  // 判断是否为该平台的对话请求
  matchRequest(url: string): boolean;
  // 解析响应为统一格式
  parseResponse(response: CapturedResponse): ParseResult;
  // 解析流式数据块
  parseStreamChunk(chunk: string): Partial<Message> | null;
}

// 解析结果
interface ParseResult {
  success: boolean;
  conversation?: UnifiedConversation;
  error?: ParseError;
  warnings?: string[];
}

// 支持的平台枚举
enum Platform {
  ChatGPT = 'chatgpt',
  Gemini = 'gemini',
  Tongyi = 'tongyi',    // 通义千问
  Doubao = 'doubao',    // 豆包
}
```

**数据流**：
1. Interceptor 将 CapturedResponse 传递给对应平台的 Adapter
2. Adapter 根据平台特定格式提取对话 ID、消息角色、内容、时间戳
3. 将角色名称映射为统一枚举值（user / assistant / system / unknown）
4. 缺失字段使用默认值填充（时间戳用拦截时间，对话 ID 自动生成）
5. 输出 UnifiedConversation 对象传递给 Collector

### 3. Extension - Collector（数据收集器）

**职责**：管理本地 IndexedDB 存储，处理数据去重、合并和状态管理。

**关键接口**：

```typescript
// 收集器接口
interface Collector {
  // 存储对话
  save(conversation: UnifiedConversation): Promise<void>;
  // 查询本地缓存
  query(filter: LocalQueryFilter): Promise<UnifiedConversation[]>;
  // 获取待同步数据
  getPendingSync(limit: number): Promise<UnifiedConversation[]>;
  // 更新同步状态
  updateSyncStatus(ids: string[], status: SyncStatus): Promise<void>;
  // 获取存储统计
  getStorageStats(): Promise<StorageStats>;
  // 清理已同步数据
  cleanSynced(before: Date): Promise<number>;
}

// 同步状态
enum SyncStatus {
  Pending = 'pending',       // 未同步
  Syncing = 'syncing',       // 同步中
  Synced = 'synced',         // 已同步
  Failed = 'failed',         // 同步失败
}

// 本地查询过滤器
interface LocalQueryFilter {
  platform?: Platform[];
  startTime?: string;
  endTime?: string;
  syncStatus?: SyncStatus;
  limit?: number; // 默认 100，最大 100
  offset?: number;
}

// 存储统计
interface StorageStats {
  totalConversations: number;
  pendingSync: number;
  storageUsed: number;       // bytes
  storageQuota: number;      // bytes
  usagePercent: number;
}
```

**数据流**：
1. 接收 Parser 输出的 UnifiedConversation
2. 检查是否存在相同对话 ID → 存在则合并（保留较新消息）
3. 写入 IndexedDB，初始同步状态为 `pending`
4. 写入失败时重试 3 次（间隔 5s），仍失败则暂存内存
5. 定期检查存储配额，超过 80% 时通知用户

### 4. Extension - Sync Service（同步服务）

**职责**：将本地缓存的对话数据推送到后端服务，支持实时和定时批量两种模式。

**关键接口**：

```typescript
// 同步服务接口
interface SyncService {
  // 启动/停止同步
  start(config: SyncConfig): void;
  stop(): void;
  // 手动触发同步
  syncNow(): Promise<SyncResult>;
  // 获取同步状态
  getStatus(): SyncServiceStatus;
}

// 同步配置
interface SyncConfig {
  serverUrl: string;
  authToken: string;
  mode: 'realtime' | 'batch';
  batchInterval: number;     // 分钟，5~1440
  batchSize: number;         // 每批最多 50 条
  maxRetries: number;        // 默认 5
}

// 同步结果
interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors?: SyncError[];
}

// 重试策略：指数退避
interface RetryPolicy {
  initialDelay: number;      // 1 分钟
  maxDelay: number;          // 30 分钟
  maxRetries: number;        // 5 次
  backoffMultiplier: number; // 2
}
```

**数据流**：
1. 实时模式：Parser 完成解析后 30s 内触发同步
2. 批量模式：按配置间隔定时拉取 pending 状态数据
3. 发送 HTTPS POST 到后端 Sync API
4. 成功 → 更新本地状态为 `synced`
5. 失败 → 指数退避重试，最多 5 次
6. 认证失败 → 停止同步，通知用户

### 5. Extension - UI（Popup & Options）

**职责**：提供插件弹出面板和设置页面，展示状态和管理配置。

**Popup 面板功能**：
- 显示插件工作状态（正常/暂停/错误）
- 展示最近 10 条已收集对话摘要
- 各平台收集统计（已收集数、待同步数）
- 暂停/恢复收集开关
- 错误信息展示

**Options 设置页功能**：
- 远程服务 URL 配置（HTTPS 格式验证）
- 认证令牌配置（加密存储）
- 平台启用/禁用开关
- 同步模式选择（实时/定时批量）
- 批量同步间隔设置
- 清理已同步数据入口

**关键接口**：

```typescript
// 配置存储接口
interface ExtensionConfig {
  serverUrl: string;
  authToken: string;         // AES 加密存储
  syncMode: 'realtime' | 'batch';
  batchInterval: number;
  enabledPlatforms: Platform[];
  isCollecting: boolean;
}

// Popup 展示数据
interface PopupData {
  status: 'active' | 'paused' | 'error';
  recentConversations: ConversationSummary[];
  stats: PlatformStats[];
  errors: ErrorInfo[];
}
```

### 6. Backend - Auth Module（认证模块）

**职责**：处理用户认证、JWT 签发与验证、API Token 管理、请求限流。

**关键接口**：

```go
// 认证服务
type AuthService interface {
    Login(ctx context.Context, username, password string) (*TokenPair, error)
    GenerateAPIToken(ctx context.Context, userID uint) (string, error)
    VerifyToken(ctx context.Context, token string) (*UserPayload, error)
    RefreshToken(ctx context.Context, refreshToken string) (*TokenPair, error)
    RevokeToken(ctx context.Context, token string) error
}

// Token 数据结构
type TokenPair struct {
    AccessToken  string `json:"access_token"`
    RefreshToken string `json:"refresh_token"`
    TokenType    string `json:"token_type"`
    ExpiresIn    int    `json:"expires_in"` // 秒
}

// 用户载荷
type UserPayload struct {
    UserID    uint   `json:"user_id"`
    Username  string `json:"username"`
    Exp       int64  `json:"exp"`
    TokenType string `json:"token_type"` // "jwt" | "api_token"
}
```

**限流策略**：
- 认证失败：同一 IP 5 分钟内超过 10 次 → 封禁 15 分钟
- 搜索请求：单用户每分钟最多 30 次
- 通用 API：单用户每分钟最多 120 次

### 7. Backend - Sync API（数据同步接口）

**职责**：接收插件推送的对话数据，验证格式，处理去重和冲突。

**关键接口**：

```go
// 路由注册
func RegisterSyncRoutes(r *gin.RouterGroup, svc SyncService) {
    r.POST("/conversations/sync", svc.SyncConversation)
    r.POST("/conversations/batch", svc.BatchSync)
}

// 请求模型
type ConversationCreate struct {
    Platform       string          `json:"platform" binding:"required,oneof=chatgpt gemini tongyi doubao"`
    ConversationID string          `json:"conversation_id" binding:"required,max=256"`
    Title          string          `json:"title,omitempty"`
    Messages       []MessageCreate `json:"messages" binding:"required,min=1"`
    CreatedAt      time.Time       `json:"created_at" binding:"required"`
    UpdatedAt      time.Time       `json:"updated_at" binding:"required"`
}

type MessageCreate struct {
    Role       string    `json:"role" binding:"required,oneof=user assistant system unknown"`
    Content    string    `json:"content" binding:"required"`
    Timestamp  time.Time `json:"timestamp" binding:"required"`
    IsComplete bool      `json:"is_complete"`
}

type BatchSyncRequest struct {
    Conversations []ConversationCreate `json:"conversations" binding:"required,max=50"`
}

// 响应模型
type SyncResponse struct {
    Success        bool   `json:"success"`
    ConversationID string `json:"conversation_id"`
    Action         string `json:"action"` // "created" | "updated" | "skipped"
}

type BatchSyncResponse struct {
    Total   int         `json:"total"`
    Created int         `json:"created"`
    Updated int         `json:"updated"`
    Failed  int         `json:"failed"`
    Results []SyncResponse `json:"results"`
    Errors  []SyncError `json:"errors"`
}
```

**数据流**：
1. 接收请求 → JWT/API Token 认证
2. 验证请求体格式（Gin binding 校验）
3. 检查对话 ID 是否已存在
4. 已存在 → 比较 updated_at 时间戳，保留较新版本
5. 不存在 → 创建新记录
6. 写入数据库 + 更新全文搜索索引
7. 记录同步日志

### 8. Backend - Query API（查询接口）

**职责**：提供对话列表、详情、消息的分页查询能力。

**关键接口**：

```go
// 路由注册
func RegisterQueryRoutes(r *gin.RouterGroup, svc QueryService) {
    r.GET("/conversations", svc.ListConversations)
    r.GET("/conversations/:id", svc.GetConversation)
    r.GET("/conversations/:id/messages", svc.GetMessages)
    r.DELETE("/conversations", svc.BatchDelete)
}

// 查询参数
type ListConversationsQuery struct {
    Platform  []string `form:"platform"`
    StartTime string   `form:"start_time"`
    EndTime   string   `form:"end_time"`
    SortBy    string   `form:"sort_by" binding:"omitempty,oneof=created_at updated_at"`
    Order     string   `form:"order" binding:"omitempty,oneof=asc desc"`
    Page      int      `form:"page,default=1" binding:"min=1"`
    PageSize  int      `form:"page_size,default=20" binding:"min=1,max=100"`
}

// 分页响应
type PaginatedResponse[T any] struct {
    Items      []T `json:"items"`
    Total      int `json:"total"`
    Page       int `json:"page"`
    PageSize   int `json:"page_size"`
    TotalPages int `json:"total_pages"`
}

type ConversationListItem struct {
    ID             uint      `json:"id"`
    Platform       string    `json:"platform"`
    ConversationID string    `json:"conversation_id"`
    Title          string    `json:"title"`
    MessageCount   int       `json:"message_count"`
    CreatedAt      time.Time `json:"created_at"`
    UpdatedAt      time.Time `json:"updated_at"`
}
```

### 9. Backend - Search Engine（搜索引擎）

**职责**：提供全文搜索能力。PostgreSQL 模式使用 tsvector + pg_trgm，SQLite 模式使用 FTS5。

**关键接口**：

```go
// 搜索服务接口（数据库无关）
type SearchService interface {
    Search(ctx context.Context, userID uint, query SearchQuery) (*SearchResponse, error)
}

type SearchQuery struct {
    Keyword   string   `form:"q" binding:"required,min=2,max=200"`
    Platform  []string `form:"platform"`
    StartTime string   `form:"start_time"`
    EndTime   string   `form:"end_time"`
    SortBy    string   `form:"sort_by" binding:"omitempty,oneof=relevance time"`
    Page      int      `form:"page,default=1"`
    PageSize  int      `form:"page_size,default=20"`
}

type SearchResponse struct {
    Items    []SearchResultItem `json:"items"`
    Total    int                `json:"total"`
    Page     int                `json:"page"`
    PageSize int                `json:"page_size"`
}

type SearchResultItem struct {
    ConversationID string         `json:"conversation_id"`
    Platform       string         `json:"platform"`
    Title          string         `json:"title"`
    MatchedMessage MatchedMessage `json:"matched_message"`
    CreatedAt      time.Time      `json:"created_at"`
    RelevanceScore float64        `json:"relevance_score"`
}

type MatchedMessage struct {
    MessageID int       `json:"message_id"`
    Role      string    `json:"role"`
    Context   string    `json:"context"`    // 前后各 50 字符
    Highlight string    `json:"highlight"`  // 高亮片段
    Timestamp time.Time `json:"timestamp"`
}
```

**搜索实现 - PostgreSQL 模式**：

```sql
-- 使用 pg_trgm + tsvector
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_messages_content_trgm ON messages USING GIN(content gin_trgm_ops);
CREATE INDEX idx_messages_search ON messages USING GIN(search_vector);

SELECT m.*, similarity(m.content, :keyword) AS score
FROM messages m
WHERE m.content ILIKE '%' || :keyword || '%'
ORDER BY score DESC;
```

**搜索实现 - SQLite 模式**：

```sql
-- 使用 FTS5 全文搜索
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id',
    tokenize='unicode61'
);

-- 搜索查询
SELECT m.*, rank
FROM messages_fts fts
JOIN messages m ON m.id = fts.rowid
WHERE messages_fts MATCH :keyword
ORDER BY rank;
```

### 10. Backend - Stats & Export（统计与导出）

**职责**：提供数据统计聚合和多格式数据导出能力。

**关键接口**：

```go
// 统计服务
type StatsService interface {
    GetOverview(ctx context.Context, userID uint) (*StatsOverview, error)
    GetTimeline(ctx context.Context, userID uint, query TimelineQuery) (*TimelineStats, error)
}

// 导出服务
type ExportService interface {
    CreateExport(ctx context.Context, userID uint, req ExportRequest) (*ExportResponse, error)
    GetExportStatus(ctx context.Context, taskID string) (*ExportStatus, error)
}

type StatsOverview struct {
    TotalConversations   int            `json:"total_conversations"`
    TotalMessages        int            `json:"total_messages"`
    ThisWeekNew          int            `json:"this_week_new"`
    PlatformDistribution map[string]int `json:"platform_distribution"`
}

type TimelineQuery struct {
    Granularity string `form:"granularity" binding:"omitempty,oneof=day week month"`
    StartTime   string `form:"start_time"`
    EndTime     string `form:"end_time"`
}

type ExportRequest struct {
    Format    string   `json:"format" binding:"required,oneof=json markdown"`
    Platform  []string `json:"platform,omitempty"`
    StartTime string   `json:"start_time,omitempty"`
    EndTime   string   `json:"end_time,omitempty"`
}
```

**统计缓存策略**：使用内存缓存（sync.Map 或 go-cache），TTL 5 分钟。

### 11. Frontend - 对话列表页

**职责**：展示所有收集到的对话记录，支持筛选、排序和分页。

**关键功能**：
- 对话卡片展示：平台图标、标题（首条用户消息前 50 字符）、消息数、创建时间
- 平台多选过滤器（Ant Design Select）
- 日期范围选择器（Ant Design DatePicker.RangePicker）
- 无限滚动加载（每次 20 条）
- 空状态引导页

**状态管理（Zustand）**：

```typescript
interface ConversationListStore {
  conversations: ConversationListItem[];
  filters: {
    platforms: Platform[];
    startTime: string | null;
    endTime: string | null;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
  loading: boolean;
  // Actions
  fetchConversations: () => Promise<void>;
  loadMore: () => Promise<void>;
  setFilters: (filters: Partial<Filters>) => void;
  resetFilters: () => void;
}
```

### 12. Frontend - 对话详情页

**职责**：以聊天气泡形式展示完整对话内容，支持 Markdown 渲染。

**关键功能**：
- 聊天气泡布局：用户消息靠右（蓝色），AI 回复靠左（灰色）
- Markdown 渲染（react-markdown + rehype-highlight）
- 代码块语法高亮 + 复制按钮
- 对话元信息展示（平台、ID、时间、消息数）
- 单条消息复制功能
- 导出为 Markdown 文件
- 不完整消息标记提示

### 13. Frontend - 搜索页

**职责**：提供全文搜索界面，展示搜索结果和高亮匹配。

**关键功能**：
- 全局搜索框（300ms 防抖）
- 搜索结果列表：对话标题、匹配片段（关键词高亮）、平台、时间
- 排序切换：相关度 / 时间
- 附加过滤：平台、时间范围
- 点击结果跳转到对话详情并定位到匹配消息
- 空结果提示

### 14. Frontend - 统计面板

**职责**：可视化展示对话数据统计，使用 ECharts 绑制图表。

**关键功能**：
- 概览卡片：总对话数、总消息数、本周新增
- 平台分布饼图（ECharts Pie）
- 时间趋势折线图（ECharts Line），支持天/周/月切换
- 时间范围选择器，默认最近 30 天
- 加载骨架屏

### 15. Frontend - 用户设置页

**职责**：管理用户账户、API Token 和数据。

**关键功能**：
- 修改密码表单
- API Token 展示（部分遮蔽）+ 复制 + 重新生成（带确认弹窗）
- 数据管理：批量删除（按平台/时间范围，带确认弹窗）
- 主题切换：浅色/深色模式（TailwindCSS dark mode）

## Data Models

### 统一对话格式（Unified Format）

Extension 和 Backend 共享的核心数据结构：

```typescript
// 统一对话格式 - Extension 端 TypeScript 定义
interface UnifiedConversation {
  id: string;                    // 本地生成的 UUID
  platform: Platform;            // 平台来源
  conversationId: string;        // 平台原始对话 ID（max 256 chars）
  title: string;                 // 对话标题
  messages: UnifiedMessage[];    // 消息列表
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  syncStatus: SyncStatus;        // 同步状态
  metadata?: Record<string, any>; // 扩展元数据
}

interface UnifiedMessage {
  id: string;                    // 消息 UUID
  role: 'user' | 'assistant' | 'system' | 'unknown';
  content: string;               // 消息内容
  timestamp: string;             // ISO 8601
  isComplete: boolean;           // 是否完整
  metadata?: Record<string, any>;
}
```

### 数据库 Schema

**数据库抽象层**：通过 GORM 统一接口，运行时根据配置选择 SQLite 或 PostgreSQL driver。

```go
// 数据库初始化（根据配置切换）
func InitDB(cfg *config.Config) (*gorm.DB, error) {
    switch cfg.Database.Driver {
    case "sqlite":
        return gorm.Open(sqlite.Open(cfg.Database.DSN), &gorm.Config{})
    case "postgres":
        return gorm.Open(postgres.Open(cfg.Database.DSN), &gorm.Config{})
    default:
        return nil, fmt.Errorf("unsupported database driver: %s", cfg.Database.Driver)
    }
}
```

**通用 Schema（GORM 模型，兼容 SQLite 和 PostgreSQL）**：

```go
// 用户表
type User struct {
    ID              uint      `gorm:"primaryKey"`
    Username        string    `gorm:"uniqueIndex;size:64;not null"`
    PasswordHash    string    `gorm:"size:256;not null"`
    APIToken        string    `gorm:"size:512"`
    APITokenExpires *time.Time
    CreatedAt       time.Time
    UpdatedAt       time.Time
}

// 对话表
type Conversation struct {
    ID             uint      `gorm:"primaryKey"`
    UserID         uint      `gorm:"index:idx_user_platform;index:idx_user_created;not null"`
    Platform       string    `gorm:"size:32;index:idx_user_platform;not null"`
    ConversationID string    `gorm:"size:256;uniqueIndex:idx_user_conv_id;not null"`
    Title          string    `gorm:"size:500"`
    MessageCount   int       `gorm:"default:0"`
    CreatedAt      time.Time `gorm:"index:idx_user_created;not null"`
    UpdatedAt      time.Time `gorm:"not null"`
    SyncedAt       time.Time
    Messages       []Message `gorm:"foreignKey:ConversationID"`
}

// 消息表
type Message struct {
    ID             uint      `gorm:"primaryKey"`
    ConversationID uint      `gorm:"index:idx_conv_timestamp;not null"`
    Role           string    `gorm:"size:16;not null"`
    Content        string    `gorm:"type:text;not null"`
    Timestamp      time.Time `gorm:"index:idx_conv_timestamp;not null"`
    IsComplete     bool      `gorm:"default:true"`
    CreatedAt      time.Time
}

// 同步日志表
type SyncLog struct {
    ID             uint   `gorm:"primaryKey"`
    UserID         uint   `gorm:"index;not null"`
    ConversationID *uint
    Action         string `gorm:"size:32;not null"`
    SourceIP       string `gorm:"size:45"`
    RequestSize    int
    ErrorMessage   string `gorm:"type:text"`
    CreatedAt      time.Time
}

// 导出任务表
type ExportTask struct {
    ID                 string `gorm:"primaryKey;size:36"`
    UserID             uint   `gorm:"index;not null"`
    Format             string `gorm:"size:16;not null"`
    Status             string `gorm:"size:16;not null;default:processing"`
    Filters            string `gorm:"type:text"` // JSON
    FilePath           string `gorm:"size:512"`
    FileSize           int64
    TotalConversations int
    DownloadURL        string `gorm:"size:1024"`
    ExpiresAt          *time.Time
    CreatedAt          time.Time
    CompletedAt        *time.Time
}
```

**PostgreSQL 特有索引**（迁移时按 driver 条件执行）：

```sql
-- 仅 PostgreSQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_messages_content_trgm ON messages USING GIN(content gin_trgm_ops);
```

**SQLite 特有索引**（FTS5 虚拟表）：

```sql
-- 仅 SQLite
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id',
    tokenize='unicode61'
);

-- 触发器保持 FTS 同步
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
```

### IndexedDB Schema（Extension 本地缓存）

```typescript
// Dexie.js 数据库定义
import Dexie, { Table } from 'dexie';

class AIChatDB extends Dexie {
  conversations!: Table<LocalConversation>;
  messages!: Table<LocalMessage>;
  syncQueue!: Table<SyncQueueItem>;

  constructor() {
    super('AIChatCollector');
    this.version(1).stores({
      conversations: '++id, conversationId, platform, createdAt, updatedAt, syncStatus, [platform+createdAt]',
      messages: '++id, conversationId, role, timestamp, [conversationId+timestamp]',
      syncQueue: '++id, conversationId, status, createdAt, nextRetryAt',
    });
  }
}

interface LocalConversation {
  id?: number;                   // 自增主键
  conversationId: string;        // 平台对话 ID
  platform: Platform;
  title: string;
  messageCount: number;
  createdAt: string;             // ISO 8601
  updatedAt: string;
  syncStatus: SyncStatus;
  lastSyncAt?: string;
  rawData?: string;              // 解析失败时保存原始数据（max 1MB）
}

interface LocalMessage {
  id?: number;
  conversationId: string;        // 关联对话 ID
  role: string;
  content: string;
  timestamp: string;
  isComplete: boolean;
}

interface SyncQueueItem {
  id?: number;
  conversationId: string;
  status: 'pending' | 'syncing' | 'failed';
  retryCount: number;
  nextRetryAt?: string;
  lastError?: string;
  createdAt: string;
}
```

## API Design

### Auth 端点

#### POST /api/v1/auth/register - 用户注册

```json
// Request
{
  "username": "user1",
  "password": "securePassword123"
}

// Response 201
{
  "user_id": 1,
  "username": "user1",
  "created_at": "2024-01-15T10:00:00Z"
}
```

#### POST /api/v1/auth/login - 用户登录

```json
// Request
{
  "username": "user1",
  "password": "securePassword123"
}

// Response 200
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 86400
}
```

#### POST /api/v1/auth/token - 生成 API Token

```json
// Request (需要 JWT 认证)
// Headers: Authorization: Bearer <access_token>
{}

// Response 200
{
  "api_token": "aic_a1b2c3d4e5f6...",
  "expires_at": "2024-02-14T10:00:00Z",
  "expires_in_days": 30
}
```

#### POST /api/v1/auth/refresh - 刷新 Token

```json
// Request
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}

// Response 200
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 86400
}
```

### Sync 端点

#### POST /api/v1/conversations/sync - 单条同步

```json
// Request
// Headers: Authorization: Bearer <token>
{
  "platform": "chatgpt",
  "conversation_id": "conv_abc123",
  "title": "关于 Python 异步编程的讨论",
  "messages": [
    {
      "role": "user",
      "content": "请解释 Python 中 async/await 的工作原理",
      "timestamp": "2024-01-15T10:30:00Z",
      "is_complete": true
    },
    {
      "role": "assistant",
      "content": "Python 的 async/await 是基于协程的异步编程模型...",
      "timestamp": "2024-01-15T10:30:05Z",
      "is_complete": true
    }
  ],
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:05Z"
}

// Response 200
{
  "success": true,
  "conversation_id": "conv_abc123",
  "action": "created"
}
```

#### POST /api/v1/conversations/batch - 批量同步

```json
// Request
// Headers: Authorization: Bearer <token>
{
  "conversations": [
    {
      "platform": "gemini",
      "conversation_id": "gem_xyz789",
      "title": "代码审查建议",
      "messages": [...],
      "created_at": "2024-01-15T09:00:00Z",
      "updated_at": "2024-01-15T09:15:00Z"
    },
    {
      "platform": "tongyi",
      "conversation_id": "ty_def456",
      "title": "数据库设计方案",
      "messages": [...],
      "created_at": "2024-01-15T08:00:00Z",
      "updated_at": "2024-01-15T08:20:00Z"
    }
  ]
}

// Response 200
{
  "total": 2,
  "created": 1,
  "updated": 1,
  "failed": 0,
  "results": [
    {"conversation_id": "gem_xyz789", "action": "created"},
    {"conversation_id": "ty_def456", "action": "updated"}
  ],
  "errors": []
}
```

### Query 端点

#### GET /api/v1/conversations - 对话列表

```json
// Request
// GET /api/v1/conversations?platform=chatgpt&platform=gemini&start_time=2024-01-01T00:00:00Z&page=1&page_size=20

// Response 200
{
  "items": [
    {
      "id": 1,
      "platform": "chatgpt",
      "conversation_id": "conv_abc123",
      "title": "关于 Python 异步编程的讨论",
      "message_count": 12,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T11:00:00Z"
    }
  ],
  "total": 156,
  "page": 1,
  "page_size": 20,
  "total_pages": 8
}
```

#### GET /api/v1/conversations/:id - 对话详情

```json
// Response 200
{
  "id": 1,
  "platform": "chatgpt",
  "conversation_id": "conv_abc123",
  "title": "关于 Python 异步编程的讨论",
  "message_count": 12,
  "messages": [
    {
      "id": 1,
      "role": "user",
      "content": "请解释 Python 中 async/await 的工作原理",
      "timestamp": "2024-01-15T10:30:00Z",
      "is_complete": true
    },
    {
      "id": 2,
      "role": "assistant",
      "content": "Python 的 async/await 是基于协程的异步编程模型...",
      "timestamp": "2024-01-15T10:30:05Z",
      "is_complete": true
    }
  ],
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T11:00:00Z"
}
```

### Search 端点

#### GET /api/v1/search - 全文搜索

```json
// Request
// GET /api/v1/search?q=异步编程&platform=chatgpt&sort_by=relevance&page=1&page_size=20

// Response 200
{
  "items": [
    {
      "conversation_id": "conv_abc123",
      "platform": "chatgpt",
      "title": "关于 Python 异步编程的讨论",
      "matched_message": {
        "message_id": 2,
        "role": "assistant",
        "context": "...Python 的 async/await 是基于协程的<em>异步编程</em>模型，它允许在单线程中...",
        "highlights": ["<em>异步编程</em>"],
        "timestamp": "2024-01-15T10:30:05Z"
      },
      "created_at": "2024-01-15T10:30:00Z",
      "relevance_score": 0.95
    }
  ],
  "total": 5,
  "page": 1,
  "page_size": 20
}
```

### Stats 端点

#### GET /api/v1/stats/overview - 统计概览

```json
// Response 200
{
  "total_conversations": 342,
  "total_messages": 4521,
  "this_week_new": 28,
  "platform_distribution": {
    "chatgpt": 156,
    "gemini": 89,
    "tongyi": 62,
    "doubao": 35
  }
}
```

#### GET /api/v1/stats/timeline - 时间趋势

```json
// Request
// GET /api/v1/stats/timeline?granularity=day&start_time=2024-01-01T00:00:00Z&end_time=2024-01-31T23:59:59Z

// Response 200
{
  "granularity": "day",
  "data": [
    {"date": "2024-01-01", "count": 5},
    {"date": "2024-01-02", "count": 8},
    {"date": "2024-01-03", "count": 3},
    {"date": "2024-01-04", "count": 12}
  ]
}
```

### Export 端点

#### POST /api/v1/export - 创建导出任务

```json
// Request
{
  "format": "markdown",
  "platform": ["chatgpt", "gemini"],
  "start_time": "2024-01-01T00:00:00Z",
  "end_time": "2024-01-31T23:59:59Z"
}

// Response 202 (异步任务)
{
  "task_id": "export_a1b2c3d4",
  "status": "processing",
  "total_conversations": 245,
  "download_url": null,
  "expires_at": null
}

// Response 200 (小数据量直接返回)
{
  "task_id": "export_e5f6g7h8",
  "status": "completed",
  "total_conversations": 50,
  "download_url": "/api/v1/export/export_e5f6g7h8/download",
  "expires_at": "2024-01-16T10:00:00Z"
}
```

#### GET /api/v1/export/:taskId - 查询导出状态

```json
// Response 200
{
  "task_id": "export_a1b2c3d4",
  "status": "completed",
  "format": "markdown",
  "total_conversations": 245,
  "file_size": 5242880,
  "download_url": "/api/v1/export/export_a1b2c3d4/download",
  "expires_at": "2024-01-16T10:00:00Z",
  "created_at": "2024-01-15T10:00:00Z",
  "completed_at": "2024-01-15T10:02:30Z"
}
```

## Security

### Token 加密存储（Extension）

插件中的认证令牌使用 AES-GCM 加密后存储在 `chrome.storage.local` 中：

```typescript
// 加密存储方案
class SecureStorage {
  private async getEncryptionKey(): Promise<CryptoKey> {
    // 使用 Web Crypto API 生成/获取加密密钥
    // 密钥基于浏览器实例唯一标识派生
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(await this.getDeviceId()),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext)
    );
    // 返回 base64(iv + ciphertext)
    return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)));
  }

  async decrypt(ciphertext: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const data = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv = data.slice(0, 12);
    const encrypted = data.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    return new TextDecoder().decode(decrypted);
  }
}
```

### HTTPS 强制

- Extension 配置页仅允许输入 `https://` 开头的服务 URL
- Backend 在生产环境强制 HTTPS（通过反向代理 Nginx/Caddy）
- 所有 API 通信使用 TLS 1.2+

### JWT 认证流程

```
┌──────────┐          ┌──────────┐          ┌──────────┐
│  Client  │          │  Backend │          │ Database │
└────┬─────┘          └────┬─────┘          └────┬─────┘
     │  POST /auth/login   │                     │
     │────────────────────▶│                     │
     │                     │  验证用户名密码      │
     │                     │────────────────────▶│
     │                     │◀────────────────────│
     │  返回 JWT Token     │                     │
     │◀────────────────────│                     │
     │                     │                     │
     │  GET /conversations │                     │
     │  Authorization:     │                     │
     │  Bearer <token>     │                     │
     │────────────────────▶│                     │
     │                     │  验证 JWT 签名+过期  │
     │                     │  提取 user_id       │
     │                     │────────────────────▶│
     │  返回数据           │◀────────────────────│
     │◀────────────────────│                     │
```

### 限流策略

```go
// 使用 golang.org/x/time/rate 或 gin-contrib/limiter
// 配置示例
type RateLimitConfig struct {
    Enabled          bool `mapstructure:"enabled"`
    AuthMaxAttempts  int  `mapstructure:"auth_max_attempts"`   // 5 分钟内最多 10 次失败
    AuthBlockMinutes int  `mapstructure:"auth_block_minutes"`  // 封禁 15 分钟
    SearchPerMinute  int  `mapstructure:"search_per_minute"`   // 单用户每分钟 30 次
    APIPerMinute     int  `mapstructure:"api_per_minute"`      // 单用户每分钟 120 次
}
```

### 输入验证

- 所有 API 输入通过 Pydantic 模型严格校验
- 字符串字段设置最大长度限制
- 请求体大小限制 10MB（Nginx + FastAPI 双重限制）
- SQL 注入防护：使用 SQLAlchemy ORM 参数化查询
- XSS 防护：前端使用 React 自动转义 + DOMPurify 处理 Markdown 渲染

## Deployment

### 配置文件格式

后端使用 YAML 配置文件，支持环境变量覆盖。启动时按以下优先级加载：

1. 命令行参数 `--config path/to/config.yaml`
2. 环境变量 `AIINBOX_CONFIG` 指定的路径
3. 当前目录 `./config.yaml`
4. 用户目录 `~/.aiinbox/config.yaml`

```yaml
# config.yaml - 本地模式示例
server:
  host: "127.0.0.1"        # 监听地址
  port: 8080               # 监听端口
  mode: "release"          # debug | release

database:
  driver: "sqlite"         # sqlite | postgres
  dsn: "./data/aiinbox.db" # SQLite 文件路径 或 PostgreSQL 连接串
  # dsn: "host=localhost user=aiinbox password=xxx dbname=aiinbox port=5432 sslmode=disable"
  max_open_conns: 10
  max_idle_conns: 5

auth:
  jwt_secret: "your-secret-key-at-least-32-characters-long"
  jwt_expire_minutes: 1440       # 24 小时
  api_token_expire_days: 30
  bcrypt_cost: 12

search:
  # SQLite 模式自动使用 FTS5，PostgreSQL 模式自动使用 pg_trgm
  max_results: 100

export:
  dir: "./data/exports"          # 导出文件存储目录
  file_expire_hours: 24
  max_concurrent: 3              # 最大并发导出任务数

rate_limit:
  enabled: true
  auth_max_attempts: 10          # 5 分钟内最大认证失败次数
  auth_block_minutes: 15
  search_per_minute: 30
  api_per_minute: 120

cors:
  allowed_origins:
    - "http://localhost:3000"
    - "chrome-extension://*"
  allowed_methods:
    - "GET"
    - "POST"
    - "PUT"
    - "DELETE"

log:
  level: "info"                  # debug | info | warn | error
  format: "json"                 # json | text
  output: "stdout"               # stdout | file
  file_path: "./data/logs/app.log"
```

```yaml
# config.yaml - 远程模式示例（Docker 部署）
server:
  host: "0.0.0.0"
  port: 8080
  mode: "release"

database:
  driver: "postgres"
  dsn: "host=db user=${DB_USER} password=${DB_PASSWORD} dbname=${DB_NAME} port=5432 sslmode=disable"
  max_open_conns: 50
  max_idle_conns: 10

auth:
  jwt_secret: "${JWT_SECRET}"
  jwt_expire_minutes: 1440
  api_token_expire_days: 30

cors:
  allowed_origins:
    - "${FRONTEND_URL}"
    - "chrome-extension://*"
```

### 配置加载方式

```go
// config/config.go
package config

import (
    "os"
    "github.com/spf13/viper"
)

type Config struct {
    Server    ServerConfig    `mapstructure:"server"`
    Database  DatabaseConfig  `mapstructure:"database"`
    Auth      AuthConfig      `mapstructure:"auth"`
    Search    SearchConfig    `mapstructure:"search"`
    Export    ExportConfig    `mapstructure:"export"`
    RateLimit RateLimitConfig `mapstructure:"rate_limit"`
    CORS      CORSConfig      `mapstructure:"cors"`
    Log       LogConfig       `mapstructure:"log"`
}

type ServerConfig struct {
    Host string `mapstructure:"host"`
    Port int    `mapstructure:"port"`
    Mode string `mapstructure:"mode"`
}

type DatabaseConfig struct {
    Driver       string `mapstructure:"driver"`
    DSN          string `mapstructure:"dsn"`
    MaxOpenConns int    `mapstructure:"max_open_conns"`
    MaxIdleConns int    `mapstructure:"max_idle_conns"`
}

type AuthConfig struct {
    JWTSecret          string `mapstructure:"jwt_secret"`
    JWTExpireMinutes   int    `mapstructure:"jwt_expire_minutes"`
    APITokenExpireDays int    `mapstructure:"api_token_expire_days"`
    BcryptCost         int    `mapstructure:"bcrypt_cost"`
}

// Load 加载配置，优先级：命令行 > 环境变量 > 配置文件
func Load(configPath string) (*Config, error) {
    v := viper.New()
    v.SetConfigType("yaml")

    // 设置默认值
    v.SetDefault("server.host", "127.0.0.1")
    v.SetDefault("server.port", 8080)
    v.SetDefault("server.mode", "release")
    v.SetDefault("database.driver", "sqlite")
    v.SetDefault("database.dsn", "./data/aiinbox.db")
    v.SetDefault("auth.jwt_expire_minutes", 1440)
    v.SetDefault("auth.api_token_expire_days", 30)
    v.SetDefault("auth.bcrypt_cost", 12)

    // 按优先级查找配置文件
    if configPath != "" {
        v.SetConfigFile(configPath)
    } else if envPath := os.Getenv("AIINBOX_CONFIG"); envPath != "" {
        v.SetConfigFile(envPath)
    } else {
        v.SetConfigName("config")
        v.AddConfigPath(".")
        v.AddConfigPath("$HOME/.aiinbox")
    }

    // 支持环境变量覆盖（前缀 AIINBOX_）
    v.SetEnvPrefix("AIINBOX")
    v.AutomaticEnv()

    if err := v.ReadInConfig(); err != nil {
        // 配置文件不存在时使用默认值
        if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
            return nil, err
        }
    }

    var cfg Config
    if err := v.Unmarshal(&cfg); err != nil {
        return nil, err
    }
    return &cfg, nil
}
```

### 本地模式部署（单二进制）

```bash
# 下载对应平台的二进制
# Windows: aiinbox-windows-amd64.exe
# macOS:   aiinbox-darwin-arm64
# Linux:   aiinbox-linux-amd64

# 首次运行，自动创建默认配置和数据目录
./aiinbox

# 或指定配置文件
./aiinbox --config /path/to/config.yaml

# 启动后访问
# Web UI:  http://localhost:8080
# API:     http://localhost:8080/api/v1/
```

Go 二进制内嵌前端静态文件（使用 `embed` 包）：

```go
package main

import "embed"

//go:embed frontend/dist/*
var frontendFS embed.FS

// 注册静态文件服务
func registerFrontend(r *gin.Engine) {
    r.StaticFS("/", http.FS(frontendFS))
    // SPA fallback
    r.NoRoute(func(c *gin.Context) {
        c.FileFromFS("/index.html", http.FS(frontendFS))
    })
}
```

### 远程模式部署（Docker Compose）

```yaml
version: '3.8'

services:
  aiinbox:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "${PORT:-8080}:8080"
    environment:
      - AIINBOX_SERVER_HOST=0.0.0.0
      - AIINBOX_DATABASE_DRIVER=postgres
      - AIINBOX_DATABASE_DSN=host=db user=${DB_USER} password=${DB_PASSWORD} dbname=${DB_NAME} port=5432 sslmode=disable
      - AIINBOX_AUTH_JWT_SECRET=${JWT_SECRET}
      - AIINBOX_CORS_ALLOWED_ORIGINS=http://localhost:3000,chrome-extension://*
    volumes:
      - export_data:/app/data/exports
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=${DB_USER:-aiinbox}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=${DB_NAME:-aiinbox}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "${DB_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-aiinbox}"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
  export_data:
```

### Backend Dockerfile

```dockerfile
# 多阶段构建
FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# 构建前端
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# 最终构建
FROM builder AS final
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN CGO_ENABLED=1 go build -o aiinbox ./cmd/server

# 运行镜像
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=final /app/aiinbox .
EXPOSE 8080
CMD ["./aiinbox"]
```

### 数据库迁移

使用 golang-migrate 管理迁移：

```bash
# 内嵌到二进制中，启动时自动执行
./aiinbox migrate up

# 回滚
./aiinbox migrate down 1
```

迁移文件结构：

```
backend/
├── migrations/
│   ├── sqlite/
│   │   ├── 001_initial.up.sql
│   │   ├── 001_initial.down.sql
│   │   ├── 002_fts5.up.sql
│   │   └── 002_fts5.down.sql
│   └── postgres/
│       ├── 001_initial.up.sql
│       ├── 001_initial.down.sql
│       ├── 002_extensions.up.sql
│       └── 002_extensions.down.sql
```

### 项目目录结构

```
aiinbox/
├── extension/                # 浏览器插件
│   ├── src/
│   │   ├── background/       # Service Worker
│   │   │   ├── index.ts
│   │   │   ├── interceptor.ts
│   │   │   └── sync-scheduler.ts
│   │   ├── adapters/         # 平台适配器
│   │   │   ├── base.ts
│   │   │   ├── chatgpt.ts
│   │   │   ├── gemini.ts
│   │   │   ├── tongyi.ts
│   │   │   └── doubao.ts
│   │   ├── storage/          # Dexie.js 存储
│   │   │   ├── db.ts
│   │   │   ├── collector.ts
│   │   │   └── sync-queue.ts
│   │   ├── sync/             # 同步服务
│   │   │   ├── service.ts
│   │   │   └── retry.ts
│   │   ├── popup/            # 弹出面板 React
│   │   │   ├── App.tsx
│   │   │   └── components/
│   │   ├── options/          # 设置页 React
│   │   │   ├── App.tsx
│   │   │   └── components/
│   │   ├── types/            # 类型定义
│   │   │   └── index.ts
│   │   └── utils/            # 工具函数
│   │       ├── crypto.ts
│   │       └── logger.ts
│   ├── manifest.json
│   ├── vite.config.ts
│   └── package.json
├── backend/                  # 后端服务 (Go)
│   ├── cmd/
│   │   └── server/
│   │       └── main.go       # 入口
│   ├── internal/
│   │   ├── config/           # 配置加载
│   │   │   └── config.go
│   │   ├── database/         # 数据库初始化
│   │   │   └── database.go
│   │   ├── models/           # GORM 模型
│   │   │   ├── user.go
│   │   │   ├── conversation.go
│   │   │   ├── message.go
│   │   │   └── sync_log.go
│   │   ├── handlers/         # HTTP 处理器
│   │   │   ├── auth.go
│   │   │   ├── sync.go
│   │   │   ├── conversations.go
│   │   │   ├── search.go
│   │   │   ├── stats.go
│   │   │   └── export.go
│   │   ├── services/         # 业务逻辑
│   │   │   ├── auth_service.go
│   │   │   ├── sync_service.go
│   │   │   ├── search_service.go
│   │   │   ├── stats_service.go
│   │   │   └── export_service.go
│   │   ├── middleware/       # 中间件
│   │   │   ├── auth.go
│   │   │   ├── cors.go
│   │   │   └── rate_limit.go
│   │   └── search/           # 搜索引擎抽象
│   │       ├── engine.go     # 接口定义
│   │       ├── sqlite.go     # FTS5 实现
│   │       └── postgres.go   # pg_trgm 实现
│   ├── migrations/           # 数据库迁移
│   │   ├── sqlite/
│   │   └── postgres/
│   ├── go.mod
│   ├── go.sum
│   └── Dockerfile
├── frontend/                 # 前端 Web 应用
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── ConversationList.tsx
│   │   │   ├── ConversationDetail.tsx
│   │   │   ├── Search.tsx
│   │   │   ├── Stats.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/
│   │   │   ├── ChatBubble.tsx
│   │   │   ├── PlatformFilter.tsx
│   │   │   ├── SearchBar.tsx
│   │   │   └── StatsChart.tsx
│   │   ├── stores/
│   │   │   ├── conversationStore.ts
│   │   │   ├── searchStore.ts
│   │   │   ├── statsStore.ts
│   │   │   └── authStore.ts
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   ├── auth.ts
│   │   │   ├── conversations.ts
│   │   │   ├── search.ts
│   │   │   └── stats.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   └── utils/
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── config.yaml               # 默认配置文件
├── docker-compose.yml
├── .env.example
├── Makefile                  # 构建脚本
├── docs/
│   └── architecture.md
└── README.md
```

## Error Handling

### Extension 错误处理

| 错误场景 | 处理策略 | 用户通知 |
|----------|----------|----------|
| webRequest API 不可用 | 停止拦截，记录日志 | 图标变红，Popup 显示错误 |
| 流式响应超时（30s） | 保存已接收数据，标记不完整 | 无（静默处理） |
| 流式数据超过 50MB | 停止接收，保存已有数据 | 无（静默处理） |
| 平台响应格式无法识别 | 保存原始数据（≤1MB），标记解析失败 | 控制台警告 |
| IndexedDB 写入失败 | 重试 3 次（间隔 5s），失败后暂存内存 | 图标变红 |
| 同步请求失败 | 指数退避重试（最多 5 次） | Popup 显示待同步数量 |
| 认证 Token 过期 | 停止同步，提示用户更新 Token | Popup 显示认证错误 |
| 存储空间超过 80% | 通知用户清理 | 浏览器通知 + Popup 提示 |

### Backend 错误处理

| 错误场景 | HTTP 状态码 | 响应格式 |
|----------|-------------|----------|
| 请求体格式错误 | 400 | `{"error": "validation_error", "details": [...]}` |
| 未认证 | 401 | `{"error": "unauthorized", "message": "..."}` |
| Token 过期 | 401 | `{"error": "token_expired", "message": "..."}` |
| 限流触发 | 429 | `{"error": "rate_limited", "retry_after": 60}` |
| 请求体过大 | 413 | `{"error": "payload_too_large", "max_size": 10485760}` |
| 资源不存在 | 404 | `{"error": "not_found", "message": "..."}` |
| 服务器内部错误 | 500 | `{"error": "internal_error", "request_id": "..."}` |
| 数据库连接失败 | 503 | `{"error": "service_unavailable", "message": "..."}` |

### Frontend 错误处理

- 网络请求失败：显示 Toast 提示，提供重试按钮
- 认证过期：自动跳转登录页
- 数据加载失败：显示错误状态组件，提供重试入口
- 搜索超时：显示超时提示，建议缩小搜索范围

## Testing Strategy

### Extension 测试

| 层级 | 工具 | 覆盖范围 |
|------|------|----------|
| 单元测试 | Vitest | Platform Adapters 解析逻辑、数据格式转换、加密工具 |
| 集成测试 | Vitest + fake-indexeddb | Collector 存储操作、Sync Service 重试逻辑 |
| E2E 测试 | Playwright | 插件安装、Popup 交互、Options 配置保存 |

### Backend 测试

| 层级 | 工具 | 覆盖范围 |
|------|------|----------|
| 单元测试 | go test + testify | Service 层业务逻辑、数据验证、Token 生成/验证 |
| 集成测试 | go test + testcontainers-go | API 端点、数据库操作、搜索功能 |
| 性能测试 | k6 / vegeta | 并发同步请求、搜索响应时间 |

### Frontend 测试

| 层级 | 工具 | 覆盖范围 |
|------|------|----------|
| 单元测试 | Vitest + React Testing Library | 组件渲染、Store 逻辑 |
| E2E 测试 | Playwright | 页面导航、搜索流程、数据导出 |

### 关键测试场景

1. **平台适配器**：每个平台准备真实 API 响应样本，验证解析结果正确性
2. **流式响应**：模拟 SSE 数据流，验证拼接和超时处理
3. **数据同步**：模拟网络中断、认证失败、冲突场景
4. **全文搜索**：验证中英文搜索准确性和性能（< 500ms）
5. **并发安全**：多标签页同时拦截不互相干扰
