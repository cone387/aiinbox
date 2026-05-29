# AI Chat Collector (AI Inbox)

统一收集 AI 平台对话记录的工具，支持 ChatGPT、Gemini、通义千问、豆包。

## 架构

- **浏览器插件** — 拦截 AI 平台网络请求，收集对话数据
- **后端服务 (Go)** — 接收、存储、搜索对话数据
- **前端 Web 应用 (React)** — 浏览、搜索、管理对话记录

## 快速开始

### 本地模式（推荐）

下载对应平台的二进制文件，直接运行：

```bash
# 首次运行，自动创建 SQLite 数据库和默认配置
./aiinbox

# 访问 http://localhost:8080
```

### 从源码构建

```bash
# 前置要求: Go 1.22+, Node.js 20+

# 构建前端
cd frontend && npm install && npm run build && cd ..

# 构建后端（内嵌前端）
cd backend && CGO_ENABLED=1 go build -o ../bin/aiinbox ./cmd/server && cd ..

# 运行
./bin/aiinbox --config config.yaml
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
  port: 8080

database:
  driver: "sqlite"          # sqlite | postgres
  dsn: "./data/aiinbox.db"  # SQLite 路径或 PostgreSQL 连接串

auth:
  jwt_secret: "your-secret-key"
```

完整配置参见 [config.yaml](config.yaml)。

## 使用流程

1. 启动后端服务
2. 访问 Web 界面注册账号
3. 在设置页生成 API Token
4. 安装浏览器插件，在插件设置中填入服务地址和 Token
5. 正常使用 AI 平台，对话自动收集

## 支持的平台

| 平台 | 状态 |
|------|------|
| ChatGPT (chat.openai.com / chatgpt.com) | ✅ |
| Gemini (gemini.google.com) | ✅ |
| 通义千问 (tongyi.aliyun.com) | ✅ |
| 豆包 (doubao.com) | ✅ |

## 技术栈

- 后端: Go + Gin + GORM + SQLite/PostgreSQL
- 前端: React + TypeScript + Ant Design + ECharts
- 插件: TypeScript + Manifest V3 + Dexie.js
- 部署: 单二进制 / Docker Compose

## 开发

```bash
# 后端开发
make backend-run

# 前端开发
make frontend-dev

# 插件开发
make extension-dev
```

## License

MIT
