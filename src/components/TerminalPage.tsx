import React, {
  useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo,
} from 'react';
import AIReply from './AIReply';
import CommandCard from './CommandCard';
import Sidebar, { type SidebarPanel } from './Sidebar';
import SidePanel from './SidePanel';
import StatusBar from './StatusBar';
import FileManager from './FileManager';
import { AnsiConverter } from '../utils/ansi';
import {
  RefreshCw, AlertCircle, Clipboard, Activity,
} from 'lucide-react';
import type { Block, ConnectConfig, ServerMsg, Risk, CommandCardStatus, Theme } from '../types';
import { DEFAULT_TERMINAL_SETTINGS } from '../types';

const SettingsPage = React.lazy(() => import('./SettingsPage'));

interface Props {
  config: ConnectConfig;
  onDisconnect: () => void;
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

export default function TerminalPage({ config, onDisconnect, theme, onThemeChange }: Props) {
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

  // Terminal display settings (from localStorage)
  const [termSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('terminal-settings');
      return raw ? { ...DEFAULT_TERMINAL_SETTINGS, ...JSON.parse(raw) } : DEFAULT_TERMINAL_SETTINGS;
    } catch { return DEFAULT_TERMINAL_SETTINGS; }
  });

  // Command history for clipboard panel + arrow key navigation
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Ctrl+R reverse search state
  const [searchMode, setSearchMode] = useState(false);
  const [searchResultIdx, setSearchResultIdx] = useState(0);
  const savedInputRef = useRef(''); // save input before entering search mode

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const converterRef = useRef(new AnsiConverter());
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingStartRef = useRef<number>(0);
  // For cursor position restoration after Ctrl+U / Ctrl+W
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
      appendTerminalHtml('\r\n<span style="color:#f85149">WebSocket 连接失败</span>\r\n');
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
          `<span style="color:#3fb950">Connected to ${msg.payload.host} as ${msg.payload.username}</span>\r\n`
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
        const color = msg.payload.level === 'error' ? '#f85149' : '#484f58';
        appendTerminalHtml(
          `<span style="color:${color};font-style:italic">▸ ${msg.payload.message}</span>\r\n`
        );
        break;
      }

      case 'ai_not_configured': {
        appendTerminalHtml(
          `<span style="color:#d29922">⚠ AI 未配置，请先在设置中配置 AI 服务才能使用自然语言功能</span>\r\n`
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
        appendTerminalHtml('\r\n<span style="color:#8b949e">Connection closed.</span>\r\n');
        break;
      }

      case 'session_cleared': {
        appendTerminalHtml(
          '\r\n<span style="color:#30363d;border-top:1px solid #30363d">─────────────── 新 AI 会话 ───────────────</span>\r\n'
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
          `\r\n<span style="color:#f85149">错误: ${msg.payload.message}</span>\r\n`
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

  // History navigation helper (shared by ArrowUp/Ctrl+P and ArrowDown/Ctrl+N)
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

  // Search mode handlers
  function enterSearchMode() {
    savedInputRef.current = input;
    setInput('');
    setHistoryIndex(-1);
    setSearchResultIdx(0);
    setSearchMode(true);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {

    // ── Ctrl+R: enter/cycle search mode ──────────────────────────────────
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      if (!searchMode) {
        enterSearchMode();
      } else {
        // Cycle to next match
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
      // Any other key: reset match index when query changes
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
    if (e.key === 'ArrowRight' && ghostText) {
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

    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      sendWs('raw_input', { data: '\x0c' });
      setBlocks([]);
      return;
    }

    // ── Shell line-editing shortcuts ───────────────────────────────────────

    // Ctrl+A: cursor to start of line
    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      inputRef.current?.setSelectionRange(0, 0);
      return;
    }

    // Ctrl+E: cursor to end of line
    if (e.ctrlKey && e.key === 'e') {
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

  // New session
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

  // Panel toggle
  function handlePanelToggle(panel: SidebarPanel) {
    if (panel === 'settings') {
      setShowSettings(true);
      setActivePanel(null);
    } else {
      setActivePanel(prev => prev === panel ? null : panel);
    }
  }

  // Insert command from clipboard history
  function insertFromHistory(cmd: string) {
    setInput(cmd);
    setHistoryIndex(-1);
    setActivePanel(null);
    inputRef.current?.focus();
  }

  // Tab label
  const tabLabel = config.name
    ? config.name
    : `${connInfo.user || config.username}@${connInfo.host || config.host}`;

  // Prompt display (changes in search mode)
  const displayPrompt = searchMode ? '(搜索) ' : prompt;
  const promptColor = searchMode ? '#39c5cf' : '#3fb950';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-terminal-bg text-terminal-text font-mono overflow-hidden relative">
      <Sidebar activePanel={activePanel} onPanelToggle={handlePanelToggle} />

      {/* Side panels */}
      {activePanel === 'clipboard' && (
        <SidePanel title="命令历史" onClose={() => setActivePanel(null)}>
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
        <SidePanel title="会话信息" onClose={() => setActivePanel(null)}>
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

      {activePanel === 'monitor' && (
        <SidePanel title="系统监控" onClose={() => setActivePanel(null)}>
          <div className="p-3 space-y-2 text-xs text-terminal-muted">
            <p className="text-center py-4">
              <Activity className="w-5 h-5 mx-auto mb-2 opacity-30" />
              输入以下命令查看系统资源
            </p>
            {[
              { label: 'CPU 使用', cmd: 'top -bn1 | head -5' },
              { label: '内存使用', cmd: 'free -h' },
              { label: '磁盘使用', cmd: 'df -h' },
              { label: '进程列表', cmd: 'ps aux | head -15' },
              { label: '网络连接', cmd: 'ss -tunlp' },
            ].map(({ label, cmd }) => (
              <button
                key={cmd}
                onClick={() => { setInput(cmd); setActivePanel(null); inputRef.current?.focus(); }}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-terminal-border/30 text-left transition-colors group"
              >
                <span className="text-terminal-text text-xs">{label}</span>
                <ChevronRight className="w-3 h-3 text-terminal-muted group-hover:text-terminal-text" />
              </button>
            ))}
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

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="flex-shrink-0 flex items-center justify-between bg-terminal-surface border-b border-terminal-border px-3 h-9">
          <div className="flex items-center gap-2">
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
              {/* Ghost text background layer */}
              {ghostText && (
                <div
                  className="absolute inset-0 text-sm font-mono whitespace-pre pointer-events-none overflow-hidden select-none"
                  aria-hidden="true"
                  style={{ lineHeight: '1.25rem' }}
                >
                  <span style={{ visibility: 'hidden' }}>{input}</span>
                  <span style={{ color: '#484f58' }}>{ghostText}</span>
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
                  caretColor: '#3fb950',
                  color: ghostText ? 'transparent' : '#e6edf3',
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
              <span style={{ color: '#39c5cf' }}>→</span>
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

          {/* Ghost text hint */}
          {ghostText && !searchMode && (
            <div className="text-[10px] text-terminal-muted mt-0.5 select-none">
              Tab 补全
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
