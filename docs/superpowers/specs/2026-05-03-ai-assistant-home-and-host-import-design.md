# Design Spec: AI 助手主页可用 + 导入主机列表对话流 + 粘贴 JSON 导入

**Date:** 2026-05-03  
**Status:** Approved

---

## Overview

本次变更涉及三个独立但相互关联的功能：

1. **主页 AI 助手可用性**：将 AI 助手面板从仅在终端页可用，扩展到主页（主机列表页）也可使用。
2. **AI 助手"导入主机列表"对话流**：在 AI 助手快捷入口中新增「导入主机列表」，通过 AI 对话引导用户生成主机 JSON，并支持一键导入。
3. **主机列表粘贴 JSON 导入**：在主机列表底部工具栏新增「JSON」按钮，支持粘贴 JSON 文本后直接导入主机。

---

## 1. 主页 AI 助手可用性

### 现状

`App.tsx` 在 `page === 'connect'` 时提前返回，只渲染 `<ConnectForm>`，`AIChatPanel`、AI 按钮、最小化悬浮球均不挂载。

### 变更

- 将 `aiPanelState` 状态、AI 按钮、`AIChatPanel` 组件挂载点、最小化悬浮球，从 terminal-only 区域移到 `App.tsx` 顶层（在 `page === 'connect'` 的早返回路径之后，统一渲染）。
- **显示条件**：只有在 AI 已配置（`aiSettings` 中 `apiKey` 非空且 `enableAIAssistant !== false`）时，才渲染 AI 按钮。否则按钮隐藏。
- **按钮位置**：在 `ConnectForm` 右上角工具栏（已有主题切换按钮）末尾追加 `Bot` 图标按钮，样式与终端页 AI 按钮完全一致。
- **状态共享**：两个页面共用同一 `AIChatPanel` 实例和 `aiPanelState`，对话历史在页面切换时保留。

### App.tsx 结构调整

去掉 `page === 'connect'` 的早返回，改为统一在顶层渲染 `AIChatPanel` 和最小化悬浮球，**全程只挂载一个实例**：

```
// 伪代码
function App() {
  const [aiPanelState, setAIPanelState] = useState('hidden');
  const aiConfigured = !!(aiSettings?.apiKey && aiSettings?.enableAIAssistant !== false);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* 页面内容区 */}
      {page === 'connect' ? (
        <ConnectForm
          ...
          aiConfigured={aiConfigured}
          onOpenAI={() => setAIPanelState('visible')}
          onHostsChanged={refreshHosts}   // 供 AI 面板导入后刷新列表
        />
      ) : (
        <TerminalLayout
          ...
          aiPanelState={aiPanelState}
          onToggleAI={() => setAIPanelState(s => s === 'visible' ? 'hidden' : 'visible')}
        />
      )}

      {/* AI 面板：始终挂载，display:none 控制可见性，两页共用同一实例 */}
      {aiConfigured && (
        <div
          className="absolute top-0 right-0 bottom-0 z-50 flex"
          style={{ display: aiPanelState === 'visible' ? undefined : 'none' }}
        >
          <AIChatPanel
            onClose={() => setAIPanelState('hidden')}
            onMinimize={() => setAIPanelState('minimized')}
            onHostsImported={refreshHosts}
          />
        </div>
      )}

      {/* 最小化悬浮球 */}
      {aiConfigured && aiPanelState === 'minimized' && (
        <div className="absolute bottom-16 right-4 z-50">
          <button onClick={() => setAIPanelState('visible')}>...</button>
        </div>
      )}
    </div>
  );
}
```

> `refreshHosts` 是 App.tsx 里触发 ConnectForm 重新加载主机列表的回调，通过 prop 传入。ConnectForm 将 `loadHosts()` 函数暴露给父组件（或通过 `onHostsChanged` 触发内部 state 更新）。

### ConnectForm 接收的新 Props

```typescript
interface ConnectFormProps {
  // ... 现有 props ...
  aiConfigured?: boolean;         // 是否显示 AI 按钮
  onOpenAI?: () => void;          // 点击 AI 按钮的回调
  onHostsChanged?: () => void;    // AI 面板导入成功后触发刷新
}
```

### AIChatPanel 接收的新 Props

```typescript
interface AIChatPanelProps {
  // ... 现有 props ...
  onHostsImported?: () => void;  // 导入成功后通知父组件刷新主机列表
}
```

导入成功后，`AIChatPanel` 调用 `onHostsImported?.()` → App.tsx 的 `refreshHosts()` → ConnectForm 的 `onHostsChanged?.()` → 内部 `loadHosts()` 重新拉取主机列表。

---

## 2. AI 助手「导入主机列表」对话流

### 快捷入口

在 `AIChatPanel.tsx` 的 `QUICK_QUESTIONS` 数组中，**在首位**新增 `「导入主机列表」`：

```typescript
const QUICK_QUESTIONS = [
  '导入主机列表',        // 新增，首位
  '如何查看磁盘使用情况？',
  '如何安装 Docker？',
  '如何配置 Nginx 反向代理？',
  '如何排查内存占用高的问题？',
];
```

### 对话流（三阶段）

```
用户点击「导入主机列表」
  → 发送触发消息给 AI（见下方 prompt）
  → AI 回复：询问主机信息
  → 用户输入主机详情（自由文本，可多台）
  → AI 回复：生成 JSON 数组 + 询问是否一键导入
  → 客户端检测 JSON → 渲染复制按钮 + 一键导入按钮
  → 用户选择：
      a) 点击「一键导入」按钮
      b) 回复确认语（「是」「好的」「确认」等）→ 客户端拦截，调用导入 API
      c) 复制 JSON，到主机列表手动粘贴导入
```

