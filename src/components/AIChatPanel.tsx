import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Plus, Send, Loader2, ChevronDown, RefreshCw,
  Bot, ChevronRight, Terminal as TerminalIcon, Copy, Check,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
}

interface Props {
  onClose: () => void;
}

function normalizeEditableText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n$/, '');
}

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

function makeConv(model: string): Conversation {
  return { id: genId(), title: '新对话', model, messages: [] };
}

// ─── Quick questions shown on the welcome screen ───────────────────────────

const QUICK_QUESTIONS = [
  '如何查看磁盘使用情况？',
  '如何安装 Docker？',
  '如何配置 Nginx 反向代理？',
  '如何排查内存占用高的问题？',
];

// ─── Markdown-lite renderer ───────────────────────────────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let key = 0;

  const flushCode = () => {
    nodes.push(
      <pre key={key++} className="bg-terminal-bg border border-terminal-border rounded-md p-2 my-1.5 overflow-x-auto text-[11px] font-mono text-terminal-text">
        <code>{codeLines.join('\n')}</code>
      </pre>
    );
    codeLines = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) { flushCode(); inCode = false; }
      else { inCode = true; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    const parts = line.split(/(`[^`]+`)|\*\*([^*]+)\*\*/g);
    const inline: React.ReactNode[] = parts.map((p, i) => {
      if (!p) return null;
      if (p.startsWith('`') && p.endsWith('`')) {
        return <code key={i} className="bg-terminal-bg border border-terminal-border/60 rounded px-1 font-mono text-[11px] text-terminal-cyan">{p.slice(1, -1)}</code>;
      }
      return p;
    });
    nodes.push(<span key={key++}>{inline}</span>);
    nodes.push(<br key={key++} />);
  }
  if (inCode) flushCode();
  return nodes;
}

function selectNodeContents(node: HTMLElement | null) {
  if (!node) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function AssistantBubble({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const [actionState, setActionState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const contentRef = useRef<HTMLDivElement>(null);
  const actionToast = actionState === 'copied'
    ? {
        text: '已复制到剪贴板',
        className: 'border-terminal-green/30 bg-terminal-green/15 text-terminal-green',
      }
    : actionState === 'selected'
      ? {
          text: '已全选当前回复',
          className: 'border-terminal-blue/30 bg-terminal-blue/15 text-terminal-blue',
        }
      : null;

  useEffect(() => {
    if (actionState === 'idle') return;
    const timer = window.setTimeout(() => setActionState('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [actionState]);

  async function handleCopy() {
    const visibleText = contentRef.current?.innerText?.trim() || content;
    try {
      selectNodeContents(contentRef.current);
      await navigator.clipboard.writeText(visibleText);
      setActionState('copied');
    } catch {}
  }

  function handleSelectAll() {
    if (selectNodeContents(contentRef.current)) {
      setActionState('selected');
    }
  }

  function handlePointerCapture(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, [contenteditable="true"]')) return;
    e.stopPropagation();
  }

  return (
    <div
      data-allow-selection="true"
      className="ai-selectable ai-assistant-bubble relative max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed bg-terminal-bg border border-terminal-border/60 text-terminal-text rounded-bl-sm"
      onMouseDownCapture={handlePointerCapture}
      onClickCapture={handlePointerCapture}
    >
      {actionToast && (
        <div
          className={`pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] shadow-lg backdrop-blur-sm ${actionToast.className}`}
        >
          <Check className="h-3 w-3" />
          <span>{actionToast.text}</span>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-terminal-muted">
        <span>{streaming ? 'AI 正在输出' : 'AI 回复'}</span>
        {!!content && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 transition-colors ${
                actionState === 'copied'
                  ? 'border-terminal-green/30 bg-terminal-green/10 text-terminal-green'
                  : 'border-terminal-border text-terminal-muted hover:text-terminal-text hover:border-terminal-blue/40'
              }`}
            >
              {actionState === 'copied' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {actionState === 'copied' ? '已复制' : '复制'}
            </button>
            <button
              type="button"
              onClick={handleSelectAll}
              className={`rounded-md border px-2 py-0.5 transition-colors ${
                actionState === 'selected'
                  ? 'border-terminal-blue/30 bg-terminal-blue/10 text-terminal-blue'
                  : 'border-terminal-border text-terminal-muted hover:text-terminal-text hover:border-terminal-blue/40'
              }`}
            >
              {actionState === 'selected' ? '已全选' : '全选'}
            </button>
          </div>
        )}
      </div>

      <div ref={contentRef} className="select-text">
        {content
          ? renderMarkdown(content)
          : <Loader2 className="w-3.5 h-3.5 animate-spin text-terminal-muted" />}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIChatPanel({ onClose }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  // Resize
  const panelRef = useRef<HTMLDivElement>(null);

  const selectConversationContents = useCallback(() => {
    return selectNodeContents(messageListRef.current);
  }, []);

  // Fetch AI settings and update model list + default model
  const refreshModels = useCallback(() => {
    return fetch('/api/ai-settings')
      .then(r => r.json())
      .then(data => {
        const enabled: string[] = data.enabledModels?.length
          ? data.enabledModels
          : data.model ? [data.model] : [];
        setModels(enabled);
        const terminal = data.terminalModel || data.model || enabled[0] || '';
        setDefaultModel(terminal);
        return terminal;
      })
      .catch(() => '');
  }, []);

  // Initial load — also create the first conversation with the correct model
  useEffect(() => {
    refreshModels().then(terminal => {
      if (conversations.length === 0) {
        const c = makeConv(terminal);
        setConversations([c]);
        setActiveId(c.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-load models whenever AI settings are saved (provider login, key saved, etc.)
  useEffect(() => {
    function onSettingsUpdated() {
      refreshModels().then(terminal => {
        // Refresh the model on any empty (unstarted) conversations
        setConversations(prev => prev.map(c =>
          c.messages.length === 0 ? { ...c, model: terminal } : c
        ));
      });
    }
    window.addEventListener('ai-settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('ai-settings-updated', onSettingsUpdated);
  }, [refreshModels]);

  // Close model picker when clicking outside
  useEffect(() => {
    if (!showModelPicker) return;
    function onDown(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showModelPicker]);

  const activeConv = conversations.find(c => c.id === activeId) ?? conversations[0];
  const isEmpty = !activeConv || activeConv.messages.length === 0;

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [activeConv?.messages, scrollToBottom]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const current = normalizeEditableText(el.innerText || '');
    if (current === input) return;
    el.textContent = input;
  }, [input]);

  useEffect(() => {
    function handlePanelKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return;

      const panel = panelRef.current;
      if (!panel) return;

      const target = e.target instanceof Node ? e.target : null;
      const active = document.activeElement instanceof Node ? document.activeElement : null;
      const selectionAnchor = window.getSelection()?.anchorNode ?? null;
      const isInsidePanel = !!(
        (target && panel.contains(target))
        || (active && panel.contains(active))
        || (selectionAnchor && panel.contains(selectionAnchor))
      );
      if (!isInsidePanel) return;

      const elementTarget = e.target instanceof HTMLElement ? e.target : null;
      if (elementTarget?.closest('textarea, input, [contenteditable="true"]')) return;

      if (selectConversationContents()) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    document.addEventListener('keydown', handlePanelKeyDown, true);
    return () => document.removeEventListener('keydown', handlePanelKeyDown, true);
  }, [selectConversationContents]);

  // ── Drag-to-resize on left edge ───────────────────────────────────────────
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelRef.current?.offsetWidth ?? 320;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    function onMove(ev: MouseEvent) {
      if (!panelRef.current) return;
      const newW = Math.max(260, Math.min(720, startW + (startX - ev.clientX)));
      panelRef.current.style.width = `${newW}px`;
    }
    function onUp() {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function addConversation() {
    const model = activeConv?.model || defaultModel;
    const c = makeConv(model);
    setConversations(prev => [...prev, c]);
    setActiveId(c.id);
    setInput('');
    setError('');
  }

  function removeConversation(id: string) {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (next.length === 0) {
        const c = makeConv(defaultModel);
        setActiveId(c.id);
        return [c];
      }
      if (activeId === id) setActiveId(next[next.length - 1].id);
      return next;
    });
  }

  function updateConvModel(id: string, model: string) {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, model } : c));
    setShowModelPicker(false);
  }

  function clearConversation(id: string) {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, messages: [], title: '新对话' } : c));
    setError('');
  }

  async function sendMessage(quickText?: string) {
    const msgText = (quickText ?? input).trim();
    if (!msgText || streaming || !activeConv) return;
    if (!quickText) setInput('');
    setError('');

    const userMsg: ChatMessage = { role: 'user', content: msgText };
    // Compute the full message array BEFORE any setState so fetch gets the correct value
    const updatedMessages: ChatMessage[] = [...activeConv.messages, userMsg];

    // Single setState: append user message + empty assistant placeholder atomically
    setConversations(prev => prev.map(c => {
      if (c.id !== activeId) return c;
      const newTitle = c.messages.length === 0 ? msgText.slice(0, 28) : c.title;
      return {
        ...c,
        title: newTitle,
        messages: [...updatedMessages, { role: 'assistant' as const, content: '' }],
      };
    }));

    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: activeConv.model, messages: updatedMessages }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `服务器返回 ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as { text?: string; done?: boolean; error?: string };
            if (payload.error) throw new Error(payload.error);
            if (payload.text) {
              setConversations(prev => prev.map(c => {
                if (c.id !== activeId) return c;
                const msgs = [...c.messages];
                const last = msgs[msgs.length - 1];
                if (last?.role === 'assistant') {
                  msgs[msgs.length - 1] = { ...last, content: last.content + payload.text };
                }
                return { ...c, messages: msgs };
              }));
              scrollToBottom();
            }
          } catch (e: unknown) {
            if (e instanceof Error && e.message) setError(e.message);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message || '请求失败');
        setConversations(prev => prev.map(c => {
          if (c.id !== activeId) return c;
          const msgs = c.messages.filter((_, i) =>
            !(i === c.messages.length - 1 && c.messages[i].role === 'assistant' && c.messages[i].content === '')
          );
          return { ...c, messages: msgs };
        }));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInputChange(e: React.FormEvent<HTMLDivElement>) {
    setInput(normalizeEditableText(e.currentTarget.innerText || ''));
  }

  function stopStreaming() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  return (
    <div
      ref={panelRef}
      className="flex-shrink-0 flex flex-col bg-terminal-surface border-l border-terminal-border shadow-2xl relative z-50"
      style={{ width: '640px' }}
      tabIndex={-1}
    >
      {/* Resize handle — drag left edge to resize */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-terminal-blue/40 transition-colors"
        onMouseDown={startResize}
        title="拖动调整宽度"
      />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-terminal-border">
        <Bot className="w-4 h-4 text-terminal-blue flex-shrink-0" />
        <span className="text-sm font-semibold text-terminal-text flex-1">终端助手</span>
        <button onClick={addConversation} title="新建对话"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors">
          <Plus className="w-3.5 h-3.5" />
        </button>
        {activeConv && (
          <button onClick={() => clearConversation(activeId)} title="清空当前对话"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={onClose} title="关闭"
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-red transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Conversation tabs (only when >1) ────────────────────────────── */}
      {conversations.length > 1 && (
        <div className="flex-shrink-0 flex overflow-x-auto border-b border-terminal-border bg-terminal-bg scrollbar-none">
          {conversations.map(c => (
            <button key={c.id}
              onClick={() => { setActiveId(c.id); setError(''); }}
              className={`group flex items-center gap-1 px-2.5 py-1.5 text-[11px] whitespace-nowrap flex-shrink-0 border-r border-terminal-border/40 transition-colors ${
                c.id === activeId
                  ? 'bg-terminal-surface text-terminal-text border-b-2 border-b-terminal-blue'
                  : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-surface/50'
              }`}>
              <span className="max-w-[72px] truncate">{c.title}</span>
              <span onMouseDown={e => { e.stopPropagation(); removeConversation(c.id); }}
                className="opacity-0 group-hover:opacity-100 hover:text-terminal-red transition-opacity ml-0.5">
                <X className="w-2.5 h-2.5" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── Message area ─────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          /* Welcome screen */
          <div className="flex flex-col items-center px-4 py-6 min-h-full">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500/30 to-cyan-500/30 flex items-center justify-center mb-4 border-2 border-terminal-blue/30 shadow-lg">
              <Bot className="w-8 h-8 text-terminal-blue" />
            </div>
            <p className="text-sm text-terminal-text mb-0.5">您好，欢迎使用</p>
            <p className="text-lg font-bold text-terminal-blue mb-6">终端助手</p>

            <div className="w-full space-y-2">
              {QUICK_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left text-[13px] text-terminal-text bg-terminal-bg border border-terminal-border rounded-lg hover:border-terminal-blue/60 hover:bg-terminal-blue/5 transition-colors group"
                >
                  <span>{q}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-terminal-muted group-hover:text-terminal-blue flex-shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Messages */
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
        )}
      </div>

      {/* ── Error bar ────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex-shrink-0 mx-3 mb-1 px-2.5 py-1.5 text-[11px] text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg flex items-start gap-1.5">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="flex-shrink-0 hover:text-terminal-red/60 mt-px">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ── Input area ───────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-terminal-border px-3 pt-2 pb-2 space-y-1.5">
        {/* Textarea */}
        <div
          ref={inputRef}
          contentEditable={!streaming}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-disabled={streaming}
          data-placeholder="请将您遇到的问题告诉我，Shift+Enter 换行"
          data-empty={input.trim() ? 'false' : 'true'}
          onInput={handleInputChange}
          onKeyDown={handleKeyDown}
          className={`ai-chat-input w-full min-h-[88px] max-h-40 overflow-y-auto bg-terminal-bg border border-terminal-border rounded-xl px-3 py-2.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue whitespace-pre-wrap break-words ${streaming ? 'opacity-50 cursor-not-allowed' : ''}`}
        />

        {/* Model selector + send row */}
        <div className="flex items-center gap-2">
          {/* Model selector — opens upward */}
          <div className="relative flex-1 min-w-0" ref={modelPickerRef}>
            <button
              type="button"
              onClick={() => setShowModelPicker(p => !p)}
              title="切换模型"
              className="flex items-center gap-1 text-terminal-muted hover:text-terminal-text transition-colors w-full min-w-0 py-0.5"
            >
              <TerminalIcon className="w-3 h-3 flex-shrink-0" />
              <span className="text-[10px] truncate flex-1 text-left">{activeConv?.model || '未设置模型'}</span>
              <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
            </button>
            {showModelPicker && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-terminal-surface border border-terminal-border rounded-lg shadow-xl z-20 max-h-52 overflow-y-auto">
                {models.length === 0 ? (
                  <div className="px-3 py-3 text-[11px] text-terminal-muted text-center">
                    无可用模型<br />
                    <span className="text-[10px] opacity-70">请先在设置 → AI → API配置中勾选模型</span>
                  </div>
                ) : models.map(m => (
                  <button key={m} type="button"
                    onClick={() => activeConv && updateConvModel(activeConv.id, m)}
                    className={`w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors flex items-center gap-2 ${
                      activeConv?.model === m
                        ? 'bg-terminal-blue/10 text-terminal-blue'
                        : 'hover:bg-terminal-border/30 text-terminal-text'
                    }`}>
                    {activeConv?.model === m && <span className="w-1.5 h-1.5 rounded-full bg-terminal-blue flex-shrink-0" />}
                    <span className={activeConv?.model === m ? '' : 'ml-3.5'}>{m}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Stop / Send */}
          {streaming ? (
            <button onClick={stopStreaming} title="停止生成"
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-terminal-red/10 hover:bg-terminal-red/20 text-terminal-red border border-terminal-red/30 text-xs font-medium transition-colors">
              <X className="w-3 h-3" />停止
            </button>
          ) : (
            <button onClick={() => sendMessage()} disabled={!input.trim()}
              className="flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Send className="w-3 h-3" />发送
            </button>
          )}
        </div>

        {/* Disclaimer */}
        <p className="text-[10px] text-terminal-muted/50 text-center leading-relaxed">
          回答由AI模型生成，仅供参考。
        </p>
      </div>
    </div>
  );
}
