# Implementation Plan:

## Overview

AI Chat Collector 项目实现计划，包含 16 个任务，覆盖后端（Go）、浏览器插件（TypeScript）和前端（React）三个模块的完整开发流程。

## Tasks

- [x] 1. 项目初始化与基础架构搭建
  - 创建 monorepo 目录结构（extension/、backend/、frontend/）
  - 初始化 Go 后端项目（go mod init、Gin 框架、基础路由）
  - 实现配置加载模块（Viper，支持 YAML + 环境变量覆盖）
  - 创建默认 config.yaml 配置文件
  - 实现数据库抽象层（GORM，支持 SQLite/PostgreSQL 切换）
  - 创建数据库迁移文件（sqlite/ 和 postgres/ 两套）
  - 实现自动迁移逻辑（启动时执行）
  - 初始化前端项目（Vite + React + TypeScript + Ant Design + TailwindCSS）
  - 初始化浏览器插件项目（Vite + CRXJS + Manifest V3 + React）
  - 创建 Makefile（构建、测试、运行命令）
  - 创建 docker-compose.yml 和 Dockerfile
  - 创建 .env.example

- [x] 2. 后端认证模块
  - 实现 User GORM 模型
  - 实现用户注册接口 POST /api/v1/auth/register（bcrypt 密码哈希）
  - 实现用户登录接口 POST /api/v1/auth/login（返回 JWT）
  - 实现 JWT 签发与验证中间件
  - 实现 API Token 生成接口 POST /api/v1/auth/token
  - 实现 Token 刷新接口 POST /api/v1/auth/refresh
  - 实现认证中间件（同时支持 JWT 和 API Token）
  - 实现限流中间件（基于 IP 和用户 ID）
  - 实现 CORS 中间件

- [x] 3. 后端数据同步 API
  - 实现 Conversation 和 Message GORM 模型
  - 实现 SyncLog GORM 模型
  - 实现单条同步接口 POST /api/v1/conversations/sync
  - 实现批量同步接口 POST /api/v1/conversations/batch（最多 50 条）
  - 实现数据去重逻辑（相同 conversation_id 比较时间戳）
  - 实现请求体大小限制（10MB）
  - 实现同步日志记录
  - 编写同步 API 集成测试

- [x] 4. 后端查询 API
  - 实现对话列表查询 GET /api/v1/conversations（分页、筛选、排序）
  - 实现对话详情查询 GET /api/v1/conversations/:id
  - 实现消息列表查询 GET /api/v1/conversations/:id/messages（分页）
  - 实现批量删除接口 DELETE /api/v1/conversations
  - 编写查询 API 集成测试

- [x] 5. 后端全文搜索
  - 定义搜索引擎接口（SearchEngine interface）
  - 实现 PostgreSQL 搜索引擎（pg_trgm + ILIKE）
  - 实现 SQLite 搜索引擎（FTS5 虚拟表 + 触发器）
  - 实现搜索接口 GET /api/v1/search（关键词、平台过滤、时间范围、排序）
  - 实现搜索结果高亮和上下文提取
  - 实现搜索限流（每分钟 30 次）
  - 编写搜索功能测试（中英文）

- [x] 6. 后端统计与导出
  - 实现统计概览接口 GET /api/v1/stats/overview
  - 实现时间趋势接口 GET /api/v1/stats/timeline（天/周/月）
  - 实现统计缓存（内存缓存，TTL 5 分钟）
  - 实现 ExportTask GORM 模型
  - 实现导出接口 POST /api/v1/export（JSON/Markdown 格式）
  - 实现异步导出（大于 1000 条时后台处理）
  - 实现导出状态查询 GET /api/v1/export/:taskId
  - 实现导出文件下载和过期清理（24 小时）

- [x] 7. 后端前端静态文件内嵌与部署
  - 使用 Go embed 包内嵌前端 dist 目录
  - 实现 SPA fallback 路由（非 API 路径返回 index.html）
  - 实现 CLI 命令（serve、migrate up/down）
  - 完善 Dockerfile（多阶段构建）
  - 编写跨平台构建脚本（Windows/macOS/Linux）
  - 测试本地模式（SQLite + 单二进制）
  - 测试远程模式（Docker Compose + PostgreSQL）

