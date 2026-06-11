# AI Inbox

统一收集 AI 平台对话记录的工具，支持 ChatGPT、Gemini、通义千问、豆包、DeepSeek。

## 架构

- **桌面应用** — 系统托盘常驻，一键打开浏览器管理对话（单二进制，内嵌前端）
- **浏览器插件** — 拦截 AI 平台网络请求，自动收集对话数据
- **后端服务 (Go)** — 接收、存储、搜索对话数据
- **前端 Web 应用 (React)** — 浏览、搜索、管理对话记录

所有功能集成在单个端口 **9531** 上运行，无需额外配置。

## 快速开始

### 桌面应用（推荐）

从 [Releases](https://github.com/cone387/aiinbox/releases/latest) 下载对应平台的桌面应用：

- **Windows**: `aiinbox-desktop-*-windows-amd64.exe` — 双击运行，系统托盘常驻
- **macOS**: `aiinbox-desktop-*-darwin-*.zip` — 解压后运行

首次启动会自动打开浏览器，引导你创建管理员账户。

**桌面应用功能**：
- 左键托盘图标 → 打开浏览器
- 右键托盘图标 → 菜单（打开浏览器 / 重置密码 / 打开数据目录 / 检查更新 / 退出）
- 端口冲突时弹出友好提示
- 自动检测 GitHub 新版本

### 服务器模式（Docker 部署）

```bash
cp .env.example .env
# 编辑 .env 设置密码和密钥
docker-compose up -d
```

### 从源码构建

```bash
# 前置要求: Go 1.24+, Node.js 20+

# 1. 构建前端
cd frontend && npm install && npm run build && cd ..

# 2. 将前端嵌入后端
# Windows (PowerShell):
Remove-Item -Recurse -Force backend/internal/webui/dist
Copy-Item -Recurse -Force frontend/dist backend/internal/webui/dist
# Linux/macOS:
rm -rf backend/internal/webui/dist && cp -r frontend/dist backend/internal/webui/dist

# 3. 构建桌面应用
# Windows:
cd backend && go build -ldflags="-H=windowsgui" -o ../aiinbox-desktop.exe ./cmd/desktop && cd ..
# macOS:
cd backend && go build -o ../aiinbox-desktop ./cmd/desktop && cd ..

# 4. 构建浏览器插件
cd extension && npm install && npm run build && cd ..

# 5. 构建纯服务器（无托盘）
cd backend && go build -o ../bin/aiinbox ./cmd/server && cd ..
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

## 使用流程

### 安装插件

- **从 Releases 下载**：在 [Releases](https://github.com/cone387/aiinbox/releases/latest) 下载 `extension.zip` 并解压。
- **Chrome 加载**：打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择解压后的目录（或源码构建产物 `extension/dist`）。

### 连接服务端

插件默认指向本地服务：

1. 启动桌面应用后，插件会自动探测 `http://localhost:9531`，检测到本地服务时在弹窗内提示，点击「连接」即可。
2. 也可点击插件图标，按提示完成账号授权（授权页打开服务端的 `/authorize` 页面，登录后一键授权，自动回填凭据）。
3. 正常使用 AI 平台（ChatGPT / Gemini / 千问 / 豆包 / DeepSeek），对话自动收集；离线时本地缓存，恢复连接后回传。

### 浏览与搜索

左键托盘图标或打开 `http://localhost:9531`，注册/登录后浏览、搜索、导出对话记录。首次无数据时页面会引导你安装插件。

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
- 桌面: Go + systray（本地 fork，支持左键事件）
- 部署: 单二进制（Go embed）/ Docker Compose

## 开发

```bash
# 后端开发（端口 9531）
make backend-run

# 前端开发（端口 9631，自动代理到后端）
make frontend-dev

# 插件开发
make extension-dev

# 桌面应用构建
make desktop-build

# 插件构建
cd extension && npx vite build
```

## License

MIT
