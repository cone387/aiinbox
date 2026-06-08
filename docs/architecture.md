# AI Chat Collector 架构图

## 系统全局架构

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              用户浏览器                                        │
│                                                                               │
│  ┌─────────────────────────┐          ┌────────────────────────────────────┐ │
│  │    AI 平台 Web 端       │          │        浏览器插件 (Extension)       │ │
│  │                         │  拦截    │                                     │ │
│  │  • chat.openai.com      │─────────▶│  Interceptor → Parser → Collector  │ │
│  │  • gemini.google.com    │          │                          │          │ │
│  │  • tongyi.aliyun.com    │          │                     IndexedDB       │ │
│  │  • doubao.com           │          │                          │          │ │
│  │                         │          │                     Sync Service    │ │
│  └─────────────────────────┘          └──────────────────────────┬─────────┘ │
│                                                                   │           │
└───────────────────────────────────────────────────────────────────┼───────────┘
                                                                    │
                                                              HTTPS │ 推送数据
                                                                    │
┌───────────────────────────────────────────────────────────────────┼───────────┐
│                              后端服务 (Backend)                    │           │
│                                                                   ▼           │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   Auth Module   │    │   Sync API      │    │     Query API           │  │
│  │                 │    │                 │    │                          │  │
│  │ • JWT 认证      │    │ POST /sync      │    │ GET /conversations      │  │
│  │ • Token 验证    │    │ POST /batch     │    │ GET /conversations/:id  │  │
│  │                 │    │ 冲突处理        │    │ GET /search              │  │
│  └────────┬────────┘    └────────┬────────┘    └────────────┬────────────┘  │
│           │                      │                           │               │
│           └──────────────────────┼───────────────────────────┘               │
│                                  ▼                                            │
│                       ┌─────────────────────┐                                │
│                       │     Database         │                                │
│                       │                      │                                │
│                       │  • conversations     │                                │
│                       │  • messages          │                                │
│                       │  • users             │                                │
│                       │  • sync_logs         │                                │
│                       └─────────────────────┘                                │
└──────────────────────────────────────────────────────────────────────────────┘
                                                                    │
                                                              HTTPS │ 查询数据
                                                                    │
┌───────────────────────────────────────────────────────────────────┼───────────┐
│                          前端 Web 应用 (Frontend)                  │           │
│                                                                   ▼           │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │ │
│  │  │   对话列表   │  │   对话详情   │  │   全文搜索   │  │   统计面板  │  │ │
│  │  │              │  │              │  │              │  │             │  │ │
│  │  │ • 按平台筛选 │  │ • 完整对话   │  │ • 关键词搜索 │  │ • 使用趋势 │  │ │
│  │  │ • 按时间排序 │  │ • Markdown   │  │ • 平台过滤   │  │ • 平台分布 │  │ │
│  │  │ • 同步状态   │  │   渲染       │  │ • 时间范围   │  │ • 对话量   │  │ │
│  │  │ • 批量操作   │  │ • 导出       │  │              │  │             │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │ │
│  │                                                                          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 三个模块职责

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│   浏览器插件         │     │     后端服务         │     │    前端 Web 应用     │
│   (Extension)       │     │     (Backend)        │     │    (Frontend)       │
├─────────────────────┤     ├─────────────────────┤     ├─────────────────────┤
│                     │     │                     │     │                     │
│ • 拦截网络请求      │     │ • 接收插件推送数据  │     │ • 对话列表浏览      │
│ • 解析流式响应      │     │ • 用户认证鉴权      │     │ • 对话详情查看      │
│ • 多平台适配        │     │ • 数据持久化存储    │     │ • 全文搜索          │
│ • 本地缓存          │     │ • 去重 & 冲突处理   │     │ • 按平台/时间筛选   │
│ • 数据同步推送      │     │ • 查询 API          │     │ • 数据导出          │
│ • 用户配置          │     │ • 搜索 API          │     │ • 使用统计          │
│ • 状态展示          │     │ • 同步日志          │     │ • 用户设置          │
│                     │     │                     │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
        │                           ▲    │                        ▲
        │      HTTPS POST           │    │     HTTPS GET          │
        └───────────────────────────┘    └────────────────────────┘
              推送对话数据                      查询对话数据
```

## 数据流全链路

```
用户在 ChatGPT/Gemini/千问/豆包 对话
              │
              ▼
┌──────────── 插件 ────────────┐
│  拦截 → 解析 → 缓存 → 推送  │
└──────────────┬───────────────┘
               │ POST /api/sync
               ▼
┌──────────── 后端 ────────────┐
│  验证 → 去重 → 存储 → 索引  │
└──────────────┬───────────────┘
               │ GET /api/conversations
               ▼
