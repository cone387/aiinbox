# AI Inbox

统一收集 AI 平台对话记录的工具，支持 ChatGPT、Gemini、通义千问、豆包、DeepSeek。

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
# 前置要求: Go 1.25+, Node.js 20+

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
  # 留空则首次运行自动生成强随机密钥，持久化到数据目录的 jwt_secret 文件。
  # 多实例部署时可显式设置同一密钥。
  jwt_secret: ""
```

完整配置参见 [config.yaml](config.yaml)。

## 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| 后端 API | 9531 | Go/Gin REST API |
| 前端 Dev | 9631 | Vite 开发服务器（自动代理 API 到 9531） |

## 使用流程

### 安装插件

- **从 Releases 下载**：在 [Releases](https://github.com/cone387/aiinbox/releases/latest) 下载 `extension.zip` 并解压。
- **Chrome 加载**：打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择解压后的目录（或源码构建产物 `extension/dist`）。

### 连接服务端

插件默认指向官方服务，无需手动填 Token：

1. 点击插件图标，按提示完成账号授权（授权页打开服务端的 `/authorize` 页面，登录后一键授权，自动回填凭据）。
2. **自助部署本地服务**：启动后端（`./aiinbox` 或 `./bin/aiinbox --config config.yaml`）后，插件会自动探测 `http://localhost:9531`，检测到本地服务时会在弹窗内提示，点击「连接」即可切换到本地服务并完成授权。
3. 正常使用 AI 平台（ChatGPT / Gemini / 千问 / 豆包 / DeepSeek），对话自动收集；离线时本地缓存，恢复连接后回传。

### 浏览与搜索

打开 `http://localhost:9631`（本地）或官方 Web 地址，注册/登录后浏览、搜索、导出对话记录。首次无数据时页面会引导你安装插件。

## 支持的平台

| 平台 | 状态 |
|------|------|
| ChatGPT (chat.openai.com / chatgpt.com) | ✅ |
| Gemini (gemini.google.com) | ✅ |
| 通义千问 (tongyi.aliyun.com) | ✅ |
| 豆包 (doubao.com) | ✅ |
| DeepSeek (chat.deepseek.com) | ✅ |

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
