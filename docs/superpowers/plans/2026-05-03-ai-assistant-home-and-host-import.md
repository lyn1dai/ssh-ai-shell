# AI 助手主页可用 + 导入主机列表对话流 + 粘贴 JSON 导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主页启用 AI 助手面板、在 AI 助手中添加「导入主机列表」AI 对话流（生成 JSON + 一键导入）、以及在主机列表底部工具栏新增粘贴 JSON 导入功能。

**Architecture:** 四个独立任务顺序执行。Task 1 改造 AIChatPanel 添加 AI 对话导入流（新增 Props、状态、JSON 检测逻辑、确认拦截）。Task 2 改造 App.tsx 让 connect 页也能挂载 AI 面板（通过包装 wrapper div）。Task 3 改造 ConnectForm 添加 AI 按钮到顶栏。Task 4 改造 ConnectForm 添加 JSON 粘贴导入到底部工具栏。

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + Lucide React；fetch API（已有 `/api/ai/chat`、`/api/hosts/import`、`/api/ai-settings`）。

---

## Task 1: AIChatPanel — 添加「导入主机列表」AI 对话流

**Files:**
- Modify: `src/components/AIChatPanel.tsx`

---

- [ ] **Step 1: 在 Props interface 中添加 `onHostsImported` 回调**

找到 `src/components/AIChatPanel.tsx` 第 21-27 行，修改：

```tsx
interface Props {
  onClose: () => void;
  /** Minimize to floating bubble — keeps all state alive */
  onMinimize?: () => void;
  /** When false the panel is CSS-hidden but stays mounted, preserving all state */
  visible?: boolean;
  /** Called after successfully importing hosts via the AI import flow */
  onHostsImported?: () => void;
}
```

- [ ] **Step 2: 添加 `HOST_IMPORT_PROMPT` 常量，并在 `QUICK_QUESTIONS` 首位加入「导入主机列表」**

找到第 39-46 行（`QUICK_QUESTIONS`），在其上方插入常量，并修改数组：

```tsx
// ─── Host-import trigger prompt (sent to AI when user clicks 「导入主机列表」) ──

const HOST_IMPORT_PROMPT = `请帮我把主机导入到主机列表。
步骤一：请询问我主机信息（支持多台主机）。
步骤二：根据我的回复，生成一个 JSON 数组，每条记录包含以下字段：name（显示名称）、host（主机地址）、port（端口，默认22）、username（用户名）、password（密码，可选）、privateKey（私钥，可选）、group（分组，可选）。请将 JSON 放在 \`\`\`json 代码块中。
步骤三：询问我是否要一键导入到主机列表。`;

// ─── Quick questions shown on the welcome screen ───────────────────────────

const QUICK_QUESTIONS = [
  '导入主机列表',
  '如何查看磁盘使用情况？',
  '如何安装 Docker？',
  '如何配置 Nginx 反向代理？',
  '如何排查内存占用高的问题？',
];
```

- [ ] **Step 3: 在组件内添加 `pendingImportHosts` 状态，并更新组件签名解构新 prop**

找到第 200 行：
```tsx
export default function AIChatPanel({ onClose, onMinimize, visible = true }: Props) {
```
改为：
```tsx
export default function AIChatPanel({ onClose, onMinimize, visible = true, onHostsImported }: Props) {
```

找到第 208 行（`const [showModelPicker, ...`）后面，插入新状态：
```tsx
  const [pendingImportHosts, setPendingImportHosts] = useState<{ hosts: object[]; json: string } | null>(null);
  const prevStreamingRef = useRef(false);
```

- [ ] **Step 4: 添加 `extractHostsJson` 辅助函数**

在 `clearConversation` 函数（约第 373-376 行）之后，插入：

```tsx
  /** Scan AI response content for a JSON array of host objects. */
  function extractHostsJson(content: string): { hosts: object[]; json: string } | null {
    const codeBlockMatch = content.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1]);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && 'host' in parsed[0]) {
          return { hosts: parsed, json: JSON.stringify(parsed, null, 2) };
        }
      } catch { /* not valid JSON */ }
    }
    return null;
  }
