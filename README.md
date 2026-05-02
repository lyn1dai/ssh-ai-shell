# SSH AI Shell

SSH AI Shell 是一个面向运维、开发和 SRE 场景的可视化 SSH 工作台，把 `SSH 终端`、`AI 辅助`、`SFTP 文件管理`、`多主机管理` 集成到同一个界面中，既适合部署为 Web 服务，也适合封装为 Windows / macOS 桌面客户端。

## 项目简介

传统 SSH 工具往往只解决“连上服务器”这一件事，但在真实工作中，远程登录之后还会继续发生很多操作：查看状态、解释命令、管理文件、切换多台主机、沉淀常用命令，以及在不同环境间迁移配置。

SSH AI Shell 试图把这些高频动作放进一个统一工作台里。它提供终端、多主机列表、文件管理、AI 助手、命令审批与配置管理，让运维、开发和 SRE 在处理日常远程任务时减少工具切换和上下文丢失。

## 核心能力

- 多主机与分组管理：保存主机、端口、账号和分组，支持快速连接与集中维护。
- 多标签与分屏终端：支持多会话并行、标签切换、面板拆分和对比查看。
- AI 辅助运维：支持自然语言问答、命令生成、命令解释，以及 AI 对话辅助操作。
- 模型与提供商接入：支持自定义 OpenAI 兼容接口，也支持 GitHub Copilot 登录与模型选择。
- 风险命令控制：支持命令白名单、自动审批策略、高危命令规则和二次确认。
- SFTP 文件管理：支持目录浏览、上传、下载、重命名、删除和创建目录。
- 命令资产沉淀：支持保存常用命令、快捷执行、历史回看和复用。
- MCP / Skills 扩展：支持配置 MCP 服务与技能增强能力。
- 配置导入导出：支持导出加密配置，并在新环境中导入恢复。

## AI 配置与模型支持

### 支持的 AI 供应商

- GitHub Copilot：支持设备码 OAuth 登录，自动读取账号可用模型。
- OpenAI：内置 `gpt-4o`、`gpt-4o-mini`、`gpt-4-turbo`、`gpt-4`、`gpt-3.5-turbo`、`o1`、`o3-mini` 等常见模型预设。
- Anthropic (Claude)：内置 `claude-3-5-sonnet`、`claude-3-5-haiku`、`claude-3-opus`、`claude-3-sonnet`、`claude-3-haiku` 等模型预设。
- DeepSeek：内置 `deepseek-chat`、`deepseek-coder`、`deepseek-reasoner`。
- 通义千问 (Qwen)：内置 `qwen-max`、`qwen-plus`、`qwen-turbo`、`qwen-long`、`qwen2.5` 系列模型预设。
- Moonshot (Kimi)：内置 `moonshot-v1-8k`、`moonshot-v1-32k`、`moonshot-v1-128k`、`kimi-latest`。
- 智谱 AI (GLM)：内置 `glm-4-plus`、`glm-4`、`glm-4-air`、`glm-4-flash`、`glm-3-turbo`。
- 文心一言 (ERNIE)：内置 `ernie-4.0`、`ernie-3.5`、`ernie-speed`、`ernie-lite` 系列预设。
- OpenRouter：支持接入聚合路由模型，例如 `openai/gpt-4o`、`anthropic/claude-3.5-sonnet`、`deepseek/deepseek-chat`。
- Ollama (本地)：支持本地模型预设，例如 `llama3.2`、`qwen2.5`、`deepseek-r1`、`mistral`、`codellama`、`gemma2`。
- 自定义 / 其他：支持手动填写 `OpenAI 兼容` 的 `Base URL`、`API Key` 和模型名。

### 可配置项

- `API Base URL`、`API Key` 和当前供应商配置。
- 连接测试：保存前必须先测试连接，确认接口和模型可正常响应。
- 模型列表获取：可直接从 API 拉取模型列表，也可手动补充自定义模型。
- 模型启用范围：可单独勾选哪些模型参与 AI 对话。
- 终端模型：可单独指定一个模型作为终端/命令行场景默认模型。
- 多供应商配置保存：支持为不同供应商分别保存配置并在界面中切换。
- Copilot 专用配置：支持登录状态检测、模型刷新、单模型测试和终端模型选择。
- AI 行为开关：支持启用/关闭 AI 命令解释、AI 助手、命令补全。
- Agent 执行模式：支持 `每条命令询问`、`白名单自动执行`、`全部自动执行`。

### 模型支持方式

- 对于大多数 API Key 供应商，系统会优先请求 `/models` 接口获取真实可用模型列表。
- 如果服务端未返回模型列表，可以直接手动录入模型名并保存。
- GitHub Copilot 会优先读取当前账号实际可用模型；如果接口暂时不可用，会回退到内置候选模型列表。
- AI 对话模型与终端默认模型可以分开设置，便于在不同场景下选择不同模型。

## 适用场景

- 日常 SSH 登录与服务器巡检
- 多台主机并行运维与会话切换
- 自然语言生成命令、解释命令和辅助排障
- 对高风险命令进行审慎确认与执行控制
- 通过 SFTP 进行远程文件上传、下载和维护
- 在 Web、Docker 或桌面客户端形态下交付给团队使用

## 演示视频

- 演示视频：待补充

## 快速开始

本地开发启动：

```bash
npm install
npm run dev
```

默认访问地址：`http://localhost:5173`

`npm run dev` 会同时启动：

- `vite` 前端开发服务
- `nodemon server/index.js` 后端服务

## 生产启动

```bash
npm run build
npm start
```

默认访问地址：`http://localhost:3000`

## Docker 部署

### 直接构建并运行

```bash
docker build -t ssh-ai-shell:latest .
docker run -d --name ssh-ai-shell -p 3000:3000 -v ./docker-data:/app/data ssh-ai-shell:latest
```

### 使用 Docker Compose

```bash
docker compose up -d --build
```

启动后访问：`http://localhost:3000`

说明：

- 容器内服务端口为 `3000`
- 容器数据目录为 `/app/data`
- 本地挂载目录为 `./docker-data`
- 镜像默认不会打包本地 `data/`，避免把已有配置或密钥带入镜像
- 可通过环境变量 `CONFIG_EXPORT_SECRET` 控制配置导入导出的加密密钥

## Docker 多架构构建

当前仓库中的 `Dockerfile` 可直接用于 `amd64` 和 `arm64` 架构。

分别构建：

```bash
docker buildx build --platform linux/amd64 -t ssh-ai-shell:amd64 .
docker buildx build --platform linux/arm64 -t ssh-ai-shell:arm64 .
```

一次构建并推送多架构镜像：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-registry/ssh-ai-shell:1.0.0 \
  --push .
```

## 数据与配置说明

- 默认开发数据目录为仓库下的 `data/`
- 服务端支持通过 `DATA_DIR` 环境变量指定数据目录
- 配置导出支持加密封装，适合迁移主机、AI 设置、命令规则、MCP 配置和技能配置
- Docker 部署时建议始终挂载独立数据目录，避免容器重建后配置丢失

## 项目结构

- `src/`：前端 React 页面、终端视图和设置界面
- `server/`：Express、WebSocket、SSH、SFTP 与 AI 相关服务端逻辑
- `electron/`：桌面端入口与壳层逻辑
- `data/`：本地开发阶段的数据目录
- `docker-compose.yml`：Docker Compose 启动配置
- `Dockerfile`：生产镜像构建文件