### 触发消息（发送给 AI 的 prompt）

```
请帮我把主机导入到主机列表。
步骤一：请询问我主机信息（支持多台）。
步骤二：根据我的回复，生成一个 JSON 数组，每条记录包含以下字段：
  name（显示名称）、host（主机地址）、port（端口，默认22）、username（用户名）、password（密码，可选）、privateKey（私钥，可选）、group（分组，可选）。
  请将 JSON 放在 ```json 代码块中。
步骤三：询问我是否要一键导入到主机列表。
```

### 新增状态

```typescript
// AIChatPanel.tsx
const [pendingImportHosts, setPendingImportHosts] = useState<object[] | null>(null);
```

### JSON 检测逻辑

每次 AI 回复结束（`streaming` 变为 `false`）后，扫描最新 assistant 消息内容：

```typescript
function extractJsonArray(content: string): object[] | null {
  // 优先匹配 ```json ... ``` 代码块
  const codeBlock = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1]); } catch {}
  }
  // 回退：匹配裸 JSON 数组
  const bare = content.match(/(\[[\s\S]*?\])/);
  if (bare) {
    try { return JSON.parse(bare[1]); } catch {}
  }
  return null;
}
```

若检测到合法数组，设置 `pendingImportHosts`，并在该 assistant 消息气泡底部渲染两个操作按钮：

```
[ 复制 JSON ]  [ 一键导入到主机列表 ]
```

### 确认语拦截

在 `sendMessage` 开头（发送到 AI API 之前）添加拦截：

```typescript
const CONFIRM_PATTERN = /^(是|好|确认|yes|一键|import|导入)/i;

if (pendingImportHosts && CONFIRM_PATTERN.test(msgText.trim())) {
  // 不发给 AI，直接导入
  await importHosts(pendingImportHosts);
  return;
}
```

### 导入结果反馈

调用 `/api/hosts/import` 后，在对话中添加一条本地 assistant 消息（非 AI 生成）：

- 成功：`「已成功导入 N 台主机，跳过重复 M 台。」`
- 失败：`「导入失败：{错误信息}」`

导入成功后清空 `pendingImportHosts`。

---

## 3. 主机列表新增「粘贴 JSON 导入」

### 位置

`ConnectForm.tsx` 底部工具栏。现有按钮：

```
[ 模板 ]  [ 导入 ]
```

新增后：

```
[ 模板 ]  [ 导入 ]  [ JSON ]
```

### 交互流程

1. 点击「JSON」按钮 → 主机列表区域底部展开内联文本域（不弹模态框）
2. 文本域高度约 6 行，placeholder：`粘贴主机 JSON（数组格式，支持多台）`
3. 文本域下方两个按钮：`[ 导入到主机列表 ]` `[ 取消 ]`
4. 点击「导入到主机列表」：
   - 解析文本域内容为 JSON
   - 调用 `POST /api/hosts/import`
   - 成功：显示「已导入 N 台，跳过重复 M 台」toast/inline 提示，收起文本域
   - 失败：显示错误信息，文本域保留内容
5. 点击「取消」：收起文本域，不导入

### 新增状态

```typescript
// ConnectForm.tsx
const [showJsonPaste, setShowJsonPaste] = useState(false);
const [jsonPasteText, setJsonPasteText] = useState('');
const [jsonPasteError, setJsonPasteError] = useState<string | null>(null);
```

---

## 4. 数据格式

### 主机导入 JSON 格式（发给 `/api/hosts/import`）

```json
[
  {
    "name": "示例服务器",
    "host": "192.168.1.1",
    "port": 22,
    "username": "root",
    "password": "yourpassword",
    "group": "Production"
  },
  {
    "name": "开发机",
    "host": "10.0.0.2",
    "port": 22,
    "username": "ubuntu",
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
    "group": "Development"
  }
]
```

`id` 和 `createdAt` 由服务端生成，客户端不需要提供。

---

## 5. 影响范围

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/App.tsx` | 修改 | 去掉 connect 早返回，顶层挂载唯一 AIChatPanel 实例；添加 `refreshHosts` 回调 |
| `src/components/ConnectForm.tsx` | 修改 | 接收 `aiConfigured`/`onOpenAI`/`onHostsChanged` props；添加 AI 按钮；添加 JSON 粘贴导入功能 |
| `src/components/AIChatPanel.tsx` | 修改 | 接收 `onHostsImported` prop；添加「导入主机列表」快捷项；添加 JSON 检测、操作按钮、确认拦截、导入反馈 |

无需新增文件，无需修改后端。

---

## 6. 边界情况

- **AI 未配置**：不显示 AI 按钮，AI 面板不渲染，不影响主机列表功能。
- **粘贴 JSON 格式错误**：解析失败时显示 `JSON 格式无效，请检查后重试`，不调用 API。
- **AI 响应未包含 JSON 数组**：不设置 `pendingImportHosts`，不渲染操作按钮，正常显示 AI 回复。
- **多次导入**：每次成功导入后重置 `pendingImportHosts`，避免重复导入。
- **服务器去重**：`/api/hosts/import` 现有去重逻辑不变，响应中返回导入数量和跳过数量。