```

- [ ] **Step 5: 添加 `doImportHosts` 函数（调用导入 API 并在对话中反馈结果）**

在 `extractHostsJson` 之后，插入：

```tsx
  /** Import hosts via API and append the result as a local assistant message. */
  async function doImportHosts(payload: { hosts: object[]; json: string }, displayText: string) {
    if (streaming) return;
    const userMsg: ChatMessage = { role: 'user', content: displayText };
    setConversations(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      return { ...c, messages: [...c.messages, userMsg, { role: 'assistant' as const, content: '' }] };
    }));
    setStreaming(true);
    try {
      const res = await fetch('/api/hosts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload.hosts),
      });
      const result = await res.json();
      const successMsg = `已成功导入 ${result.added} 台主机，跳过重复 ${result.skipped} 台。`;
      setConversations(prev => prev.map(c => {
        if (c.id !== activeId) return c;
        const msgs = [...c.messages];
        msgs[msgs.length - 1] = { role: 'assistant' as const, content: successMsg };
        return { ...c, messages: msgs };
      }));
      setPendingImportHosts(null);
      onHostsImported?.();
    } catch {
      const errMsg = '导入失败，请稍后重试。';
      setConversations(prev => prev.map(c => {
        if (c.id !== activeId) return c;
        const msgs = [...c.messages];
        msgs[msgs.length - 1] = { role: 'assistant' as const, content: errMsg };
        return { ...c, messages: msgs };
      }));
    } finally {
      setStreaming(false);
    }
  }
```

- [ ] **Step 6: 添加两个 `useEffect`——streaming 结束后检测 JSON；切换对话时清空 pendingImportHosts**

在现有的 `useEffect(() => { scrollToBottom(); }, [...])` 行（约第 284 行）之后，插入：

```tsx
  // Clear pending import state when switching conversations
  useEffect(() => {
    setPendingImportHosts(null);
  }, [activeId]);

  // After streaming ends, scan last assistant message for importable hosts JSON
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (!wasStreaming || streaming || !activeConv) return;
    const msgs = activeConv.messages;
    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.content) return;
    const detected = extractHostsJson(lastMsg.content);
    if (detected) setPendingImportHosts(detected);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);
