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
import TerminalContextMenu from './TerminalContextMenu';
import { AnsiConverter } from '../utils/ansi';
import {
  RefreshCw, AlertCircle, AlertTriangle, Clipboard, ClipboardPaste, ChevronRight,
  Server, BookMarked, Settings2, Search, Trash2, Play, Copy, Square, X, SendHorizonal, Download,
} from 'lucide-react';
import type { Block, ConnectConfig, ServerMsg, Risk, CommandCardStatus, Theme, SavedCommand, CommandHistoryEntry, AutoApproveRule } from '../types';
import { DEFAULT_TERMINAL_SETTINGS } from '../types';

const SettingsPage = React.lazy(() => import('./SettingsPage'));

const PASTEBOARD_MIN_HEIGHT = 160;
const PASTEBOARD_DEFAULT_HEIGHT = 280;

interface Props {
  config: ConnectConfig;
  onDisconnect: () => void;
  onNewTab?: (config: ConnectConfig) => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  /** When set, execute this saved command (nonce distinguishes repeated runs). */
  pendingCommand?: { cmd: SavedCommand; nonce: number };
  /** False when this pane was created by a split (hides settings/userinfo/hosts in sidebar). */
  isPrimary?: boolean;
  /** Split the current pane in the given direction / position. */
  onSplitPane?: (direction: 'horizontal' | 'vertical', position?: 'after' | 'before') => void;
}

// Strip ANSI escape sequences (color codes etc.) from a string
function stripAnsiCodes(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
}

const COMMAND_WRAPPERS = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'nice', 'xargs']);
const COMMON_COMMANDS = [
  'ls', 'll', 'cd', 'pwd', 'cat', 'less', 'more', 'head', 'tail', 'grep', 'find',
  'mkdir', 'rm', 'cp', 'mv', 'touch', 'stat', 'du', 'file', 'tree', 'clear',
  'git', 'ssh', 'scp', 'rsync', 'curl', 'wget', 'ping',
  'docker', 'docker-compose', 'kubectl', 'helm',
  'node', 'npm', 'pnpm', 'yarn', 'python', 'python3',
  'vim', 'vi', 'nano', 'top', 'htop', 'ps', 'source',
];
const PREFERRED_COMMAND_SHORTCUTS = new Map<string, string>([
  ['l', 'ls'],
]);
const PATH_OPTION_FLAGS = new Set([
  '-f', '--file', '--files', '--filename', '--config', '--config-file', '--compose-file',
  '-C', '--directory', '--dir', '--root', '--cwd', '--work-tree', '--git-dir',
  '-o', '--output', '--out', '-i', '--input', '--log-file', '--pid-file',
  '-k', '--kustomize', '-L', '--chdir', '--cert', '--key', '--cacert', '--capath',
  '--env-file', '--from-file', '--values', '--set-file', '--manifest', '--inventory',
]);
const ATTACHED_PATH_OPTION_FLAGS = new Set(['-C', '-f', '-o', '-i']);
const ALWAYS_PATH_ARGUMENT_COMMANDS = new Set([
  'cd', 'ls', 'll', 'la', 'dir', 'tree',
  'cat', 'less', 'more', 'head', 'tail', 'sed', 'awk', 'grep',
  'vi', 'vim', 'nano', 'emacs', 'code',
  'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'stat', 'du', 'file', 'realpath',
  'ln', 'unzip', 'zip', 'source', '.',
  'python', 'python3', 'node', 'bash', 'sh', 'zsh', 'perl', 'ruby',
  'scp', 'rsync',
]);
const PATH_AFTER_FIRST_ARGUMENT_COMMANDS = new Set([
  'chmod', 'chown', 'chgrp', 'find', 'tar',
]);
const GIT_PATH_SUBCOMMANDS = new Set([
  'add', 'rm', 'mv', 'restore', 'grep', 'ls-files', 'archive', 'checkout-index',
]);
const DOCKER_PATH_SUBCOMMANDS = new Set(['build', 'cp']);
const DOCKER_COMPOSE_PATH_SUBCOMMANDS = new Set(['build', 'cp']);
const KUBECTL_FILE_SUBCOMMANDS = new Set(['apply', 'create', 'replace', 'delete', 'patch', 'diff']);

function htmlToPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.innerText || div.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, '    ');
}

function plainTextToTerminalHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ {2,}/g, s => '&nbsp;'.repeat(s.length))
    .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/\n/g, '<br>');
}

function wrapTerminalLines(lines: string[], columns: number): string[] {
  const width = Math.max(1, columns);
  const wrapped: string[] = [];

  for (const line of lines) {
    if (!line.length) {
      wrapped.push('');
      continue;
    }

    for (let i = 0; i < line.length; i += width) {
      wrapped.push(line.slice(i, i + width));
    }
  }

  return wrapped;
}

function parsePrompt(text: string): { prompt: string; user: string; host: string; cwd: string } | null {
  const m1 = text.match(/\[([^@\]]+)@([^\s\]]+)\s+([^\]]+)\]([$#])\s*$/m);
  if (m1) {
    const cwd = stripAnsiCodes(m1[3]);
    return { prompt: `[${m1[1]}@${m1[2]} ${m1[3]}]${m1[4]} `, user: stripAnsiCodes(m1[1]), host: `${stripAnsiCodes(m1[1])}@${stripAnsiCodes(m1[2])}`, cwd };
  }
  const m2 = text.match(/([^@\s]+)@([^:]+):([^$#\s]+)([$#])\s*$/m);
  if (m2) {
    const cwd = stripAnsiCodes(m2[3]);
    return { prompt: `${m2[1]}@${m2[2]}:${m2[3]}${m2[4]} `, user: stripAnsiCodes(m2[1]), host: `${stripAnsiCodes(m2[1])}@${stripAnsiCodes(m2[2])}`, cwd };
  }
  return null;
}

function normalizeFileManagerPath(path: string | null | undefined): string {
  const value = (path || '').trim();
  if (!value) return '~';
  if (value.startsWith('/') || value === '~' || value.startsWith('~/')) return value;
  if (value === '.' || value === '..' || value.startsWith('./') || value.startsWith('../')) return '~';
  return `~/${value.replace(/^\/+/, '')}`;
}

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2)}`; }

const DEFAULT_HIGH_RISK_RULES: AutoApproveRule[] = [
  { id: 'highrisk_default_0', pattern: 'sudo *', enabled: true, description: '提权执行' },
  { id: 'highrisk_default_1', pattern: 'su', enabled: true, description: '切换用户' },
  { id: 'highrisk_default_2', pattern: 'su *', enabled: true, description: '切换用户带参数' },
  { id: 'highrisk_default_3', pattern: 'doas *', enabled: true, description: '提权执行' },
  { id: 'highrisk_default_4', pattern: 'passwd *', enabled: true, description: '修改账户密码' },
  { id: 'highrisk_default_5', pattern: 'userdel *', enabled: true, description: '删除用户' },
  { id: 'highrisk_default_6', pattern: 'usermod *', enabled: true, description: '修改用户配置' },
  { id: 'highrisk_default_7', pattern: 'groupdel *', enabled: true, description: '删除用户组' },
  { id: 'highrisk_default_8', pattern: 'rm *', enabled: true, description: '删除文件/目录' },
  { id: 'highrisk_default_9', pattern: 'dd *', enabled: true, description: '磁盘覆盖/复制' },
  { id: 'highrisk_default_10', pattern: 'mkfs *', enabled: true, description: '格式化文件系统' },
  { id: 'highrisk_default_11', pattern: 'wipefs *', enabled: true, description: '擦除文件系统签名' },
  { id: 'highrisk_default_12', pattern: 'shred *', enabled: true, description: '安全擦除文件' },
  { id: 'highrisk_default_13', pattern: 'fdisk *', enabled: true, description: '磁盘分区' },
  { id: 'highrisk_default_14', pattern: 'parted *', enabled: true, description: '磁盘分区' },
  { id: 'highrisk_default_15', pattern: 'cfdisk *', enabled: true, description: '磁盘分区' },
  { id: 'highrisk_default_16', pattern: 'truncate *', enabled: true, description: '截断文件' },
  { id: 'highrisk_default_17', pattern: 'chmod -R *', enabled: true, description: '递归修改权限' },
  { id: 'highrisk_default_18', pattern: 'chown -R *', enabled: true, description: '递归修改属主' },
  { id: 'highrisk_default_19', pattern: 'kill *', enabled: true, description: '终止进程' },
  { id: 'highrisk_default_20', pattern: 'killall *', enabled: true, description: '终止同名进程' },
  { id: 'highrisk_default_21', pattern: 'pkill *', enabled: true, description: '按模式终止进程' },
  { id: 'highrisk_default_22', pattern: 'reboot', enabled: true, description: '重启系统' },
  { id: 'highrisk_default_23', pattern: 'shutdown *', enabled: true, description: '关机/重启' },
  { id: 'highrisk_default_24', pattern: 'halt', enabled: true, description: '停止系统' },
  { id: 'highrisk_default_25', pattern: 'poweroff', enabled: true, description: '关闭电源' },
  { id: 'highrisk_default_26', pattern: '/^init\s*[016](\s|$)/', enabled: true, description: '切换运行级别' },
  { id: 'highrisk_default_27', pattern: 'systemctl stop *', enabled: true, description: '停止服务' },
  { id: 'highrisk_default_28', pattern: 'systemctl disable *', enabled: true, description: '禁用服务' },
  { id: 'highrisk_default_29', pattern: 'systemctl mask *', enabled: true, description: '屏蔽服务' },
  { id: 'highrisk_default_30', pattern: 'systemctl kill *', enabled: true, description: '强制停止服务' },
  { id: 'highrisk_default_31', pattern: 'iptables *', enabled: true, description: '修改防火墙规则' },
  { id: 'highrisk_default_32', pattern: 'ufw disable', enabled: true, description: '关闭防火墙' },
  { id: 'highrisk_default_33', pattern: 'ufw delete *', enabled: true, description: '删除防火墙规则' },
  { id: 'highrisk_default_34', pattern: 'docker stop *', enabled: true, description: '停止容器' },
  { id: 'highrisk_default_35', pattern: 'docker kill *', enabled: true, description: '强制终止容器' },
  { id: 'highrisk_default_36', pattern: 'docker rm *', enabled: true, description: '删除容器' },
  { id: 'highrisk_default_37', pattern: 'docker rmi *', enabled: true, description: '删除镜像' },
  { id: 'highrisk_default_38', pattern: 'docker compose down *', enabled: true, description: '停止并删除 Compose 资源' },
  { id: 'highrisk_default_39', pattern: 'docker compose rm *', enabled: true, description: '删除 Compose 容器' },
  { id: 'highrisk_default_40', pattern: 'kubectl delete *', enabled: true, description: '删除 Kubernetes 资源' },
  { id: 'highrisk_default_41', pattern: 'kubectl scale *', enabled: true, description: '调整副本数量' },
  { id: 'highrisk_default_42', pattern: 'helm uninstall *', enabled: true, description: '卸载 Helm 发布' },
  { id: 'highrisk_default_43', pattern: 'crontab -r', enabled: true, description: '删除当前用户定时任务' },
  { id: 'highrisk_default_44', pattern: '/^curl\\b.*\\|\\s*(bash|sh|zsh|fish)(\\s|$)/', enabled: true, description: '管道执行脚本' },
  { id: 'highrisk_default_45', pattern: '/^wget\\b.*\\|\\s*(bash|sh)(\\s|$)/', enabled: true, description: '管道执行脚本' },
];

function matchesCommandPattern(pattern: string, command: string): boolean {
  const p = pattern.trim();
  const t = command.trim();
  if (p.startsWith('/') && p.endsWith('/') && p.length > 2) {
    try { return new RegExp(p.slice(1, -1)).test(t); } catch { return false; }
  }
  if (p.includes('*')) {
    const re = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${re}$`).test(t);
  }
  if (p === t) return true;
  return t.startsWith(p) && /\s/.test(t.charAt(p.length));
}

