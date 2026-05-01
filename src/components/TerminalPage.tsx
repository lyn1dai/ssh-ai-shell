import React, {
  useState, useEffect, useRef, useCallback, useLayoutEffect,
} from 'react';
import AIReply from './AIReply';
import CommandCard from './CommandCard';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import { AnsiConverter } from '../utils/ansi';
import type { Block, ConnectConfig, ServerMsg, Risk, CommandCardStatus } from '../types';

interface Props {
  config: ConnectConfig;
  onDisconnect: () => void;
}

// Detect shell prompt and extract context
function parsePrompt(text: string): { prompt: string; user: string; host: string } | null {
  const m1 = text.match(/\[([^@\]]+)@([^\s\]]+)\s+([^\]]+)\][\$#]\s*$/m);
  if (m1) return { prompt: `[${m1[1]}@${m1[2]} ${m1[3]}]$ `, user: m1[1], host: `${m1[1]}@${m1[2]}` };
  const m2 = text.match(/([^@\s]+)@([^:]+):([^\$#\s]+)[\$#]\s*$/m);
  if (m2) return { prompt: `${m2[1]}@${m2[2]}:${m2[3]}$ `, user: m2[1], host: `${m2[1]}@${m2[2]}` };
  return null;
}

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2)}`; }

export default function TerminalPage({ config, onDisconnect }: Props) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState('$ ');
  const [connInfo, setConnInfo] = useState({ host: '', user: '' });
  const [latency, setLatency] = useState(0);
  const [termSize, setTermSize] = useState({ rows: 24, cols: 80 });
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 11));

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const converterRef = useRef(new AnsiConverter());
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingStartRef = useRef<number>(0);

  // Auto-scroll
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  useLayoutEffect(() => { scrollToBottom(); }, [blocks]);

  // Observe terminal container size and update rows/cols
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const charW = 8.4;  // approx mono char width at text-sm
      const charH = 20;   // approx mono line height
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
    setBlocks(prev => {
      // Before adding AI blocks, close any open terminal block gap
      return [...prev, block];
    });
  }

  function updateBlock<T extends Block>(id: string, updater: (b: T) => T) {
    setBlocks(prev => prev.map(b => b.id === id ? updater(b as T) as Block : b));
  }

  // Track current streaming AI reply id
  const aiReplyIdRef = useRef<string | null>(null);
  const lastFeedbackBlockIdRef = useRef<string | null>(null);

  // ── WebSocket ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'connect', payload: config }));
      // Start latency ping
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
        appendTerminalHtml(
          `<span style="color:#3fb950">Connected to ${msg.payload.host} as ${msg.payload.username}</span>\r\n`
        );
        break;
      }

      case 'terminal_output': {
        const raw = msg.payload.data;
        const html = converterRef.current.convert(raw);
        appendTerminalHtml(html);
        // Try to extract prompt
        const ctx = parsePrompt(raw);
        if (ctx) {
          setPrompt(ctx.prompt);
          setConnInfo(prev => ({ ...prev, host: ctx.host }));
        }
        break;
      }

      case 'ai_thinking': {
        // Start a new AI reply block (empty = shows loading dots)
        // First, ensure terminal block is "closed" so AI block starts fresh
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
            ...b,
            text: b.text + msg.payload.text,
          }));
        }
        break;
      }

      case 'ai_reply_end': {
        const id = aiReplyIdRef.current;
        if (id) {
          updateBlock<Extract<Block, { type: 'ai_reply' }>>(id, b => ({
            ...b,
            complete: true,
          }));
          aiReplyIdRef.current = null;
        }
        inputRef.current?.focus();
        break;
      }

      case 'command_card': {
        const { commandId, command, risk } = msg.payload;
        addBlock({
          id: `card_${commandId}`,
          type: 'command_card',
          commandId,
          command,
          risk: risk as Risk,
          status: 'pending',
        });
        break;
      }

      case 'command_auto_approve': {
        const { commandId } = msg.payload;
        setBlocks(prev => prev.map(b =>
          b.type === 'command_card' && b.commandId === commandId
            ? { ...b, status: 'approved' as CommandCardStatus }
            : b
        ));
        break;
      }

      case 'command_executing': {
        const { commandId } = msg.payload;
        setBlocks(prev => prev.map(b =>
          b.type === 'command_card' && b.commandId === commandId
            ? { ...b, status: 'executing' as CommandCardStatus }
            : b
        ));
        break;
      }

      case 'command_done': {
        const { commandId } = msg.payload;
        setBlocks(prev => prev.map(b =>
          b.type === 'command_card' && b.commandId === commandId
            ? { ...b, status: 'done' as CommandCardStatus }
            : b
        ));
        break;
      }

      case 'disconnected': {
        setConnected(false);
        appendTerminalHtml('\r\n<span style="color:#8b949e">Connection closed.</span>\r\n');
        break;
      }

      case 'session_cleared': {
        // Visual separator for new session
        appendTerminalHtml(
          '\r\n<span style="color:#30363d">─────────────── 新会话 ───────────────</span>\r\n'
        );
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

  function send(type: string, payload: object = {}) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.trim();
      setInput('');
      if (!connected) return;
      send('input', { text });
      // Show user input in terminal stream immediately
      appendTerminalHtml(
        `<span style="color:#e6edf3">${escapeHtml(text)}</span>\r\n`
      );
    }
    // Ctrl+C
    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      send('raw_input', { data: '\x03' });
    }
    // Ctrl+D
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      send('raw_input', { data: '\x04' });
    }
    // Ctrl+L → clear terminal
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      send('raw_input', { data: '\x0c' });
      setBlocks([]);
    }
    // Tab
    if (e.key === 'Tab') {
      e.preventDefault();
      send('raw_input', { data: '\t' });
    }
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Command card actions
  function handleConfirm(commandId: string, command: string) {
    setBlocks(prev => prev.map(b =>
      b.type === 'command_card' && b.commandId === commandId
        ? { ...b, status: 'executing' as CommandCardStatus }
        : b
    ));
    send('command_confirm', { commandId, command });
  }

  function handleReject(commandId: string) {
    setBlocks(prev => prev.map(b =>
      b.type === 'command_card' && b.commandId === commandId
        ? { ...b, status: 'rejected' as CommandCardStatus }
        : b
    ));
    send('command_reject', { commandId });
  }

  function handleNewSession() {
    send('new_session', {});
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-terminal-bg text-terminal-text font-mono overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="flex-shrink-0 flex items-center justify-between bg-terminal-surface border-b border-terminal-border px-3 h-9">
          <div className="flex items-center gap-2">
            {/* Tab */}
            <div className="flex items-center gap-1.5 bg-terminal-bg border border-terminal-border rounded-md px-2.5 py-1 text-xs text-terminal-text">
              <span className="w-1.5 h-1.5 rounded-full bg-terminal-green" />
              <span>{connInfo.user}{connInfo.host ? `@${connInfo.host.split('@')[1] || connInfo.host}` : ''}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {latency > 0 && (
              <span className="text-[11px] text-terminal-muted">{latency} ms</span>
            )}
            <button
              onClick={() => { send('disconnect', {}); onDisconnect(); }}
              className="text-[11px] text-terminal-muted hover:text-terminal-red transition-colors"
            >
              断开
            </button>
          </div>
        </div>

        {/* ── Main scroll area: all blocks ─────────────────────────────────── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-0.5 scroll-smooth"
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
                    onNewSession={block.complete ? handleNewSession : undefined}
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

          {/* Padding at bottom so input doesn't cover content */}
          <div className="h-2" />
        </div>

        {/* ── Input bar ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-terminal-border bg-terminal-bg">
          <div className="flex items-center px-3 py-2 gap-1">
            {/* Prompt prefix */}
            <span className="text-terminal-green text-sm select-none flex-shrink-0 truncate max-w-xs">
              {prompt}
            </span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={connected ? '输入自然语言或命令，AI将智能响应，试试打个招呼吧' : '正在连接…'}
              disabled={!connected}
              className="flex-1 bg-transparent outline-none text-terminal-text text-sm placeholder-terminal-muted/40 caret-terminal-green disabled:opacity-40"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        </div>

        <StatusBar
          connected={connected}
          host={connInfo.host}
          latencyMs={latency}
          rows={termSize.rows}
          cols={termSize.cols}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}