```

- [ ] **Step 7: 修改 `sendMessage` 函数——添加 `apiText` 参数和确认语拦截**

找到第 378 行：
```tsx
  async function sendMessage(quickText?: string) {
    const msgText = (quickText ?? input).trim();
    if (!msgText || streaming || !activeConv) return;
    if (!quickText) setInput('');
    setError('');

    const userMsg: ChatMessage = { role: 'user', content: msgText };
    // Compute the full message array BEFORE any setState so fetch gets the correct value
    const updatedMessages: ChatMessage[] = [...activeConv.messages, userMsg];
```

替换为：

```tsx
  async function sendMessage(quickText?: string, apiText?: string) {
    const msgText = (quickText ?? input).trim();
    if (!msgText || streaming || !activeConv) return;

    // Intercept confirmation messages when there are pending import hosts
    const CONFIRM_PATTERN = /^(是|好|确认|yes|一键|import|导入)/i;
    if (pendingImportHosts && CONFIRM_PATTERN.test(msgText)) {
      if (!quickText) setInput('');
      await doImportHosts(pendingImportHosts, msgText);
      return;
    }

    if (!quickText) setInput('');
    setError('');

    // Display text (shown in chat bubble) may differ from API text (sent to AI)
    const displayMsg: ChatMessage = { role: 'user', content: msgText };
    const apiMsgContent = apiText ?? msgText;
    const apiMsg: ChatMessage = { role: 'user', content: apiMsgContent };

    // For display in conversation
    const updatedDisplayMessages: ChatMessage[] = [...activeConv.messages, displayMsg];
    // For API call
    const updatedApiMessages: ChatMessage[] = [...activeConv.messages, apiMsg];
    // Alias for backwards compat (used in the setConversations below)
    const updatedMessages = updatedDisplayMessages;
```

Find the `body: JSON.stringify(...)` line (about 6 lines below in the fetch call):
```tsx
        body: JSON.stringify({ model: activeConv.model, messages: updatedMessages }),
```
Change to:
```tsx
        body: JSON.stringify({ model: activeConv.model, messages: updatedApiMessages }),
```

- [ ] **Step 8: 修改快捷问题点击回调，对「导入主机列表」使用特殊 prompt**

找到第 558 行：
```tsx
                  onClick={() => sendMessage(q)}
```
改为：
```tsx
                  onClick={() => {
                    if (q === '导入主机列表') {
                      sendMessage('导入主机列表', HOST_IMPORT_PROMPT);
                    } else {
                      sendMessage(q);
                    }
                  }}
```

- [ ] **Step 9: 在消息渲染循环中，在最后一条 assistant 消息下方添加「复制 JSON」和「一键导入」按钮**

找到第 569-589 行的消息渲染区域：
```tsx
          <div ref={messageListRef} className="ai-selectable px-3 py-3 space-y-3">
            {activeConv!.messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-terminal-blue/20 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-terminal-blue" />
                  </div>
                )}
                {msg.role === 'assistant' ? (
                  <AssistantBubble content={msg.content} streaming={streaming && i === activeConv!.messages.length - 1} />
                ) : (
                  <div
                    data-allow-selection="true"
                    className="ai-selectable ai-user-bubble max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed bg-terminal-blue text-white rounded-br-sm"
                  >
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
```

替换为：

```tsx
          <div ref={messageListRef} className="ai-selectable px-3 py-3 space-y-3">
            {activeConv!.messages.map((msg, i) => (
              <div key={i}>
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-terminal-blue/20 flex items-center justify-center flex-shrink-0 mr-2 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-terminal-blue" />
                    </div>
                  )}
                  {msg.role === 'assistant' ? (
                    <AssistantBubble content={msg.content} streaming={streaming && i === activeConv!.messages.length - 1} />
                  ) : (
                    <div
                      data-allow-selection="true"
                      className="ai-selectable ai-user-bubble max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed bg-terminal-blue text-white rounded-br-sm"
                    >
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>
                  )}
                </div>
                {/* Action buttons: shown below last assistant message when host JSON was detected */}
                {msg.role === 'assistant' && !streaming && pendingImportHosts && i === activeConv!.messages.length - 1 && (
                  <div className="flex gap-2 mt-1.5 ml-8">
                    <button
                      onClick={() => { navigator.clipboard.writeText(pendingImportHosts.json).catch(() => {}); }}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text hover:border-terminal-blue/40 transition-colors"
                    >
                      <Copy className="w-3 h-3" />复制 JSON
                    </button>
                    <button
                      onClick={() => doImportHosts(pendingImportHosts, '确认，一键导入')}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg border border-terminal-green/40 text-terminal-green hover:bg-terminal-green/10 transition-colors"
                    >
                      一键导入到主机列表
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
```

- [ ] **Step 10: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：无错误（或仅有与本次改动无关的原有警告）。

- [ ] **Step 11: Commit Task 1**

```bash
git add src/components/AIChatPanel.tsx
git commit -m "feat: add 导入主机列表 AI conversation flow to AIChatPanel"
```

---

## Task 2: App.tsx — Connect 页面启用 AI 助手面板

**Files:**
- Modify: `src/App.tsx`

---

- [ ] **Step 1: 改造 connect 页的早返回，包裹 wrapper div 并挂载 AI 面板**

找到第 519-529 行：

```tsx
  if (page === 'connect') {
    return (
      <ConnectForm
        onConnect={handleConnect}
        theme={theme}
        onThemeChange={setTheme}
        hasActiveSessions={sessions.length > 0}
        onBackToTerminal={sessions.length > 0 ? () => setPage('terminal') : undefined}
      />
    );
  }
```

替换为：

```tsx
  if (page === 'connect') {
    return (
      <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <ConnectForm
          onConnect={handleConnect}
          theme={theme}
          onThemeChange={setTheme}
          hasActiveSessions={sessions.length > 0}
          onBackToTerminal={sessions.length > 0 ? () => setPage('terminal') : undefined}
          onOpenAI={() => setAIPanelState('visible')}
        />
        {/* AI panel overlay — same as terminal page, shares aiPanelState */}
        <div
          className="absolute top-0 right-0 bottom-0 z-50 flex"
          style={{ boxShadow: '-4px 0 24px rgba(0,0,0,0.25)', display: aiPanelState === 'visible' ? undefined : 'none' }}
        >
          <AIChatPanel
            onClose={() => setAIPanelState('hidden')}
            onMinimize={() => setAIPanelState('minimized')}
            onHostsImported={() => window.dispatchEvent(new Event('hosts-updated'))}
          />
        </div>
        {aiPanelState === 'minimized' && (
          <div className="absolute bottom-16 right-4 z-50">
            <button
              onClick={() => setAIPanelState('visible')}
              title="恢复 AI 助手"
              className="w-12 h-12 rounded-full bg-terminal-blue flex items-center justify-center transition-all hover:scale-110 active:scale-95 select-none"
              style={{
                boxShadow: '0 0 0 3px rgba(59,130,246,0.25), 0 8px 24px rgba(0,0,0,0.45)',
                animation: 'ai-bubble-idle 3s ease-in-out infinite',
              }}
            >
              <Bot className="w-6 h-6 text-white" />
            </button>
          </div>
        )}
      </div>
    );
  }
```

- [ ] **Step 2: 给终端页的 AIChatPanel 也加上 `onHostsImported` prop**

找到第 788-791 行：

```tsx
          <AIChatPanel
            onClose={() => setAIPanelState('hidden')}
            onMinimize={() => setAIPanelState('minimized')}
          />
```

替换为：

```tsx
          <AIChatPanel
            onClose={() => setAIPanelState('hidden')}
            onMinimize={() => setAIPanelState('minimized')}
            onHostsImported={() => window.dispatchEvent(new Event('hosts-updated'))}
          />
```

- [ ] **Step 3: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：无错误。

- [ ] **Step 4: Commit Task 2**

```bash
git add src/App.tsx
git commit -m "feat: enable AI assistant panel on connect/home page"
```

---

## Task 3: ConnectForm — 顶栏添加 AI 助手按钮

**Files:**
- Modify: `src/components/ConnectForm.tsx`

---

- [ ] **Step 1: 在 lucide-react 导入中添加 `Bot`**

找到第 2-6 行：
```tsx
import {
  Terminal, Key, Server, User, Lock, Trash2, Edit3, Plus, Settings,
  Search, ChevronRight, ChevronDown, Folder, FolderOpen, FolderPlus, Monitor,
  AlertTriangle, Clock, Zap, LogIn, X, Wifi, Star, Upload, Download, ArrowLeft,
} from 'lucide-react';
```
改为：
```tsx
import {
  Terminal, Key, Server, User, Lock, Trash2, Edit3, Plus, Settings,
  Search, ChevronRight, ChevronDown, Folder, FolderOpen, FolderPlus, Monitor,
  AlertTriangle, Clock, Zap, LogIn, X, Wifi, Star, Upload, Download, ArrowLeft,
  Bot,
} from 'lucide-react';
```

- [ ] **Step 2: 在 Props interface 中添加 `onOpenAI`**

找到第 89-95 行：
```tsx
interface Props {
  onConnect: (cfg: ConnectConfig) => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  hasActiveSessions?: boolean;
  onBackToTerminal?: () => void;
}
```
替换为：
```tsx
interface Props {
  onConnect: (cfg: ConnectConfig) => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  hasActiveSessions?: boolean;
  onBackToTerminal?: () => void;
  /** Called when user clicks the AI assistant button in the header */
  onOpenAI?: () => void;
}
```

- [ ] **Step 3: 在组件函数签名中解构 `onOpenAI`**

找到第 625 行：
```tsx
export default function ConnectForm({ onConnect, theme, onThemeChange, hasActiveSessions, onBackToTerminal }: Props) {
```
改为：
```tsx
export default function ConnectForm({ onConnect, theme, onThemeChange, hasActiveSessions, onBackToTerminal, onOpenAI }: Props) {
```

- [ ] **Step 4: 在顶栏右侧按钮区域添加「AI 助手」按钮**

找到第 1143-1158 行，将 `<div className="flex items-center gap-2">` 整块替换为：

```tsx
          <div className="flex items-center gap-2">
            {hasActiveSessions && onBackToTerminal && (
              <button onClick={onBackToTerminal}
                className="flex items-center gap-1.5 text-xs text-terminal-green hover:text-terminal-green/80 transition-colors px-2 py-1 rounded hover:bg-terminal-green/10">
                <ArrowLeft className="w-3.5 h-3.5" />返回终端
              </button>
            )}
            {aiConfigured && onOpenAI && (
              <button
                onClick={onOpenAI}
                title="AI 助手"
                className="flex items-center gap-1.5 text-xs text-terminal-muted hover:text-terminal-blue transition-colors px-2 py-1 rounded hover:bg-terminal-blue/10"
              >
                <Bot className="w-3.5 h-3.5" />AI 助手
              </button>
            )}
            <button onClick={handleDownloadConfig}
              className="flex items-center gap-1.5 text-xs text-terminal-muted hover:text-terminal-green transition-colors px-2 py-1 rounded hover:bg-terminal-green/10">
              <Download className="w-3.5 h-3.5" />下载配置
            </button>
            <button onClick={() => { setShowSettingsTab(undefined); setShowSettings(true); }}
              className="flex items-center gap-1.5 text-xs text-terminal-muted hover:text-terminal-blue transition-colors px-2 py-1 rounded hover:bg-terminal-blue/10">
              <Settings className="w-3.5 h-3.5" />设置
            </button>
          </div>

- [ ] **Step 5: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：无错误。

- [ ] **Step 6: Commit Task 3**

```bash
git add src/components/ConnectForm.tsx
git commit -m "feat: add AI assistant button to ConnectForm header"
```

---

## Task 4: ConnectForm — 底部工具栏新增粘贴 JSON 导入

**Files:**
- Modify: `src/components/ConnectForm.tsx`

---

- [ ] **Step 1: 在 lucide-react 导入中添加 `Clipboard`**

找到第 2-6 行（已有 `Bot` 了），再加一个：

```tsx
import {
  Terminal, Key, Server, User, Lock, Trash2, Edit3, Plus, Settings,
  Search, ChevronRight, ChevronDown, Folder, FolderOpen, FolderPlus, Monitor,
  AlertTriangle, Clock, Zap, LogIn, X, Wifi, Star, Upload, Download, ArrowLeft,
  Bot, Clipboard,
} from 'lucide-react';
```

- [ ] **Step 2: 在组件 state 声明区域添加三个新状态**

在 `const [importMsg, setImportMsg] = useState('');`（第 640 行）之后，插入：

```tsx
  const [showJsonPaste, setShowJsonPaste] = useState(false);
  const [jsonPasteText, setJsonPasteText] = useState('');
  const [jsonPasteError, setJsonPasteError] = useState<string | null>(null);
```

- [ ] **Step 3: 添加 `handleJsonPasteImport` 函数**

在 `handleImportFile` 函数（第 855-876 行）之后，插入：

```tsx
  async function handleJsonPasteImport() {
    try {
      const json = JSON.parse(jsonPasteText);
      const incoming = Array.isArray(json) ? json : (json.hosts || []);
      const res = await fetch('/api/hosts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(incoming),
      });
      const result = await res.json();
      const hostsRes = await fetch('/api/hosts');
      setSavedHosts(await hostsRes.json());
      setImportMsg(`已导入 ${result.added} 台，跳过重复 ${result.skipped} 台`);
      setTimeout(() => setImportMsg(''), 4000);
      setShowJsonPaste(false);
      setJsonPasteText('');
      setJsonPasteError(null);
    } catch {
      setJsonPasteError('JSON 格式无效，请检查后重试');
    }
  }
```

- [ ] **Step 4: 在底部工具栏添加「JSON」按钮，并在其下方添加内联展开文本域**

找到第 1103-1120 行：

```tsx
        {/* Import / Export template buttons */}
        <div className="px-2 py-1.5 border-t border-terminal-border flex items-center gap-1">
          <button
            onClick={handleDownloadTemplate}
            title="下载导入模板"
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 rounded transition-colors"
          >
            <Download className="w-3 h-3" />模板
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            title="从 JSON 文件导入主机"
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/10 rounded transition-colors"
          >
            <Upload className="w-3 h-3" />导入
          </button>
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        </div>
```

替换为：

```tsx
        {/* Import / Export template buttons */}
        <div className="px-2 py-1.5 border-t border-terminal-border flex items-center gap-1">
          <button
            onClick={handleDownloadTemplate}
            title="下载导入模板"
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 rounded transition-colors"
          >
            <Download className="w-3 h-3" />模板
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            title="从 JSON 文件导入主机"
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/10 rounded transition-colors"
          >
            <Upload className="w-3 h-3" />导入
          </button>
          <button
            onClick={() => { setShowJsonPaste(s => !s); setJsonPasteError(null); }}
            title="粘贴 JSON 导入主机"
            className={`flex-1 flex items-center justify-center gap-1 py-1 text-[10px] rounded transition-colors ${
              showJsonPaste
                ? 'text-terminal-blue bg-terminal-blue/10'
                : 'text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10'
            }`}
          >
            <Clipboard className="w-3 h-3" />JSON
          </button>
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        </div>
        {/* Inline JSON paste area — expands below the toolbar */}
        {showJsonPaste && (
          <div className="px-2 pb-2">
            <textarea
              value={jsonPasteText}
              onChange={e => { setJsonPasteText(e.target.value); setJsonPasteError(null); }}
              placeholder="粘贴主机 JSON（数组格式，支持多台）"
              className="w-full h-24 text-[11px] font-mono bg-terminal-bg text-terminal-text border border-terminal-border rounded p-2 resize-none focus:outline-none focus:border-terminal-blue/50"
            />
            {jsonPasteError && (
              <p className="text-[10px] text-red-400 mt-1">{jsonPasteError}</p>
            )}
            <div className="flex gap-1 mt-1">
              <button
                onClick={handleJsonPasteImport}
                disabled={!jsonPasteText.trim()}
                className="flex-1 py-1 text-[10px] bg-terminal-blue text-white rounded hover:bg-terminal-blue/80 disabled:opacity-40 transition-colors"
              >
                导入到主机列表
              </button>
              <button
                onClick={() => { setShowJsonPaste(false); setJsonPasteText(''); setJsonPasteError(null); }}
                className="px-2 py-1 text-[10px] text-terminal-muted hover:text-terminal-text rounded hover:bg-terminal-border/50 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}
```

- [ ] **Step 5: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

预期：无错误。

- [ ] **Step 6: Commit Task 4**

```bash
git add src/components/ConnectForm.tsx
git commit -m "feat: add JSON paste import to ConnectForm host list toolbar"
```

---

## 完成验证

- [ ] **手动验证清单**

1. **主页 AI 按钮**：打开 app，在主机列表页（connect 页），顶栏应出现「AI 助手」按钮（仅在 AI 已配置时显示）
2. **AI 面板打开**：点击「AI 助手」按钮，AI 面板从右侧滑出
3. **最小化**：点击最小化按钮，面板消失，右下角出现悬浮球；点悬浮球能恢复
4. **导入主机列表快捷项**：AI 面板欢迎屏幕第一条为「导入主机列表」
5. **AI 对话流**：点击「导入主机列表」，AI 回复询问主机信息；输入一台主机信息后发送；AI 回复包含 JSON 代码块；消息下方出现「复制 JSON」和「一键导入到主机列表」按钮
6. **一键导入**：点击「一键导入到主机列表」，AI 面板中显示成功消息；主机列表自动刷新
7. **确认语导入**：在同一对话中输入「是」，触发导入并显示结果
8. **JSON 粘贴导入**：主机列表底部工具栏有「JSON」按钮；点击展开文本域；粘贴合法 JSON 后点「导入到主机列表」成功；粘贴非法 JSON 显示错误提示
9. **切换到终端页后回来**：AI 面板对话历史仍然存在（同一页面会话内）