- [x] 8. 浏览器插件 - 网络请求拦截器
  - 创建 manifest.json（Manifest V3，声明 webRequest 权限和 URL patterns）
  - 实现 Service Worker 入口（background/index.ts）
  - 实现 Interceptor 核心类（注册/注销 webRequest 监听器）
  - 实现各平台 URL Pattern 匹配（ChatGPT、Gemini、通义千问、豆包）
  - 实现流式响应（SSE）拦截和数据块拼接
  - 实现独立缓冲区管理（per requestId）
  - 实现超时检测（30s 无新数据判定中断）
  - 实现数据大小限制（50MB 停止接收）
  - 实现多标签页独立拦截
  - 实现拦截开关（启用/禁用）

- [x] 9. 浏览器插件 - 平台适配器
  - 定义 PlatformAdapter 接口（base.ts）
  - 实现 ChatGPT 适配器（解析 conversation API 响应格式）
  - 实现 Gemini 适配器（解析 BardChatUi 响应格式）
  - 实现通义千问适配器（解析 dialog/conversation 响应格式）
  - 实现豆包适配器（解析 chat API 响应格式）
  - 实现角色映射（平台特定角色到 user/assistant/system/unknown）
  - 实现缺失字段填充（时间戳、对话 ID 自动生成）
  - 实现解析失败处理（保存原始数据不超过 1MB）
  - 编写各适配器单元测试（使用真实 API 响应样本）

- [x] 10. 浏览器插件 - 本地存储与数据收集
  - 初始化 Dexie.js 数据库（conversations、messages、syncQueue stores）
  - 实现 Collector 类（save、query、getPendingSync、updateSyncStatus）
  - 实现数据去重和合并逻辑（相同对话 ID 合并消息）
  - 实现写入失败重试（3 次，间隔 5s）
  - 实现存储空间监控（超过 80% 通知用户）
  - 实现已同步数据清理功能
  - 实现按平台和时间范围查询

- [x] 11. 浏览器插件 - 同步服务
  - 实现 SyncService 类（start、stop、syncNow）
  - 实现实时同步模式（解析完成后 30s 内推送）
  - 实现定时批量同步模式（可配置间隔，每批最多 50 条）
  - 实现指数退避重试策略（初始 1min，最大 30min，最多 5 次）
  - 实现认证失败检测（停止同步，通知用户）
  - 实现同步状态更新（pending 到 syncing 到 synced/failed）
  - 实现 Token 加密存储（Web Crypto API，AES-GCM）

- [x] 12. 浏览器插件 - UI（Popup 和 Options）
  - 实现 Popup 面板布局（状态指示、对话摘要列表、统计、开关）
  - 实现 Popup 状态展示（正常/暂停/错误，图标颜色切换）
  - 实现 Popup 最近 10 条对话摘要展示
  - 实现 Popup 各平台收集统计
  - 实现 Popup 暂停/恢复开关
  - 实现 Options 设置页（服务 URL、Token、平台开关、同步模式）
  - 实现 URL 格式验证（必须 https://）
  - 实现配置保存和即时生效
  - 实现工具栏图标状态更新

- [x] 13. 前端 - 基础框架与路由
  - 配置 React Router（对话列表、详情、搜索、统计、设置）
  - 实现全局布局组件（侧边栏导航 + 内容区）
  - 实现 API 客户端（fetch 封装，Token 自动注入，错误拦截）
  - 实现认证 Store（Zustand，登录/登出/Token 管理）
  - 实现登录页
  - 实现路由守卫（未登录跳转登录页）
  - 配置 TailwindCSS + Ant Design 主题

- [x] 14. 前端 - 对话列表与详情页
  - 实现对话列表页（卡片展示、平台图标、标题、时间、消息数）
  - 实现平台多选过滤器
  - 实现日期范围选择器
  - 实现无限滚动或分页加载
  - 实现空状态引导页
  - 实现对话详情页（聊天气泡布局）
  - 实现 Markdown 渲染（react-markdown + 代码高亮）
  - 实现单条消息复制功能
  - 实现导出为 Markdown 文件
  - 实现不完整消息标记

