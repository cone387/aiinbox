# AI Chat Collector (AI Inbox)

统一收集 AI 平台对话记录的工具，支持 ChatGPT、Gemini、通义千问、豆包。

## 架构

- **浏览器插件** — 拦截 AI 平台网络请求，收集对话数据
- **后端服务 (Go)** — 接收、存储、搜索对话数据（端口 9531）
- **前端 Web 应用 (React)** — 浏览、搜索、管理对话记录（端口 9631）

## 快速开始

### 本地模式（推荐）

下载对应平台的二进制文件，直接运行：

```bash
# 首次运行，自动创建 SQLite 数据库和默认配置
./aiinbox

# 后端 API: http://localhost:9531
# 前端 Web: http://localhost:9631
```

### 从源码构建

```bash
# 前置要求: Go 1.22+, Node.js 20+

# 安装前端依赖并构建
cd frontend && npm install && npm run build && cd ..

# 安装插件依赖并构建
cd extension && npm install && npx vite build && cd ..

# 构建后端
cd backend && go build -o ../bin/aiinbox ./cmd/server && cd ..

# 运行后端
./bin/aiinbox --config config.yaml

# 运行前端开发服务器（另一个终端）
cd frontend && npx vite
```

### Docker 部署（PostgreSQL 模式）

```bash
cp .env.example .env
# 编辑 .env 设置密码和密钥
docker-compose up -d
```

## 配置

配置文件 `config.yaml`，支持环境变量覆盖（前缀 `AIINBOX_`）：

```yaml
server:
  host: "127.0.0.1"
  port: 9531

database:
  driver: "sqlite"          # sqlite | postgres
  dsn: "./data/aiinbox.db"  # SQLite 路径或 PostgreSQL 连接串

auth:
  jwt_secret: "your-secret-key"
```

完整配置参见 [config.yaml](config.yaml)。

## 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| 后端 API | 9531 | Go/Gin REST API |
| 前端 Dev | 9631 | Vite 开发服务器（自动代理 API 到 9531） |

## 使用流程

1. 启动后端服务：`./bin/aiinbox --config config.yaml`
2. 启动前端：`cd frontend && npx vite`
3. 打开 `http://localhost:9631` 注册账号并登录
4. 在设置页生成 API Token
5. Chrome 加载插件：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `extension/dist` 目录
6. 点击插件图标 → ⚙️ 设置 → 填入服务地址 `http://localhost:9531` 和 Token → 保存
7. 正常使用 AI 平台（ChatGPT/Gemini/千问/豆包），对话自动收集

## 支持的平台

| 平台 | 状态 |
|------|------|
| ChatGPT (chat.openai.com / chatgpt.com) | ✅ |
| Gemini (gemini.google.com) | ✅ |
| 通义千问 (tongyi.aliyun.com) | ✅ |
| 豆包 (doubao.com) | ✅ |

## 技术栈

- 后端: Go + Gin + GORM + SQLite(pure-Go)/PostgreSQL
- 前端: React + TypeScript + Ant Design + ECharts + TailwindCSS
- 插件: TypeScript + Manifest V3 + Dexie.js + CRXJS
- 部署: 单二进制（Go embed）/ Docker Compose

## 开发

```bash
# 后端开发（端口 9531）
make backend-run

# 前端开发（端口 9631）
make frontend-dev

# 插件开发
make extension-dev

# 插件构建
cd extension && npx vite build
```

## License

MIT
