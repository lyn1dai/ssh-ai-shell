# SSH AI Shell

SSH AI Shell 是一个面向运维、开发和 SRE 场景的可视化 SSH 工作台。它把 `SSH 终端`、`AI 辅助命令执行`、`SFTP 文件管理`、`多主机管理` 和 `风险审批` 集成到一个界面里，适合部署为 Web 服务，也适合封装为 Windows / macOS 客户端。

## 产品介绍

- 产品定位：AI 驱动的 SSH 管理与运维工作台
- 适用场景：远程服务器登录、批量主机管理、命令解释、风险命令确认、文件上传下载、模型接入与 Copilot 接入
- 部署形态：浏览器访问、Docker 部署、Windows 客户端、macOS 客户端

## 演示信息

- 演示视频：待补充
- 在线 Demo：待补充

## 功能介绍

- 多主机管理：保存主机、端口、账号、分组，支持快速连接
- 多标签与分屏终端：支持标签页、面板拆分、并行查看多个会话
- AI 辅助：支持自定义 OpenAI 兼容接口，也支持 GitHub Copilot 登录
- 命令安全控制：低风险自动放行，高风险命令强制确认
- SFTP 文件管理：支持目录浏览、上传、下载、重命名、删除、创建目录
- 命令资产沉淀：保存常用命令、命令历史回放、快捷执行
- MCP / Skills 扩展：支持配置 MCP 服务与技能增强
- 设置导入导出：支持导出加密配置并在新环境中导入

## 本地启动

```bash
npm install
npm run dev
```

默认访问地址：`http://localhost:5173`

生产模式：

```bash
npm run build
npm start
```

默认访问地址：`http://localhost:3000`

## Docker 启动

### 1. 本地直接构建并运行

```bash
docker build -t ssh-ai-shell:latest .
docker run -d --name ssh-ai-shell -p 3000:3000 -v ./docker-data:/app/data ssh-ai-shell:latest
```

### 2. 使用 Docker Compose

```bash
docker compose up -d --build
```

启动后访问：`http://localhost:3000`

说明：

- 容器数据目录为 `/app/data`
- 本地挂载目录为 `./docker-data`
- 镜像默认不会打包本地 `data/`，避免把已有配置或密钥带入镜像

## Docker 多架构输出

当前仓库中的 `Dockerfile` 可直接用于 `amd64` 和 `arm64`。

分别构建：

```bash
docker buildx build --platform linux/amd64 -t ssh-ai-shell:amd64 .
docker buildx build --platform linux/arm64 -t ssh-ai-shell:arm64 .
```

一次输出多架构镜像并推送：

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-registry/ssh-ai-shell:1.0.0 \
  --push .
```

## 桌面客户端输出

项目已补充 Electron 桌面壳，可输出 Windows 客户端，并支持在 macOS 环境下输出 macOS 客户端。

### Windows 客户端

```bash
npm install
npm run build:win
```

输出目录：`release/`

典型产物形态：

- NSIS 安装包：`*.exe`
- Portable 免安装包：`*.exe`

### macOS 客户端

```bash
npm install
npm run build:mac
```

输出目录：`release/`

典型产物形态：

- macOS 安装镜像：`*.dmg`
- macOS 压缩包：`*.zip`

说明：

- `macOS` 客户端建议在 `macOS` 主机或 `macOS CI Runner` 上构建
- 若需要同时输出 Intel 和 Apple Silicon，可分别执行：

```bash
npm run build:mac -- --x64
npm run build:mac -- --arm64
```

## 桌面端本地预览

```bash
npm install
npm run start:desktop
```

桌面端会在本地自动启动内置服务，并把用户数据写入系统用户目录下的应用数据目录。

## 目录说明

- `src/`：前端 React 页面与组件
- `server/`：Express + WebSocket + SSH/SFTP 服务端
- `electron/`：桌面端入口
- `data/`：本地开发数据目录
- `docker-compose.yml`：容器启动配置
- `Dockerfile`：生产镜像构建文件

## 交付目标对照

- Docker `amd64`：已支持
- Docker `arm64`：已支持
- Windows 客户端：已补充构建脚本与打包配置
- macOS 客户端：已补充构建脚本与打包配置
