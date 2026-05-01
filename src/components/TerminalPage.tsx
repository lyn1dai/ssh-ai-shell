import React, {
  useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo,
} from 'react';
import AIReply from './AIReply';
import CommandCard from './CommandCard';
import Sidebar, { type SidebarPanel } from './Sidebar';
import SidePanel from './SidePanel';
import StatusBar from './StatusBar';
import FileManager from './FileManager';
import AIChatPanel from './AIChatPanel';
import { AnsiConverter } from '../utils/ansi';
import {
  RefreshCw, AlertCircle, Clipboard, ChevronRight, Server, BookMarked, Settings2,
} from 'lucide-react';
import type { Block, ConnectConfig, ServerMsg, Risk, CommandCardStatus, Theme, SavedCommand } from '../types';
import { DEFAULT_TERMINAL_SETTINGS } from '../types';

const SettingsPage = React.lazy(() => import('./SettingsPage'));

interface Props {
  config: ConnectConfig;
  onDisconnect: () => void;
  onNewTab?: (config: ConnectConfig) => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}

function parsePrompt(text: string): { prompt: string; user: string; host: string } | null {
  const m1 = text.match(/\[([^@\]]+)@([^\s\]]+)\s+([^\]]+)\][\$#]\s*$/m);
  if (m1) return { prompt: `[${m1[1]}@${m1[2]} ${m1[3]}]$ `, user: m1[1], host: `${m1[1]}@${m1[2]}` };
  const m2 = text.match(/([^@\s]+)@([^:]+):([^\$#\s]+)[\$#]\s*$/m);
  if (m2) return { prompt: `${m2[1]}@${m2[2]}:${m2[3]}$ `, user: m2[1], host: `${m2[1]}@${m2[2]}` };
  return null;
}

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2)}`; }

// New Session confirmation dialog
function NewSessionDialog({ onConfirm, onClearAndConfirm, onCancel }: {
  onConfirm: () => void;
  onClearAndConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-terminal-surface border border-terminal-border rounded-xl shadow-2xl p-5 w-full max-w-sm animate-slide-up">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-terminal-blue/20 flex items-center justify-center flex-shrink-0">
            <RefreshCw className="w-4 h-4 text-terminal-blue" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-terminal-text mb-1">开启新 AI 会话</h3>
            <p className="text-xs text-terminal-muted leading-relaxed">
              这将清空当前 AI 对话历史记录，AI 将不再记得之前的上下文。
              SSH 连接和终端内容不受影响。
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <button onClick={onConfirm}
            className="w-full px-4 py-2.5 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors flex items-center justify-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            开启新会话（保留终端内容）
          </button>
          <button onClick={onClearAndConfirm}
            className="w-full px-4 py-2.5 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text hover:border-terminal-blue/40 transition-colors flex items-center justify-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            开启新会话并清屏
          </button>
          <button onClick={onCancel}
            className="w-full px-4 py-2 text-xs rounded-lg text-terminal-muted hover:text-terminal-text transition-colors">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TerminalPage({ config, onDisconnect, onNewTab, theme, onThemeChange }: Props) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState('$ ');
  const [connInfo, setConnInfo] = useState({ host: '', user: '' });
  const [latency, setLatency] = useState(0);
  const [termSize, setTermSize] = useState({ rows: 24, cols: 80 });
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 11));
  const [showSettings, setShowSettings] = useState(false);
  const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [aiConfigured, setAIConfigured] = useState<boolean | null>(null);
  const [sessionToken, setSessionToken] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);

  // Saved commands
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);

  // Terminal display settings (from localStorage, reactive to changes)
  const [termSettings, setTermSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('terminal-settings');
      return raw ? { ...DEFAULT_TERMINAL_SETTINGS, ...JSON.parse(raw) } : DEFAULT_TERMINAL_SETTINGS;
    } catch { return DEFAULT_TERMINAL_SETTINGS; }
  });

  // Listen for terminal settings changes dispatched from SettingsPage
  useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem('terminal-settings');
        if (raw) setTermSettings({ ...DEFAULT_TERMINAL_SETTINGS, ...JSON.parse(raw) });
      } catch {}
    };
    window.addEventListener('terminal-settings-updated', handler);
    return () => window.removeEventListener('terminal-settings-updated', handler);
  }, []);

  // Command history for clipboard panel + arrow key navigation
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Ctrl+R reverse search state
  const [searchMode, setSearchMode] = useState(false);
  const [searchResultIdx, setSearchResultIdx] = useState(0);
  const savedInputRef = useRef('');

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const converterRef = useRef(new AnsiConverter());
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingStartRef = useRef<number>(0);
  const nextCursorRef = useRef<number | null>(null);

  // Restore cursor position after state-driven input changes
  useLayoutEffect(() => {
    if (nextCursorRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(nextCursorRef.current, nextCursorRef.current);
      nextCursorRef.current = null;
    }
  }, [input]);

  // Ghost text: prefix-match from history (only when NOT in search mode)
  const ghostText = useMemo(() => {
    if (searchMode || !input) return '';
    const match = cmdHistory.find(c => c.startsWith(input) && c !== input);
    return match ? match.slice(input.length) : '';
  }, [input, cmdHistory, searchMode]);

  // Ctrl+R search: filter history by substring
  const searchResults = useMemo(() => {
    if (!searchMode) return [];
    if (!input) return cmdHistory;
    const q = input.toLowerCase();
    return cmdHistory.filter(c => c.toLowerCase().includes(q));
  }, [searchMode, input, cmdHistory]);

  const currentSearchMatch = searchMode ? (searchResults[searchResultIdx] ?? '') : '';

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);
  useLayoutEffect(() => { scrollToBottom(); }, [blocks]);

  // Size observer
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const charW = 8.4; const charH = 20;
      const cols = Math.floor(el.clientWidth / charW);
      const rows = Math.floor(el.clientHeight / charH);
      setTermSize({ rows: Math.max(10, rows), cols: Math.max(40, cols) });
      wsRef.current?.send(JSON.stringify({ type: 'resize', payload: { rows, cols } }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Check AI config on mount
  useEffect(() => {
    fetch('/api/ai-settings')
      .then(r => r.json())
      .then(d => setAIConfigured(d.configured ?? false))
      .catch(() => setAIConfigured(false));
  }, []);

  // Load saved commands
  useEffect(() => {
    fetch('/api/saved-commands')
      .then(r => r.json())
      .then(d => setSavedCommands(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  // Listen for saved-commands updates from SettingsPage
  useEffect(() => {
    const handler = () => {
      fetch('/api/saved-commands')
        .then(r => r.json())
        .then(d => setSavedCommands(Array.isArray(d) ? d : []))
        .catch(() => {});
    };
    window.addEventListener('saved-commands-updated', handler);
    return () => window.removeEventListener('saved-commands-updated', handler);
  }, []);

  // ── Block helpers ─────────────────────────────────────────────────────────

  function appendTerminalHtml(html: string) {
    setBlocks(prev => {
      const last = prev[prev.length - 1];
      if (last?.type === 'terminal') {
        return [...prev.slice(0, -1), { ...last, html: last.html + html }];
      }
      return [...prev, { id: genId(), type: 'terminal', html }];
    });
  }

  function addBlock(block: Block) {
    setBlocks(prev => [...prev, block]);
  }

  function updateBlock<T extends Block>(id: string, updater: (b: T) => T) {
    setBlocks(prev => prev.map(b => b.id === id ? updater(b as T) as Block : b));
  }

  const aiReplyIdRef = useRef<string | null>(null);
  const lastFeedbackBlockIdRef = useRef<string | null>(null);

  // ── WebSocket ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'connect', payload: config }));
      pingRef.current = setInterval(() => {
        pingStartRef.current = Date.now();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 5000);
    };

    ws.onmessage = (e) => {
      const msg: ServerMsg = JSON.parse(e.data);
      handleMsg(msg);
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
    };

    ws.onerror = () => {
      appendTerminalHtml('\r\n<span style="color:rgb(var(--tw-c-red))">WebSocket 连接失败</span>\r\n');
    };

    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      ws.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMsg(msg: ServerMsg) {
    switch (msg.type) {
      case 'ssh_connected': {
        setConnected(true);
        setConnInfo({ host: msg.payload.host, user: msg.payload.username });
        if (msg.payload.sessionToken) setSessionToken(msg.payload.sessionToken);
        appendTerminalHtml(
          `<span style="color:rgb(var(--tw-c-green))">Connected to ${msg.payload.host} as ${msg.payload.username}</span>\r\n`
        );
        break;
      }

      case 'terminal_output': {
        const raw = msg.payload.data;
        appendTerminalHtml(converterRef.current.convert(raw));
        const ctx = parsePrompt(raw);
        if (ctx) {
          setPrompt(ctx.prompt);
          setConnInfo(prev => ({ ...prev, host: ctx.host }));
        }
        break;
      }

      case 'ai_thinking': {
        const id = genId();
        aiReplyIdRef.current = id;
        lastFeedbackBlockIdRef.current = id;
        addBlock({ id, type: 'ai_reply', text: '', complete: false });
        break;
      }

      case 'ai_reply_chunk': {
        const id = aiReplyIdRef.current;
        if (id) {
          updateBlock<Extract<Block, { type: 'ai_reply' }>>(id, b => ({
            ...b, text: b.text + msg.payload.text,
          }));
        }
        break;
      }

      case 'ai_reply_end': {
        const id = aiReplyIdRef.current;
        if (id) {
          updateBlock<Extract<Block, { type: 'ai_reply' }>>(id, b => ({ ...b, complete: true }));
          aiReplyIdRef.current = null;
        }
        inputRef.current?.focus();
        break;
      }

      case 'ai_log': {
        const { message, level = 'info' } = msg.payload as { message: string; level?: string };
        const now = new Date().toLocaleTimeString('zh-CN', {
          hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // level → { foreground color, prefix glyph }
        const lvl: Record<string, [string, string]> = {
          step:  ['rgb(var(--tw-c-blue))',   '→'],
          ok:    ['rgb(var(--tw-c-green))',  '✓'],
          warn:  ['rgb(var(--tw-c-yellow))', '⚠'],
          error: ['rgb(var(--tw-c-red))',    '✗'],
          cmd:   ['rgb(var(--tw-c-purple))', '❯'],
          info:  ['rgb(var(--tw-c-muted))',  '·'],
        };
        const [col, pfx] = lvl[level] ?? lvl.info;
        appendTerminalHtml(
          `<span style="color:rgb(var(--tw-c-border))">[${now}]</span>` +
          ` <span style="color:${col}">${pfx} ${safe}</span>\r\n`
        );
        break;
      }

      case 'ai_not_configured': {
        appendTerminalHtml(
          `<span style="color:rgb(var(--tw-c-yellow))">⚠ AI 未配置，请先在设置中配置 AI 服务才能使用自然语言功能</span>\r\n`
        );
        setShowSettings(true);
        break;
      }

      case 'command_card': {
        const { commandId, command, risk } = msg.payload;
        addBlock({
          id: `card_${commandId}`, type: 'command_card',
          commandId, command, risk: risk as Risk, status: 'pending',
        });
        break;
      }

      case 'command_auto_approve': {
        const { commandId } = msg.payload;
        setBlocks(prev => prev.map(b =>
          b.type === 'command_card' && b.commandId === commandId
            ? { ...b, status: 'approved' as CommandCardStatus } : b
        ));
        break;
      }

      case 'command_executing': {
        const { commandId } = msg.payload;
        setBlocks(prev => prev.map(b =>
          b.type === 'command_card' && b.commandId === commandId
            ? { ...b, status: 'executing' as CommandCardStatus } : b
        ));
        break;
      }

      case 'command_done': {
        const { commandId } = msg.payload;
        setBlocks(prev => prev.map(b =>
          b.type === 'command_card' && b.commandId === commandId
            ? { ...b, status: 'done' as CommandCardStatus } : b
        ));
        break;
      }

      case 'disconnected': {
        setConnected(false);
        appendTerminalHtml('\r\n<span style="color:rgb(var(--tw-c-muted))">Connection closed.</span>\r\n');
        break;
      }

      case 'session_cleared': {
        appendTerminalHtml(
          '\r\n<span style="color:rgb(var(--tw-c-border));border-top:1px solid rgb(var(--tw-c-border))">─────────────── 新 AI 会话 ───────────────</span>\r\n'
        );
        break;
      }

      case 'config_updated': {
        if (msg.payload.configured !== undefined) setAIConfigured(msg.payload.configured);
        break;
      }

      case 'pong': {
        setLatency(Date.now() - pingStartRef.current);
        break;
      }

      case 'error': {
        appendTerminalHtml(
          `\r\n<span style="color:rgb(var(--tw-c-red))">错误: ${msg.payload.message}</span>\r\n`
        );
        break;
      }
    }
  }

  // ── Input handling ────────────────────────────────────────────────────────

  function sendWs(type: string, payload: object = {}) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }

  // Execute a saved command directly in the shell
  const executeSavedCommand = useCallback((cmd: SavedCommand) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'run_saved_command', payload: { content: cmd.content } }));
    inputRef.current?.focus();
  }, []);

  // Keep a ref to savedCommands so the global keydown effect doesn't re-subscribe on every render
  const savedCommandsRef = useRef<SavedCommand[]>([]);
  useEffect(() => { savedCommandsRef.current = savedCommands; }, [savedCommands]);

  // Global keydown handler for saved command shortcuts (runs in capture phase)
  useEffect(() => {
    function normalizeKey(e: KeyboardEvent): string {
      const parts: string[] = [];
      if (e.ctrlKey)  parts.push('Ctrl');
      if (e.altKey)   parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey)  parts.push('Meta');
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!['Control','Alt','Shift','Meta'].includes(key)) parts.push(key);
      return parts.join('+');
    }

    function handleGlobalKeyDown(e: KeyboardEvent) {
      const combo = normalizeKey(e);
      const match = savedCommandsRef.current.find(
        c => c.shortcut && c.shortcut.toLowerCase() === combo.toLowerCase()
      );
      if (match) {
        e.preventDefault();
        e.stopPropagation();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'run_saved_command', payload: { content: match.content } }));
          inputRef.current?.focus();
        }
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, []);

  function navigateHistoryUp() {
    if (cmdHistory.length === 0) return;
    const newIdx = Math.min(historyIndex + 1, cmdHistory.length - 1);
    setInput(cmdHistory[newIdx]);
    setHistoryIndex(newIdx);
  }

  function navigateHistoryDown() {
    if (historyIndex <= 0) {
      setInput('');
      setHistoryIndex(-1);
    } else {
      const newIdx = historyIndex - 1;
      setInput(cmdHistory[newIdx]);
      setHistoryIndex(newIdx);
    }
  }

  function enterSearchMode() {
    savedInputRef.current = input;
    setInput('');
    setHistoryIndex(-1);
    setSearchResultIdx(0);
    setSearchMode(true);
  }

  // Find previous word boundary for Alt+B / Ctrl+Left
  function wordLeft(str: string, pos: number): number {
    let i = pos;
    while (i > 0 && str[i - 1] === ' ') i--;
    while (i > 0 && str[i - 1] !== ' ') i--;
    return i;
  }

  // Find next word boundary for Alt+F / Ctrl+Right
  function wordRight(str: string, pos: number): number {
    let i = pos;
    while (i < str.length && str[i] !== ' ') i++;
    while (i < str.length && str[i] === ' ') i++;
    return i;
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {

    // ── Ctrl+R: enter/cycle search mode ──────────────────────────────────
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      if (!searchMode) {
        enterSearchMode();
      } else {
        setSearchResultIdx(prev => Math.min(prev + 1, searchResults.length - 1));
      }
      return;
    }

    // ── Search mode special keys ──────────────────────────────────────────
    if (searchMode) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const match = currentSearchMatch;
        setInput(match || savedInputRef.current);
        setSearchMode(false);
        setHistoryIndex(-1);
        return;
      }
      if (e.key === 'Escape' || (e.ctrlKey && e.key === 'g')) {
        e.preventDefault();
        setInput(savedInputRef.current);
        setSearchMode(false);
        return;
      }
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
        setSearchResultIdx(0);
      }
      return;
    }

    // ── Normal mode ────────────────────────────────────────────────────────

    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.trim();
      setInput('');
      setHistoryIndex(-1);
      if (!connected) return;
      if (text) {
        // Intercept clear/reset commands locally to avoid race with ANSI escape codes
        if (text === 'clear' || text === 'reset') {
          setBlocks([]);
          sendWs('raw_input', { data: text + '\r' });
          return;
        }
        setCmdHistory(prev => {
          const filtered = prev.filter(c => c !== text);
          return [text, ...filtered].slice(0, 100);
        });
      }
      sendWs('input', { text });
      return;
    }

    // Tab: accept ghost text if available, otherwise SSH tab completion
    if (e.key === 'Tab') {
      e.preventDefault();
      if (ghostText) {
        setInput(input + ghostText);
      } else {
        sendWs('raw_input', { data: '\t' });
      }
      return;
    }

    // ArrowRight: accept ghost text if cursor is at end
    if (e.key === 'ArrowRight' && !e.altKey && !e.ctrlKey && ghostText) {
      const curPos = inputRef.current?.selectionStart ?? input.length;
      if (curPos === input.length) {
        e.preventDefault();
        setInput(input + ghostText);
        return;
      }
    }

    // Ctrl+C — send interrupt if no text selected
    if (e.ctrlKey && e.key === 'c') {
      const sel = window.getSelection()?.toString();
      if (!sel) {
        e.preventDefault();
        sendWs('raw_input', { data: '\x03' });
      }
      return;
    }

    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      sendWs('raw_input', { data: '\x04' });
      return;
    }

    // Ctrl+L: clear screen
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      setBlocks([]);
      sendWs('raw_input', { data: '\x0c' });
      return;
    }

    // Ctrl+Z: suspend (SIGTSTP)
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      sendWs('raw_input', { data: '\x1a' });
      return;
    }

    // ── Shell line-editing shortcuts ───────────────────────────────────────

    // Ctrl+A / Home: cursor to start of line
    if ((e.ctrlKey && e.key === 'a') || e.key === 'Home') {
      e.preventDefault();
      inputRef.current?.setSelectionRange(0, 0);
      return;
    }

    // Ctrl+E / End: cursor to end of line
    if ((e.ctrlKey && e.key === 'e') || e.key === 'End') {
      e.preventDefault();
      const end = input.length;
      inputRef.current?.setSelectionRange(end, end);
      return;
    }

    // Ctrl+K: kill from cursor to end of line
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? input.length;
      setInput(input.slice(0, pos));
      return;
    }

    // Ctrl+U: kill from start to cursor
    if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? 0;
      nextCursorRef.current = 0;
      setInput(input.slice(pos));
      return;
    }

    // Ctrl+W: kill word before cursor
    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? input.length;
      const before = input.slice(0, pos);
      const after = input.slice(pos);
      const trimmed = before.trimEnd();
      const wordStart = trimmed.lastIndexOf(' ') + 1;
      nextCursorRef.current = wordStart;
      setInput(before.slice(0, wordStart) + after);
      return;
    }

    // Alt+B or Ctrl+Left: move cursor one word left
    if ((e.altKey && e.key === 'b') || (e.ctrlKey && e.key === 'ArrowLeft')) {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? input.length;
      const newPos = wordLeft(input, pos);
      inputRef.current?.setSelectionRange(newPos, newPos);
      return;
    }

    // Alt+F or Ctrl+Right: move cursor one word right
    if ((e.altKey && e.key === 'f') || (e.ctrlKey && e.key === 'ArrowRight')) {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? input.length;
      const newPos = wordRight(input, pos);
      inputRef.current?.setSelectionRange(newPos, newPos);
      return;
    }

    // Alt+D: delete word after cursor
    if (e.altKey && e.key === 'd') {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? input.length;
      const wordEnd = wordRight(input, pos);
      setInput(input.slice(0, pos) + input.slice(wordEnd));
      nextCursorRef.current = pos;
      return;
    }

    // Alt+Backspace: delete word before cursor (same as Ctrl+W but cleaner)
    if (e.altKey && e.key === 'Backspace') {
      e.preventDefault();
      const pos = inputRef.current?.selectionStart ?? input.length;
      const newStart = wordLeft(input, pos);
      nextCursorRef.current = newStart;
      setInput(input.slice(0, newStart) + input.slice(pos));
      return;
    }

    // Ctrl+P: history previous (same as ArrowUp)
    if (e.ctrlKey && e.key === 'p') {
      e.preventDefault();
      navigateHistoryUp();
      return;
    }

    // Ctrl+N: history next (same as ArrowDown)
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      navigateHistoryDown();
      return;
    }

    // ArrowUp: history previous
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateHistoryUp();
      return;
    }

    // ArrowDown: history next
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateHistoryDown();
      return;
    }

    // PageUp: scroll terminal up
    if (e.key === 'PageUp') {
      e.preventDefault();
      scrollRef.current?.scrollBy({ top: -400, behavior: 'smooth' });
      return;
    }

    // PageDown: scroll terminal down
    if (e.key === 'PageDown') {
      e.preventDefault();
      scrollRef.current?.scrollBy({ top: 400, behavior: 'smooth' });
      return;
    }
  }

  // Command card actions
  function handleConfirm(commandId: string, command: string) {
    setBlocks(prev => prev.map(b =>
      b.type === 'command_card' && b.commandId === commandId
        ? { ...b, status: 'executing' as CommandCardStatus } : b
    ));
    sendWs('command_confirm', { commandId, command });
  }

  function handleReject(commandId: string) {
    setBlocks(prev => prev.map(b =>
      b.type === 'command_card' && b.commandId === commandId
        ? { ...b, status: 'rejected' as CommandCardStatus } : b
    ));
    sendWs('command_reject', { commandId });
  }

  function handleNewSessionRequest() {
    setShowNewSession(true);
  }

  function handleNewSessionConfirm(clearScreen: boolean) {
    setShowNewSession(false);
    sendWs('new_session', {});
    if (clearScreen) setBlocks([]);
  }

  function handleSettingsSaved() {
    sendWs('update_ai_config', {});
    fetch('/api/ai-settings')
      .then(r => r.json())
      .then(d => setAIConfigured(d.configured ?? false))
      .catch(() => {});
  }

  function handlePanelToggle(panel: SidebarPanel) {
    if (panel === 'settings') {
      setShowSettings(true);
      setActivePanel(null);
    } else if (panel === 'chat') {
      setShowChatPanel(prev => !prev);
      setActivePanel(null);
    } else {
      setActivePanel(prev => prev === panel ? null : panel);
    }
  }

  function insertFromHistory(cmd: string) {
    setInput(cmd);
    setHistoryIndex(-1);
    setActivePanel(null);
    inputRef.current?.focus();
  }

  const tabLabel = config.name
    ? config.name
    : `${connInfo.user || config.username}@${connInfo.host || config.host}`;

  const displayPrompt = searchMode ? '(搜索) ' : prompt;
  const promptColor = searchMode ? 'rgb(var(--tw-c-cyan))' : 'rgb(var(--tw-c-green))';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full bg-terminal-bg text-terminal-text font-mono overflow-hidden relative">
      {/* Sidebar: collapsible */}
      {!sidebarCollapsed && (
        <Sidebar activePanel={showChatPanel ? 'chat' : activePanel} onPanelToggle={handlePanelToggle} />
      )}

      {/* Side panels */}
      {activePanel === 'clipboard' && (
        <SidePanel title="命令历史" onClose={() => setActivePanel(null)} leftClass={sidebarCollapsed ? 'left-0' : 'left-10'}>
          {cmdHistory.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-terminal-muted">
              <Clipboard className="w-6 h-6 mx-auto mb-2 opacity-30" />
              暂无历史命令
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {cmdHistory.map((cmd, i) => (
                <button
                  key={i}
                  onClick={() => insertFromHistory(cmd)}
                  title="点击插入"
                  className="w-full text-left px-2.5 py-2 rounded-md hover:bg-terminal-border/30 text-xs font-mono text-terminal-text truncate transition-colors group"
                >
                  <span className="text-terminal-muted group-hover:text-terminal-text transition-colors">
                    {cmd}
                  </span>
                </button>
              ))}
            </div>
          )}
        </SidePanel>
      )}

      {activePanel === 'userinfo' && (
        <SidePanel title="会话信息" onClose={() => setActivePanel(null)} leftClass={sidebarCollapsed ? 'left-0' : 'left-10'}>
          <div className="p-3 space-y-3">
            <div className="bg-terminal-bg rounded-lg p-3 space-y-2">
              {[
                { label: '主机名称', value: config.name || '-' },
                { label: '服务器', value: connInfo.host || config.host },
                { label: '用户', value: connInfo.user || config.username },
                { label: '端口', value: String(config.port) },
                { label: '状态', value: connected ? '已连接' : '未连接' },
                { label: '延迟', value: latency > 0 ? `${latency} ms` : '-' },
                { label: '会话 ID', value: sessionId },
                { label: '终端大小', value: `${termSize.cols}×${termSize.rows}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-[10px] text-terminal-muted">{label}</span>
                  <span className="text-[10px] text-terminal-text font-mono">{value}</span>
                </div>
              ))}
            </div>
            <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md ${
              connected ? 'bg-terminal-green/10 text-terminal-green' : 'bg-terminal-red/10 text-terminal-red'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-terminal-green' : 'bg-terminal-red'}`} />
              {connected ? 'SSH 连接正常' : 'SSH 已断开'}
            </div>
            <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md ${
              aiConfigured ? 'bg-terminal-blue/10 text-terminal-blue' : 'bg-terminal-yellow/10 text-terminal-yellow'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${aiConfigured ? 'bg-terminal-blue' : 'bg-terminal-yellow'}`} />
              {aiConfigured ? 'AI 已配置' : 'AI 未配置'}
            </div>
          </div>
        </SidePanel>
      )}

      {activePanel === 'files' && (
        <SidePanel title="文件管理" onClose={() => setActivePanel(null)} widthClass="w-[420px]" noHeader>
          <FileManager
            ws={wsRef.current}
            sessionToken={sessionToken}
            onClose={() => setActivePanel(null)}
          />
        </SidePanel>
      )}

      {activePanel === 'hosts' && (
        <SidePanel title="主机管理" onClose={() => setActivePanel(null)}>
          <HostManagerPanel
            currentConfig={config}
            onConnect={(cfg) => {
              setActivePanel(null);
              if (onNewTab) onNewTab(cfg);
            }}
          />
        </SidePanel>
      )}

      {activePanel === 'commands' && (
        <SidePanel title="常用命令" onClose={() => setActivePanel(null)} leftClass={sidebarCollapsed ? 'left-0' : 'left-10'}>
          {savedCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-terminal-muted">
              <BookMarked className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p>暂无常用命令</p>
              <button
                onClick={() => { setActivePanel(null); setShowSettings(true); }}
                className="mt-2 text-terminal-blue hover:underline text-[11px]"
              >
                前往设置添加
              </button>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {savedCommands.map(cmd => (
                <button
                  key={cmd.id}
                  onClick={() => { executeSavedCommand(cmd); setActivePanel(null); }}
                  title={cmd.content}
                  className="w-full text-left px-2.5 py-2 rounded-md hover:bg-terminal-border/30 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-terminal-text truncate group-hover:text-terminal-blue transition-colors">
                      {cmd.name}
                    </span>
                    {cmd.shortcut && (
                      <span className="flex-shrink-0 text-[9px] font-mono bg-terminal-bg border border-terminal-border text-terminal-muted px-1 py-0.5 rounded">
                        {cmd.shortcut}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-terminal-muted font-mono truncate mt-0.5">
                    {cmd.content}
                  </div>
                  {cmd.description && (
                    <div className="text-[10px] text-terminal-muted/70 truncate mt-0.5">
                      {cmd.description}
                    </div>
                  )}
                </button>
              ))}
              <div className="pt-1 border-t border-terminal-border/50 mt-1">
                <button
                  onClick={() => { setActivePanel(null); setShowSettings(true); }}
                  className="w-full text-center text-[10px] text-terminal-muted hover:text-terminal-blue py-1.5 transition-colors flex items-center justify-center gap-1"
                >
                  <Settings2 className="w-3 h-3" />
                  管理常用命令
                </button>
              </div>
            </div>
          )}
        </SidePanel>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Info bar */}
        <div className="flex-shrink-0 flex items-center justify-between bg-terminal-surface border-b border-terminal-border px-3 h-9">
          <div className="flex items-center gap-2">
            {/* Sidebar toggle button */}
            <button
              onClick={() => setSidebarCollapsed(p => !p)}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors"
              title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="currentColor">
                {sidebarCollapsed
                  ? <><rect x="1" y="1" width="4" height="12" rx="1" opacity="0.4"/><rect x="7" y="1" width="6" height="12" rx="1" opacity="0.8"/></>
                  : <><rect x="1" y="1" width="4" height="12" rx="1" opacity="0.8"/><rect x="7" y="1" width="6" height="12" rx="1" opacity="0.4"/></>
                }
              </svg>
            </button>
            <div className="flex items-center gap-1.5 bg-terminal-bg border border-terminal-border rounded-md px-2.5 py-1 text-xs text-terminal-text">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-terminal-green' : 'bg-terminal-red'}`} />
              <span className="max-w-[200px] truncate">{tabLabel}</span>
            </div>
            {aiConfigured === false && (
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-1 text-[10px] text-terminal-yellow hover:text-terminal-yellow/80 transition-colors"
                title="AI 未配置，点击配置"
              >
                <AlertCircle className="w-3 h-3" />
                AI 未配置
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {latency > 0 && <span className="text-[11px] text-terminal-muted">{latency} ms</span>}
            <button
              onClick={() => { sendWs('disconnect', {}); onDisconnect(); }}
              className="text-[11px] text-terminal-muted hover:text-terminal-red transition-colors"
            >
              断开
            </button>
          </div>
        </div>

        {/* ── Main scroll area ──────────────────────────────────────────── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 scroll-smooth terminal-area"
          style={{
            fontSize: `${termSettings.fontSize}px`,
            fontFamily: `'${termSettings.fontFamily}', 'JetBrains Mono', monospace`,
            lineHeight: termSettings.lineHeight,
            letterSpacing: termSettings.letterSpacing ? `${termSettings.letterSpacing}px` : undefined,
          }}
          onClick={() => inputRef.current?.focus()}
        >
          {blocks.map((block) => {
            switch (block.type) {
              case 'terminal':
                return (
                  <div
                    key={block.id}
                    className="terminal-output whitespace-pre-wrap break-words text-sm leading-5 text-terminal-text"
                    dangerouslySetInnerHTML={{ __html: block.html }}
                  />
                );

              case 'ai_reply':
                return (
                  <AIReply
                    key={block.id}
                    text={block.text}
                    complete={block.complete}
                    showFeedback={block.complete && block.id === lastFeedbackBlockIdRef.current}
                    onNewSession={block.complete ? handleNewSessionRequest : undefined}
                  />
                );

              case 'command_card':
                return (
                  <CommandCard
                    key={block.id}
                    commandId={block.commandId}
                    command={block.command}
                    risk={block.risk}
                    status={block.status}
                    onConfirm={handleConfirm}
                    onReject={handleReject}
                  />
                );

              default:
                return null;
            }
          })}

          {/* ── Inline prompt + input ──────────────────────────────────── */}
          <div
            className="flex items-baseline mt-0.5"
            onClick={e => { e.stopPropagation(); inputRef.current?.focus(); }}
          >
            <span
              className="text-sm select-none whitespace-pre flex-shrink-0 font-mono"
              style={{ lineHeight: '1.25rem', color: promptColor }}
            >
              {displayPrompt}
            </span>

            {/* Input wrapper: ghost text overlay + actual input */}
            <div className="relative flex-1 min-w-0">
              {ghostText && (
                <div
                  className="absolute inset-0 text-sm font-mono whitespace-pre pointer-events-none overflow-hidden select-none"
                  aria-hidden="true"
                  style={{ lineHeight: '1.25rem' }}
                >
                  <span style={{ visibility: 'hidden' }}>{input}</span>
                  <span style={{ color: 'rgb(var(--tw-c-muted))' }}>{ghostText}</span>
                </div>
              )}
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  if (!searchMode) setHistoryIndex(-1);
                  if (searchMode) setSearchResultIdx(0);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder={connected ? '' : '正在连接…'}
                disabled={!connected}
                className="w-full bg-transparent outline-none text-sm font-mono min-w-0 disabled:opacity-40"
                style={{
                  lineHeight: '1.25rem',
                  caretColor: 'rgb(var(--tw-c-green))',
                  color: ghostText ? 'transparent' : 'rgb(var(--tw-c-term-fg))',
                }}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
          </div>

          {/* Ctrl+R search match indicator */}
          {searchMode && (
            <div className="flex items-center gap-2 mt-0.5 text-xs font-mono">
              <span style={{ color: 'rgb(var(--tw-c-cyan))' }}>→</span>
              <span className={currentSearchMatch ? 'text-terminal-text' : 'text-terminal-muted'}>
                {currentSearchMatch || '(无匹配)'}
              </span>
              {searchResults.length > 1 && (
                <span className="text-terminal-muted">
                  {searchResultIdx + 1}/{searchResults.length}  Ctrl+R 继续
                </span>
              )}
            </div>
          )}

          {ghostText && !searchMode && (
            <div className="text-[10px] text-terminal-muted mt-0.5 select-none">
              Tab / → 补全
            </div>
          )}

          <div className="h-4" />
        </div>

        <StatusBar
          connected={connected}
          host={connInfo.host}
          latencyMs={latency}
          rows={termSize.rows}
          cols={termSize.cols}
          sessionId={sessionId}
          aiConfigured={aiConfigured ?? false}
          onAISettings={() => setShowSettings(true)}
        />
      </div>

      {/* Right: AI Chat Panel */}
      {showChatPanel && (
        <AIChatPanel onClose={() => setShowChatPanel(false)} />
      )}

      {/* Dialogs */}
      {showSettings && (
        <React.Suspense fallback={null}>
          <SettingsPage
            onClose={() => setShowSettings(false)}
            onSaved={handleSettingsSaved}
            theme={theme}
            onThemeChange={onThemeChange}
          />
        </React.Suspense>
      )}

      {showNewSession && (
        <NewSessionDialog
          onConfirm={() => handleNewSessionConfirm(false)}
          onClearAndConfirm={() => handleNewSessionConfirm(true)}
          onCancel={() => setShowNewSession(false)}
        />
      )}
    </div>
  );
}

// ── Host Manager Panel ────────────────────────────────────────────────────

interface HostManagerProps {
  currentConfig: ConnectConfig;
  onConnect: (cfg: ConnectConfig) => void;
}

interface SavedHost {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  privateKey: string;
  group: string;
  lastConnectedAt: string | null;
}

function HostManagerPanel({ currentConfig, onConnect }: HostManagerProps) {
  const [hosts, setHosts] = useState<SavedHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/hosts')
      .then(r => r.json())
      .then(data => { setHosts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = search
    ? hosts.filter(h =>
        h.name.toLowerCase().includes(search.toLowerCase()) ||
        h.host.toLowerCase().includes(search.toLowerCase()) ||
        h.username.toLowerCase().includes(search.toLowerCase())
      )
    : hosts;

  // Group by group field
  const groups = new Map<string, SavedHost[]>();
  for (const h of filtered) {
    const g = h.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(h);
  }

  function handleConnect(host: SavedHost) {
    // Update lastConnectedAt in the background
    fetch('/api/hosts/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: host.id, host: host.host, port: host.port, username: host.username }),
    }).catch(() => {});
    onConnect({
      host: host.host,
      port: host.port,
      username: host.username,
      password: host.password,
      privateKey: host.privateKey,
      name: host.name,
      hostId: host.id,
    } as ConnectConfig);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-terminal-border/50">
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398l3.85 3.85a1 1 0 0 0 1.415-1.415l-3.868-3.833zM6.5 11a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索主机..."
            className="w-full bg-terminal-bg border border-terminal-border rounded-md pl-7 pr-3 py-1 text-xs text-terminal-text outline-none focus:border-terminal-blue/50 placeholder:text-terminal-muted"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center h-20 text-terminal-muted text-xs">
            加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 text-terminal-muted gap-1">
            <Server className="w-5 h-5 opacity-30" />
            <span className="text-xs">{search ? '无匹配主机' : '暂无保存的主机'}</span>
          </div>
        ) : (
          Array.from(groups.entries()).map(([group, groupHosts]) => (
            <div key={group}>
              {group && (
                <div className="px-3 py-1 text-[10px] text-terminal-muted font-medium uppercase tracking-wide">
                  {group}
                </div>
              )}
              {groupHosts.map(host => {
                const isCurrent = host.host === currentConfig.host &&
                  host.username === currentConfig.username &&
                  host.port === currentConfig.port;
                return (
                  <button
                    key={host.id}
                    onClick={() => handleConnect(host)}
                    className={`w-full text-left px-3 py-2 hover:bg-terminal-border/30 transition-colors group ${
                      isCurrent ? 'bg-terminal-blue/5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCurrent ? 'bg-terminal-green' : 'bg-terminal-border'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-terminal-text truncate font-medium">{host.name}</span>
                          {isCurrent && (
                            <span className="text-[9px] text-terminal-green bg-terminal-green/10 px-1 rounded">当前</span>
                          )}
                        </div>
                        <div className="text-[10px] text-terminal-muted truncate">
                          {host.username}@{host.host}:{host.port}
                        </div>
                      </div>
                      <ChevronRight className="w-3 h-3 text-terminal-muted opacity-0 group-hover:opacity-100 flex-shrink-0" />
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="px-3 py-2 border-t border-terminal-border/50 text-[10px] text-terminal-muted">
        {filtered.length} 台主机 · 点击在新标签页中打开
      </div>
    </div>
  );
}