- [x] 15. 前端 - 搜索、统计与设置页
  - 实现全局搜索框（300ms 防抖）
  - 实现搜索结果列表（高亮匹配、上下文片段）
  - 实现搜索结果排序切换（相关度/时间）
  - 实现搜索附加过滤（平台、时间范围）
  - 实现点击搜索结果跳转到对话详情定位
  - 实现统计面板（概览卡片、平台分布饼图、趋势折线图）
  - 实现 ECharts 图表组件（支持天/周/月切换）
  - 实现用户设置页（修改密码、API Token 管理）
  - 实现数据管理（批量删除，带确认弹窗）
  - 实现主题切换（浅色/深色模式）

- [x] 16. 集成测试与端到端验证
  - 编写后端 API 完整集成测试（SQLite 模式）
  - 编写后端 API 完整集成测试（PostgreSQL 模式）
  - 测试插件拦截到解析到缓存到同步完整链路
  - 测试前端所有页面功能
  - 测试本地模式端到端（单二进制 + 插件 + 浏览器）
  - 测试远程模式端到端（Docker Compose + 插件 + 浏览器）
  - 编写 README.md（安装说明、配置说明、使用指南）

## Task Dependency Graph

```json
{
  "waves": [
    {
      "name": "Wave 1 - 项目初始化",
      "tasks": [1],
      "description": "创建项目结构、配置加载、数据库抽象"
    },
    {
      "name": "Wave 2 - 后端核心 + 插件拦截",
      "tasks": [2, 8],
      "description": "认证模块和插件网络拦截器可并行开发"
    },
    {
      "name": "Wave 3 - 后端 API + 插件适配器",
      "tasks": [3, 4, 9],
      "description": "同步/查询 API 和平台适配器并行开发"
    },
    {
      "name": "Wave 4 - 后端搜索/统计 + 插件存储/同步",
      "tasks": [5, 6, 10, 11],
      "description": "搜索、统计、本地存储和同步服务并行开发"
    },
    {
      "name": "Wave 5 - 前端框架 + 插件 UI",
      "tasks": [12, 13],
      "description": "插件 UI 和前端基础框架并行开发"
    },
    {
      "name": "Wave 6 - 前端页面",
      "tasks": [14, 15],
      "description": "对话列表/详情和搜索/统计/设置页面"
    },
    {
      "name": "Wave 7 - 部署与集成测试",
      "tasks": [7, 16],
      "description": "打包部署和端到端验证"
    }
  ]
}
```

```
Task 1 (项目初始化)
├── Task 2 (认证模块) ──┐
├── Task 8 (插件拦截器)  │
├── Task 13 (前端框架)   │
│                        ▼
│   Task 3 (同步 API) ← Task 2
│   Task 4 (查询 API) ← Task 2
│   Task 5 (全文搜索) ← Task 3
│   Task 6 (统计导出) ← Task 4
│
├── Task 9 (平台适配器) ← Task 8
├── Task 10 (本地存储) ← Task 9
├── Task 11 (同步服务) ← Task 10, Task 3
├── Task 12 (插件 UI) ← Task 10, Task 11
│
├── Task 14 (前端列表/详情) ← Task 13, Task 4
├── Task 15 (前端搜索/统计/设置) ← Task 13, Task 5, Task 6
│
├── Task 7 (部署打包) ← Task 6, Task 15
└── Task 16 (集成测试) ← All above
```

## Notes

- Task 1 是所有任务的前置依赖，必须最先完成
- 后端任务（2-7）和插件任务（8-12）可以并行开发
- 前端任务（13-15）依赖后端 API 就绪，但可以用 mock 数据先行开发
- Task 7（部署打包）需要前端构建产物，放在前端完成后
- Task 16（集成测试）是最终验证，依赖所有功能完成
- 建议开发顺序：Task 1 → (Task 2-6 并行 Task 8-12) → Task 13-15 → Task 7 → Task 16