function isHighRiskCommand(cmd: string, highRiskRules: AutoApproveRule[]): boolean {
  return highRiskRules.some(rule => rule.enabled && matchesCommandPattern(rule.pattern, cmd));
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}小时前`;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === yesterday.toDateString())
    return '昨天 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function parseLogicalCommands(text: string): string[] {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const commands: string[] = [];
  let current = '';

  for (const line of rawLines) {
    const trimmedLine = line.trimEnd();
    if (trimmedLine.endsWith('\\')) {
      current += trimmedLine.slice(0, -1);
    } else {
      current += line;
      if (current.trim()) commands.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) commands.push(current.trim());
  return commands;
}

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

export default function TerminalPage({ config, onDisconnect, onNewTab, theme, onThemeChange, pendingCommand, isPrimary = true, onSplitPane }: Props) {
  type RectSelectionBlock = {
    id: string;
    active: boolean;
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
    text: string;
  };

  type DangerConfirmState = { source: 'input'; command: string };

  type CompletionItem = { name: string; isDir: boolean };

  type CompletionRequestContext = {
    word: string;
    lookupWord: string;
    replacePrefix: string;
    wordStart: number;
    cursorPos: number;
    type: 'command' | 'path';
    revealListOnResolve: boolean;
  };

  type CompletionCycleState = {
    baseInput: string;
    items: CompletionItem[];
    index: number;
    ctx: Pick<CompletionRequestContext, 'word' | 'lookupWord' | 'replacePrefix' | 'wordStart' | 'cursorPos' | 'type'>;
  };

  const terminalRootRef = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState('');
  const [inputSelection, setInputSelection] = useState({ start: 0, end: 0 });
  const [inputScrollLeft, setInputScrollLeft] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState('$ ');
  const [cwd, setCwd] = useState('');
  const [connInfo, setConnInfo] = useState({ host: '', user: '' });
  const [latency, setLatency] = useState(0);
  const [termSize, setTermSize] = useState({ rows: 24, cols: 80 });
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 11));
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'general' | 'terminal' | 'shortcuts' | 'ai' | 'data' | 'about' | 'commands'>('general');
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [aiConfigured, setAIConfigured] = useState<boolean | null>(null);
  const [sessionToken, setSessionToken] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [configExportNotice, setConfigExportNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  // Inline side-panel width (persisted); shared across all activePanel tabs
  const [sidePanelWidth, setSidePanelWidth] = useState<number>(() => {
    try {
      const s = localStorage.getItem('side-panel-width');
      if (s) return Math.max(220, Math.min(900, parseInt(s, 10)));
    } catch {}
    return 300;
  });

  // ── File manager initial path resolution ─────────────────────────────────
  // null   = panel closed / still resolving
  // string = ready ('' means "use SFTP home")
  const [fileMgrInitPath, setFileMgrInitPath] = useState<string | null>(null);

  // ── Context menu ──────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null);

  // AI mode toggles (persisted in localStorage)
  const [aiModeEnabled, setAiModeEnabled] = useState(() => {
    try { return localStorage.getItem('terminal-ai-mode') !== 'false'; } catch { return true; }
  });
  const [aiAssistantEnabled, setAiAssistantEnabled] = useState(false);
  const [aiExplainEnabled, setAiExplainEnabled] = useState(false);

  // Copy/paste history
  const [appendToCopyHistory, setAppendToCopyHistory] = useState(() => {
    try { return localStorage.getItem('terminal-append-copy-history') === 'true'; } catch { return false; }
  });
  const [copyHistory, setCopyHistory] = useState<string[]>(() => {
    try { const r = localStorage.getItem('terminal-copy-history'); return r ? JSON.parse(r) : []; } catch { return []; }
  });
  const [pasteHistory, setPasteHistory] = useState<string[]>(() => {
    try { const r = localStorage.getItem('terminal-paste-history'); return r ? JSON.parse(r) : []; } catch { return []; }
  });
  const [showCopyHistoryPanel, setShowCopyHistoryPanel] = useState(false);
  const [showPasteHistoryPanel, setShowPasteHistoryPanel] = useState(false);
  const [highRiskRules, setHighRiskRules] = useState<AutoApproveRule[]>(DEFAULT_HIGH_RISK_RULES);

  // Current character set (locale.encoding)
  const [charset, setCharset] = useState('en_US.UTF-8');

  // Pasteboard (multi-line paste panel)
  const [showPasteboard, setShowPasteboard] = useState(false);
  const [pasteboardText, setPasteboardText] = useState('');
  const [pasteboardHeight, setPasteboardHeight] = useState(() => {
    try {
      const raw = localStorage.getItem('terminal-pasteboard-height');
      if (raw) {
        const parsed = parseInt(raw, 10);
        if (Number.isFinite(parsed)) return Math.max(PASTEBOARD_MIN_HEIGHT, parsed);
      }
    } catch {}
    return PASTEBOARD_DEFAULT_HEIGHT;
  });
  const pasteboardRef = useRef<HTMLTextAreaElement>(null);
  const lastAutoCopiedSelectionRef = useRef('');
  const suppressNextTerminalClickRef = useRef(false);
  const [rectSelections, setRectSelections] = useState<RectSelectionBlock[]>([]);
  const rectSelectionsRef = useRef<RectSelectionBlock[]>([]);
  const activeRectSelectionIdRef = useRef<string | null>(null);

  // True while a command is running (from Enter → until server prompt returns)
  const [waiting, setWaiting] = useState(false);

  // Non-null while a directly entered dangerous command is waiting for confirmation.
  const [dangerPending, setDangerPending] = useState<DangerConfirmState | null>(null);

  // Sequential command queue (filled by pasteboard "发送" or direct multi-line paste)
  const cmdQueueRef = useRef<string[]>([]);
  // Non-null while the queue is draining: { current: 1-based index, total }
  const [queueStatus, setQueueStatus] = useState<{ current: number; total: number } | null>(null);

  // Saved commands
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);

  // Command history (persisted per host)
  const [historyEntries, setHistoryEntries] = useState<CommandHistoryEntry[]>([]);
  const [historySearch, setHistorySearch] = useState('');

  // Current AI step status — shown inside the active AIReply bubble
  const [aiStatusLine, setAIStatusLine] = useState('');
  // True while AI is streaming (used to show Stop button and route Ctrl+C)
  const [aiGenerating, setAiGenerating] = useState(false);

  // Terminal display settings (from localStorage, reactive to changes)
  const [termSettings, setTermSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('terminal-settings');
      return raw ? { ...DEFAULT_TERMINAL_SETTINGS, ...JSON.parse(raw) } : DEFAULT_TERMINAL_SETTINGS;
    } catch { return DEFAULT_TERMINAL_SETTINGS; }
  });
  const terminalFontFamily = useMemo(
    () => `'${termSettings.fontFamily}', 'JetBrains Mono', monospace`,
    [termSettings.fontFamily],
  );
  const terminalTextStyle = useMemo(() => {
    const style: React.CSSProperties & { ['--terminal-bold-font-weight']?: string } = {
      fontSize: `${termSettings.fontSize}px`,
      fontFamily: terminalFontFamily,
      lineHeight: termSettings.lineHeight,
      letterSpacing: termSettings.letterSpacing ? `${termSettings.letterSpacing}px` : undefined,
      fontWeight: termSettings.fontWeight,
    };
    style['--terminal-bold-font-weight'] = termSettings.boldFontWeight;
    return style;
  }, [
    termSettings.boldFontWeight,
    termSettings.fontSize,
    termSettings.fontWeight,
    termSettings.letterSpacing,
    termSettings.lineHeight,
    terminalFontFamily,
  ]);

  const syncInputSelectionState = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const scrollLeft = el.scrollLeft ?? 0;
    setInputSelection(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
    setInputScrollLeft(prev => (prev === scrollLeft ? prev : scrollLeft));
  }, []);

  const measureTerminalTextWidth = useCallback((text: string) => {
    if (!text) return 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.font = `${termSettings.fontWeight} ${termSettings.fontSize}px ${terminalFontFamily}`;
    const measured = ctx?.measureText(text).width ?? text.length * termSettings.fontSize * 0.62;
    const letterSpacing = termSettings.letterSpacing ?? 0;
    return measured + Math.max(0, text.length - 1) * letterSpacing;
  }, [termSettings.fontSize, termSettings.fontWeight, termSettings.letterSpacing, terminalFontFamily]);
  const terminalMetrics = useMemo(() => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.font = `${termSettings.fontWeight} ${termSettings.fontSize}px ${terminalFontFamily}`;
    const measured = ctx?.measureText('M').width ?? termSettings.fontSize * 0.62;
    const letterSpacing = termSettings.letterSpacing ?? 0;
    return {
      charWidth: Math.max(1, measured + letterSpacing),
      lineHeightPx: termSettings.fontSize * termSettings.lineHeight,
      paddingX: 12,
      paddingY: 8,
    };
  }, [terminalFontFamily, termSettings.fontSize, termSettings.fontWeight, termSettings.letterSpacing, termSettings.lineHeight]);
  const showCustomCursor = inputFocused && inputSelection.start === inputSelection.end;
  const cursorTextOffset = useMemo(
    () => measureTerminalTextWidth(input.slice(0, inputSelection.start)) - inputScrollLeft,
    [input, inputScrollLeft, inputSelection.start, measureTerminalTextWidth],
  );
  const cursorGlyphWidth = useMemo(() => {
    if (termSettings.cursorStyle === 'bar') return 2;
    const glyph = input[inputSelection.start] || ' ';
    return Math.max(termSettings.cursorStyle === 'block' ? terminalMetrics.charWidth : 8, measureTerminalTextWidth(glyph) || terminalMetrics.charWidth);
  }, [input, inputSelection.start, measureTerminalTextWidth, termSettings.cursorStyle, terminalMetrics.charWidth]);
  const cursorVisualStyle = useMemo<React.CSSProperties>(() => {
    const baseHeight = Math.max(12, terminalMetrics.lineHeightPx - 2);
    const base: React.CSSProperties = {
      position: 'absolute',
      left: `${Math.max(0, cursorTextOffset)}px`,
      pointerEvents: 'none',
      opacity: 1,
      animation: termSettings.cursorBlink ? 'terminal-cursor-blink 1s steps(1, end) infinite' : undefined,
    };

    if (termSettings.cursorStyle === 'underline') {
      return {
        ...base,
        width: `${cursorGlyphWidth}px`,
        height: '2px',
        bottom: '2px',
        background: 'rgb(var(--tw-c-green))',
      };
    }

    return {
      ...base,
      width: `${cursorGlyphWidth}px`,
      height: `${baseHeight}px`,
      top: '50%',
      transform: 'translateY(-50%)',
      background: termSettings.cursorStyle === 'block'
        ? 'rgba(var(--tw-c-green), 0.35)'
        : 'rgb(var(--tw-c-green))',
      border: termSettings.cursorStyle === 'block' ? '1px solid rgb(var(--tw-c-green))' : undefined,
    };
  }, [cursorGlyphWidth, cursorTextOffset, termSettings.cursorBlink, termSettings.cursorStyle, terminalMetrics.lineHeightPx]);

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

  // Tab completion state
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionWord, setCompletionWord] = useState('');
  const [completionReplacePrefix, setCompletionReplacePrefix] = useState('');
  const [completionWordStart, setCompletionWordStart] = useState(0);
  const [completionCursorPos, setCompletionCursorPos] = useState(0);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionPopupLayout, setCompletionPopupLayout] = useState({
    alignRight: false,
    width: 280,
    maxHeight: 320,
    rowsPerColumn: 8,
  });
  const [completionFilter, setCompletionFilter] = useState('');
  const [tabFeedback, setTabFeedback] = useState<'nomatch' | null>(null);
  // Ref stores pending context for when complete_result arrives (avoids stale closure)
  const completionCtxRef = useRef<CompletionRequestContext | null>(null);
  const lastTabRequestRef = useRef<{
    input: string;
    cursorPos: number;
    word: string;
    type: 'command' | 'path';
    at: number;
  } | null>(null);
  const tabFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionCycleRef = useRef<CompletionCycleState | null>(null);
  const completionsListRef = useRef<HTMLDivElement>(null);
  const completionAnchorRef = useRef<HTMLDivElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activePanelRef = useRef<SidebarPanel>(null);
  const cwdRef = useRef('');
  const converterRef = useRef(new AnsiConverter());
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingStartRef = useRef<number>(0);
  const nextCursorRef = useRef<number | null>(null);

  // Echo suppression: track the command we just sent so we can strip the
  // server's echo when it arrives (bash readline sends echo back even with
  // ECHO:0 PTY mode in some configurations, and it may arrive after output).
  const pendingEchoRef = useRef('');
  const pendingEchoChunksRef = useRef(0);
  const pendingEchoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore cursor position after state-driven input changes
  useLayoutEffect(() => {
    if (nextCursorRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(nextCursorRef.current, nextCursorRef.current);
      nextCursorRef.current = null;
    }
    syncInputSelectionState();
  }, [input, syncInputSelectionState]);

  useEffect(() => () => {
    if (tabFeedbackTimerRef.current) {
      clearTimeout(tabFeedbackTimerRef.current);
      tabFeedbackTimerRef.current = null;
    }
  }, []);

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
      const usableWidth = Math.max(0, el.clientWidth - terminalMetrics.paddingX * 2);
      const usableHeight = Math.max(0, el.clientHeight - terminalMetrics.paddingY * 2);
      const cols = Math.max(40, Math.floor(usableWidth / terminalMetrics.charWidth));
      const rows = Math.max(10, Math.floor(usableHeight / terminalMetrics.lineHeightPx));
      setTermSize({ rows, cols });
      wsRef.current?.send(JSON.stringify({ type: 'resize', payload: { rows, cols } }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [terminalMetrics.charWidth, terminalMetrics.lineHeightPx, terminalMetrics.paddingX, terminalMetrics.paddingY]);

  // Check AI config on mount
  useEffect(() => {
    fetch('/api/ai-settings')
      .then(r => r.json())
      .then(d => {
        setAIConfigured(d.configured ?? false);
        if (d.enableAIAssistant !== undefined) setAiAssistantEnabled(!!d.enableAIAssistant);
        if (d.enableCommandExplain !== undefined) setAiExplainEnabled(!!d.enableCommandExplain);
      })
      .catch(() => setAIConfigured(false));
  }, []);

  useEffect(() => {
    fetch('/api/auto-approve')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.highRiskRules)) {
          setHighRiskRules(d.highRiskRules);
        } else {
          setHighRiskRules(DEFAULT_HIGH_RISK_RULES);
        }
      })
      .catch(() => setHighRiskRules(DEFAULT_HIGH_RISK_RULES));
  }, []);

  // Load app settings (showStatusBar, etc.)
  useEffect(() => {
    fetch('/api/app-settings')
      .then(r => r.json())
      .then(d => { if (d.showStatusBar !== undefined) setShowStatusBar(d.showStatusBar); })
      .catch(() => {});
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

  // Global Ctrl+C: cancel AI (or send SIGINT) even when the input is not focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 'c') return;
      // If the terminal input already has focus, its own onKeyDown handles it
      if (document.activeElement === inputRef.current) return;
      const sel = window.getSelection()?.toString();
      if (sel) return; // user is copying text — don't intercept
      e.preventDefault();
      if (aiGenerating) {
        cancelAI();
      } else {
        // Send SIGINT to the remote shell even when input isn't focused
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'raw_input', payload: { data: '\x03' } }));
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiGenerating]);

  // Ctrl+Shift+I: toggle AI terminal mode; Ctrl+Shift+Y: toggle AI assistant
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        setAiModeEnabled(p => {
          const next = !p;
          try { localStorage.setItem('terminal-ai-mode', String(next)); } catch {}
          return next;
        });
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'Y') {
        e.preventDefault();
        setAiAssistantEnabled(p => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Block helpers ─────────────────────────────────────────────────────────

  function appendTerminalHtml(html: string) {
    if (!html) return;
    setBlocks(prev => {
      const limit = Math.max(1, termSettings.scrollback || DEFAULT_TERMINAL_SETTINGS.scrollback);
      const next = [...prev, { id: genId(), type: 'terminal' as const, html }];
      let remaining = limit;
      const pruned: Block[] = [];

      for (let i = next.length - 1; i >= 0; i -= 1) {
        const block = next[i];
        if (block.type !== 'terminal') {
          pruned.push(block);
          continue;
        }

        const lines = Math.max(1, htmlToPlainText(block.html).replace(/\r/g, '').split('\n').length);
        if (remaining <= 0) continue;

        if (lines <= remaining) {
          pruned.push(block);
          remaining -= lines;
          continue;
        }

        const trimmed = htmlToPlainText(block.html)
          .replace(/\r/g, '')
          .split('\n')
          .slice(-remaining)
          .join('\n');
        pruned.push({ ...block, html: plainTextToTerminalHtml(trimmed) });
        remaining = 0;
      }

      return pruned.reverse();
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

  // ── Echo suppression ─────────────────────────────────────────────────────

  // When we show the command echo immediately client-side, the server may still
  // send back its own echo at the start of the first terminal_output chunk.
  // This function strips it, keeping track of how many chunks we've checked so
  // we give up after MAX_ECHO_CHUNKS to avoid swallowing unrelated output.
  const MAX_ECHO_CHUNKS = 5;

  function tryStripEcho(raw: string, cmd: string): string {
    if (!cmd) return raw;

    // Some PTY implementations prefix the echo with private-mode sequences
    // (e.g. \x1b[?2004l — bracketed-paste off).  Strip those before comparing.
    const noPrefix = raw.replace(/^(\x1b\[\?[\d;]*[hl])+/, '');
    const prefixLen = raw.length - noPrefix.length;

    // Only strip when the echo is followed by a newline (or occupies the whole chunk).
    // Omitting the bare '' suffix prevents accidentally clipping real output that
    // happens to start with the same word as the command (e.g. "ls" + "ls: error").
    for (const suffix of ['\r\n', '\r', '\n']) {
      const echo = cmd + suffix;
      if (noPrefix.startsWith(echo)) {
        pendingEchoRef.current = '';
        pendingEchoChunksRef.current = 0;
        if (pendingEchoTimerRef.current) {
          clearTimeout(pendingEchoTimerRef.current);
          pendingEchoTimerRef.current = null;
        }
        // Return whatever followed the echo (keeping any PTY prefix stripped too)
        return noPrefix.slice(echo.length);
      }
    }

    // Chunk didn't start with the expected echo — increment counter
    pendingEchoChunksRef.current += 1;
    if (pendingEchoChunksRef.current >= MAX_ECHO_CHUNKS) {
      // Give up — the echo probably wasn't there (or already stripped by PTY)
      pendingEchoRef.current = '';
      pendingEchoChunksRef.current = 0;
      if (pendingEchoTimerRef.current) {
        clearTimeout(pendingEchoTimerRef.current);
        pendingEchoTimerRef.current = null;
      }
    }
    return raw;
  }

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
        // Load persisted command history for this host
        const hostKey = `${msg.payload.username}@${msg.payload.host}`;
        fetch(`/api/command-history?host=${encodeURIComponent(hostKey)}`)
          .then(r => r.json())
          .then((entries: CommandHistoryEntry[]) => {
            setHistoryEntries(entries);
            setCmdHistory(entries.map((e: CommandHistoryEntry) => e.command));
          })
          .catch(() => {});
        break;
      }

      case 'terminal_output': {
        const raw = msg.payload.data;
        // Strip server echo if we already rendered it client-side
        const data = tryStripEcho(raw, pendingEchoRef.current);
        // If the entire chunk was just the echo, skip rendering
        if (data === '') break;
        const ctx = parsePrompt(data);
        if (ctx) {
          setPrompt(ctx.prompt);
          setCwd(ctx.cwd);
          setConnInfo(prev => ({ ...prev, host: ctx.host }));
          // Prompt returned → command finished
          setWaiting(false);
          // If there are queued commands, run next; otherwise focus input
          if (cmdQueueRef.current.length > 0) {
            const next = cmdQueueRef.current.shift()!;
            setQueueStatus(prev =>
              prev ? { current: prev.total - cmdQueueRef.current.length, total: prev.total } : null
            );
            requestAnimationFrame(() => executeCommandRef.current(next));
          } else {
            setQueueStatus(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
          // Strip the trailing prompt from the rendered output so it only appears
          // in the inline input area below, preventing a duplicate prompt line.
          const stripped = data
            .replace(/\[([^@\]]+)@([^\s\]]+)\s+([^\]]+)\][$#]\s*$/, '')
            .replace(/([^@\s]+)@([^:]+):([^$#\s]+)[$#]\s*$/, '');
          appendTerminalHtml(converterRef.current.convert(stripped));
        } else {
          appendTerminalHtml(converterRef.current.convert(data));
        }
        break;
      }

      case 'ai_thinking': {
        const id = genId();
        aiReplyIdRef.current = id;
        lastFeedbackBlockIdRef.current = id;
        setAIStatusLine('');
        setAiGenerating(true);
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
        setAIStatusLine('');
        setAiGenerating(false);
        inputRef.current?.focus();
        break;
      }

      case 'ai_log': {
        const { message, level = 'info' } = msg.payload as { message: string; level?: string };
        // Log to browser DevTools only — not shown in the UI
        const prefix: Record<string, string> = {
          step: '→', ok: '✓', warn: '⚠', error: '✗', cmd: '❯', info: '·',
        };
        console.log(`[AI ${(level).toUpperCase().padEnd(5)}] ${prefix[level] ?? '·'} ${message}`);
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
        setWaiting(false);
        cmdQueueRef.current = [];
        setQueueStatus(null);
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

      case 'shell_cwd_result': {
        const { path } = msg.payload as { path: string };
        if (activePanelRef.current === 'files') {
          setFileMgrInitPath(normalizeFileManagerPath(path || cwdRef.current));
        }
        break;
      }

      case 'error': {
        appendTerminalHtml(
          `\r\n<span style="color:rgb(var(--tw-c-red))">错误: ${msg.payload.message}</span>\r\n`
        );
        break;
      }

      case 'complete_result': {
        const { completions } = msg.payload;
        const ctx = completionCtxRef.current;
        setCompletionLoading(false);
        if (!ctx) break;
        const items = ctx.type === 'command'
          ? mergeCommandCompletions(ctx.lookupWord, completions)
          : completions;
        if (items.length === 0) {
          triggerTabFeedback();
          closeCompletions();
        } else if (ctx.revealListOnResolve) {
          clearTabFeedback();
          showCompletionList(items, ctx);
        } else if (items.length === 1) {
          clearTabFeedback();
          const replacement = getCompletionReplacement(items[0], ctx);
          setInput(prev => prev.slice(0, ctx.wordStart) + replacement + prev.slice(ctx.cursorPos));
          nextCursorRef.current = ctx.wordStart + replacement.length;
          completionCtxRef.current = null;
          clearTabRequest();
        } else {
          if (!ctx.revealListOnResolve && applySharedCompletion(items, ctx)) {
            completionCtxRef.current = null;
          } else if (ctx.type === 'command' && !ctx.revealListOnResolve) {
            const preferred = getPreferredCommandCompletion(ctx.lookupWord, items);
            if (preferred) {
              clearTabFeedback();
              const replacement = getCompletionReplacement(preferred, ctx);
              setInput(prev => prev.slice(0, ctx.wordStart) + replacement + prev.slice(ctx.cursorPos));
              nextCursorRef.current = ctx.wordStart + replacement.length;
              completionCtxRef.current = null;
              clearTabRequest();
            } else {
              clearTabFeedback();
              showCompletionList(items, ctx);
            }
          } else if (ctx.type === 'command') {
            clearTabFeedback();
            showCompletionList(items, ctx);
          } else {
            completionCtxRef.current = null;
          }
        }
        inputRef.current?.focus();
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

  // Cancel an in-flight AI response — call from Ctrl+C or the Stop button
  function cancelAI() {
    sendWs('ai_cancel', {});
    const id = aiReplyIdRef.current;
    if (id) {
      updateBlock<Extract<Block, { type: 'ai_reply' }>>(id, b => ({ ...b, complete: true }));
      aiReplyIdRef.current = null;
    }
    setAIStatusLine('');
    setAiGenerating(false);
    inputRef.current?.focus();
  }

  // Execute multi-line text directly (same queue logic as the pasteboard send button)
  function executeMultilineText(text: string) {
    const commands = parseLogicalCommands(text);
    if (commands.length === 0) return;
    cmdQueueRef.current = commands.slice(1);
    if (commands.length > 1) setQueueStatus({ current: 1, total: commands.length });
    executeCommandRef.current(commands[0]);
  }

  // Execute a saved command via the normal command path so prompt+command echo appears first
  const executeSavedCommand = useCallback((cmd: SavedCommand) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Track usage count (fire-and-forget)
    if (cmd.id) {
      fetch(`/api/saved-commands/${cmd.id}/usage`, { method: 'POST' }).catch(() => {});
    }

    if (cmd.content.includes('\n')) {
      executeMultilineText(cmd.content);
    } else {
      // Single-line: go through normal executeCommand so prompt echo + waiting state work
      executeCommandRef.current(cmd.content.trim());
      inputRef.current?.focus();
    }
  }, []);

  // Fire when App passes a pendingCommand from the per-pane dropdown
  useEffect(() => {
    if (!pendingCommand) return;
    executeSavedCommand(pendingCommand.cmd);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand?.nonce]);

  // ── Resolve file manager cwd when the files panel opens ──────────────────
  useEffect(() => {
    if (activePanel !== 'files') {
      setFileMgrInitPath(null); // reset so next open re-resolves
      return;
    }

    const promptPath = cwd && (cwd.startsWith('/') || cwd === '~' || cwd.startsWith('~/'))
      ? cwd
      : null;

    // Use prompt-parsed path as a fast best-effort fallback, but always ask the
    // server for the interactive shell's real cwd so file manager follows `cd` accurately.
    setFileMgrInitPath(promptPath ? normalizeFileManagerPath(promptPath) : null);
    const timer = setTimeout(() => {
      setFileMgrInitPath(prev => prev || normalizeFileManagerPath(promptPath || cwdRef.current));
    }, 2000);

    wsRef.current?.send(JSON.stringify({ type: 'get_shell_cwd', payload: {} }));

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanel]);

  // Keep a ref to savedCommands so the global keydown effect doesn't re-subscribe on every render
  const savedCommandsRef = useRef<SavedCommand[]>([]);
  useEffect(() => { savedCommandsRef.current = savedCommands; }, [savedCommands]);

  // Keep live refs for values read inside the long-lived WebSocket handler.
  useEffect(() => { activePanelRef.current = activePanel; }, [activePanel]);
  useEffect(() => { cwdRef.current = cwd; }, [cwd]);

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
          if (match.content.includes('\n')) {
            executeMultilineText(match.content);
          } else {
            executeCommandRef.current(match.content.trim());
          }
          inputRef.current?.focus();
        }
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, []);

  // Keyboard handling while a dangerous command is pending confirmation
  useEffect(() => {
    if (!dangerPending) return;
    const pending = dangerPending;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setInput(pending.command);
        requestAnimationFrame(() => inputRef.current?.focus());
        setDangerPending(null);
      }
    }
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [dangerPending]);

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

  // ── Tab completion helpers ──────────────────────────────────────────────

  function getActiveSegment(text: string) {
    const parts = text.split(/(?:\|\||&&|;|\|)/);
    return parts[parts.length - 1] ?? '';
  }

  function getSemanticCommand(tokens: string[]) {
    let index = 0;
    while (index < tokens.length && COMMAND_WRAPPERS.has(tokens[index])) {
      index += 1;
      if (tokens[index - 1] === 'env') {
        while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])) {
          index += 1;
        }
      }
    }
    return {
      command: tokens[index] ?? '',
      argsBeforeCursor: tokens.slice(index + 1),
    };
  }

  function isPathArgumentContext(command: string, argsBeforeCursor: string[]) {
    if (!command) return false;

    const currentArgIndex = argsBeforeCursor.length + 1;
    const previousToken = argsBeforeCursor[argsBeforeCursor.length - 1] ?? '';

    if (PATH_OPTION_FLAGS.has(previousToken)) return true;
    if (ALWAYS_PATH_ARGUMENT_COMMANDS.has(command)) return true;
    if (PATH_AFTER_FIRST_ARGUMENT_COMMANDS.has(command)) return currentArgIndex >= 2;

    if (command === 'git') {
      const subcommand = argsBeforeCursor[0] ?? '';
      if (!subcommand) return false;
      if (GIT_PATH_SUBCOMMANDS.has(subcommand)) return currentArgIndex >= 2;
      if (['checkout', 'restore', 'diff', 'show', 'log'].includes(subcommand) && argsBeforeCursor.includes('--')) {
        return true;
      }
      return false;
    }

    if (command === 'docker') {
      const subcommand = argsBeforeCursor[0] ?? '';
      if (!subcommand) return false;
      if (DOCKER_PATH_SUBCOMMANDS.has(subcommand)) return currentArgIndex >= 2;
      if (subcommand === 'compose') {
        const composeSubcommand = argsBeforeCursor[1] ?? '';
        if (!composeSubcommand) return false;
        if (DOCKER_COMPOSE_PATH_SUBCOMMANDS.has(composeSubcommand)) return currentArgIndex >= 3;
      }
      return false;
    }

    if (command === 'kubectl') {
      const subcommand = argsBeforeCursor[0] ?? '';
      return !!subcommand && KUBECTL_FILE_SUBCOMMANDS.has(subcommand) && PATH_OPTION_FLAGS.has(previousToken);
    }

    if (command === 'npm' || command === 'pnpm' || command === 'yarn') {
      const subcommand = argsBeforeCursor[0] ?? '';
      if (!subcommand) return false;
      return ['exec', 'run'].includes(subcommand) && PATH_OPTION_FLAGS.has(previousToken);
    }

    return false;
  }

  function extractPathCompletionTarget(rawWord: string) {
    const eqIndex = rawWord.indexOf('=');
    if (eqIndex > 0) {
      const flag = rawWord.slice(0, eqIndex);
      if (PATH_OPTION_FLAGS.has(flag)) {
        return {
          replacePrefix: rawWord.slice(0, eqIndex + 1),
          lookupWord: rawWord.slice(eqIndex + 1),
        };
      }
    }

    for (const flag of ATTACHED_PATH_OPTION_FLAGS) {
      if (rawWord.startsWith(flag)) {
        return {
          replacePrefix: flag,
          lookupWord: rawWord.slice(flag.length),
        };
      }
    }

    return { replacePrefix: '', lookupWord: rawWord };
  }

  function getLookupLeaf(word: string) {
    const lastSlash = word.lastIndexOf('/');
    return lastSlash >= 0 ? word.slice(lastSlash + 1) : word;
  }

  function getCompletionCtx(inputStr: string, cursorPos: number) {
    const textUpToCursor = inputStr.slice(0, cursorPos);
    const wordMatch = textUpToCursor.match(/\S+$/);
    const wordStart = wordMatch ? cursorPos - wordMatch[0].length : cursorPos;
    const word = wordMatch ? wordMatch[0] : '';
    const { replacePrefix, lookupWord } = extractPathCompletionTarget(word);
    const activeSegment = getActiveSegment(textUpToCursor.slice(0, wordStart));
    const prevTokens = activeSegment.trim() ? activeSegment.trim().split(/\s+/) : [];
    const { command: semanticCommand, argsBeforeCursor } = getSemanticCommand(prevTokens);
    const isCommandPos = prevTokens.length === 0 || !semanticCommand;
    const isPathLike = lookupWord.includes('/') || lookupWord.startsWith('~') || (lookupWord.startsWith('.') && lookupWord.length > 1);
    const wantsPathArgs = !!replacePrefix || isPathArgumentContext(semanticCommand, argsBeforeCursor);
    const type = (!isPathLike && !replacePrefix && isCommandPos)
      ? 'command' as const
      : (isPathLike || wantsPathArgs)
        ? 'path' as const
        : 'command' as const;
    return { word, lookupWord, replacePrefix, wordStart, type };
  }

  function isRepeatedTabRequest(inputStr: string, cursorPos: number, word: string, type: 'command' | 'path') {
    const last = lastTabRequestRef.current;
    return !!last
      && Date.now() - last.at < 1600
      && last.input === inputStr
      && last.cursorPos === cursorPos
      && last.word === word
      && last.type === type;
  }

  function rememberTabRequest(inputStr: string, cursorPos: number, word: string, type: 'command' | 'path') {
    lastTabRequestRef.current = { input: inputStr, cursorPos, word, type, at: Date.now() };
  }

  function clearTabRequest() {
    lastTabRequestRef.current = null;
  }

  function clearCompletionCycle() {
    completionCycleRef.current = null;
  }

  function rememberCompletionCycle(baseInput: string, items: CompletionItem[], ctx: Pick<CompletionRequestContext, 'word' | 'lookupWord' | 'replacePrefix' | 'wordStart' | 'cursorPos' | 'type'>) {
    completionCycleRef.current = {
      baseInput,
      items,
      index: -1,
      ctx,
    };
  }

  function clearTabFeedback() {
    if (tabFeedbackTimerRef.current) {
      clearTimeout(tabFeedbackTimerRef.current);
      tabFeedbackTimerRef.current = null;
    }
    setTabFeedback(null);
  }

  function triggerTabFeedback(kind: 'nomatch' = 'nomatch') {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(12);
    }
    if (tabFeedbackTimerRef.current) clearTimeout(tabFeedbackTimerRef.current);
    setTabFeedback(kind);
    tabFeedbackTimerRef.current = setTimeout(() => {
      setTabFeedback(null);
      tabFeedbackTimerRef.current = null;
    }, 900);
  }

  function getCommonPrefix(values: string[]) {
    if (!values.length) return '';
    let prefix = values[0];
    for (const value of values.slice(1)) {
      while (prefix && !value.startsWith(prefix)) {
        prefix = prefix.slice(0, -1);
      }
      if (!prefix) break;
    }
    return prefix;
  }

  function mergeCommandCompletions(prefix: string, items: CompletionItem[]) {
    const merged = new Map<string, CompletionItem>();
    const normalizedPrefix = prefix.toLowerCase();

    for (const name of COMMON_COMMANDS) {
      if (name.toLowerCase().startsWith(normalizedPrefix)) {
        merged.set(name, { name, isDir: false });
      }
    }

    for (const item of items) {
      if (!merged.has(item.name)) merged.set(item.name, item);
    }

    const preferredOrder = new Map(COMMON_COMMANDS.map((name, index) => [name, index]));
    return Array.from(merged.values()).sort((a, b) => {
      const aRank = preferredOrder.get(a.name) ?? Number.MAX_SAFE_INTEGER;
      const bRank = preferredOrder.get(b.name) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });
  }

  function getPreferredCommandCompletion(prefix: string, items: CompletionItem[]) {
    const preferredName = PREFERRED_COMMAND_SHORTCUTS.get(prefix.toLowerCase());
    if (!preferredName) return null;
    return items.find(item => item.name === preferredName) ?? null;
  }

  function getCompletionReplacement(item: CompletionItem, ctx: Pick<CompletionRequestContext, 'lookupWord' | 'replacePrefix' | 'type'>) {
    const pathPfx = ctx.type === 'path' && ctx.lookupWord.includes('/')
      ? ctx.lookupWord.slice(0, ctx.lookupWord.lastIndexOf('/') + 1)
      : '';
    return ctx.replacePrefix + pathPfx + item.name + (item.isDir ? '/' : ' ');
  }

  function applyCompletionVariant(item: CompletionItem, ctx: Pick<CompletionRequestContext, 'lookupWord' | 'replacePrefix' | 'wordStart' | 'cursorPos' | 'type'>, baseInput?: string) {
    const sourceInput = baseInput ?? inputRef.current?.value ?? '';
    const replacement = getCompletionReplacement(item, ctx);
    setInput(sourceInput.slice(0, ctx.wordStart) + replacement + sourceInput.slice(ctx.cursorPos));
    nextCursorRef.current = ctx.wordStart + replacement.length;
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function cycleCompletion(direction: 'forward' | 'backward') {
    const cycle = completionCycleRef.current;
    if (!cycle || cycle.items.length === 0) return false;

    const { items, index } = cycle;
    const nextIndex = direction === 'backward'
      ? (index <= 0 ? items.length - 1 : index - 1)
      : (index + 1) % items.length;

    completionCycleRef.current = { ...cycle, index: nextIndex };
    clearTabFeedback();
    applyCompletionVariant(items[nextIndex], cycle.ctx, cycle.baseInput);
    return true;
  }

  function applyCompletion(item: CompletionItem) {
    clearTabFeedback();
    const replacement = getCompletionReplacement(item, {
      lookupWord: completionWord,
      replacePrefix: completionReplacePrefix,
      type: 'path',
    });
    setInput(prev => prev.slice(0, completionWordStart) + replacement + prev.slice(completionCursorPos));
    setShowCompletions(false);
    setCompletions([]);
    setCompletionFilter('');
    nextCursorRef.current = completionWordStart + replacement.length;
    clearTabRequest();
    clearCompletionCycle();
    inputRef.current?.focus();
  }

  function applySharedCompletion(items: CompletionItem[], ctx: Pick<CompletionRequestContext, 'lookupWord' | 'replacePrefix' | 'wordStart' | 'cursorPos' | 'type'>) {
    clearTabFeedback();
    const shared = getCommonPrefix(items.map(item => item.name));
    const currentLeaf = ctx.type === 'path'
      ? getLookupLeaf(ctx.lookupWord)
      : ctx.lookupWord;

    if (!shared || shared.length <= currentLeaf.length) return false;

    const pathPfx = ctx.type === 'path' && ctx.lookupWord.includes('/')
      ? ctx.lookupWord.slice(0, ctx.lookupWord.lastIndexOf('/') + 1)
      : '';
    const replacement = ctx.replacePrefix + pathPfx + shared;

    setInput(prev => prev.slice(0, ctx.wordStart) + replacement + prev.slice(ctx.cursorPos));
    nextCursorRef.current = ctx.wordStart + replacement.length;
    clearTabRequest();
    clearCompletionCycle();
    return true;
  }

  function showCompletionList(items: CompletionItem[], ctx: Pick<CompletionRequestContext, 'word' | 'lookupWord' | 'replacePrefix' | 'wordStart' | 'cursorPos'>) {
    clearTabFeedback();
    const currentType = completionCtxRef.current?.type ?? 'path';
    rememberCompletionCycle(inputRef.current?.value ?? '', items, { ...ctx, type: currentType });
    setCompletions(items);
    setCompletionWord(ctx.lookupWord);
    setCompletionReplacePrefix(ctx.replacePrefix);
    setCompletionWordStart(ctx.wordStart);
    setCompletionCursorPos(ctx.cursorPos);
    setCompletionIndex(0);
    setCompletionFilter('');
    setShowCompletions(true);
  }

  function closeCompletions() {
    setShowCompletions(false);
    setCompletions([]);
    setCompletionLoading(false);
    setCompletionReplacePrefix('');
    setCompletionFilter('');
    completionCtxRef.current = null;
    clearTabRequest();
    clearCompletionCycle();
  }

  useLayoutEffect(() => {
    if ((!showCompletions && !completionLoading) || !completionAnchorRef.current) return;

    const anchorRect = completionAnchorRef.current.getBoundingClientRect();
    const rootRect = terminalRootRef.current?.getBoundingClientRect();
    const viewportTop = (rootRect?.top ?? 0) + 8;
    const viewportBottom = (rootRect?.bottom ?? window.innerHeight) - 8;
    const viewportLeft = (rootRect?.left ?? 0) + 8;
    const viewportRight = (rootRect?.right ?? window.innerWidth) - 8;
    const gap = 6;

    const rawSpaceBelow = viewportBottom - anchorRect.bottom - gap;
    const spaceBelow = Math.max(72, rawSpaceBelow);
    // Allow up to 400px height for vertical scroll list
    const maxHeight = Math.max(72, Math.min(400, spaceBelow));

    // Fixed narrow width: enough for a readable single column
    const desiredWidth = 280;
    const availableRight = Math.max(160, viewportRight - anchorRect.left);
    const availableLeft = Math.max(160, anchorRect.right - viewportLeft);
    const alignRight = availableRight < 200 && availableLeft > availableRight;
    const width = Math.max(160, Math.min(desiredWidth, alignRight ? availableLeft : availableRight));

    const listMaxHeight = Math.max(72, maxHeight - 26);
    const rowHeight = 30;
    const rowsPerColumn = Math.max(1, Math.floor(listMaxHeight / rowHeight));


    setCompletionPopupLayout({ alignRight, width, maxHeight, rowsPerColumn });
  }, [showCompletions, completionLoading, completions.length, input, sidePanelWidth]);

  // ── Execute a non-dangerous confirmed command ──────────────────────────────
  // Shared by the normal Enter path and the danger-confirm "确认" button.

  function executeCommand(text: string) {
    // Render "prompt + command" echo immediately
    const closeTag = converterRef.current.flush();
    const safe = (prompt + text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    appendTerminalHtml(closeTag + safe + '\n');

    // Set up server-echo stripping
    pendingEchoRef.current = text;
    pendingEchoChunksRef.current = 0;
    if (pendingEchoTimerRef.current) clearTimeout(pendingEchoTimerRef.current);
    pendingEchoTimerRef.current = setTimeout(() => {
      pendingEchoRef.current = '';
      pendingEchoChunksRef.current = 0;
      pendingEchoTimerRef.current = null;
    }, 3000);

    // Hide input until prompt returns
    setWaiting(true);

    // Update in-memory history
    setCmdHistory(prev => {
      const filtered = prev.filter(c => c !== text);
      return [text, ...filtered].slice(0, 100);
    });

    // Persist to server history
    const hostKey = connInfo.host || `${config.username}@${config.host}`;
    fetch('/api/command-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: text, host: hostKey }),
    })
      .then(r => r.json())
      .then((entry: CommandHistoryEntry) => {
        setHistoryEntries(prev => {
          const filtered = prev.filter(e => !(e.command === text && e.host === hostKey));
          return [entry, ...filtered].slice(0, 2000);
        });
      })
      .catch(() => {});

    sendWs(aiModeEnabled ? 'input' : 'raw_input', aiModeEnabled ? { text } : { data: text + '\r' });
  }

  // Always-current ref so stale closures (global key handler, pendingCommand effect) can call executeCommand
  const executeCommandRef = useRef(executeCommand);
  useLayoutEffect(() => { executeCommandRef.current = executeCommand; });

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const visibleCompletions = filteredCompletions;

    // ── Completion dropdown navigation ────────────────────────────────────
    if (showCompletions && visibleCompletions.length > 0) {
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        setCompletionIndex(i => {
          const next = (i - 1 + visibleCompletions.length) % visibleCompletions.length;
          requestAnimationFrame(() => {
            completionsListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCompletionIndex(i => {
          const next = (i + 1) % visibleCompletions.length;
          // Scroll item into view
          requestAnimationFrame(() => {
            completionsListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCompletionIndex(i => {
          const next = (i - 1 + visibleCompletions.length) % visibleCompletions.length;
          requestAnimationFrame(() => {
            completionsListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
          });
          return next;
        });
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCompletion(visibleCompletions[completionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCompletions();
        return;
      }
      // Printable characters / Backspace / Delete fall through to normal input handling;
      // the onChange handler will re-filter or close the dropdown as needed.
    }

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

    if (e.key === 'Escape' && rectSelectionsRef.current.length) {
      e.preventDefault();
      clearRectSelections();
      lastAutoCopiedSelectionRef.current = '';
      return;
    }

    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (cycleCompletion('backward')) return;
      triggerTabFeedback();
      return;
    }

    // ── Normal mode ────────────────────────────────────────────────────────

    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.trim();
      setInput('');
      clearTabRequest();
      clearCompletionCycle();
      clearTabFeedback();
      setHistoryIndex(-1);
      if (!connected) return;
      if (text) {
        // Intercept clear/reset commands locally to avoid race with ANSI escape codes
        if (text === 'clear' || text === 'reset') {
          setBlocks([]);
          sendWs('raw_input', { data: text + '\r' });
          return;
        }
        // Dangerous commands need an explicit confirmation before running
        if (isHighRiskCommand(text, highRiskRules)) {
          setDangerPending({ source: 'input', command: text });
          return;
        }
        executeCommand(text);
        return;
      }
      // Empty Enter → send newline to PTY (confirms prompts, triggers readline, etc.)
      sendWs('input', { text: '' });
      return;
    }

    // Tab: command position completes shell executables; double-Tab shows cwd files
    if (e.key === 'Tab') {
      e.preventDefault();
      const cursorPos = inputRef.current?.selectionStart ?? input.length;
      const ctx = getCompletionCtx(input, cursorPos);
      const repeatedTab = isRepeatedTabRequest(input, cursorPos, ctx.word, ctx.type);
      rememberTabRequest(input, cursorPos, ctx.word, ctx.type);

      const setCompletionCtx = (type: 'command' | 'path') => {
        completionCtxRef.current = {
          word: ctx.word,
          lookupWord: ctx.lookupWord,
          replacePrefix: ctx.replacePrefix,
          wordStart: ctx.wordStart,
          cursorPos,
          type,
          revealListOnResolve: repeatedTab,
        };
      };

      const requestCurrentPathFiles = () => {
        setCompletionCtx('path');
        setCompletionWord(ctx.lookupWord);
        setCompletionReplacePrefix(ctx.replacePrefix);
        setCompletionWordStart(ctx.wordStart);
        setCompletionCursorPos(cursorPos);
        setCompletionLoading(true);
        sendWs('complete_request', { word: ctx.lookupWord, cwd, mode: 'path' });
      };

      const requestShellCommands = () => {
        setCompletionCtx('command');
        setCompletionLoading(true);
        sendWs('complete_request', { word: ctx.lookupWord, cwd, mode: 'command' });
      };

      if (ctx.type === 'command') {
        if (repeatedTab) {
          requestCurrentPathFiles();
        } else {
          requestShellCommands();
        }
      } else {
        // Path/argument completion — ask server (SFTP with exec fallback)
        requestCurrentPathFiles();
      }
      return;
    }

    // Ctrl+C — cancel AI if generating, otherwise send SIGINT to shell
    if (e.ctrlKey && e.key === 'c') {
      const sel = window.getSelection()?.toString() || inputRef.current?.value?.slice(
        inputRef.current.selectionStart ?? 0, inputRef.current.selectionEnd ?? 0
      );
      if (sel) return; // let browser copy the selection
      e.preventDefault();
      if (aiGenerating) {
        // Cancel the in-flight AI stream
        cancelAI();
      } else {
        // Cancel any pending command queue
        if (cmdQueueRef.current.length > 0) {
          cmdQueueRef.current = [];
          setQueueStatus(null);
        }
        // Send SIGINT to the remote shell and clear any typed input
        setInput('');
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

    // Ctrl+B: open pasteboard
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      setShowPasteboard(prev => !prev);
      setTimeout(() => pasteboardRef.current?.focus(), 50);
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
  function sendCommandCardConfirm(commandId: string, command: string) {
    setBlocks(prev => prev.map(b =>
      b.type === 'command_card' && b.commandId === commandId
        ? { ...b, command, status: 'executing' as CommandCardStatus } : b
    ));
    sendWs('command_confirm', { commandId, command });
  }

  function handleConfirm(commandId: string, command: string, _risk: Risk) {
    sendCommandCardConfirm(commandId, command);
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

  /** Called when the native input detects a paste containing newlines. */
  function handleInputPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (text.includes('\n')) {
      e.preventDefault();
      setPasteboardText(prev => prev ? prev + text : text);
      setShowPasteboard(true);
      // Focus textarea after render
      setTimeout(() => pasteboardRef.current?.focus(), 50);
    }
    // single-line paste: let browser handle it normally
  }

  /**
   * Send all logical commands from the pasteboard sequentially.
   * Lines ending with \ are joined with the next line (shell continuation).
   * Each logical command waits for the prompt to return before the next is sent.
   */
  function sendFromPasteboard() {
    const text = pasteboardText;
    if (!text.trim()) return;
    setShowPasteboard(false);
    setPasteboardText('');
    executeMultilineText(text);
  }

  function handleSettingsSaved() {
    sendWs('update_ai_config', {});
    fetch('/api/ai-settings')
      .then(r => r.json())
      .then(d => setAIConfigured(d.configured ?? false))
      .catch(() => {});
    fetch('/api/auto-approve')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.highRiskRules)) {
          setHighRiskRules(d.highRiskRules);
        } else {
          setHighRiskRules(DEFAULT_HIGH_RISK_RULES);
        }
      })
      .catch(() => {});
    fetch('/api/app-settings')
      .then(r => r.json())
      .then(d => { if (d.showStatusBar !== undefined) setShowStatusBar(d.showStatusBar); })
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

  function startPanelResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidePanelWidth;
    let lastW = startW;
    function onMove(ev: PointerEvent) {
      lastW = Math.max(220, Math.min(900, startW + (ev.clientX - startX)));
      setSidePanelWidth(lastW);
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('side-panel-width', String(lastW)); } catch {}
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function insertFromHistory(cmd: string) {
    setInput(cmd);
    setHistoryIndex(-1);
    setActivePanel(null);
    inputRef.current?.focus();
  }

  // ── Context-menu helpers ──────────────────────────────────────────────────

  function createCaretRangeFromPoint(clientX: number, clientY: number): Range | null {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };

    if (typeof doc.caretRangeFromPoint === 'function') {
      return doc.caretRangeFromPoint(clientX, clientY);
    }

    if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(clientX, clientY);
      if (!pos) return null;
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }

    return null;
  }

  function getRectSelectionPoint(clientX: number, clientY: number) {
    const el = scrollRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - terminalMetrics.paddingX;
    const y = clientY - rect.top - terminalMetrics.paddingY + el.scrollTop;
    return {
      col: Math.max(0, Math.floor(x / terminalMetrics.charWidth)),
      row: Math.max(0, Math.floor(y / terminalMetrics.lineHeightPx)),
    };
  }

  function getRectSelectionText(startRow: number, endRow: number, startCol: number, endCol: number) {
    const top = Math.max(0, Math.min(startRow, endRow));
    const bottom = Math.max(0, Math.max(startRow, endRow));
    const left = Math.max(0, Math.min(startCol, endCol));
    const right = Math.max(left + 1, Math.max(startCol, endCol) + 1);

    return rectangularSourceLines
      .slice(top, bottom + 1)
      .map(line => line.padEnd(right, ' ').slice(left, right))
      .join('\n');
  }

  function hasActiveRectSelection() {
    return rectSelectionsRef.current.some(selection => selection.active);
  }

  function getCombinedRectSelectionText(selections = rectSelectionsRef.current) {
    return selections
      .map(selection => selection.text)
      .filter(Boolean)
      .join('\n');
  }

  function clearRectSelections() {
    setRectSelections([]);
    rectSelectionsRef.current = [];
    activeRectSelectionIdRef.current = null;
  }

  function getSelectedTerminalText() {
    const windowSel = window.getSelection()?.toString() ?? '';
    const inputSel = inputRef.current
      ? inputRef.current.value.slice(
          inputRef.current.selectionStart ?? 0,
          inputRef.current.selectionEnd ?? 0,
        )
      : '';
    return windowSel || inputSel || getCombinedRectSelectionText() || '';
  }

  function selectTerminalLineAtPoint(clientX: number, clientY: number) {
    const selection = window.getSelection() as Selection & {
      modify?: (alter: 'move' | 'extend', direction: 'forward' | 'backward', granularity: string) => void;
    } | null;

    if (!selection || typeof selection.modify !== 'function') return false;

    const range = createCaretRangeFromPoint(clientX, clientY);
    if (!range) return false;

    selection.removeAllRanges();
    selection.addRange(range);
    selection.modify('move', 'backward', 'lineboundary');
    selection.modify('extend', 'forward', 'lineboundary');
    return !!selection.toString();
  }

  function maybeAutoCopySelection() {
    if (!termSettings.selectToCopy) return;
    if (hasActiveRectSelection()) return;
    const selectedText = getSelectedTerminalText();
    if (!selectedText) {
      lastAutoCopiedSelectionRef.current = '';
      return;
    }
    if (selectedText === lastAutoCopiedSelectionRef.current) return;
    lastAutoCopiedSelectionRef.current = selectedText;
    handleCopyText(selectedText);
  }

  function handleTerminalAreaClick(e: React.MouseEvent<HTMLDivElement>) {
    if (suppressNextTerminalClickRef.current) {
      suppressNextTerminalClickRef.current = false;
      return;
    }

    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, button, select, a, [contenteditable="true"]')) {
      return;
    }

    if (target?.closest('.ai-selectable')) {
      return;
    }

    if (hasActiveRectSelection()) return;

    if (e.detail >= 3) {
      if (target && !target.closest('input, textarea, button, select, a, [contenteditable="true"]')) {
        if (selectTerminalLineAtPoint(e.clientX, e.clientY)) {
          clearRectSelections();
          maybeAutoCopySelection();
          return;
        }
      }
    }

    if (rectSelectionsRef.current.length) clearRectSelections();
    if (!getSelectedTerminalText()) inputRef.current?.focus();
  }

  function handleRectSelectionMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0 || !e.altKey) return;

    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, button')) return;

    const start = getRectSelectionPoint(e.clientX, e.clientY);
    if (!start) return;

    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    setContextMenu(null);

    const appendSelection = e.shiftKey;
    if (!appendSelection && rectSelectionsRef.current.length) {
      clearRectSelections();
    }

    const next = {
      id: Math.random().toString(36).slice(2, 11),
      active: true,
      startRow: start.row,
      startCol: start.col,
      endRow: start.row,
      endCol: start.col,
      text: '',
    };
    activeRectSelectionIdRef.current = next.id;
    setRectSelections(prev => {
      const updated = appendSelection ? [...prev, next] : [next];
      rectSelectionsRef.current = updated;
      return updated;
    });
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      const point = getRectSelectionPoint(ev.clientX, ev.clientY);
      if (!point) return;
      setRectSelections(prev => {
        const activeId = activeRectSelectionIdRef.current;
        if (!activeId) return prev;
        const updated = prev.map(selection => selection.id === activeId
          ? { ...selection, endRow: point.row, endCol: point.col }
          : selection);
        rectSelectionsRef.current = updated;
        return updated;
      });
    }

    function onUp(ev: MouseEvent) {
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      const point = getRectSelectionPoint(ev.clientX, ev.clientY) || start;
      if (!start || !point) return;
      const text = getRectSelectionText(start.row, point.row, start.col, point.col);

      const activeId = activeRectSelectionIdRef.current;
      activeRectSelectionIdRef.current = null;

      if (!activeId) return;

      let combinedText = '';
      setRectSelections(prev => {
        const updated = prev
          .map(selection => selection.id === activeId
            ? {
                ...selection,
                active: false,
                endRow: point.row,
                endCol: point.col,
                text,
              }
            : selection)
          .filter(selection => selection.text || selection.active);
        rectSelectionsRef.current = updated;
        combinedText = getCombinedRectSelectionText(updated);
        return updated;
      });

      if (combinedText) {
        suppressNextTerminalClickRef.current = true;
        lastAutoCopiedSelectionRef.current = combinedText;
        handleCopyText(combinedText);
      } else {
        clearRectSelections();
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function handleContextMenu(e: React.MouseEvent) {
    const selectedText = getSelectedTerminalText();

    e.preventDefault();

    setContextMenu({ x: e.clientX, y: e.clientY, selectedText });
  }

  function addTextToCopyHistory(text: string) {
    if (!appendToCopyHistory || !text) return;
    setCopyHistory(prev => {
      const updated = [text, ...prev.filter(h => h !== text)].slice(0, 50);
      try { localStorage.setItem('terminal-copy-history', JSON.stringify(updated)); } catch {}
      return updated;
    });
  }

  function handleCopyText(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    addTextToCopyHistory(text);
  }

  function handleCopyScreen() {
    const tmp = document.createElement('div');
    const text = blocks
      .filter((b): b is Extract<Block, { type: 'terminal' }> => b.type === 'terminal')
      .map(b => { tmp.innerHTML = b.html; return tmp.textContent ?? ''; })
      .join('');
    handleCopyText(text);
  }

  function handlePasteFromClipboard() {
    navigator.clipboard.readText().then(text => {
      if (!text) return;
      if (text.includes('\n')) {
        setPasteboardText(prev => prev ? prev + text : text);
        setShowPasteboard(true);
        setTimeout(() => pasteboardRef.current?.focus(), 50);
      } else {
        setInput(prev => prev + text);
        inputRef.current?.focus();
      }
    }).catch(() => {});
  }

  function handleAddToPasteHistory() {
    navigator.clipboard.readText().then(text => {
      if (!text) return;
      setPasteHistory(prev => {
        const updated = [text, ...prev.filter(h => h !== text)].slice(0, 50);
        try { localStorage.setItem('terminal-paste-history', JSON.stringify(updated)); } catch {}
        return updated;
      });
    }).catch(() => {});
  }

  async function handleDownloadConfig() {
    setConfigExportNotice(null);
    try {
      const res = await fetch('/api/export-settings');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `下载失败 (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ssh-ai-shell-${new Date().toISOString().slice(0, 10)}.enc`;
      a.click();
      URL.revokeObjectURL(url);

      setConfigExportNotice({ tone: 'success', text: '配置已下载' });
      window.setTimeout(() => setConfigExportNotice(current => (current?.tone === 'success' ? null : current)), 2500);
    } catch (err: any) {
      setConfigExportNotice({
        tone: 'error',
        text: err.message === 'Failed to fetch'
          ? '后端未连接'
          : '下载失败',
      });
      window.setTimeout(() => setConfigExportNotice(current => (current?.tone === 'error' ? null : current)), 3500);
    }
  }

  function handleSetCharset(locale: string, encoding: string) {
    const value = locale === encoding ? locale : `${locale}.${encoding}`;
    setCharset(value);
    sendWs('raw_input', { data: `export LANG=${value} LC_ALL=${value}\r` });
  }

  const clampPasteboardHeight = useCallback((height: number) => {
    const rootHeight = terminalRootRef.current?.clientHeight ?? window.innerHeight;
    const statusBarHeight = showStatusBar ? 24 : 0;
    const maxHeight = Math.max(PASTEBOARD_MIN_HEIGHT, rootHeight - statusBarHeight - 88);
    return Math.max(PASTEBOARD_MIN_HEIGHT, Math.min(maxHeight, height));
  }, [showStatusBar]);

  useEffect(() => {
    try { localStorage.setItem('terminal-pasteboard-height', String(pasteboardHeight)); } catch {}
  }, [pasteboardHeight]);

  useEffect(() => {
    setPasteboardHeight(prev => clampPasteboardHeight(prev));
  }, [clampPasteboardHeight]);

  useEffect(() => {
    const root = terminalRootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      setPasteboardHeight(prev => clampPasteboardHeight(prev));
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [clampPasteboardHeight]);

  function startPasteboardResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();

    const startY = e.clientY;
    const startHeight = pasteboardHeight;

    function onMove(ev: PointerEvent) {
      const nextHeight = clampPasteboardHeight(startHeight - (ev.clientY - startY));
      setPasteboardHeight(nextHeight);
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const tabLabel = config.name
    ? config.name
    : `${connInfo.user || config.username}@${connInfo.host || config.host}`;

  const displayPrompt = searchMode ? '(搜索) ' : prompt;
  const promptColor = searchMode ? 'rgb(var(--tw-c-cyan))' : 'rgb(var(--tw-c-term-fg))';
  const pasteboardCommands = parseLogicalCommands(pasteboardText);
  const pasteboardCommandCount = pasteboardCommands.length;
  const rectangularSourceLines = useMemo(() => {
    const logicalLines = blocks
      .filter((b): b is Extract<Block, { type: 'terminal' }> => b.type === 'terminal')
      .map(b => htmlToPlainText(b.html))
      .join('')
      .split(/\r?\n/);

    if (!waiting && !dangerPending) logicalLines.push(displayPrompt + input);

    return wrapTerminalLines(logicalLines, termSize.cols || 80);
  }, [blocks, dangerPending, displayPrompt, input, termSize.cols, waiting]);

  // Filtered completions: narrow the list as the user continues typing after Tab
  const filteredCompletions = React.useMemo(() => {
    if (!completionFilter || !completions.length) return completions;
    const lower = completionFilter.toLowerCase();
    const prefixMatches = completions.filter(item => item.name.toLowerCase().startsWith(lower));
    return prefixMatches.length > 0
      ? prefixMatches
      : completions.filter(item => item.name.toLowerCase().includes(lower));
  }, [completions, completionFilter]);

  // Auto-close when typing has narrowed the list to zero
  React.useEffect(() => {
    if (showCompletions && completionFilter && filteredCompletions.length === 0) {
      closeCompletions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredCompletions.length, showCompletions, completionFilter]);


  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={terminalRootRef} className="flex h-full w-full bg-terminal-bg text-terminal-text font-mono overflow-hidden relative">
      {/* Sidebar */}
      {!sidebarCollapsed && (
        <Sidebar activePanel={showChatPanel ? 'chat' : activePanel} onPanelToggle={handlePanelToggle} isPrimary={isPrimary} />
      )}

      {/* ── Inline side panel (clipboard / userinfo / files / hosts / commands) ── */}
      {activePanel && (
        <>
          {/* Panel body */}
          <div
            className="flex-shrink-0 flex flex-col bg-terminal-surface overflow-hidden"
            style={{ width: sidePanelWidth, borderRight: '1px solid rgb(var(--tw-c-border))' }}
          >

            {/* ── Command history ─────────────────────────────────────── */}
            {activePanel === 'clipboard' && (() => {
              const hostKey = connInfo.host || `${config.username}@${config.host}`;
              const filtered = historySearch.trim()
                ? historyEntries.filter(e => e.command.toLowerCase().includes(historySearch.toLowerCase()))
                : historyEntries;

              function deleteEntry(id: string) {
                fetch(`/api/command-history/${id}`, { method: 'DELETE' }).catch(() => {});
                setHistoryEntries(prev => prev.filter(e => e.id !== id));
                setCmdHistory(prev => {
                  const cmd = historyEntries.find(e => e.id === id)?.command;
                  return cmd ? prev.filter(c => c !== cmd) : prev;
                });
              }
              function clearAll() {
                fetch(`/api/command-history?host=${encodeURIComponent(hostKey)}`, { method: 'DELETE' }).catch(() => {});
                setHistoryEntries([]);
                setCmdHistory([]);
              }
              function runEntry(cmd: string) {
                insertFromHistory(cmd);
                setTimeout(() => {
                  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
                  inputRef.current?.dispatchEvent(ev);
                }, 0);
              }

              return (
                <>
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-terminal-border flex-shrink-0 select-none">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-terminal-text">命令历史</span>
                      {historyEntries.length > 0 && (
                        <span className="text-[10px] text-terminal-muted bg-terminal-border/40 rounded px-1">{historyEntries.length}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {historyEntries.length > 0 && (
                        <button onClick={clearAll} title="清空当前主机历史"
                          className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 rounded transition-colors">
                          <Trash2 className="w-3 h-3" />清空
                        </button>
                      )}
                      <button onClick={() => { setActivePanel(null); setHistorySearch(''); }}
                        className="text-terminal-muted hover:text-terminal-text transition-colors ml-1">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="px-2 py-1.5 border-b border-terminal-border/50 flex-shrink-0">
                    <div className="flex items-center gap-1.5 bg-terminal-bg rounded px-2 py-1">
                      <Search className="w-3 h-3 text-terminal-muted flex-shrink-0" />
                      <input type="text" placeholder="搜索历史命令..." value={historySearch}
                        onChange={e => setHistorySearch(e.target.value)}
                        className="flex-1 bg-transparent text-xs text-terminal-text placeholder:text-terminal-muted/60 outline-none font-mono min-w-0" />
                      {historySearch && (
                        <button onClick={() => setHistorySearch('')} className="text-terminal-muted hover:text-terminal-text text-[10px]">✕</button>
                      )}
                    </div>
                  </div>
                  {filtered.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs text-terminal-muted">
                      <Clipboard className="w-6 h-6 mx-auto mb-2 opacity-30" />
                      {historySearch ? '无匹配命令' : '暂无历史命令'}
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto p-1.5 space-y-px">
                      {filtered.map(entry => (
                        <div key={entry.id}
                          className="group flex items-center gap-1 px-2 py-1.5 rounded hover:bg-terminal-border/25 transition-colors cursor-pointer"
                          onClick={() => insertFromHistory(entry.command)} title="点击插入到输入框">
                          <span className="flex-1 text-xs font-mono text-terminal-text truncate min-w-0">{entry.command}</span>
                          <span className="text-[10px] text-terminal-muted/60 flex-shrink-0 group-hover:hidden">{relativeTime(entry.timestamp)}</span>
                          <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                            <button onClick={e => { e.stopPropagation(); insertFromHistory(entry.command); }} title="插入"
                              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors">
                              <ChevronRight className="w-3 h-3" />
                            </button>
                            <button onClick={e => { e.stopPropagation(); runEntry(entry.command); }} title="直接执行"
                              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/10 transition-colors">
                              <Play className="w-3 h-3" />
                            </button>
                            <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(entry.command).catch(() => {}); }} title="复制"
                              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-yellow hover:bg-terminal-yellow/10 transition-colors">
                              <Copy className="w-3 h-3" />
                            </button>
                            <button onClick={e => { e.stopPropagation(); deleteEntry(entry.id); }} title="删除"
                              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 transition-colors">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}

            {/* ── Session info ────────────────────────────────────────── */}
            {activePanel === 'userinfo' && (
              <>
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-terminal-border flex-shrink-0">
                  <span className="text-xs font-medium text-terminal-text">会话信息</span>
                  <button onClick={() => setActivePanel(null)} className="text-terminal-muted hover:text-terminal-text transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
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
                  <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md ${connected ? 'bg-terminal-green/10 text-terminal-green' : 'bg-terminal-red/10 text-terminal-red'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-terminal-green' : 'bg-terminal-red'}`} />
                    {connected ? 'SSH 连接正常' : 'SSH 已断开'}
                  </div>
                  <div className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-md ${aiConfigured ? 'bg-terminal-blue/10 text-terminal-blue' : 'bg-terminal-yellow/10 text-terminal-yellow'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${aiConfigured ? 'bg-terminal-blue' : 'bg-terminal-yellow'}`} />
                    {aiConfigured ? 'AI 已配置' : 'AI 未配置'}
                  </div>
                </div>
              </>
            )}

            {/* ── File manager ────────────────────────────────────────── */}
            {activePanel === 'files' && (
              <>
                {fileMgrInitPath === null ? (
                  <div className="flex-1 flex items-center justify-center gap-2 text-xs text-terminal-muted py-8">
                    <span className="inline-block w-3.5 h-3.5 rounded-full border border-terminal-muted border-t-terminal-blue animate-spin" />
                    正在获取当前目录…
                  </div>
                ) : (
                  <FileManager
                    key={fileMgrInitPath}
                    ws={wsRef.current}
                    sessionToken={sessionToken}
                    onClose={() => setActivePanel(null)}
                    initialPath={fileMgrInitPath || undefined}
                  />
                )}
              </>
            )}

            {/* ── Host management ─────────────────────────────────────── */}
            {activePanel === 'hosts' && (
              <>
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-terminal-border flex-shrink-0">
                  <span className="text-xs font-medium text-terminal-text">主机管理</span>
                  <button onClick={() => setActivePanel(null)} className="text-terminal-muted hover:text-terminal-text transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                  <HostManagerPanel
                    currentConfig={config}
                    onConnect={(cfg) => { setActivePanel(null); if (onNewTab) onNewTab(cfg); }}
                  />
                </div>
              </>
            )}

            {/* ── Saved commands ──────────────────────────────────────── */}
            {activePanel === 'commands' && (
              <>
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-terminal-border flex-shrink-0">
                  <span className="text-xs font-medium text-terminal-text">常用命令</span>
                  <button onClick={() => setActivePanel(null)} className="text-terminal-muted hover:text-terminal-text transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                  {savedCommands.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs text-terminal-muted">
                      <BookMarked className="w-6 h-6 mx-auto mb-2 opacity-30" />
                      <p>暂无常用命令</p>
                      <button onClick={() => { setActivePanel(null); setSettingsSection('commands'); setShowSettings(true); }}
                        className="mt-2 text-terminal-blue hover:underline text-[11px]">
                        前往设置添加
                      </button>
                    </div>
                  ) : (
                    <div className="p-2 space-y-1">
                      {savedCommands.map(cmd => (
                        <button key={cmd.id}
                          onClick={() => { executeSavedCommand(cmd); setActivePanel(null); }}
                          title={cmd.content}
                          className="w-full text-left px-2.5 py-2 rounded-md hover:bg-terminal-border/30 transition-colors group">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-terminal-text truncate group-hover:text-terminal-blue transition-colors">{cmd.name}</span>
                            {cmd.shortcut && (
                              <span className="flex-shrink-0 text-[9px] font-mono bg-terminal-bg border border-terminal-border text-terminal-muted px-1 py-0.5 rounded">{cmd.shortcut}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-terminal-muted font-mono truncate mt-0.5">{cmd.content}</div>
                          {cmd.description && (
                            <div className="text-[10px] text-terminal-muted/70 truncate mt-0.5">{cmd.description}</div>
                          )}
                        </button>
                      ))}
                      <div className="pt-1 border-t border-terminal-border/50 mt-1">
                        <button onClick={() => { setActivePanel(null); setSettingsSection('commands'); setShowSettings(true); }}
                          className="w-full text-center text-[10px] text-terminal-muted hover:text-terminal-blue py-1.5 transition-colors flex items-center justify-center gap-1">
                          <Settings2 className="w-3 h-3" />
                          管理常用命令
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

          </div>

          {/* Resize divider — drag to change panel width */}
          <div
            className="flex-shrink-0 w-1 cursor-col-resize relative group"
            style={{ background: 'rgb(var(--tw-c-border))' }}
            onPointerDown={startPanelResize}
            title="拖动调整面板宽度"
          >
            <div className="absolute inset-0 group-hover:bg-terminal-blue/50 transition-colors" />
          </div>
        </>
      )}
      {/* ── Copy history panel ───────────────────────────────────────── */}
      {showCopyHistoryPanel && (
        <SidePanel
          title="复制历史"
          onClose={() => setShowCopyHistoryPanel(false)}
          defaultLeft={40}
          positionKey="copy-history"
          defaultWidth={300}
          resizable
          storageKey="copy-history"
        >
          {copyHistory.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-terminal-muted">
              <Clipboard className="w-6 h-6 mx-auto mb-2 opacity-30" />
              暂无复制历史
            </div>
          ) : (
            <>
              <div className="flex justify-end px-3 py-1.5 border-b border-terminal-border/50">
                <button
                  onClick={() => {
                    setCopyHistory([]);
                    try { localStorage.removeItem('terminal-copy-history'); } catch {}
                  }}
                  className="flex items-center gap-0.5 text-[10px] text-terminal-muted hover:text-terminal-red transition-colors"
                >
                  <Trash2 className="w-3 h-3" />清空
                </button>
              </div>
              <div className="p-1.5 space-y-px">
                {copyHistory.map((item, i) => (
                  <div
                    key={i}
                    className="group flex items-center gap-1 px-2 py-1.5 rounded hover:bg-terminal-border/25 transition-colors cursor-pointer"
                    onClick={() => navigator.clipboard.writeText(item).catch(() => {})}
                    title="点击复制到剪贴板"
                  >
                    <span className="flex-1 text-xs font-mono text-terminal-text truncate min-w-0">
                      {item.length > 80 ? item.slice(0, 80) + '…' : item}
                    </span>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setCopyHistory(prev => {
                          const updated = prev.filter((_, j) => j !== i);
                          try { localStorage.setItem('terminal-copy-history', JSON.stringify(updated)); } catch {}
                          return updated;
                        });
                      }}
                      className="hidden group-hover:flex items-center text-terminal-muted hover:text-terminal-red transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </SidePanel>
      )}

      {/* ── Paste history panel ──────────────────────────────────────── */}
      {showPasteHistoryPanel && (
        <SidePanel
          title="粘贴历史"
          onClose={() => setShowPasteHistoryPanel(false)}
          defaultLeft={40}
          positionKey="paste-history"
          defaultWidth={300}
          resizable
          storageKey="paste-history"
        >
          {pasteHistory.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-terminal-muted">
              <ClipboardPaste className="w-6 h-6 mx-auto mb-2 opacity-30" />
              暂无粘贴历史
            </div>
          ) : (
            <>
              <div className="flex justify-end px-3 py-1.5 border-b border-terminal-border/50">
                <button
                  onClick={() => {
                    setPasteHistory([]);
                    try { localStorage.removeItem('terminal-paste-history'); } catch {}
                  }}
                  className="flex items-center gap-0.5 text-[10px] text-terminal-muted hover:text-terminal-red transition-colors"
                >
                  <Trash2 className="w-3 h-3" />清空
                </button>
              </div>
              <div className="p-1.5 space-y-px">
                {pasteHistory.map((item, i) => (
                  <div
                    key={i}
                    className="group flex items-center gap-1 px-2 py-1.5 rounded hover:bg-terminal-border/25 transition-colors cursor-pointer"
                    onClick={() => sendWs('raw_input', { data: item + '\r' })}
                    title="点击发送到终端"
                  >
                    <span className="flex-1 text-xs font-mono text-terminal-text truncate min-w-0">
                      {item.length > 80 ? item.slice(0, 80) + '…' : item}
                    </span>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setPasteHistory(prev => {
                          const updated = prev.filter((_, j) => j !== i);
                          try { localStorage.setItem('terminal-paste-history', JSON.stringify(updated)); } catch {}
                          return updated;
                        });
                      }}
                      className="hidden group-hover:flex items-center text-terminal-muted hover:text-terminal-red transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </SidePanel>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
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
            {configExportNotice && (
              <span className={`text-[10px] ${configExportNotice.tone === 'success' ? 'text-terminal-green' : 'text-terminal-red'}`}>
                {configExportNotice.text}
              </span>
            )}
            <button
              onClick={handleDownloadConfig}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/10 transition-colors"
              title="下载配置文件"
            >
              <Download className="w-3.5 h-3.5" />
              下载配置
            </button>
            <button
              onClick={() => { setShowPasteboard(prev => !prev); setTimeout(() => pasteboardRef.current?.focus(), 50); }}
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                showPasteboard
                  ? 'bg-terminal-blue/20 text-terminal-blue'
                  : 'hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text'
              }`}
              title="粘贴板 (Ctrl+B)"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
            </button>
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
          data-allow-selection="true"
          className="relative flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 scroll-smooth terminal-area select-text"
          style={terminalTextStyle}
          onMouseDown={handleRectSelectionMouseDown}
          onClick={handleTerminalAreaClick}
          onMouseUp={maybeAutoCopySelection}
          onContextMenu={handleContextMenu}
        >
          {rectSelections.map((rectSelection) => {
            const topRow = Math.min(rectSelection.startRow, rectSelection.endRow);
            const bottomRow = Math.max(rectSelection.startRow, rectSelection.endRow);
            const leftCol = Math.min(rectSelection.startCol, rectSelection.endCol);
            const rightCol = Math.max(rectSelection.startCol, rectSelection.endCol) + 1;

            return (
              <div
                key={rectSelection.id}
                className="pointer-events-none absolute z-20 rounded-sm border border-terminal-blue/70 bg-terminal-blue/20"
                style={{
                  top: terminalMetrics.paddingY + topRow * terminalMetrics.lineHeightPx,
                  left: terminalMetrics.paddingX + leftCol * terminalMetrics.charWidth,
                  width: Math.max(1, (rightCol - leftCol) * terminalMetrics.charWidth),
                  height: Math.max(terminalMetrics.lineHeightPx, (bottomRow - topRow + 1) * terminalMetrics.lineHeightPx),
                  boxShadow: rectSelection.active ? '0 0 0 1px rgba(var(--tw-c-blue), 0.25)' : 'none',
                }}
              />
            );
          })}

          {blocks.map((block) => {
            switch (block.type) {
              case 'terminal':
                return (
                  <div
                    key={block.id}
                    className="terminal-output whitespace-pre-wrap break-words select-text cursor-text"
                    style={terminalTextStyle}
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
                    statusLine={!block.complete && block.id === aiReplyIdRef.current ? aiStatusLine : undefined}
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
                    requiresHighRiskConfirm={(command, risk) => risk === 'high' || isHighRiskCommand(command, highRiskRules)}
                    onConfirm={handleConfirm}
                    onReject={handleReject}
                  />
                );

              default:
                return null;
            }
          })}

          {/* ── Danger confirmation card ───────────────────────────────── */}
          {dangerPending && (
            <div className="my-2 rounded-lg border border-terminal-red/50 bg-terminal-surface/90 overflow-hidden animate-slide-up">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-terminal-red/20">
                <AlertTriangle className="w-3.5 h-3.5 text-terminal-red flex-shrink-0" />
                <span className="text-xs font-medium text-terminal-red">确认执行这条高危命令吗？</span>
              </div>
              <div className="px-3 py-2">
                <code className="text-xs text-terminal-text font-mono break-all leading-relaxed">
                  {dangerPending.command}
                </code>
              </div>
              <div className="flex items-center justify-end gap-2 px-3 pb-2.5">
                <button
                  onClick={() => {
                    setInput(dangerPending.command);
                    requestAnimationFrame(() => inputRef.current?.focus());
                    setDangerPending(null);
                  }}
                  className="px-3 py-1 text-xs rounded border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                >
                  取消 <kbd className="text-[9px] opacity-60 ml-0.5">Esc</kbd>
                </button>
                <button
                  autoFocus
                  onClick={() => {
                    const pending = dangerPending;
                    setDangerPending(null);
                    executeCommand(pending.command);
                  }}
                  className="px-3 py-1 text-xs rounded bg-terminal-red hover:bg-terminal-red/80 text-white font-medium transition-colors"
                >
                  确认
                </button>
              </div>
            </div>
          )}

          {/* ── AI generating — stop bar ───────────────────────────────── */}
          {aiGenerating && (
            <div className="flex items-center justify-center py-1.5">
              <button
                onClick={cancelAI}
                className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors select-none"
                style={{
                  border: '1px solid rgb(var(--tw-c-border))',
                  color: 'rgb(var(--tw-c-muted))',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = 'rgb(var(--tw-c-term-fg))';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgb(var(--tw-c-term-fg))';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.color = 'rgb(var(--tw-c-muted))';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgb(var(--tw-c-border))';
                }}
              >
                <Square size={9} />
                停止生成
                <kbd className="text-[9px] opacity-50 ml-0.5">Ctrl+C</kbd>
              </button>
            </div>
          )}

          {/* ── Sequential queue progress bar ─────────────────────────── */}
          {queueStatus && (
            <div className="flex items-center gap-2 px-2 py-1 text-[11px] select-none"
              style={{ color: 'rgb(var(--tw-c-muted))' }}>
              <span className="inline-block w-2.5 h-2.5 rounded-full border border-current border-t-transparent animate-spin flex-shrink-0" />
              <span>
                正在执行第 <span style={{ color: 'rgb(var(--tw-c-blue))' }}>{queueStatus.current}</span>
                /{queueStatus.total} 条命令
              </span>
              <button
                onClick={() => { cmdQueueRef.current = []; setQueueStatus(null); }}
                className="ml-auto text-[10px] hover:text-terminal-red transition-colors"
              >
                取消队列 <kbd className="opacity-50">Ctrl+C</kbd>
              </button>
            </div>
          )}

          {/* ── Inline prompt + input ──────────────────────────────────── */}
          {!waiting && !dangerPending && (
          <div
            data-allow-selection="true"
            className="flex items-baseline mt-0.5"
            onClick={e => {
              e.stopPropagation();
              if (!getSelectedTerminalText()) inputRef.current?.focus();
            }}
          >
            <span
              className="select-text cursor-text whitespace-pre flex-shrink-0"
              style={{ ...terminalTextStyle, color: promptColor }}
            >
              {displayPrompt}
            </span>

            {/* Input wrapper */}
            <div
              ref={completionAnchorRef}
              className="relative flex-1 min-w-0 rounded-sm transition-shadow"
              style={tabFeedback === 'nomatch'
                ? { boxShadow: '0 0 0 1px rgba(var(--tw-c-yellow), 0.55)' }
                : undefined}
            >
              {/* Tab completion loading indicator */}
              {completionLoading && !showCompletions && (
                <div
                  className="absolute z-50 rounded-lg shadow-xl px-3 py-1.5 flex items-center gap-2 text-xs font-mono select-none"
                  style={{
                    top: '100%',
                    marginTop: `${6}px`,
                    ...(completionPopupLayout.alignRight ? { right: 0 } : { left: 0 }),
                    background: 'rgb(var(--tw-c-bg))',
                    border: '1px solid rgb(var(--tw-c-border))',
                    color: 'rgb(var(--tw-c-muted))',
                  }}
                >
                  <span className="inline-block w-3 h-3 rounded-full border border-terminal-muted border-t-terminal-blue animate-spin" />
                  补全中…
                </div>
              )}
              {tabFeedback === 'nomatch' && !completionLoading && !showCompletions && (
                <div
                  className="absolute z-40 rounded-lg shadow-xl px-3 py-2 text-xs font-mono select-none"
                  style={{
                    top: '100%',
                    marginTop: `${6}px`,
                    ...(completionPopupLayout.alignRight ? { right: 0 } : { left: 0 }),
                    width: `${Math.min(220, completionPopupLayout.width)}px`,
                    background: 'rgb(var(--tw-c-bg))',
                    border: '1px solid rgba(var(--tw-c-yellow), 0.28)',
                    color: 'rgb(var(--tw-c-yellow))',
                  }}
                >
                  无匹配项
                </div>
              )}
              {/* Tab completion dropdown */}
              {showCompletions && completions.length > 0 && (
                <div
                  className="absolute z-50 rounded-lg shadow-2xl overflow-hidden"
                  style={{
                    top: '100%',
                    marginTop: `${6}px`,
                    ...(completionPopupLayout.alignRight ? { right: 0 } : { left: 0 }),
                    background: 'rgb(var(--tw-c-bg))',
                    border: '1px solid rgb(var(--tw-c-border))',
                    width: `${completionPopupLayout.width}px`,
                    maxWidth: 'min(80vw, 400px)',
                  }}
                >
                  <div
                    ref={completionsListRef}
                    className="overflow-y-auto"
                    style={{ maxHeight: `${Math.max(72, completionPopupLayout.maxHeight - 26)}px` }}
                  >
                    {filteredCompletions.map((item, i) => (
                      <div
                        key={item.name}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono cursor-pointer select-none"
                        style={{
                          background: i === completionIndex ? 'rgb(var(--tw-c-selection))' : 'transparent',
                          color: i === completionIndex ? 'rgb(var(--tw-c-term-fg))' : 'rgb(var(--tw-c-muted))',
                        }}
                        onMouseEnter={() => setCompletionIndex(i)}
                        onMouseDown={e => {
                          e.preventDefault();
                          setCompletionIndex(i);
                          applyCompletion(item);
                        }}
                      >
                        <span
                          className="flex-shrink-0 text-[10px] w-4 text-center"
                          style={{ color: item.isDir ? 'rgb(var(--tw-c-blue))' : 'rgb(var(--tw-c-muted))' }}
                        >
                          {item.isDir ? '/' : '-'}
                        </span>
                        <span className="flex-1 truncate">
                          {item.name}{item.isDir ? '/' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div
                    className="px-3 py-1 text-[10px] border-t select-none flex items-center justify-between"
                    style={{ color: 'rgb(var(--tw-c-muted))', borderColor: 'rgb(var(--tw-c-border))' }}
                  >
                    <span>
                      {completionFilter && filteredCompletions.length < completions.length
                        ? `${filteredCompletions.length} / ${completions.length} 项`
                        : `${completions.length} 项`}
                    </span>
                    <span>补全候选 · Shift+Tab 反向 · ↑↓ 导航 · Enter 确认 · Esc 关闭</span>
                  </div>
                </div>
              )}
              {showCustomCursor && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                  <span style={cursorVisualStyle} />
                </div>
              )}
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => {
                  const newValue = e.target.value;
                  setInput(newValue);
                  clearTabFeedback();
                  clearTabRequest();
                  clearCompletionCycle();
                  if (!searchMode) setHistoryIndex(-1);
                  if (searchMode) setSearchResultIdx(0);
                  if (completionLoading) { closeCompletions(); return; }
                  if (showCompletions && completionCtxRef.current) {
                    // Derive the token the user is currently editing
                    const cursorPos = e.target.selectionStart ?? newValue.length;
                    const currentWord = newValue.slice(completionCtxRef.current.wordStart, cursorPos);
                    if (completionCtxRef.current.type === 'path') {
                      const currentTarget = extractPathCompletionTarget(currentWord);
                      if (currentTarget.replacePrefix !== completionCtxRef.current.replacePrefix) {
                        closeCompletions();
                      } else {
                        setCompletionFilter(getLookupLeaf(currentTarget.lookupWord));
                        setCompletionIndex(0);
                      }
                    } else {
                      if (!currentWord.startsWith(completionCtxRef.current.word)) {
                        closeCompletions();
                      } else {
                        setCompletionFilter(currentWord);
                        setCompletionIndex(0);
                      }
                    }
                  }
                }}
                onKeyDown={handleInputKeyDown}
                onPaste={handleInputPaste}
                placeholder={connected ? '输入自然语言或命令，AI将智能响应，试试打个招呼吧' : '正在连接…'}
                disabled={!connected}
                className="w-full bg-transparent outline-none min-w-0 placeholder:text-terminal-muted/45 disabled:opacity-40"
                style={{
                  ...terminalTextStyle,
                  caretColor: 'transparent',
                  color: 'rgb(var(--tw-c-term-fg))',
                }}
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onFocus={() => {
                  setInputFocused(true);
                  syncInputSelectionState();
                }}
                onBlur={() => setInputFocused(false)}
                onSelect={() => {
                  syncInputSelectionState();
                  maybeAutoCopySelection();
                }}
                onClick={syncInputSelectionState}
                onKeyUp={syncInputSelectionState}
                onScroll={syncInputSelectionState}
                onMouseUp={() => {
                  syncInputSelectionState();
                  maybeAutoCopySelection();
                }}
              />
            </div>
          </div>
          )}

          {/* Ctrl+R search match indicator */}
          {!waiting && !dangerPending && searchMode && (
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

          <div className="h-4" />
        </div>

        {showStatusBar && (
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
        )}

        {/* ── Pasteboard panel ──────────────────────────────────────────── */}
        {showPasteboard && (
          <div
            className="absolute inset-x-0 bottom-0 z-40 flex items-end justify-stretch pointer-events-none"
            style={{ top: 0, bottom: showStatusBar ? '1.5rem' : 0 }}
          >
            <div
              className="pointer-events-auto w-full border-t border-terminal-border bg-terminal-surface flex flex-col"
              style={{ height: clampPasteboardHeight(pasteboardHeight) }}
            >
              <div
                className="relative h-2.5 cursor-row-resize flex-shrink-0 group"
                onPointerDown={startPasteboardResize}
                title="拖动调整粘贴板高度"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-terminal-border group-hover:bg-terminal-blue/60 transition-colors" />
                <div className="absolute inset-x-0 top-0 flex justify-center pt-1">
                  <div className="h-0.5 w-10 rounded-full bg-terminal-muted/50 group-hover:bg-terminal-blue/70 transition-colors" />
                </div>
              </div>

              {/* Header */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-terminal-border/60 flex-shrink-0">
                <ClipboardPaste className="w-3.5 h-3.5 text-terminal-muted" />
                <span className="text-xs font-medium text-terminal-text flex-1">粘贴板</span>

                {/* Read from system clipboard */}
                <button
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      setPasteboardText(prev => prev ? prev + '\n' + text : text);
                      pasteboardRef.current?.focus();
                    } catch {}
                  }}
                  className="flex items-center gap-1 text-[10px] text-terminal-muted hover:text-terminal-text transition-colors px-1.5 py-0.5 rounded hover:bg-terminal-border/40"
                  title="从系统剪贴板读取"
                >
                  <Clipboard className="w-3 h-3" />
                  读取剪贴板
                </button>

                {/* Clear */}
                <button
                  onClick={() => { setPasteboardText(''); pasteboardRef.current?.focus(); }}
                  className="flex items-center gap-1 text-[10px] text-terminal-muted hover:text-terminal-red transition-colors px-1.5 py-0.5 rounded hover:bg-terminal-border/40"
                  title="清空"
                >
                  <Trash2 className="w-3 h-3" />
                  清空
                </button>

                <div className="w-px h-3.5 bg-terminal-border/60 mx-0.5" />

                {/* Close */}
                <button
                  onClick={() => setShowPasteboard(false)}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors"
                  title="关闭 (Ctrl+B)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Textarea */}
              <textarea
                ref={pasteboardRef}
                value={pasteboardText}
                onChange={e => setPasteboardText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    sendFromPasteboard();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowPasteboard(false);
                  }
                }}
                placeholder="输入命令，Enter 换行，Shift+Enter 发送"
                className="flex-1 min-h-0 w-full resize-none bg-transparent outline-none px-3 py-2 text-terminal-text placeholder:text-terminal-muted/50"
                style={{
                  ...terminalTextStyle,
                  color: 'rgb(var(--tw-c-term-fg))',
                }}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />

              {/* Footer */}
              <div className="flex items-center justify-between px-3 py-1.5 border-t border-terminal-border/60 flex-shrink-0 gap-2">
                <span className="text-[10px] select-none" style={{ color: 'rgb(var(--tw-c-muted))' }}>
                  {pasteboardCommandCount > 0 ? (
                    <>{pasteboardCommandCount} 条命令 · 逐条顺序执行 · Shift+Enter 发送 · Esc 关闭</>
                  ) : (
                    <>粘贴多行命令，逐条顺序执行</>
                  )}
                </span>
                <button
                  onClick={sendFromPasteboard}
                  disabled={!pasteboardText.trim()}
                  className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-terminal-blue/20 text-terminal-blue hover:bg-terminal-blue/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <SendHorizonal className="w-3 h-3" />
                  {pasteboardCommandCount > 1 ? `顺序执行 (${pasteboardCommandCount})` : '发送'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: AI Chat Panel */}
      {showChatPanel && (
        <AIChatPanel onClose={() => setShowChatPanel(false)} />
      )}

      {/* Dialogs */}
      {showSettings && (
        <React.Suspense fallback={null}>
          <SettingsPage
            key={settingsSection}
            onClose={() => { setShowSettings(false); setSettingsSection('general'); }}
            onSaved={handleSettingsSaved}
            theme={theme}
            onThemeChange={onThemeChange}
            initialSection={settingsSection}
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

      {/* ── Right-click context menu ─────────────────────────────────── */}
      {contextMenu && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedText={contextMenu.selectedText}
          aiModeEnabled={aiModeEnabled}
          aiAssistantEnabled={aiAssistantEnabled}
          aiExplainEnabled={aiExplainEnabled}
          appendToCopyHistory={appendToCopyHistory}
          charset={charset}
          onClose={() => setContextMenu(null)}
          onNewTerminal={() => { setContextMenu(null); onNewTab?.(config); }}
          onToggleAIMode={() => {
            setAiModeEnabled(p => {
              const next = !p;
              try { localStorage.setItem('terminal-ai-mode', String(next)); } catch {}
              return next;
            });
          }}
          onToggleAIAssistant={() => setAiAssistantEnabled(p => !p)}
          onToggleAIExplain={() => setAiExplainEnabled(p => !p)}
          onCopySelection={() => handleCopyText(contextMenu.selectedText)}
          onCopyScreen={handleCopyScreen}
          onCopyBuffer={handleCopyScreen}
          onToggleAppendToCopyHistory={() => {
            setAppendToCopyHistory(p => {
              const next = !p;
              try { localStorage.setItem('terminal-append-copy-history', String(next)); } catch {}
              return next;
            });
          }}
          onShowCopyHistory={() => setShowCopyHistoryPanel(true)}
          onPaste={handlePasteFromClipboard}
          onAddToPasteHistory={handleAddToPasteHistory}
          onShowPasteHistory={() => setShowPasteHistoryPanel(true)}
          onSetCharset={handleSetCharset}
          onSessionInfo={() => setActivePanel('userinfo')}
          onDisconnect={() => { sendWs('disconnect', {}); onDisconnect(); }}
          onSplitRight={onSplitPane ? () => onSplitPane('horizontal', 'after')  : undefined}
          onSplitLeft={onSplitPane  ? () => onSplitPane('horizontal', 'before') : undefined}
          onSplitDown={onSplitPane  ? () => onSplitPane('vertical',   'after')  : undefined}
          onSplitUp={onSplitPane    ? () => onSplitPane('vertical',   'before') : undefined}
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