┌──────────── 前端 ────────────┐
│  展示 → 搜索 → 筛选 → 导出  │
└──────────────────────────────┘
```

## 后端 API 端点（当前实现）

业务端点统一位于 `/api/v1` 前缀下；除标注「公开」者外均需 JWT 认证（`Authorization: Bearer <token>`）。认证类端点带 IP 限流，受保护端点带按用户限流（可配置）。

| 分组 | 方法 & 路径 | 说明 |
|------|------------|------|
| 健康 | `GET /health` | 服务存活探针（公开） |
| 健康 | `GET /health/auth` | 校验 token 有效性 |
| 认证 | `POST /auth/register` · `POST /auth/login` | 注册 / 登录（公开，IP 限流） |
| 认证 | `POST /auth/refresh` | 刷新 access token（公开） |
| 认证 | `POST /auth/exchange` | 扩展用一次性 code 换 token（公开，IP 限流） |
| 授权 | `GET /authorize/validate` · `POST /authorize` | 浏览器扩展授权同意流程，签发一次性 code |
| API Token | `POST /auth/token` · `GET /auth/tokens` · `DELETE /auth/token` | 管理长期 API Token |
| 同步 | `POST /conversations/sync` · `POST /conversations/batch` | 单条 / 批量对话同步 |
| 同步 | `GET /sync/status` | 同步状态 |
| 查询 | `GET /conversations` · `GET /conversations/:id` · `GET /conversations/:id/messages` | 列表 / 详情 / 消息 |
| 查询 | `POST /conversations/:id/read` · `POST /conversations/read-all` | 标记已读 |
| 查询 | `DELETE /conversations` | 批量删除 |
| 搜索 | `GET /search` | 全文搜索（SQLite FTS5 / PostgreSQL） |
| 统计 | `GET /stats/overview` | 概览指标 |
| 统计 | `GET /stats/timeline` | 时间趋势（按平台拆分） |
| 统计 | `GET /stats/activity` | 使用习惯热力图 |
| 统计 | `GET /stats/insights` | 内容洞察 |

## 统计模块（当前能力与设计）

四个统计端点均按用户隔离查询（`messages JOIN conversations` 限定 `user_id`），统计口径基于**真实对话时间**（`conversations.created_at` / `messages.timestamp`，即平台原始时间），而非导入时间（`synced_at`）。

**端点能力**

- `GET /stats/overview`：总对话数、总消息数、本周新增、平均对话长度、未读对话数；平台分布同时给出按会话数（`platform_distribution`）与按消息数（`platform_msg_distribution`）两个维度。
- `GET /stats/timeline?granularity=&metric=&range=&tz_offset=`：
  - `granularity`：`day` / `week` / `month`
  - `metric`：`conversations`（按 `created_at`）或 `messages`（按 `timestamp`）
  - `range`：`30d`（默认）/ `90d` / `1y` / `all`，亦可用 `start_time` / `end_time` 显式覆盖
  - 返回 `{ granularity, metric, dates[], series[{ platform, data[] }] }`——**每个平台一条对齐的时间序列**，前端按平台分别画线、图例可逐平台切换。
- `GET /stats/activity?tz_offset=`：按本地小时（`by_hour[24]`）与星期（`by_weekday[7]`，周一=0）统计消息量，并给出 7×24 `heatmap`，呈现活跃时段分布。
- `GET /stats/insights`：提问 / 回复的消息数与字数、平均提问 / 回复字数，以及各平台平均回复长度（`platform_avg_reply_length`）。

**关键设计决策**

- **时间分桶在 Go 侧完成，而非 SQL**：`strftime` 仅 SQLite 可用、会在 PostgreSQL 上失效；改为只取时间列、在 Go 内按粒度分桶，兼顾可移植性与显式时区处理。
- **时区契约**：前端传 `tz_offset = new Date().getTimezoneOffset()`（UTC+8 → `-480`）；后端以 `local = utc + (-tz_offset) 分钟` 还原本地时间再分桶，避免靠近本地午夜的记录被推到错误的日期。
- **可移植聚合**：内容统计只使用 ANSI 通用聚合（`COUNT` / `SUM(LENGTH())` / `AVG(LENGTH())` / `GROUP BY`）；`LENGTH()` 对文本列在 SQLite 与 PostgreSQL 均返回字符数，CJK 统计正确。
- **day 粒度零填充**：跨度 ≤120 天时连续补齐日期桶（避免折线误导性跳连）；更长跨度（如 `all`）退化为稀疏排序桶，避免产生上千空点。
- 统计为按需实时计算，当前未引入缓存层。

## 技术选型建议

| 模块 | 技术栈 | 说明 |
|------|--------|------|
| **插件** | TypeScript + Manifest V3 + Vite + CRXJS | 现代浏览器扩展开发 |
| **插件 UI** | React (Popup & Options) | 轻量弹窗和设置页 |
| **后端** | Go (Gin) | 单二进制部署，高性能 |
| **数据库** | SQLite (本地) / PostgreSQL (远程) | 通过配置切换 |
| **前端** | React + TypeScript + Ant Design + TailwindCSS | SPA 管理界面 |
| **部署（本地）** | 单二进制 (Go embed) | 下载即用，零依赖 |
| **部署（远程）** | Docker + Docker Compose | PostgreSQL + 多用户 |

## 项目目录结构

```
aiinbox/
├── extension/                # 浏览器插件
│   ├── src/
│   │   ├── background/       # Service Worker
│   │   ├── adapters/         # 平台适配器
│   │   ├── storage/          # Dexie.js 存储
│   │   ├── sync/             # 同步服务
│   │   ├── popup/            # 弹出面板 UI
│   │   └── options/          # 设置页 UI
│   ├── manifest.json
│   └── vite.config.ts
├── backend/                  # 后端服务 (Go)
│   ├── cmd/server/           # 入口
│   ├── internal/
│   │   ├── config/           # 配置加载 (Viper)
│   │   ├── database/         # 数据库初始化
│   │   ├── models/           # GORM 模型
│   │   ├── handlers/         # HTTP 处理器
│   │   ├── services/         # 业务逻辑
│   │   ├── middleware/       # 认证/限流
│   │   └── search/           # 搜索引擎抽象
│   ├── migrations/           # 数据库迁移
│   │   ├── sqlite/
│   │   └── postgres/
│   └── go.mod
├── frontend/                 # 前端 Web 应用
│   ├── src/
│   │   ├── pages/            # 页面
│   │   ├── components/       # 组件
│   │   ├── stores/           # Zustand 状态
│   │   └── api/              # API 调用
│   └── vite.config.ts
├── config.yaml               # 默认配置文件
├── docker-compose.yml
└── Makefile                  # 构建脚本
```
