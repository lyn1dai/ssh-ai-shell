import React, {
  useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo,
} from 'react';
import AIReply from './AIReply';
import CommandCard from './CommandCard';
import Sidebar, { type SidebarPanel } from './Sidebar';
import StatusBar from './StatusBar';
import FileManager from './FileManager';
import AIChatPanel from './AIChatPanel';
import TerminalContextMenu from './TerminalContextMenu';
import HtermTerminal, { type HtermTerminalHandle } from './HtermTerminal';
import { AnsiConverter } from '../utils/ansi';
import * as inputClassifier from '../../shared/inputClassifier.js';
import {
  RefreshCw, AlertCircle, AlertTriangle, Clipboard, ClipboardPaste, ChevronRight,
  Server, BookMarked, Settings2, Search, Trash2, Play, Copy, Square, X, SendHorizonal, Download, Plus, Edit3, Save, Bot, Eye, EyeOff,
} from 'lucide-react';
import type { Block, ConnectConfig, ServerMsg, Risk, CommandCardStatus, Theme, SavedCommand, CommandHistoryEntry, ClipboardHistoryEntry, AutoApproveRule } from '../types';
import { DEFAULT_TERMINAL_SETTINGS } from '../types';

const SettingsPage = React.lazy(() => import('./SettingsPage'));
const { classifyInlineInput, classifyPastedText } = inputClassifier;

const PASTEBOARD_MIN_HEIGHT = 160;
const PASTEBOARD_DEFAULT_HEIGHT = 280;

// ── VimScrollbar ──────────────────────────────────────────────────────────────
// A thin scrollbar overlay rendered on top of the hterm iframe while a
// full-screen TUI (vim, less, …) is running.  The thumb position is an
// ESTIMATE derived from counting scroll events — it is not exact.
const SCROLL_LINES = 3;
const VIM_SCROLL_STEPS_RANGE = 30; // 30 steps = full estimated range (~18px/step for 600px track)

interface VimScrollbarProps {
  scrollPos: number;   // 0-1 estimated scroll fraction
  onScrollUp: () => void;
  onScrollDown: () => void;
  onSeek: (ratio: number) => void;  // user dragged the thumb to this fraction
}

function VimScrollbar({ scrollPos, onScrollUp, onScrollDown, onSeek }: VimScrollbarProps) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const THUMB_H = 40; // px — fixed thumb height

  function trackHeight() {
    return trackRef.current?.clientHeight ?? 200;
  }

  function handleTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track) return;
    const th = trackHeight();
    const usable = th - THUMB_H;
    const thumbTop = scrollPos * usable;
    const clickY = e.clientY - track.getBoundingClientRect().top;

    if (Math.abs(clickY - thumbTop - THUMB_H / 2) < THUMB_H / 2 + 4) {
      // Click ON the thumb — start drag
      const startY = e.clientY;
      const startRatio = scrollPos;
      function onMove(me: PointerEvent) {
        const dy = me.clientY - startY;
        const ratio = Math.max(0, Math.min(1, startRatio + dy / usable));
        onSeek(ratio);
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    } else {
      // Click on TRACK above/below thumb — page scroll
      clickY < thumbTop ? onScrollUp() : onScrollDown();
    }
  }

  const usable = (trackRef.current?.clientHeight ?? 200) - THUMB_H;
  const thumbTop = Math.round(scrollPos * usable);
  console.log('[VimScrollbar] render scrollPos=', scrollPos.toFixed(4), 'trackH=', trackRef.current?.clientHeight, 'usable=', usable, 'thumbTop=', thumbTop);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 12,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        background: 'rgba(0,0,0,0.35)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Up arrow */}
      <div
        style={{ height: 18, flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.6)', userSelect: 'none', fontSize: 9 }}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); console.log('[VimScrollbar] ▲ clicked'); onScrollUp(); }}
      >▲</div>

      {/* Track + thumb */}
      <div
        ref={trackRef}
        style={{ flex: 1, position: 'relative', cursor: 'pointer' }}
        onPointerDown={handleTrackPointerDown}
      >
        <div
          style={{
            position: 'absolute',
            left: 2,
            right: 2,
            height: THUMB_H,
            top: thumbTop,
            background: 'rgba(255,255,255,0.35)',
            borderRadius: 3,
            cursor: 'grab',
          }}
        />
      </div>

      {/* Down arrow */}
      <div
        style={{ height: 18, flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.6)', userSelect: 'none', fontSize: 9 }}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); console.log('[VimScrollbar] ▼ clicked'); onScrollDown(); }}
      >▼</div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

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
  /** Notifies parent when SSH connection status changes. */
  onConnectionChange?: (connected: boolean) => void;
}

// Strip ANSI escape sequences (color codes etc.) from a string
function stripInvisibleTerminalSequences(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    // Keep SGR (`...m`) color sequences so the ANSI converter can render them.
    .replace(/\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x6c\x6e-\x7E]/g, '')
    .replace(/\x1b[()][0-2B]/g, '')
    .replace(/\x1b[NO][\x20-\x7E]/g, '')
    // Some shells emit standalone ESC control sequences (for example around
    // prompt redraw/readline state changes). If we don't strip them, the ESC
    // is swallowed by the browser and the trailing byte becomes visible text.
    .replace(/\x1b(?!\[|\]|\(|\))[\x20-\x2F]*[\x30-\x7E]/g, '');
}

function stripAnsiCodes(s: string): string {
  return stripInvisibleTerminalSequences(s)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function readTerminalEscapeSequence(text: string, start: number): { value: string; length: number } | null {
  if (text[start] !== '\x1b') return null;

  const next = text[start + 1];
  if (next == null) return null;

  if (next === '[') {
    for (let i = start + 2; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) {
        return { value: text.slice(start, i + 1), length: i - start + 1 };
      }
    }
    return null;
  }

  if (next === ']') {
    for (let i = start + 2; i < text.length; i += 1) {
      if (text[i] === '\x07') {
        return { value: text.slice(start, i + 1), length: i - start + 1 };
      }
      if (text[i] === '\x1b' && text[i + 1] === '\\') {
        return { value: text.slice(start, i + 2), length: i - start + 2 };
      }
    }
    return null;
  }

  if (next === '(' || next === ')') {
    if (start + 2 >= text.length) return null;
    return { value: text.slice(start, start + 3), length: 3 };
  }

  if (next === 'O' || next === 'N') {
    if (start + 2 >= text.length) return null;
    return { value: text.slice(start, start + 3), length: 3 };
  }

  return { value: text.slice(start, start + 2), length: 2 };
}

function trimVisibleSuffix(text: string, visibleCharsToTrim: number): string {
  if (visibleCharsToTrim <= 0) return text;

  const tokens: Array<{ text: string; visible: number }> = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\x1b') {
      const sequence = readTerminalEscapeSequence(text, i);
      if (sequence) {
        tokens.push({ text: sequence.value, visible: 0 });
        i += sequence.length;
        continue;
      }
    }

    const ch = text[i];
    // Control characters like CR/LF are layout instructions, not visible prompt text.
    tokens.push({ text: ch, visible: (ch === '\r' || ch === '\n') ? 0 : 1 });
    i += 1;
  }

  const totalVisible = tokens.reduce((sum, token) => sum + token.visible, 0);
  const visibleCharsToKeep = Math.max(0, totalVisible - visibleCharsToTrim);
  let keptVisible = 0;
  let result = '';

  for (const token of tokens) {
    if (token.visible === 0) {
      if (visibleCharsToKeep > 0 && keptVisible <= visibleCharsToKeep) result += token.text;
      continue;
    }
    if (keptVisible >= visibleCharsToKeep) break;
    result += token.text;
    keptVisible += 1;
  }

  return result;
}

type PromptContext = {
  prompt: string;
  user?: string;
  host?: string;
  cwd?: string;
  rawPrompt: string;
};

function getNonEmptyTerminalLines(text: string): Array<{ rawLine: string; line: string }> {
  return text
    .split('\n')
    .map(rawLine => ({ rawLine, line: rawLine.trimEnd() }))
    .filter(({ line }) => line.trim());
}

function parseStructuredPromptLine(rawLine: string, line: string): PromptContext | null {
  const m1 = line.match(/^\[([^@\]]+)@([^\s\]]+)\s+([^\]]+)\]([$#])$/);
  if (m1) {
    const user = stripAnsiCodes(m1[1]);
    const hostName = stripAnsiCodes(m1[2]);
    const cwd = stripAnsiCodes(m1[3]);
    return {
      prompt: `[${user}@${hostName} ${m1[3]}]${m1[4]} `,
      user,
      host: `${user}@${hostName}`,
      cwd,
      rawPrompt: rawLine,
    };
  }

  const m2 = line.match(/^([^@\s]+)@([^:]+):([^$#\s]+)([$#])$/);
  if (m2) {
    const user = stripAnsiCodes(m2[1]);
    const hostName = stripAnsiCodes(m2[2]);
    const cwd = stripAnsiCodes(m2[3]);
    return {
      prompt: `${m2[1]}@${m2[2]}:${m2[3]}${m2[4]} `,
      user,
      host: `${user}@${hostName}`,
      cwd,
      rawPrompt: rawLine,
    };
  }

  return null;
}

function parseBarePromptLine(rawLine: string, line: string): PromptContext | null {
  // `sudo su` and similar flows often change PS1 to a bare shell/version prompt
  // like `bash-4.4#`, which still means the previous command has finished.
  const m3 = line.match(/^((?:\([^)]+\)\s*)?[A-Za-z_][A-Za-z0-9_.-]*)([$#])$/);
  if (m3) {
    return {
      prompt: `${m3[1]}${m3[2]} `,
      rawPrompt: rawLine,
    };
  }

  return null;
}

function parsePrompt(text: string): PromptContext | null {
  const normalized = stripAnsiCodes(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = getNonEmptyTerminalLines(normalized);
  if (lines.length === 0) return null;

  // Prefer a full `user@host cwd` prompt if one appears anywhere near the tail
  // of the chunk; a bare `bash-4.4#` prompt is only a fallback.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseStructuredPromptLine(lines[i].rawLine, lines[i].line);
    if (parsed) return parsed;
  }

  const lastLine = lines[lines.length - 1];
  return parseBarePromptLine(lastLine.rawLine, lastLine.line);
}

function stripTrailingPrompt(text: string): string {
  const normalized = stripAnsiCodes(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lines = getNonEmptyTerminalLines(normalized);
  if (lines.length === 0) return text;

  const lastLine = lines[lines.length - 1];
  const promptCtx = parseStructuredPromptLine(lastLine.rawLine, lastLine.line)
    ?? parseBarePromptLine(lastLine.rawLine, lastLine.line);
  if (!promptCtx) return text;

  const stripped = trimVisibleSuffix(text, promptCtx.rawPrompt.length);
  const promptPlain = stripAnsiCodes(promptCtx.rawPrompt).trimEnd();
  if (!promptPlain) return stripped;

  const normalizedStripped = stripAnsiCodes(stripped)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const strippedLines = normalizedStripped.split('\n');
  const tailLine = strippedLines[strippedLines.length - 1]?.trimEnd() || '';

  // Bash can redraw a bare prompt after `sudo su`, leaving a short prefix like
  // `b` on the previous line in the HTML terminal stream. If the remaining tail
  // is only a strict prefix of the prompt we just removed, drop it as redraw noise.
  if (tailLine && tailLine.length < promptPlain.length && promptPlain.startsWith(tailLine)) {
    return stripped.replace(new RegExp(`${tailLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\r\n|\r|\n)?$`), '');
  }

  return stripped;
}

function looksLikePromptPreviewFragment(text: string): boolean {
  const normalized = stripAnsiCodes(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const lastLine = normalized.split('\n').pop()?.trimEnd() || '';
  if (!lastLine) return false;
  // If the last line is already a complete prompt, don't suppress it.
  if (parseStructuredPromptLine(lastLine, lastLine) || parseBarePromptLine(lastLine, lastLine)) return false;

  // SSH prompts often arrive in multiple chunks. Suppress rendering incomplete
  // prompt fragments like a lone `[` or the leading `b` from `bash-4.4#`
  // until the full prompt is recognized.
  if (/^\[[^\]\n\r]*$/.test(lastLine)) return true;
  if (/^(?:\([^)]+\)\s*)?[A-Za-z_][A-Za-z0-9_.-]*$/.test(lastLine)) return true;
  return false;
}

function stripStandalonePromptNoise(text: string): string {
  if (!text) return text;

  return text.replace(/(^|\n)(?:\x1b\[[0-9;]*m)*\[(?:\x1b\[[0-9;]*m)*(?:\n|$)/g, '$1');
}

const ALT_SCREEN_SEQUENCES = [
  '\x1b[?1049h', '\x1b[?1049l',
  '\x1b[?1047h', '\x1b[?1047l',
  '\x1b[?47h', '\x1b[?47l',
];

function splitTrailingAltScreenFragment(text: string): { stable: string; trailing: string } {
  if (!text) return { stable: '', trailing: '' };

  const maxLength = Math.max(...ALT_SCREEN_SEQUENCES.map(seq => seq.length - 1));
  const limit = Math.min(text.length, maxLength);

  for (let len = limit; len > 0; len -= 1) {
    const suffix = text.slice(-len);
    if (ALT_SCREEN_SEQUENCES.some(seq => seq !== suffix && seq.startsWith(suffix))) {
      return {
        stable: text.slice(0, -len),
        trailing: suffix,
      };
    }
  }

  return { stable: text, trailing: '' };
}

function isLocalClearCommand(text: string): boolean {
  return ['clear', 'reset', 'cls'].includes(text.trim().toLowerCase());
}

const COMMAND_WRAPPERS = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'nice', 'xargs']);
const COMMON_COMMANDS = [
  'ls', 'll', 'cd', 'pwd', 'cat', 'less', 'more', 'head', 'tail', 'grep', 'find',
  'mkdir', 'rm', 'cp', 'mv', 'touch', 'stat', 'du', 'file', 'tree', 'clear', 'reset', 'cls',
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

class TerminalStreamBuffer {
  private currentLine = '';
  private escapeBuffer = '';

  consume(raw: string): { committed: string; preview: string } {
    const text = this.escapeBuffer + raw;
    this.escapeBuffer = '';

    let committed = '';
    let line = this.currentLine;
    let i = 0;

    while (i < text.length) {
      const ch = text[i];

      if (ch === '\x1b') {
        const sequence = readTerminalEscapeSequence(text, i);
        if (!sequence) {
          this.escapeBuffer = text.slice(i);
          break;
        }
        line += sequence.value;
        i += sequence.length;
        continue;
      }

      if (ch === '\r') {
        if (text[i + 1] === '\n') {
          committed += line + '\n';
          line = '';
          i += 2;
          continue;
        }

        line = '';
        i += 1;
        continue;
      }

      if (ch === '\n') {
        committed += line + '\n';
        line = '';
        i += 1;
        continue;
      }

      line += ch;
      i += 1;
    }

    this.currentLine = line;
    return { committed, preview: this.currentLine };
  }

  clearPreview() {
    this.currentLine = '';
    this.escapeBuffer = '';
  }

  reset() {
    this.clearPreview();
  }
}

function normalizeFileManagerPath(path: string | null | undefined): string {
  const value = (path || '').trim();
  if (!value) return '~';
  if (value.startsWith('/') || value === '~' || value.startsWith('~/')) return value;
  if (value === '.' || value === '..' || value.startsWith('./') || value.startsWith('../')) return '~';
  return `~/${value.replace(/^\/+/, '')}`;
}

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2)}`; }

function formatAIStatusLine(message?: string | null, fallback = 'AI 正在思考...'): string {
  const compact = String(message || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return fallback;
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
}

function looksLikeInteractiveInputPrompt(text: string): boolean {
  const normalized = stripAnsiCodes(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lastLine = normalized.split('\n').pop()?.trim() || '';
  if (!lastLine) return false;

  return [
    /(?:password|passphrase)(?:\s+for\s+.+?)?:\s*$/i,
    /enter passphrase(?:\s+for\s+.+?)?:\s*$/i,
    /(?:verification code|otp|one-time code|2fa code|pin):\s*$/i,
    /(?:username|login):\s*$/i,
    /continue connecting \(yes\/no(?:\/\[[^\]]+\])?\)\?\s*$/i,
    /\((?:yes\/no|y\/n)\)\??\s*$/i,
    /\[(?:Y\/n|y\/N|y\/n|yes\/no)\]\s*$/,
    /are you sure.*\?\s*$/i,
    /press (?:enter|return) to continue\.?\s*$/i,
    /press any key to continue\.?\s*$/i,
  ].some(re => re.test(lastLine));
}

function looksLikePasswordPrompt(text: string): boolean {
  const normalized = stripAnsiCodes(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lastLine = normalized.split('\n').pop()?.trim() || '';
  if (!lastLine) return false;
  return [
    /(?:password|passphrase)(?:\s+for\s+.+?)?:\s*$/i,
    /enter passphrase(?:\s+for\s+.+?)?:\s*$/i,
    /(?:verification code|otp|one-time code|2fa code|pin):\s*$/i,
  ].some(re => re.test(lastLine));
}

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

function fetchErrMsg(err: any): string {
  if (typeof err === 'string') return err;
  if (err?.message) return String(err.message);
  return '操作失败，请稍后重试';
}

function KeyRecorder({ value, onChange, onCancel }: {
  value: string; onChange: (k: string) => void; onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [current, setCurrent] = useState(value);

  useEffect(() => {
    setCurrent(value);
  }, [value]);

  useEffect(() => {
    if (!recording) return;

    function handler(e: KeyboardEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();

      const key = e.key;
      if (key === 'Escape') {
        setRecording(false);
        onCancel();
        return;
      }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      const displayKey = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
      parts.push(displayKey);

      const combo = parts.join('+');
      setCurrent(combo);
      setRecording(false);
      onChange(combo);
    }

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [recording, onChange, onCancel]);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setRecording(r => !r)}
        className={`px-2 py-1 rounded text-xs font-mono border transition-colors focus:outline-none ${
          recording
            ? 'border-terminal-blue bg-terminal-blue/20 text-terminal-blue animate-pulse'
            : 'border-terminal-border bg-terminal-surface text-terminal-text hover:border-terminal-blue'
        }`}
      >
        {recording ? '按下快捷键...' : current}
      </button>
      {recording && (
        <button
          type="button"
          onClick={() => { setRecording(false); onCancel(); }}
          className="text-terminal-muted hover:text-terminal-text"
          title="取消 (Esc)"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
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

type InputForceKind = 'shell' | 'natural';

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

export default function TerminalPage({ config, onDisconnect, onNewTab, theme, onThemeChange, pendingCommand, isPrimary = true, onSplitPane, onConnectionChange }: Props) {
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

type HistoryTab = 'commands' | 'copy' | 'paste';

  type SavedCommandDraft = {
    id?: string;
    name: string;
    content: string;
    type: 'shell' | 'natural';
    shortcut: string;
    description: string;
    createdAt?: string;
    updatedAt?: string;
  };

function parseClipboardHistory(raw: string | null): ClipboardHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ClipboardHistoryEntry[] => {
      if (typeof item === 'string') {
        return item ? [{ text: item, timestamp: new Date().toISOString() }] : [];
      }
      if (!item || typeof item !== 'object') return [];
      const text = typeof item.text === 'string' ? item.text : '';
      if (!text) return [];
      const timestamp = typeof item.timestamp === 'string' && item.timestamp ? item.timestamp : new Date().toISOString();
      return [{ text, timestamp }];
    });
  } catch {
    return [];
  }
}

function persistClipboardHistory(storageKey: string, entries: ClipboardHistoryEntry[]) {
  try { localStorage.setItem(storageKey, JSON.stringify(entries)); } catch {}
}

  const terminalRootRef = useRef<HTMLDivElement>(null);
  const shellTerminalRef = useRef<HtermTerminalHandle | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [liveTerminalHtml, setLiveTerminalHtml] = useState('');
  const [input, setInput] = useState('');
  const [inputSelection, setInputSelection] = useState({ start: 0, end: 0 });
  const [inputScrollLeft, setInputScrollLeft] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [connected, setConnected] = useState(false);

  // Notify parent when SSH connection status changes (skip initial false on mount)
  const connectedInitRef = useRef(true);
  useEffect(() => {
    if (connectedInitRef.current) { connectedInitRef.current = false; return; }
    onConnectionChange?.(connected);
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps
  const [prompt, setPrompt] = useState('$ ');
  const [cwd, setCwd] = useState('');
  const [connInfo, setConnInfo] = useState({ host: '', user: '' });
  const [latency, setLatency] = useState(0);
  const [termSize, setTermSize] = useState({ rows: 24, cols: 80 });
  const termSizeRef = useRef({ rows: 24, cols: 80 });
  const [sessionId] = useState(() => Math.random().toString(36).slice(2, 11));
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'general' | 'terminal' | 'shortcuts' | 'ai' | 'data' | 'about' | 'commands'>('general');
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [activePanel, setActivePanel] = useState<SidebarPanel>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [aiConfigured, setAIConfigured] = useState<boolean | null>(null);
  const [sessionToken, setSessionToken] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 'hidden' | 'visible' | 'minimized'  — mirrors WeChat mini-program lifecycle
  const [chatPanelState, setChatPanelState] = useState<'hidden' | 'visible' | 'minimized'>('hidden');
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
  const [copyHistory, setCopyHistory] = useState<ClipboardHistoryEntry[]>(() => {
    try { return parseClipboardHistory(localStorage.getItem('terminal-copy-history')); } catch { return []; }
  });
  const [pasteHistory, setPasteHistory] = useState<ClipboardHistoryEntry[]>(() => {
    try { return parseClipboardHistory(localStorage.getItem('terminal-paste-history')); } catch { return []; }
  });
  const [historyTab, setHistoryTab] = useState<HistoryTab>('commands');
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
  // Ref mirror of `waiting` so stale WebSocket closures can read the current value.
  const waitingRef = useRef(false);
  // True only when the running process visibly asks the user for more input.
  const [processInputRequested, setProcessInputRequested] = useState(false);
  // True when the interactive prompt looks like a password/passphrase field (mask input).
  const [processPasswordInput, setProcessPasswordInput] = useState(false);

  // Raw terminal mode (vi / vim / htop / less / etc. — programs using the alternate screen)
  const [rawTerminalMode, setRawTerminalMode] = useState(false);
  const [ptyDirectInputMode, setPtyDirectInputMode] = useState(false);
  const rawTerminalModeRef = useRef(false);
  const ptyDirectInputModeRef = useRef(false);
  // Estimated vim scroll position (0 = top, 1 = bottom) — updated on each scroll event
  const vimScrollStepsRef = useRef(0);
  const [vimScrollPos, setVimScrollPos] = useState(0);
  // True while the remote app (e.g. vim) has enabled bracketed-paste mode (\x1b[?2004h).
  const bracketedPasteModeRef = useRef(false);

  // Non-null while a directly entered dangerous command is waiting for confirmation.
  const [dangerPending, setDangerPending] = useState<DangerConfirmState | null>(null);

  // Sequential command queue (filled by pasteboard "发送" or direct multi-line paste)
  const cmdQueueRef = useRef<string[]>([]);
  // Non-null while the queue is draining: { current: 1-based index, total }
  const [queueStatus, setQueueStatus] = useState<{ current: number; total: number } | null>(null);

  // Saved commands
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);
  const [showAddSavedCommand, setShowAddSavedCommand] = useState(false);
  const [editingSavedCommand, setEditingSavedCommand] = useState<SavedCommandDraft | null>(null);
  const [savedCommandError, setSavedCommandError] = useState('');
  const [savedCommandSaving, setSavedCommandSaving] = useState(false);
  const [newSavedCommand, setNewSavedCommand] = useState<SavedCommandDraft>({
    name: '',
    content: '',
    type: 'shell',
    shortcut: '',
    description: '',
  });

  // Command history (persisted per host)
  const [historyEntries, setHistoryEntries] = useState<CommandHistoryEntry[]>([]);
  const [historySearch, setHistorySearch] = useState('');

  // Current AI step status — shown inside the active AIReply bubble
  const [aiStatusLine, setAIStatusLine] = useState('');
  // True while AI is streaming (used to show Stop button and route Ctrl+C)
  const [aiGenerating, setAiGenerating] = useState(false);
  // True while a natural-language task is still alive, including waiting for confirm or command output.
  const [aiTaskActive, setAiTaskActive] = useState(false);

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
  const showCustomCursor = false;
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
        ? 'rgb(var(--tw-c-green) / 0.4)'
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

  useEffect(() => {
    const syncFocusState = () => setInputFocused(document.activeElement === inputRef.current);
    syncFocusState();
    window.addEventListener('focusin', syncFocusState);
    window.addEventListener('focusout', syncFocusState);
    return () => {
      window.removeEventListener('focusin', syncFocusState);
      window.removeEventListener('focusout', syncFocusState);
    };
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
  const terminalStreamRef = useRef(new TerminalStreamBuffer());
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingStartRef = useRef<number>(0);
  const nextCursorRef = useRef<number | null>(null);

  // Refs for stale-closure-safe access to frequently changing values
  const connInfoRef = useRef({ host: '', user: '' });
  connInfoRef.current = connInfo;
  const appendToCopyHistoryRef = useRef(appendToCopyHistory);
  appendToCopyHistoryRef.current = appendToCopyHistory;
  // Maps AI commandId → command text so auto-approved commands can be added to history
  const commandIdToCommandRef = useRef<Record<string, string>>({});
  // Always-fresh function for saving a command to history (safe to call from stale closures)
  const saveCommandToHistoryRef = useRef<(cmd: string) => void>(() => {});
  saveCommandToHistoryRef.current = (command: string) => {
    const hostKey = connInfoRef.current.host || `${config.username}@${config.host}`;
    setCmdHistory(prev => {
      const filtered = prev.filter(c => c !== command);
      return [command, ...filtered].slice(0, 100);
    });
    fetch('/api/command-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, host: hostKey }),
    })
      .then(r => r.json())
      .then((entry: CommandHistoryEntry) => {
        setHistoryEntries(prev => {
          const filtered = prev.filter(e => !(e.command === command && e.host === hostKey));
          return [entry, ...filtered].slice(0, 2000);
        });
      })
      .catch(() => {});
  };

  // Echo suppression: track the command we just sent so we can strip the
  // server's echo when it arrives (bash readline sends echo back even with
  // ECHO:0 PTY mode in some configurations, and it may arrive after output).
  const pendingEchoRef = useRef('');
  const pendingEchoChunksRef = useRef(0);
  const pendingEchoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAltScreenFragmentRef = useRef('');

  function clearTerminalScreen() {
    pendingEchoRef.current = '';
    pendingEchoChunksRef.current = 0;
    pendingAltScreenFragmentRef.current = '';
    if (pendingEchoTimerRef.current) {
      clearTimeout(pendingEchoTimerRef.current);
      pendingEchoTimerRef.current = null;
    }
    converterRef.current = new AnsiConverter();
    terminalStreamRef.current.reset();
    rawTerminalModeRef.current = false;
    ptyDirectInputModeRef.current = false;
    setRawTerminalMode(false);
    setPtyDirectInputMode(false);
    shellTerminalRef.current?.setRawMode(false);
    setLiveTerminalHtml('');
    setBlocks([]);
    shellTerminalRef.current?.clear();
  }

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
  const displayPrompt = searchMode ? '(搜索) ' : prompt;
  const promptColor = searchMode ? 'rgb(var(--tw-c-cyan))' : 'rgb(var(--tw-c-term-fg))';
  const inlineInputMirrorText = processPasswordInput ? '' : input;
  const terminalPassthroughMode = rawTerminalMode || ptyDirectInputMode;
  // True when a non-AI process is running and paste should go directly to the PTY.
  // This covers both xterm alt-screen mode AND the flow-terminal path (vim without alt-screen).
  const pasteIntoProcess = terminalPassthroughMode || (waiting && !aiTaskActive && !aiGenerating);


  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current && !rawTerminalModeRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);
  useLayoutEffect(() => { scrollToBottom(); }, [blocks, dangerPending, liveTerminalHtml, scrollToBottom, waiting]);

  useEffect(() => {
    if (rawTerminalModeRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const usableWidth = Math.max(0, el.clientWidth - terminalMetrics.paddingX * 2);
      const usableHeight = Math.max(0, el.clientHeight - terminalMetrics.paddingY * 2);
      const cols = Math.max(40, Math.floor(usableWidth / terminalMetrics.charWidth));
      const rows = Math.max(10, Math.floor(usableHeight / terminalMetrics.lineHeightPx));
      termSizeRef.current = { rows, cols };
      setTermSize(prev => (prev.rows === rows && prev.cols === cols ? prev : { rows, cols }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [terminalMetrics.charWidth, terminalMetrics.lineHeightPx, terminalMetrics.paddingX, terminalMetrics.paddingY, rawTerminalMode]);

  const handleTerminalResize = useCallback(({ cols, rows }: { cols: number; rows: number }) => {
    termSizeRef.current = { rows, cols };
    setTermSize(prev => (prev.rows === rows && prev.cols === cols ? prev : { rows, cols }));
    wsRef.current?.send(JSON.stringify({ type: 'resize', payload: { rows, cols } }));
  }, []);

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
      if (!e.ctrlKey || e.shiftKey || e.key.toLowerCase() !== 'c') return;
      if (shellTerminalRef.current?.hasFocus()) return;
      // In raw terminal mode, forward Ctrl+C directly to the PTY
      if (rawTerminalModeRef.current) {
        e.preventDefault();
        wsRef.current?.send(JSON.stringify({ type: 'raw_input', payload: { data: '\x03' } }));
        return;
      }
      // If the terminal input already has focus, its own onKeyDown handles it
      if (document.activeElement === inputRef.current) return;
      const sel = window.getSelection()?.toString();
      if (sel) return; // user is copying text — don't intercept
      e.preventDefault();
      if (aiTaskActive) {
        cancelAI();
      } else {
        interruptShellExecution();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiTaskActive]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      const activeElement = document.activeElement as HTMLElement | null;
      const rawFocused = shellTerminalRef.current?.hasFocus() ?? false;
      const insideTerminal = !!target && !!terminalRootRef.current?.contains(target);
      const activeInsideTerminal = !!activeElement && !!terminalRootRef.current?.contains(activeElement);
      const editableTarget = !!target?.closest('input, textarea, [contenteditable="true"]');
      const selection = window.getSelection();
      const selectionInTerminal = !!terminalRootRef.current
        && !!selection
        && selection.rangeCount > 0
        && terminalRootRef.current.contains(selection.getRangeAt(0).commonAncestorContainer);
      const terminalShortcutContext = rawFocused || insideTerminal || activeInsideTerminal || selectionInTerminal;

      const wantsCopy = (e.ctrlKey && e.shiftKey && key === 'c') || (e.ctrlKey && !e.shiftKey && key === 'insert');
      const wantsPaste = (e.ctrlKey && !e.shiftKey && key === 'v') || (!e.ctrlKey && e.shiftKey && key === 'insert');

      if (wantsCopy) {
        if (!terminalShortcutContext) return;
        e.preventDefault();
        e.stopPropagation();
        const selectedText = getSelectedTerminalText();
        if (selectedText) {
          handleCopyText(selectedText);
        } else {
          handleCopyScreen();
        }
        return;
      }

      if (wantsPaste) {
        if (!terminalShortcutContext) return;
        if (editableTarget && !rawFocused) {
          // Normally we leave paste alone when a form/input is focused. But when the
          // terminal inline input has focus and a non-AI process (vim, etc.) is running,
          // paste MUST be intercepted so the text goes to the PTY, not the input field.
          const isTerminalInput = document.activeElement === inputRef.current;
          if (!(isTerminalInput && waiting && !aiTaskActive && !aiGenerating)) return;
        }
        e.preventDefault();
        e.stopPropagation();
        handlePasteFromClipboard();
        return;
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [
    aiGenerating,
    aiStatusLine,
    aiTaskActive,
    appendToCopyHistory,
    blocks,
    currentSearchMatch,
    dangerPending,
    displayPrompt,
    input,
    liveTerminalHtml,
    queueStatus,
    searchMode,
    waiting,
  ]);

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (!rawTerminalModeRef.current && !ptyDirectInputModeRef.current) return;
      if (document.activeElement === pasteboardRef.current) return;
      const rawFocused = shellTerminalRef.current?.hasFocus() ?? false;
      if (!rawFocused) return;
      const text = e.clipboardData?.getData('text') ?? '';
      e.preventDefault();
      e.stopPropagation();
      routeClipboardTextToPasteboard(text);
    };

    document.addEventListener('paste', handler, true);
    return () => document.removeEventListener('paste', handler, true);
  }, []);

  // When a non-AI process (vim, etc.) is running in flow-terminal mode, intercept ALL
  // paste events at document capture level and redirect them to the pasteboard panel.
  // This fires for Ctrl+V, Shift+Insert, right-click paste, and Chinese IME paste —
  // regardless of which element currently has focus — so vim never receives raw bytes.
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) return;
      if (!waiting || aiTaskActive || aiGenerating) return;
      // Let the pasteboard textarea handle its own paste events normally.
      if (document.activeElement === pasteboardRef.current) return;
      const text = e.clipboardData?.getData('text') ?? '';
      e.preventDefault();
      e.stopPropagation();
      routeClipboardTextToPasteboard(text);
    };

    document.addEventListener('paste', handler, true);
    return () => document.removeEventListener('paste', handler, true);
  }, [waiting, aiTaskActive, aiGenerating]);

  // Keep input focused when a process starts running (user may need to type a password, etc.)
  // Also reset bracketedPasteModeRef: the shell may have enabled bracketed paste before the
  // process started, but vim (or the new process) manages its own BPM state independently.
  // Without the reset we would wrongly wrap the first paste in \x1b[200~…\x1b[201~, which
  // causes vim to see an ESC → exit insert mode → garbled output.
  useEffect(() => {
    if (waiting && !rawTerminalModeRef.current && !ptyDirectInputModeRef.current) {
      bracketedPasteModeRef.current = false;
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [waiting]);

  useEffect(() => {
    if (rawTerminalMode) {
      if (ptyDirectInputModeRef.current) {
        ptyDirectInputModeRef.current = false;
        setPtyDirectInputMode(false);
      }
      return;
    }

    // PTY direct mode (xterm overlay) is only used for true full-screen apps (vim, htop…)
    // triggered via rawTerminalMode. Interactive prompts like docker login stay in the flow.
    const shouldEnterDirectMode = false;
    if (shouldEnterDirectMode && !ptyDirectInputModeRef.current) {
      ptyDirectInputModeRef.current = true;
      setPtyDirectInputMode(true);
      sendWs('set_raw_terminal_mode', { enabled: true });
      requestAnimationFrame(() => {
        shellTerminalRef.current?.syncSize();
        shellTerminalRef.current?.focus();
      });
      return;
    }

    if (!shouldEnterDirectMode && ptyDirectInputModeRef.current) {
      ptyDirectInputModeRef.current = false;
      setPtyDirectInputMode(false);
      sendWs('set_raw_terminal_mode', { enabled: false });
      shellTerminalRef.current?.clear();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [rawTerminalMode]);

  useEffect(() => {
    if (connected && !rawTerminalMode && !ptyDirectInputMode && !dangerPending) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [connected, dangerPending, ptyDirectInputMode, rawTerminalMode]);

  // After React commits the DOM change into vim/raw mode, re-sync terminal size
  // so xterm fits the container correctly (opacity-0→100 doesn't affect layout
  // but the double-rAF guarantees the frame after the React paint is complete).
  useEffect(() => {
    if (terminalPassthroughMode) {
      shellTerminalRef.current?.syncSize();
      const raf = requestAnimationFrame(() => shellTerminalRef.current?.syncSize());
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [terminalPassthroughMode]);

  useEffect(() => {
    if (connected && !waiting && !rawTerminalMode && !ptyDirectInputMode && !dangerPending) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [connected, dangerPending, ptyDirectInputMode, rawTerminalMode, waiting]);

  useEffect(() => {
    waitingRef.current = waiting;
    if (!waiting) { setProcessInputRequested(false); setProcessPasswordInput(false); }
  }, [waiting]);

  // Intercept native copy events (Ctrl+C with selection, browser copy) to add to copy history
  useEffect(() => {
    const handler = () => {
      if (!appendToCopyHistoryRef.current) return;
      const sel = window.getSelection()?.toString();
      if (!sel) return;
      // Only capture copies originating within the terminal area
      const rangeCount = window.getSelection()?.rangeCount ?? 0;
      if (rangeCount > 0 && terminalRootRef.current) {
        const range = window.getSelection()!.getRangeAt(0);
        if (!terminalRootRef.current.contains(range.commonAncestorContainer)) return;
      }
      setCopyHistory(prev => {
        const updated = [{ text: sel, timestamp: new Date().toISOString() }, ...prev.filter(h => h.text !== sel)].slice(0, 50);
        persistClipboardHistory('terminal-copy-history', updated);
        return updated;
      });
    };
    document.addEventListener('copy', handler);
    return () => document.removeEventListener('copy', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      ws.send(JSON.stringify({ type: 'connect', payload: { ...config, charset } }));
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
        const combinedRaw = pendingAltScreenFragmentRef.current + msg.payload.data;
        const { stable: raw, trailing } = splitTrailingAltScreenFragment(combinedRaw);
        pendingAltScreenFragmentRef.current = trailing;
        if (!raw) break;

        if (rawTerminalModeRef.current) {
          const exitMatch = /\x1b\[\?(?:1049|1047|47)l/.exec(raw);
          if (exitMatch) {
            const beforeExit = raw.slice(0, exitMatch.index + exitMatch[0].length);
            if (beforeExit) shellTerminalRef.current?.write(beforeExit);
            rawTerminalModeRef.current = false;
            setRawTerminalMode(false);
            sendWs('set_raw_terminal_mode', { enabled: false });
            shellTerminalRef.current?.setRawMode(false);
            shellTerminalRef.current?.clear();
            const tail = raw.slice(exitMatch.index + exitMatch[0].length);
            if (tail) handleMsg({ type: 'terminal_output', payload: { data: tail } } as ServerMsg);
            requestAnimationFrame(() => inputRef.current?.focus());
          } else {
            shellTerminalRef.current?.write(raw);
          }
          break;
        }

        const altEnterMatch = /\x1b\[\?(?:1049|47|1047)h/.exec(raw);
        if (altEnterMatch) {
          const beforeAltEnter = raw.slice(0, altEnterMatch.index);
          if (beforeAltEnter) {
            handleMsg({ type: 'terminal_output', payload: { data: beforeAltEnter } } as ServerMsg);
          }
          rawTerminalModeRef.current = true;
          setRawTerminalMode(true);
          setWaiting(true);
          sendWs('set_raw_terminal_mode', { enabled: true });
          shellTerminalRef.current?.setRawMode(true);
          vimScrollStepsRef.current = 0;
          setVimScrollPos(0);
          // Use cancelPendingWrites() instead of clear() so that the terminal
          // history from before vim/raw-mode is preserved in hterm's scrollback
          // buffer — the user can scroll up with the scrollbar to see it.
          shellTerminalRef.current?.cancelPendingWrites();
          shellTerminalRef.current?.syncSize();
          const afterAltEnter = raw.slice(altEnterMatch.index);
          if (afterAltEnter) shellTerminalRef.current?.write(afterAltEnter);
          requestAnimationFrame(() => {
            shellTerminalRef.current?.syncSize();
            shellTerminalRef.current?.focus();
          });
          break;
        }

        const data = tryStripEcho(raw, pendingEchoRef.current);
        if (data === '') break;
        // Track bracketed-paste mode from the unstripped output so tryStripEcho
        // cannot hide ?2004h/?2004l that appear at the start of a chunk.
        if (/\x1b\[\?2004h/.test(raw)) bracketedPasteModeRef.current = true;
        if (/\x1b\[\?2004l/.test(raw)) bracketedPasteModeRef.current = false;
        if (ptyDirectInputModeRef.current) {
          shellTerminalRef.current?.write(data);
        }
        const { committed, preview } = terminalStreamRef.current.consume(data);
        const visibleText = committed + preview;
        if (visibleText === '') {
          setLiveTerminalHtml('');
          break;
        }

        const ctx = parsePrompt(visibleText);
        if (ctx) {
          setPrompt(ctx.prompt);
          if (ctx.cwd !== undefined) setCwd(ctx.cwd);
          if (ctx.host !== undefined || ctx.user !== undefined) {
            setConnInfo(prev => ({
              host: ctx.host ?? prev.host,
              user: ctx.user ?? prev.user,
            }));
          }
          setWaiting(false);
          setProcessInputRequested(false);
          setProcessPasswordInput(false);
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
          const stripped = stripStandalonePromptNoise(stripTrailingPrompt(visibleText));
          terminalStreamRef.current.clearPreview();
          setLiveTerminalHtml('');
          if (stripped) {
            appendTerminalHtml(converterRef.current.convert(stripped));
          }
        } else {
          setProcessInputRequested(waitingRef.current && looksLikeInteractiveInputPrompt(visibleText));
          setProcessPasswordInput(waitingRef.current && looksLikePasswordPrompt(visibleText));
          const sanitizedCommitted = stripStandalonePromptNoise(committed);
          if (sanitizedCommitted) {
            appendTerminalHtml(converterRef.current.convert(sanitizedCommitted));
          }
          setLiveTerminalHtml(
            preview && !looksLikePromptPreviewFragment(preview)
              ? converterRef.current.renderPreview(preview)
              : ''
          );
        }
        break;
      }

      case 'ai_task_start': {
        setAiTaskActive(true);
        break;
      }

      case 'ai_task_end': {
        const cancelled = Boolean(msg.payload?.cancelled);
        setAiTaskActive(false);
        setAiGenerating(false);
        setWaiting(false);
        setAIStatusLine('');
        if (cancelled) {
          setBlocks(prev => prev.map(b => (
            b.type === 'command_card' && ['pending', 'approved', 'executing'].includes(b.status)
              ? { ...b, status: 'cancelled' as CommandCardStatus }
              : b
          )));
        }
        inputRef.current?.focus();
        break;
      }

      case 'ai_thinking': {
        setWaiting(false);
        let id = aiReplyIdRef.current;
        if (!id) {
          id = genId();
          aiReplyIdRef.current = id;
          lastFeedbackBlockIdRef.current = id;
          addBlock({ id, type: 'ai_reply', text: '', complete: false });
        } else {
          updateBlock<Extract<Block, { type: 'ai_reply' }>>(id, b => ({ ...b, complete: false }));
        }
        setAIStatusLine(formatAIStatusLine(msg.payload?.message, '正在分析请求...'));
        setAiGenerating(true);
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
        setWaiting(false);
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
        if (aiReplyIdRef.current) {
          setAIStatusLine(formatAIStatusLine(message));
        }
        break;
      }

      case 'ai_not_configured': {
        setWaiting(false);
        setAiTaskActive(false);
        appendTerminalHtml(
          `<span style="color:rgb(var(--tw-c-yellow))">⚠ AI 未配置，请先在设置中配置 AI 服务才能使用自然语言功能</span>\r\n`
        );
        setShowSettings(true);
        break;
      }

      case 'command_card': {
        setWaiting(false);
        const { commandId, command, risk } = msg.payload;
        commandIdToCommandRef.current[commandId] = command;
        addBlock({
          id: `card_${commandId}`, type: 'command_card',
          commandId, command, risk: risk as Risk, status: 'pending',
        });
        break;
      }

      case 'command_auto_approve': {
        const { commandId } = msg.payload;
        const autoCmd = commandIdToCommandRef.current[commandId];
        if (autoCmd) saveCommandToHistoryRef.current(autoCmd);
        setBlocks(prev => prev.map(b =>
          b.type === 'command_card' && b.commandId === commandId
            ? { ...b, status: 'approved' as CommandCardStatus } : b
        ));
        break;
      }

      case 'command_executing': {
        setWaiting(true);
        const { commandId } = msg.payload;
        setBlocks(prev => prev.map(b =>
          b.type === 'command_card' && b.commandId === commandId
            ? { ...b, status: 'executing' as CommandCardStatus } : b
        ));
        break;
      }

      case 'command_done': {
        // 不重置 waiting — command_done 之后服务端总是紧跟 AI 分析,
        // 保持 waiting=true 避免输入框在空白期闪现
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
        rawTerminalModeRef.current = false;
        ptyDirectInputModeRef.current = false;
        pendingAltScreenFragmentRef.current = '';
        setRawTerminalMode(false);
        setPtyDirectInputMode(false);
        shellTerminalRef.current?.setRawMode(false);
        setProcessInputRequested(false);
        setProcessPasswordInput(false);
        setAiGenerating(false);
        setAiTaskActive(false);
        terminalStreamRef.current.reset();
        setLiveTerminalHtml('');
        cmdQueueRef.current = [];
        setQueueStatus(null);
        appendTerminalHtml('\r\n<span style="color:rgb(var(--tw-c-muted))">Connection closed.</span>\r\n');
        break;
      }

      case 'session_cleared': {
        resetAiWorkflowState();
        appendTerminalHtml(
          '\r\n<span style="color:rgb(var(--tw-c-border));border-top:1px solid rgb(var(--tw-c-border))">─────────────── 新 AI 会话 ───────────────</span>\r\n'
        );
        inputRef.current?.focus();
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

  const handleRawTerminalData = useCallback((data: string, encoding: 'text' | 'base64' = 'text') => {
    sendWs('raw_input', { data, encoding });
  }, []);

  function interruptShellExecution() {
    cmdQueueRef.current = [];
    setQueueStatus(null);
    setInput('');
    sendWs('raw_input', { data: '\x03' });
  }

  function resetAiWorkflowState() {
    const id = aiReplyIdRef.current;
    if (id) {
      updateBlock<Extract<Block, { type: 'ai_reply' }>>(id, b => ({ ...b, complete: true }));
      aiReplyIdRef.current = null;
    }
    setAIStatusLine('');
    setAiGenerating(false);
    setAiTaskActive(false);
    setWaiting(false);
    setProcessInputRequested(false);
    setProcessPasswordInput(false);
    setBlocks(prev => prev.map(b => (
      b.type === 'command_card' && ['pending', 'approved', 'executing'].includes(b.status)
        ? { ...b, status: 'cancelled' as CommandCardStatus }
        : b
    )));
  }

  function resetToFreshAISession() {
    resetAiWorkflowState();
    sendWs('new_session', {});
  }

  // Stop the current natural-language workflow and reset to a fresh AI session without clearing the terminal.
  function cancelAI() {
    resetToFreshAISession();
    inputRef.current?.focus();
  }

  function sendInputText(text: string, options?: { forceKind?: InputForceKind }) {
    const forcedKind = options?.forceKind;
    const inputKind = forcedKind ?? (aiModeEnabled ? classifyInlineInput(text) : 'shell');
    // Shell-classified commands always go via raw_input so they bypass AI entirely.
    // Natural-language input (AI mode, or forced) goes via the 'input' channel.
    const transportType = inputKind === 'natural' ? 'input' : 'raw_input';

    const closeTag = converterRef.current.flush();
    const promptText = (displayPrompt || prompt || '$ ');
    appendTerminalHtml(closeTag + plainTextToTerminalHtml(promptText + text + '\n'));

    if (inputKind === 'shell') {
      pendingEchoRef.current = text;
      pendingEchoChunksRef.current = 0;
      if (pendingEchoTimerRef.current) clearTimeout(pendingEchoTimerRef.current);
      pendingEchoTimerRef.current = setTimeout(() => {
        pendingEchoRef.current = '';
        pendingEchoChunksRef.current = 0;
        pendingEchoTimerRef.current = null;
      }, 3000);
      setWaiting(true);
      setProcessInputRequested(false);
      setProcessPasswordInput(false);
    } else {
      setAiTaskActive(true);
      pendingEchoRef.current = '';
      pendingEchoChunksRef.current = 0;
      if (pendingEchoTimerRef.current) {
        clearTimeout(pendingEchoTimerRef.current);
        pendingEchoTimerRef.current = null;
      }
      setWaiting(false);
    }

    setCmdHistory(prev => {
      const filtered = prev.filter(c => c !== text);
      return [text, ...filtered].slice(0, 100);
    });

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

    if (transportType === 'input') {
      sendWs('input', forcedKind ? { text, forceKind: forcedKind } : { text });
    } else {
      sendWs('raw_input', { data: text + '\r' });
    }
  }

  // Execute multi-line text directly (same queue logic as the pasteboard send button)
  function executeMultilineText(text: string) {
    const intent = classifyPastedText(text);
    if (intent === 'natural_language' || intent === 'uncertain' || intent === 'mixed') {
      sendInputText(text.trim(), { forceKind: 'natural' });
      return;
    }

    const commands = parseLogicalCommands(text);
    if (commands.length === 0) return;
    cmdQueueRef.current = commands.slice(1);
    if (commands.length > 1) setQueueStatus({ current: 1, total: commands.length });
    executeCommandRef.current(commands[0]);
  }

  // Execute a saved command via the normal command path so prompt+command echo appears first
  function executeSavedCommand(cmd: SavedCommand) {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const content = cmd.content.trim();
    if (!content) return;

    // Track usage count (fire-and-forget)
    if (cmd.id) {
      fetch(`/api/saved-commands/${cmd.id}/usage`, { method: 'POST' }).catch(() => {});
    }

    // In vim/vi or other raw-terminal / direct-input programs: paste text at cursor,
    // do NOT run as a shell command, do NOT append a newline.
    if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
      pasteTextIntoRawTerminal(content);
      return;
    }

    resetInlineComposer();

    if (cmd.type === 'natural') {
      sendInputText(content, { forceKind: 'natural' });
    } else if (content.includes('\n')) {
      executeMultilineText(content);
    } else {
      // Single-line: go through normal executeCommand so prompt echo + waiting state work
      executeCommandRef.current(content);
    }
    inputRef.current?.focus();
  }

  function notifySavedCommandsUpdated() {
    window.dispatchEvent(new CustomEvent('saved-commands-updated'));
  }

  function resetNewSavedCommand() {
    setNewSavedCommand({
      name: '',
      content: '',
      type: 'shell',
      shortcut: '',
      description: '',
    });
  }

  async function addSavedCommandInline() {
    if (!newSavedCommand.name.trim() || !newSavedCommand.content.trim()) {
      setSavedCommandError('名称和内容不能为空');
      return;
    }

    setSavedCommandSaving(true);
    setSavedCommandError('');
    try {
      const res = await fetch('/api/saved-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSavedCommand.name.trim(),
          content: newSavedCommand.content.trim(),
          type: newSavedCommand.type,
          shortcut: newSavedCommand.shortcut.trim(),
          description: newSavedCommand.description.trim(),
        }),
      });
      if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
      const created: SavedCommand = await res.json();
      setSavedCommands(prev => [...prev, created]);
      setShowAddSavedCommand(false);
      resetNewSavedCommand();
      notifySavedCommandsUpdated();
    } catch (err: any) {
      setSavedCommandError(fetchErrMsg(err));
    } finally {
      setSavedCommandSaving(false);
    }
  }

  async function updateSavedCommandInline(cmd: SavedCommandDraft) {
    if (!cmd.id) return;
    if (!cmd.name.trim() || !cmd.content.trim()) {
      setSavedCommandError('名称和内容不能为空');
      return;
    }

    setSavedCommandSaving(true);
    setSavedCommandError('');
    try {
      const res = await fetch(`/api/saved-commands/${cmd.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cmd.name.trim(),
          content: cmd.content.trim(),
          type: cmd.type,
          shortcut: cmd.shortcut.trim(),
          description: cmd.description.trim(),
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
      const updated: SavedCommand = await res.json();
      setSavedCommands(prev => prev.map(item => item.id === updated.id ? updated : item));
      setEditingSavedCommand(null);
      notifySavedCommandsUpdated();
    } catch (err: any) {
      setSavedCommandError(fetchErrMsg(err));
    } finally {
      setSavedCommandSaving(false);
    }
  }

  async function deleteSavedCommandInline(id: string) {
    try {
      const res = await fetch(`/api/saved-commands/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
      setSavedCommands(prev => prev.filter(item => item.id !== id));
      if (editingSavedCommand?.id === id) setEditingSavedCommand(null);
      notifySavedCommandsUpdated();
    } catch (err: any) {
      setSavedCommandError(fetchErrMsg(err));
    }
  }

  async function toggleStripVisibilityInline(cmd: SavedCommand) {
    const next = cmd.showInStrip === false; // false→true (show), undefined/true→false (hide)
    const res = await fetch(`/api/saved-commands/${cmd.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showInStrip: next }),
    });
    if (res.ok) {
      setSavedCommands(prev =>
        prev.map(c => c.id === cmd.id ? { ...c, showInStrip: next } : c)
      );
      notifySavedCommandsUpdated();
    }
  }

  // Fire when App passes a pendingCommand from the per-pane dropdown
  useEffect(() => {
    if (!pendingCommand) return;
    executeSavedCommandRef.current(pendingCommand.cmd);
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
        executeSavedCommandRef.current(match);
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
    const normalized = text.trim();

    // Intercept clear/reset so the React block list is wiped immediately,
    // regardless of whether the command came from the keyboard or a saved command.
    if (isLocalClearCommand(normalized)) {
      clearTerminalScreen();
      sendWs('raw_input', { data: normalized + '\r' });
      inputRef.current?.focus();
      return;
    }
    sendInputText(text);
  }

  // Always-current ref so stale closures (global key handler, pendingCommand effect) can call executeCommand
  const executeCommandRef = useRef(executeCommand);
  useLayoutEffect(() => { executeCommandRef.current = executeCommand; });
  const executeSavedCommandRef = useRef(executeSavedCommand);
  useLayoutEffect(() => { executeSavedCommandRef.current = executeSavedCommand; });

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // ── Raw terminal mode: forward all keystrokes directly to the PTY ─────
    if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
      e.preventDefault();
      shellTerminalRef.current?.focus();
      return;
    }

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
      // While a process is running, Enter sends input directly to the PTY
      if (waiting) {
        const text = input;
        setInput('');
        setProcessInputRequested(false);
        setProcessPasswordInput(false);

        // Simulate PTY echo: commit the current live output (e.g., "Username: ") + typed
        // text as a terminal block so the display looks like a real shell.
        // For password prompts the text is hidden; we just advance the line.
        const echoText = processPasswordInput ? '' : text;
        const { committed } = terminalStreamRef.current.consume(echoText + '\r\n');
        const sanitized = stripStandalonePromptNoise(committed);
        if (sanitized) {
          appendTerminalHtml(converterRef.current.convert(sanitized));
        }
        setLiveTerminalHtml('');

        // Set pending echo so the actual PTY echo is stripped when it arrives.
        if (!processPasswordInput && text) {
          pendingEchoRef.current = text;
          pendingEchoChunksRef.current = 0;
          if (pendingEchoTimerRef.current) clearTimeout(pendingEchoTimerRef.current);
          pendingEchoTimerRef.current = setTimeout(() => {
            pendingEchoRef.current = '';
            pendingEchoChunksRef.current = 0;
            pendingEchoTimerRef.current = null;
          }, 3000);
        }

        sendWs('raw_input', { data: text + '\r' });
        return;
      }
      const text = input.trim();
      setInput('');
      clearTabRequest();
      clearCompletionCycle();
      clearTabFeedback();
      setHistoryIndex(-1);
      if (!connected) return;
      if (text) {
        // Dangerous commands need an explicit confirmation before running
        if (isHighRiskCommand(text, highRiskRules)) {
          setDangerPending({ source: 'input', command: text });
          return;
        }
        executeCommand(text);
        return;
      }
      // Empty Enter → send newline to PTY (confirms prompts, triggers readline, etc.)
      sendWs('raw_input', { data: '\r' });
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
      if (aiTaskActive) {
        // Cancel the current natural-language task, including pending confirm / execution follow-up
        cancelAI();
      } else {
        interruptShellExecution();
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
      clearTerminalScreen();
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

    // Ctrl+P: history previous (same as ArrowUp) — skip while process is running
    if (e.ctrlKey && e.key === 'p') {
      e.preventDefault();
      if (!waiting) navigateHistoryUp();
      return;
    }

    // Ctrl+N: history next (same as ArrowDown) — skip while process is running
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      if (!waiting) navigateHistoryDown();
      return;
    }

    // Ctrl+B: open pasteboard
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      setShowPasteboard(prev => !prev);
      setTimeout(() => pasteboardRef.current?.focus(), 50);
      return;
    }

    // ArrowUp: history previous — skip while process is running
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!waiting) navigateHistoryUp();
      return;
    }

    // ArrowDown: history next — skip while process is running
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!waiting) navigateHistoryDown();
      return;
    }

    // PageUp: scroll terminal up
    if (e.key === 'PageUp') {
      e.preventDefault();
      if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
        shellTerminalRef.current?.pageUp();
      } else {
        scrollRef.current?.scrollBy({ top: -400, behavior: 'smooth' });
      }
      return;
    }

    // PageDown: scroll terminal down
    if (e.key === 'PageDown') {
      e.preventDefault();
      if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
        shellTerminalRef.current?.pageDown();
      } else {
        scrollRef.current?.scrollBy({ top: 400, behavior: 'smooth' });
      }
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
    saveCommandToHistoryRef.current(command);
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
    resetToFreshAISession();
    if (clearScreen) clearTerminalScreen();
  }

  /** Called when the native input detects a paste containing newlines. */
  function handleInputPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    // When a process is running (vim, etc.) open the pasteboard so the user can
    // review the content before sending — avoids direct-send garbling issues.
    if (waiting && !aiTaskActive && !aiGenerating) {
      e.preventDefault();
      setPasteboardText(prev => prev ? prev + text : text);
      setShowPasteboard(true);
      setTimeout(() => pasteboardRef.current?.focus(), 50);
      return;
    }
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
    if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
      pasteTextIntoRawTerminal(text);
      return;
    }
    // When a process is running (vim, interactive program) but NOT in xterm
    // alt-screen mode, send the text directly to the PTY as raw input instead
    // of going through the AI / command-queue path.
    if (waiting && !aiTaskActive && !aiGenerating) {
      const payload = bracketedPasteModeRef.current ? `\x1b[200~${text}\x1b[201~` : text;
      sendWs('raw_input', { data: payload });
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    executeMultilineText(text);
  }

  function closePasteboard() {
    setShowPasteboard(false);
    if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
      requestAnimationFrame(() => shellTerminalRef.current?.focus());
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function resetInlineComposer() {
    setInput('');
    setSearchMode(false);
    setHistoryIndex(-1);
    clearTabFeedback();
    clearTabRequest();
    clearCompletionCycle();
    closeCompletions();
  }

  function handleSettingsSaved() {
    sendWs('update_ai_config', {});
    window.dispatchEvent(new CustomEvent('ai-settings-updated'));
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
      setChatPanelState(prev => prev === 'visible' ? 'hidden' : 'visible');
      setActivePanel(null);
    } else {
      if (panel === 'clipboard') setHistoryTab('commands');
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
    const htermSel = shellTerminalRef.current?.getSelectionText() ?? '';
    const inputSel = inputRef.current
      ? inputRef.current.value.slice(
          inputRef.current.selectionStart ?? 0,
          inputRef.current.selectionEnd ?? 0,
        )
      : '';
    return windowSel || htermSel || inputSel || getCombinedRectSelectionText() || '';
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
    if (!getSelectedTerminalText()) {
      if ((rawTerminalModeRef.current || ptyDirectInputModeRef.current) && (e.target as HTMLElement | null)?.closest('.terminal-shell-host')) {
        shellTerminalRef.current?.focus();
      } else {
        inputRef.current?.focus();
      }
    }
  }

  function handleRectSelectionMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) return;
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
      const updated = [{ text, timestamp: new Date().toISOString() }, ...prev.filter(h => h.text !== text)].slice(0, 50);
      persistClipboardHistory('terminal-copy-history', updated);
      return updated;
    });
  }

  function normalizeCopiedText(text: string) {
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function getCommandCardCopyText(status: CommandCardStatus, command: string) {
    const prefix = {
      pending: '待确认命令',
      approved: '已自动批准',
      rejected: '已拒绝',
      executing: '执行中',
      done: '已执行完成',
      cancelled: '已中断',
    }[status];
    return `${prefix}\n${command}`;
  }

  function getTerminalBufferText() {
    const parts = blocks.flatMap((block): string[] => {
      switch (block.type) {
        case 'terminal': {
          const text = normalizeCopiedText(htmlToPlainText(block.html));
          return text ? [text] : [];
        }
        case 'ai_reply': {
          const text = normalizeCopiedText(block.text || (!block.complete ? aiStatusLine : ''));
          return text ? [text] : [];
        }
        case 'command_card': {
          const text = normalizeCopiedText(getCommandCardCopyText(block.status, block.command));
          return text ? [text] : [];
        }
        default:
          return [];
      }
    });

    if (liveTerminalHtml) {
      const liveText = normalizeCopiedText(htmlToPlainText(liveTerminalHtml));
      if (liveText) parts.push(liveText);
    }

    if (dangerPending) parts.push(`确认执行高危命令\n${dangerPending.command}`);
    if (aiTaskActive && aiStatusLine) parts.push(formatAIStatusLine(aiStatusLine, aiGenerating ? 'AI 正在思考...' : 'AI 任务进行中...'));
    if (queueStatus) parts.push(`正在执行第 ${queueStatus.current}/${queueStatus.total} 条命令`);
    if (!dangerPending && !waiting) parts.push(displayPrompt + input);
    if (!dangerPending && searchMode) parts.push(`→ ${currentSearchMatch || '(无匹配)'}`);

    return normalizeCopiedText(parts.join('\n\n'));
  }

  function getVisibleTerminalFlowText() {
    const container = scrollRef.current;
    if (!container) return '';

    const containerRect = container.getBoundingClientRect();
    const promptLine = !dangerPending && !waiting ? `${displayPrompt}${input}` : '';
    const parts = Array.from(container.children).flatMap((child): string[] => {
      const el = child as HTMLElement;
      if (el.dataset.copyExclude === 'true') return [];

      const rect = el.getBoundingClientRect();
      if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) return [];

      if (el.dataset.terminalPromptRow === 'true') {
        return promptLine ? [promptLine] : [];
      }

      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-copy-exclude="true"]').forEach(node => node.remove());
      const text = normalizeCopiedText(clone.innerText || clone.textContent || '');
      return text ? [text] : [];
    });

    return normalizeCopiedText(parts.join('\n\n'));
  }

  function handleCopyText(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    addTextToCopyHistory(text);
  }

  function handleCopyScreen() {
    const text = (rawTerminalModeRef.current || ptyDirectInputModeRef.current)
      ? shellTerminalRef.current?.getVisibleText() ?? ''
      : getVisibleTerminalFlowText() || getTerminalBufferText();
    if (text) handleCopyText(text);
  }

  function handleCopyBuffer() {
    const text = (rawTerminalModeRef.current || ptyDirectInputModeRef.current)
      ? shellTerminalRef.current?.getAllText() ?? ''
      : getTerminalBufferText();
    if (text) handleCopyText(text);
  }

  function insertTextIntoInlineInput(text: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? start;
    clearTabFeedback();
    clearTabRequest();
    clearCompletionCycle();
    closeCompletions();
    if (!searchMode) setHistoryIndex(-1);
    if (searchMode) setSearchResultIdx(0);
    setInput(prev => prev.slice(0, start) + text + prev.slice(end));
    nextCursorRef.current = start + text.length;
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function pasteTextIntoRawTerminal(text: string) {
    if (!text) return;
    shellTerminalRef.current?.pasteText(text);
    requestAnimationFrame(() => shellTerminalRef.current?.focus());
  }

  function routeClipboardTextToPasteboard(text: string) {
    setShowPasteboard(true);
    if (text) setPasteboardText(prev => prev ? prev + text : text);
    setTimeout(() => pasteboardRef.current?.focus(), 50);
  }

  // Send scroll keystrokes to the PTY when a full-screen TUI (vim etc.) is running.
  // Each call moves SCROLL_LINES lines; also updates the estimated scroll position indicator.
  function sendVimScroll(direction: 'up' | 'down') {
    const seq = (direction === 'up' ? '\x1b[A' : '\x1b[B').repeat(SCROLL_LINES);
    shellTerminalRef.current?.sendData(seq);
    const delta = direction === 'up' ? -1 : 1;
    const next = Math.max(0, Math.min(VIM_SCROLL_STEPS_RANGE, vimScrollStepsRef.current + delta));
    vimScrollStepsRef.current = next;
    console.log('[sendVimScroll]', direction, '→ steps=', next, 'pos=', (next / VIM_SCROLL_STEPS_RANGE).toFixed(4));
    setVimScrollPos(next / VIM_SCROLL_STEPS_RANGE);
  }

  // Called by HtermTerminal when a wheel event is forwarded to the PTY.
  // Data is already sent; we only update the scrollbar thumb position here.
  function updateVimScrollPos(direction: 'up' | 'down') {
    const delta = direction === 'up' ? -1 : 1;
    const next = Math.max(0, Math.min(VIM_SCROLL_STEPS_RANGE, vimScrollStepsRef.current + delta));
    vimScrollStepsRef.current = next;
    console.log('[updateVimScrollPos]', direction, '→ steps=', next, 'pos=', (next / VIM_SCROLL_STEPS_RANGE).toFixed(4));
    setVimScrollPos(next / VIM_SCROLL_STEPS_RANGE);
  }

  // Paste handler wired to HtermTerminal's onPasteText prop.
  // • Raw terminal / pty-direct mode (vim, etc.): paste directly into the PTY
  //   so Ctrl+V works exactly like a normal terminal emulator.
  // • Flow terminal mode (process running, waiting=true): open the pasteboard
  //   panel so the user can review/edit before sending.
  // • All other states: route to pasteboard as well.
  function handleHtermPaste(text: string) {
    if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
      pasteTextIntoRawTerminal(text);
    } else {
      routeClipboardTextToPasteboard(text);
    }
  }


  function handlePasteFromClipboard() {
    navigator.clipboard.readText().then(text => {
      if (!text) return;
      if (rawTerminalModeRef.current || ptyDirectInputModeRef.current) {
        routeClipboardTextToPasteboard(text);
        return;
      }
      // When a process is running (vim, etc.) open the pasteboard so the user can
      // review the content before sending — avoids direct-send garbling issues.
      // The document-level paste handler will have already pre-filled the text if
      // a paste event reached it; otherwise the pasteboard opens empty for manual paste.
      if (waiting && !aiTaskActive && !aiGenerating) {
        routeClipboardTextToPasteboard(text);
        return;
      }
      if (text.includes('\n')) {
        routeClipboardTextToPasteboard(text);
      } else {
        insertTextIntoInlineInput(text);
      }
    }).catch(() => {});
  }

  function handleAddToPasteHistory() {
    navigator.clipboard.readText().then(text => {
      if (!text) return;
      setPasteHistory(prev => {
        const updated = [{ text, timestamp: new Date().toISOString() }, ...prev.filter(h => h.text !== text)].slice(0, 50);
        persistClipboardHistory('terminal-paste-history', updated);
        return updated;
      });
      openHistoryPanel('paste');
    }).catch(() => {});
  }

  function openHistoryPanel(tab: HistoryTab = 'commands') {
    setHistoryTab(tab);
    setChatPanelState('hidden');
    setActivePanel('clipboard');
  }

  function clearCopyHistory() {
    setCopyHistory([]);
    try { localStorage.removeItem('terminal-copy-history'); } catch {}
  }

  function removeCopyHistoryItem(index: number) {
    setCopyHistory(prev => {
      const updated = prev.filter((_, i) => i !== index);
      persistClipboardHistory('terminal-copy-history', updated);
      return updated;
    });
  }

  function clearPasteHistory() {
    setPasteHistory([]);
    try { localStorage.removeItem('terminal-paste-history'); } catch {}
  }

  function removePasteHistoryItem(index: number) {
    setPasteHistory(prev => {
      const updated = prev.filter((_, i) => i !== index);
      persistClipboardHistory('terminal-paste-history', updated);
      return updated;
    });
  }

  async function saveCommandToFavorites(command: string) {
    const content = command.trim();
    if (!content) return;

    const existing = savedCommands.find(cmd => cmd.type === 'shell' && cmd.content.trim() === content);
    if (existing) {
      setConfigExportNotice({ tone: 'success', text: '该命令已在常用命令中' });
      window.setTimeout(() => setConfigExportNotice(current => (current?.text === '该命令已在常用命令中' ? null : current)), 2500);
      return;
    }

    const name = content.length > 24 ? `${content.slice(0, 24)}...` : content;

    try {
      const res = await fetch('/api/saved-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, type: 'shell' }),
      });
      if (!res.ok) throw new Error(`保存失败 (${res.status})`);
      const created = await res.json();
      setSavedCommands(prev => [...prev, created]);
      window.dispatchEvent(new Event('saved-commands-updated'));
      setConfigExportNotice({ tone: 'success', text: '已加入常用命令' });
      window.setTimeout(() => setConfigExportNotice(current => (current?.text === '已加入常用命令' ? null : current)), 2500);
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存常用命令失败';
      setConfigExportNotice({ tone: 'error', text: message });
      window.setTimeout(() => setConfigExportNotice(current => (current?.text === message ? null : current)), 3000);
    }
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
    sendWs('set_charset', { charset: value });
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

  const nonTerminalBlocks = useMemo(
    () => blocks.filter((block): block is Exclude<Block, { type: 'terminal' }> => block.type !== 'terminal'),
    [blocks],
  );
  const pasteboardIntent = classifyPastedText(pasteboardText);
  const pasteboardCommands = parseLogicalCommands(pasteboardText);
  const pasteboardCommandCount = pasteboardCommands.length;
  const rectangularSourceLines = useMemo(() => {
    const logicalLines = blocks
      .filter((b): b is Extract<Block, { type: 'terminal' }> => b.type === 'terminal')
      .map(b => htmlToPlainText(b.html))
      .join('')
      .split(/\r?\n/);

    if (liveTerminalHtml) {
      const liveText = htmlToPlainText(liveTerminalHtml);
      if (logicalLines.length === 0) {
        logicalLines.push(liveText);
      } else {
        logicalLines[logicalLines.length - 1] += liveText;
      }
    }

    if (!waiting && !dangerPending) logicalLines.push(displayPrompt + input);

    return wrapTerminalLines(logicalLines, termSize.cols || 80);
  }, [blocks, dangerPending, displayPrompt, input, liveTerminalHtml, termSize.cols, waiting]);

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
        <Sidebar activePanel={chatPanelState === 'visible' ? 'chat' : activePanel} onPanelToggle={handlePanelToggle} isPrimary={isPrimary} />
      )}

      {/* ── Inline side panel (history / userinfo / files / hosts / commands) ── */}
      <>
        {/* Panel body */}
        <div
          className="flex-shrink-0 flex flex-col bg-terminal-surface overflow-hidden"
          style={{ width: sidePanelWidth, borderRight: '1px solid rgb(var(--tw-c-border))', display: activePanel ? undefined : 'none' }}
        >

            {/* ── History center ──────────────────────────────────────── */}
            <div style={{ display: activePanel === 'clipboard' ? 'contents' : 'none' }}>
            {(() => {
              const hostKey = connInfo.host || `${config.username}@${config.host}`;
              const filtered = historySearch.trim()
                ? historyEntries.filter(e => e.command.toLowerCase().includes(historySearch.toLowerCase()))
                : historyEntries;
              const tabs: { id: HistoryTab; label: string; count: number }[] = [
                { id: 'commands', label: '命令', count: historyEntries.length },
                { id: 'copy', label: '复制', count: copyHistory.length },
                { id: 'paste', label: '粘贴', count: pasteHistory.length },
              ];
              const activeHistoryCount = historyTab === 'commands'
                ? historyEntries.length
                : historyTab === 'copy'
                  ? copyHistory.length
                  : pasteHistory.length;

              function deleteEntry(id: string) {
                const cmd = historyEntries.find(e => e.id === id)?.command;
                fetch(`/api/command-history/${id}`, { method: 'DELETE' }).catch(() => {});
                setHistoryEntries(prev => prev.filter(e => e.id !== id));
                if (cmd) setCmdHistory(prev => prev.filter(c => c !== cmd));
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

              function closeHistoryPanel() {
                setActivePanel(null);
                setHistorySearch('');
              }

              return (
                <>
                  <div className="px-3 py-3 border-b border-terminal-border flex-shrink-0 select-none">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-md bg-terminal-blue/10 text-terminal-blue flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Clipboard className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-terminal-text">历史记录</span>
                            <span className="text-[10px] text-terminal-muted bg-terminal-border/40 rounded px-1">{activeHistoryCount}</span>
                          </div>
                          <div className="text-[10px] text-terminal-muted mt-0.5 truncate">
                            {historyTab === 'commands'
                              ? `当前主机 · ${hostKey}`
                              : historyTab === 'copy'
                                ? '复制到系统剪贴板的文本会收纳在这里'
                                : '常用粘贴内容可以在这里快速重发'}
                          </div>
                        </div>
                      </div>
                      <button onClick={closeHistoryPanel}
                        className="text-terminal-muted hover:text-terminal-text transition-colors flex-shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-1 rounded-lg bg-terminal-bg p-1">
                      {tabs.map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setHistoryTab(tab.id)}
                          className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${historyTab === tab.id
                            ? 'bg-terminal-blue/15 text-terminal-blue'
                            : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/40'
                          }`}
                        >
                          {tab.id === 'commands' ? <Clipboard className="w-3 h-3" /> : tab.id === 'copy' ? <Copy className="w-3 h-3" /> : <ClipboardPaste className="w-3 h-3" />}
                          <span>{tab.label}</span>
                          <span className={`rounded px-1 py-0.5 text-[10px] leading-none ${historyTab === tab.id
                            ? 'bg-terminal-blue/10 text-terminal-blue'
                            : 'bg-terminal-border/40 text-terminal-muted'
                          }`}>{tab.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-2 py-1.5 border-b border-terminal-border/50 flex-shrink-0">
                    {historyTab === 'commands' ? (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-terminal-bg rounded-lg px-2 py-1 flex-1 min-w-0">
                          <Search className="w-3 h-3 text-terminal-muted flex-shrink-0" />
                          <input type="text" placeholder="搜索历史命令..." value={historySearch}
                            onChange={e => setHistorySearch(e.target.value)}
                            className="flex-1 bg-transparent text-xs text-terminal-text placeholder:text-terminal-muted/60 outline-none font-mono min-w-0" />
                          {historySearch && (
                            <button onClick={() => setHistorySearch('')} className="text-terminal-muted hover:text-terminal-text text-[10px]">✕</button>
                          )}
                        </div>
                        {historyEntries.length > 0 && (
                          <button onClick={clearAll} title="清空当前主机历史"
                            className="flex items-center gap-0.5 px-2 py-1 text-[10px] text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 rounded-md transition-colors flex-shrink-0">
                            <Trash2 className="w-3 h-3" />清空
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 px-1">
                        <span className="text-[10px] text-terminal-muted truncate">
                          {historyTab === 'copy' ? '点击条目可再次复制到剪贴板' : '点击条目可直接发送到终端'}
                        </span>
                        {activeHistoryCount > 0 && (
                          <button
                            onClick={historyTab === 'copy' ? clearCopyHistory : clearPasteHistory}
                            className="flex items-center gap-0.5 px-2 py-1 text-[10px] text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 rounded-md transition-colors flex-shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />清空
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {historyTab === 'commands' ? (
                    filtered.length === 0 ? (
                      <div className="px-3 py-8 text-center text-xs text-terminal-muted">
                        <Clipboard className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        {historySearch ? '无匹配命令' : '暂无历史命令'}
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                        {filtered.map(entry => (
                          <div key={entry.id}
                            className="group flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-terminal-border/25 transition-colors cursor-pointer"
                            onClick={() => insertFromHistory(entry.command)} title="点击插入到输入框">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-mono text-terminal-text truncate">{entry.command}</div>
                              <div className="text-[10px] text-terminal-muted/70 mt-0.5">{relativeTime(entry.timestamp)}</div>
                            </div>
                            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                              <button onClick={e => { e.stopPropagation(); saveCommandToFavorites(entry.command); }} title="加入常用命令"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-yellow hover:bg-terminal-yellow/10 transition-colors">
                                <BookMarked className="w-3 h-3" />
                              </button>
                              <button onClick={e => { e.stopPropagation(); insertFromHistory(entry.command); }} title="插入"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors">
                                <ChevronRight className="w-3 h-3" />
                              </button>
                              <button onClick={e => { e.stopPropagation(); runEntry(entry.command); }} title="直接执行"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/10 transition-colors">
                                <Play className="w-3 h-3" />
                              </button>
                              <button onClick={e => { e.stopPropagation(); handleCopyText(entry.command); }} title="复制命令"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-yellow hover:bg-terminal-yellow/10 transition-colors">
                                <Copy className="w-3 h-3" />
                              </button>
                              <button onClick={e => { e.stopPropagation(); deleteEntry(entry.id); }} title="删除"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 transition-colors">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : historyTab === 'copy' ? (
                    copyHistory.length === 0 ? (
                      <div className="px-3 py-8 text-center text-xs text-terminal-muted">
                        <Clipboard className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        暂无复制历史
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                        {copyHistory.map((item, i) => (
                          <div
                            key={`${i}-${item.text.slice(0, 24)}`}
                            className="group flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-terminal-border/25 transition-colors cursor-pointer"
                            onClick={() => handleCopyText(item.text)}
                            title="点击复制到剪贴板"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-mono text-terminal-text whitespace-pre-wrap break-all leading-5">{item.text}</div>
                              <div className="text-[10px] text-terminal-muted/70 mt-1">{relativeTime(item.timestamp)}</div>
                            </div>
                            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  handleCopyText(item.text);
                                }}
                                title="复制"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-yellow hover:bg-terminal-yellow/10 transition-colors"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  removeCopyHistoryItem(i);
                                }}
                                title="删除"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : (
                    pasteHistory.length === 0 ? (
                      <div className="px-3 py-8 text-center text-xs text-terminal-muted">
                        <Clipboard className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        暂无粘贴历史
                      </div>
                    ) : (
                      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                        {pasteHistory.map((item, i) => (
                          <div
                            key={`${i}-${item.text.slice(0, 24)}`}
                            className="group flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-terminal-border/25 transition-colors cursor-pointer"
                            onClick={() => sendWs('raw_input', { data: item.text + '\r' })}
                            title="点击发送到终端"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-mono text-terminal-text whitespace-pre-wrap break-all leading-5">{item.text}</div>
                              <div className="text-[10px] text-terminal-muted/70 mt-1">{relativeTime(item.timestamp)}</div>
                            </div>
                            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  sendWs('raw_input', { data: item.text + '\r' });
                                }}
                                title="发送到终端"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/10 transition-colors"
                              >
                                <SendHorizonal className="w-3 h-3" />
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  handleCopyText(item.text);
                                }}
                                title="复制"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-yellow hover:bg-terminal-yellow/10 transition-colors"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  removePasteHistoryItem(i);
                                }}
                                title="删除"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </>
              );
            })()}
            </div>

            {/* ── Session info ────────────────────────────────────────── */}
            <div style={{ display: activePanel === 'userinfo' ? 'contents' : 'none' }}>
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
            </div>

            {/* ── File manager ────────────────────────────────────────── */}
            <div style={{ display: activePanel === 'files' ? 'contents' : 'none' }}>
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
            </div>

            {/* ── Host management ─────────────────────────────────────── */}
            <div style={{ display: activePanel === 'hosts' ? 'contents' : 'none' }}>
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
            </div>

            {/* ── Saved commands ──────────────────────────────────────── */}
            <div style={{ display: activePanel === 'commands' ? 'contents' : 'none' }}>
              <>
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-terminal-border flex-shrink-0">
                  <span className="text-xs font-medium text-terminal-text">常用命令</span>
                  <button onClick={() => setActivePanel(null)} className="text-terminal-muted hover:text-terminal-text transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-terminal-border bg-terminal-surface px-2.5 py-2">
                    <div>
                      <div className="text-xs font-medium text-terminal-text">常用命令管理</div>
                      <div className="text-[10px] text-terminal-muted">在这里直接新增、编辑、删除和执行常用命令</div>
                    </div>
                    <button
                      onClick={() => {
                        setShowAddSavedCommand(prev => !prev);
                        setEditingSavedCommand(null);
                        setSavedCommandError('');
                        if (showAddSavedCommand) resetNewSavedCommand();
                      }}
                      className="flex items-center gap-1 rounded-md border border-terminal-blue/30 bg-terminal-blue/15 px-2 py-1 text-[11px] text-terminal-blue hover:bg-terminal-blue/25 transition-colors"
                    >
                      <Plus className="w-3 h-3" />添加
                    </button>
                  </div>

                  {savedCommandError && (
                    <div className="flex items-center gap-2 rounded-lg border border-terminal-red/20 bg-terminal-red/10 px-3 py-2 text-[11px] text-terminal-red">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {savedCommandError}
                    </div>
                  )}

                  {showAddSavedCommand && (
                    <div className="space-y-3 rounded-xl border border-terminal-blue/30 bg-terminal-surface p-3">
                      <div className="text-xs font-medium text-terminal-blue">新建常用命令</div>
                      <div className="space-y-2">
                        <div>
                          <label className="mb-1 block text-[10px] text-terminal-muted">名称</label>
                          <input
                            type="text"
                            value={newSavedCommand.name}
                            onChange={e => setNewSavedCommand(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="例：查看磁盘使用"
                            className="w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:border-terminal-blue focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-terminal-muted">类型</label>
                          <div className="flex gap-2">
                            {(['shell', 'natural'] as const).map(type => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => setNewSavedCommand(prev => ({ ...prev, type }))}
                                className={`flex-1 rounded-lg border py-2 text-xs transition-colors ${
                                  newSavedCommand.type === type
                                    ? 'border-terminal-blue/50 bg-terminal-blue/20 text-terminal-blue'
                                    : 'border-terminal-border bg-terminal-bg text-terminal-muted hover:border-terminal-blue/40'
                                }`}
                              >
                                {type === 'shell' ? 'Shell 命令' : 'AI 自然语言'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-terminal-muted">内容</label>
                          <textarea
                            value={newSavedCommand.content}
                            onChange={e => setNewSavedCommand(prev => ({ ...prev, content: e.target.value }))}
                            rows={3}
                            placeholder={newSavedCommand.type === 'shell' ? 'df -h\nfree -h\nuptime' : '帮我查看磁盘使用情况并找出大文件'}
                            className="w-full resize-none rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-xs font-mono text-terminal-text placeholder-terminal-muted/40 focus:border-terminal-blue focus:outline-none"
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-[10px] text-terminal-muted">快捷键</label>
                            <KeyRecorder
                              value={newSavedCommand.shortcut || '（未设置）'}
                              onChange={k => setNewSavedCommand(prev => ({ ...prev, shortcut: k === '（未设置）' ? '' : k }))}
                              onCancel={() => {}}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] text-terminal-muted">备注</label>
                            <input
                              type="text"
                              value={newSavedCommand.description}
                              onChange={e => setNewSavedCommand(prev => ({ ...prev, description: e.target.value }))}
                              placeholder="简短说明用途"
                              className="w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:border-terminal-blue focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={addSavedCommandInline}
                          disabled={savedCommandSaving || !newSavedCommand.name.trim() || !newSavedCommand.content.trim()}
                          className="flex items-center gap-1.5 rounded-lg bg-terminal-blue px-3 py-2 text-xs text-white transition-colors hover:bg-terminal-blue/80 disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />{savedCommandSaving ? '保存中...' : '保存'}
                        </button>
                        <button
                          onClick={() => { setShowAddSavedCommand(false); setSavedCommandError(''); resetNewSavedCommand(); }}
                          className="rounded-lg border border-terminal-border px-3 py-2 text-xs text-terminal-muted transition-colors hover:text-terminal-text"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}

                  {savedCommands.length === 0 && !showAddSavedCommand ? (
                    <div className="px-3 py-8 text-center text-xs text-terminal-muted">
                      <BookMarked className="mx-auto mb-2 h-6 w-6 opacity-30" />
                      <p>暂无常用命令</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {savedCommands.map(cmd => (
                        <div key={cmd.id} className="rounded-xl border border-terminal-border bg-terminal-surface p-3 group">
                          {editingSavedCommand?.id === cmd.id ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                                <div>
                                  <label className="mb-1 block text-[10px] text-terminal-muted">名称</label>
                                  <input
                                    type="text"
                                    value={editingSavedCommand.name}
                                    onChange={e => setEditingSavedCommand(prev => prev ? { ...prev, name: e.target.value } : null)}
                                    className="w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-xs text-terminal-text focus:border-terminal-blue focus:outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] text-terminal-muted">类型</label>
                                  <div className="flex gap-2">
                                    {(['shell', 'natural'] as const).map(type => (
                                      <button
                                        key={type}
                                        type="button"
                                        onClick={() => setEditingSavedCommand(prev => prev ? { ...prev, type } : null)}
                                        className={`flex-1 rounded-lg border py-2 text-xs transition-colors ${
                                          editingSavedCommand.type === type
                                            ? 'border-terminal-blue/50 bg-terminal-blue/20 text-terminal-blue'
                                            : 'border-terminal-border bg-terminal-bg text-terminal-muted'
                                        }`}
                                      >
                                        {type === 'shell' ? 'Shell' : 'AI'}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] text-terminal-muted">内容</label>
                                <textarea
                                  value={editingSavedCommand.content}
                                  onChange={e => setEditingSavedCommand(prev => prev ? { ...prev, content: e.target.value } : null)}
                                  rows={3}
                                  className="w-full resize-none rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-xs font-mono text-terminal-text focus:border-terminal-blue focus:outline-none"
                                />
                              </div>
                              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                                <div>
                                  <label className="mb-1 block text-[10px] text-terminal-muted">快捷键</label>
                                  <KeyRecorder
                                    value={editingSavedCommand.shortcut || '（未设置）'}
                                    onChange={k => setEditingSavedCommand(prev => prev ? { ...prev, shortcut: k === '（未设置）' ? '' : k } : null)}
                                    onCancel={() => {}}
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] text-terminal-muted">备注</label>
                                  <input
                                    type="text"
                                    value={editingSavedCommand.description}
                                    onChange={e => setEditingSavedCommand(prev => prev ? { ...prev, description: e.target.value } : null)}
                                    className="w-full rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2 text-xs text-terminal-text focus:border-terminal-blue focus:outline-none"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => updateSavedCommandInline(editingSavedCommand)}
                                  disabled={savedCommandSaving}
                                  className="flex items-center gap-1.5 rounded-lg bg-terminal-blue px-3 py-2 text-xs text-white transition-colors hover:bg-terminal-blue/80 disabled:opacity-50"
                                >
                                  <Save className="w-3.5 h-3.5" />{savedCommandSaving ? '保存中...' : '保存'}
                                </button>
                                <button
                                  onClick={() => { setEditingSavedCommand(null); setSavedCommandError(''); }}
                                  className="rounded-lg border border-terminal-border px-3 py-2 text-xs text-terminal-muted transition-colors hover:text-terminal-text"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  onClick={() => { executeSavedCommand(cmd); setActivePanel(null); }}
                                  title={cmd.content}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="truncate text-xs font-medium text-terminal-text group-hover:text-terminal-blue transition-colors">{cmd.name}</span>
                                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${
                                      cmd.type === 'natural'
                                        ? 'border-terminal-cyan/30 bg-terminal-cyan/10 text-terminal-cyan'
                                        : 'border-terminal-green/30 bg-terminal-green/10 text-terminal-green'
                                    }`}>
                                      {cmd.type === 'natural' ? 'AI' : 'Shell'}
                                    </span>
                                    {cmd.shortcut && (
                                      <span className="flex-shrink-0 rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[9px] font-mono text-terminal-muted">{cmd.shortcut}</span>
                                    )}
                                  </div>
                                  <div className="truncate text-[10px] font-mono text-terminal-muted">{cmd.content}</div>
                                  {cmd.description && (
                                    <div className="mt-0.5 truncate text-[10px] text-terminal-muted/70">{cmd.description}</div>
                                  )}
                                </button>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button
                                    onClick={() => toggleStripVisibilityInline(cmd)}
                                    title={cmd.showInStrip !== false ? '在悬浮栏显示（点击关闭）' : '已从悬浮栏隐藏（点击开启）'}
                                    className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                                      cmd.showInStrip !== false
                                        ? 'text-terminal-blue hover:bg-terminal-blue/10'
                                        : 'text-terminal-muted hover:bg-terminal-border/40 hover:text-terminal-text'
                                    }`}
                                  >
                                    {cmd.showInStrip !== false
                                      ? <Eye className="w-3.5 h-3.5" />
                                      : <EyeOff className="w-3.5 h-3.5" />}
                                  </button>
                                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                    <button
                                      onClick={() => { setEditingSavedCommand({ ...cmd, shortcut: cmd.shortcut || '', description: cmd.description || '' }); setShowAddSavedCommand(false); setSavedCommandError(''); }}
                                      className="flex h-7 w-7 items-center justify-center rounded-md text-terminal-muted transition-colors hover:bg-terminal-border/40 hover:text-terminal-text"
                                      title="编辑"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => deleteSavedCommandInline(cmd.id)}
                                      className="flex h-7 w-7 items-center justify-center rounded-md text-terminal-muted transition-colors hover:bg-terminal-red/10 hover:text-terminal-red"
                                      title="删除"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                              <div className="mt-2 flex justify-end">
                                <button
                                  onClick={() => { executeSavedCommand(cmd); setActivePanel(null); }}
                                  className="flex items-center gap-1 rounded-md border border-terminal-border px-2 py-1 text-[10px] text-terminal-muted transition-colors hover:border-terminal-blue/40 hover:text-terminal-blue"
                                >
                                  <Play className="w-3 h-3" />执行
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}

                      <div className="pt-1 border-t border-terminal-border/50 mt-1">
                        <button
                          onClick={() => { setActivePanel(null); setSettingsSection('commands'); setShowSettings(true); }}
                          className="w-full text-center text-[10px] text-terminal-muted hover:text-terminal-blue py-1.5 transition-colors flex items-center justify-center gap-1"
                        >
                          <Settings2 className="w-3 h-3" />
                          在设置中查看完整命令配置
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            </div>

          </div>

          {/* Resize divider — drag to change panel width */}
          <div
            className="flex-shrink-0 w-1 cursor-col-resize relative group"
            style={{ background: 'rgb(var(--tw-c-border))', display: activePanel ? undefined : 'none' }}
            onPointerDown={startPanelResize}
            title="拖动调整面板宽度"
          >
            <div className="absolute inset-0 group-hover:bg-terminal-blue/50 transition-colors" />
          </div>
        </>

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

        {/* ── Main terminal area ─────────────────────────────────────────── */}
        <div
          className={`relative flex-1 min-h-0 terminal-area flex flex-col gap-2${terminalPassthroughMode ? '' : ' px-3 py-2'}`}
          onContextMenu={handleContextMenu}
        >
          <div
            ref={scrollRef}
            data-allow-selection="true"
            className={`terminal-shell-host relative flex-1 bg-terminal-bg select-text ${
              terminalPassthroughMode
                ? 'overflow-hidden'
                : 'min-h-[260px] rounded-none border border-terminal-border/80 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] overflow-y-auto overflow-x-hidden scroll-smooth'
            }`}
            style={terminalTextStyle}
            onMouseDown={handleRectSelectionMouseDown}
            onClick={handleTerminalAreaClick}
            onMouseUp={maybeAutoCopySelection}
          >
            <div
              data-copy-exclude="true"
              className={`absolute inset-0 z-10 ${terminalPassthroughMode ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
              aria-hidden={!terminalPassthroughMode}
            >
              <HtermTerminal
                ref={shellTerminalRef}
                settings={termSettings}
                onData={handleRawTerminalData}
                onPasteText={handleHtermPaste}
                onResize={handleTerminalResize}
                onVimScroll={updateVimScrollPos}
                className="h-full w-full"
              />
            </div>

            {/* ── Vim scrollbar overlay ───────────────────────────────────────
                Rendered as a DIRECT child of terminal-shell-host (outside the
                hterm container) so its z-index is not constrained by the
                iframe's stacking context.                                      */}
            {terminalPassthroughMode && (
              <VimScrollbar
                scrollPos={vimScrollPos}
                onScrollUp={() => sendVimScroll('up')}
                onScrollDown={() => sendVimScroll('down')}
                onSeek={(ratio) => {
                  const target = Math.round(ratio * VIM_SCROLL_STEPS_RANGE);
                  const current = vimScrollStepsRef.current;
                  const delta = target - current;
                  if (delta === 0) return;
                  const dir = delta > 0 ? 'down' : 'up';
                  const seq = (dir === 'up' ? '\x1b[A' : '\x1b[B').repeat(Math.abs(delta) * SCROLL_LINES);
                  shellTerminalRef.current?.sendData(seq);
                  vimScrollStepsRef.current = target;
                  setVimScrollPos(ratio);
                }}
              />
            )}

            {!terminalPassthroughMode && blocks.map((block) => {
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

            {!terminalPassthroughMode && liveTerminalHtml && (
              <div
                className="terminal-output whitespace-pre-wrap break-words select-text cursor-text"
                style={terminalTextStyle}
                dangerouslySetInnerHTML={{
                  __html: liveTerminalHtml +
                    (waiting && !processPasswordInput && input
                      ? input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      : '')
                }}
              />
            )}

            {!terminalPassthroughMode && dangerPending && (
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

            {!terminalPassthroughMode && aiTaskActive && (
              <div className="flex items-center justify-center gap-3 py-1.5 text-xs text-terminal-muted">
                <span className="max-w-[32rem] truncate">{formatAIStatusLine(aiStatusLine, aiGenerating ? 'AI 正在思考...' : 'AI 任务进行中...')}</span>
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

            {!terminalPassthroughMode && queueStatus && (
              <div className="flex items-center gap-2 px-2 py-1 text-[11px] select-none"
                style={{ color: 'rgb(var(--tw-c-muted))' }}>
                <span className="inline-block w-2.5 h-2.5 rounded-full border border-current border-t-transparent animate-spin flex-shrink-0" />
                <span>
                  正在执行第 <span style={{ color: 'rgb(var(--tw-c-blue))' }}>{queueStatus.current}</span>
                  /{queueStatus.total} 条命令
                </span>
                <button
                  onClick={interruptShellExecution}
                  className="ml-auto text-[10px] hover:text-terminal-red transition-colors"
                >
                  中断并取消 <kbd className="opacity-50">Ctrl+C</kbd>
                </button>
              </div>
            )}

            {!dangerPending && !terminalPassthroughMode && (
              <div
                data-terminal-prompt-row="true"
                data-allow-selection="true"
                className="flex items-center mt-0.5"
                style={{ minHeight: `${terminalMetrics.lineHeightPx}px` }}
                onClick={e => {
                  e.stopPropagation();
                  if (!getSelectedTerminalText()) inputRef.current?.focus();
                }}
              >
                <span
                  className="select-text cursor-text whitespace-pre flex-shrink-0"
                  style={{
                    ...terminalTextStyle,
                    color: promptColor,
                    minHeight: `${terminalMetrics.lineHeightPx}px`,
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  {waiting ? '' : displayPrompt}
                </span>
                <div
                  ref={completionAnchorRef}
                  className="relative flex-1 min-w-0 rounded-sm transition-shadow"
                  style={tabFeedback === 'nomatch'
                    ? {
                      boxShadow: '0 0 0 1px rgb(var(--tw-c-yellow) / 0.55)',
                      minHeight: `${terminalMetrics.lineHeightPx}px`,
                    }
                    : { minHeight: `${terminalMetrics.lineHeightPx}px` }}
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
                    border: '1px solid rgb(var(--tw-c-yellow) / 0.28)',
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
              <div
                className="pointer-events-none relative"
                aria-hidden="true"
                style={{ minHeight: `${terminalMetrics.lineHeightPx}px` }}
              />
              {showCustomCursor && !processPasswordInput && (
                <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden="true">
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
                placeholder={
                  !connected ? '正在连接…'
                  : waiting   ? ''
                  : aiConfigured ? '输入自然语言或命令，AI将智能响应，试试打个招呼吧'
                  : ''
                }
                disabled={!connected}
                className="absolute inset-0 h-full w-full bg-transparent outline-none min-w-0 placeholder:text-terminal-muted/18 disabled:opacity-40"
                style={{
                  ...terminalTextStyle,
                  caretColor: (waiting && !!liveTerminalHtml) ? 'transparent' : 'rgb(var(--tw-c-green))',
                  color: (waiting && !!liveTerminalHtml) ? 'transparent' : 'rgb(var(--tw-c-term-fg))',
                  WebkitTextFillColor: (waiting && !!liveTerminalHtml) ? 'transparent' : 'rgb(var(--tw-c-term-fg))',
                  height: `${terminalMetrics.lineHeightPx}px`,
                  lineHeight: `${terminalMetrics.lineHeightPx}px`,
                  padding: 0,
                  border: 0,
                  opacity: 1,
                  zIndex: 15,
                }}
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

            {!dangerPending && !terminalPassthroughMode && searchMode && (
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

            {!terminalPassthroughMode && <div className="h-4" />}
          </div>
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
                  onClick={closePasteboard}
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
                    closePasteboard();
                  }
                }}
                placeholder={pasteIntoProcess ? '输入要贴入当前终端程序的文本，Enter 换行，Shift+Enter 贴入' : '输入命令，Enter 换行，Shift+Enter 发送'}
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
                  {pasteIntoProcess ? (
                    <>原样贴入当前终端程序（如 vim） · Shift+Enter 贴入 · Esc 关闭</>
                  ) : pasteboardIntent === 'command' && pasteboardCommandCount > 0 ? (
                    <>{pasteboardCommandCount} 条命令 · 逐条顺序执行 · Shift+Enter 发送 · Esc 关闭</>
                  ) : pasteboardText.trim() ? (
                    <>检测为自然语言/配置内容 · 整段交给 AI，不直接执行到 shell · Shift+Enter 发送 · Esc 关闭</>
                  ) : (
                    <>粘贴自然语言、配置片段或多行命令</>
                  )}
                </span>
                <button
                  onClick={sendFromPasteboard}
                  disabled={!pasteboardText.trim()}
                  className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-terminal-blue/20 text-terminal-blue hover:bg-terminal-blue/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <SendHorizonal className="w-3 h-3" />
                  {pasteIntoProcess
                    ? '贴入终端'
                    : (pasteboardIntent === 'command' && pasteboardCommandCount > 1 ? `顺序执行 (${pasteboardCommandCount})` : '发送')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right: AI Chat Panel — always mounted, CSS-hidden when not visible */}
      <AIChatPanel
        onClose={() => setChatPanelState('hidden')}
        onMinimize={() => setChatPanelState('minimized')}
        visible={chatPanelState === 'visible'}
      />

      {/* Floating bubble when AI chat is minimized (WeChat mini-program style) */}
      {chatPanelState === 'minimized' && (
        <div className="absolute bottom-16 right-4 z-50">
          <button
            onClick={() => setChatPanelState('visible')}
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
          appendToCopyHistory={appendToCopyHistory}
          charset={charset}
          onClose={() => setContextMenu(null)}
          onNewTerminal={() => { setContextMenu(null); onNewTab?.(config); }}
          onCopySelection={() => handleCopyText(contextMenu.selectedText)}
          onCopyScreen={handleCopyScreen}
          onCopyBuffer={handleCopyBuffer}
          onToggleAppendToCopyHistory={() => {
            setAppendToCopyHistory(p => {
              const next = !p;
              try { localStorage.setItem('terminal-append-copy-history', String(next)); } catch {}
              return next;
            });
          }}
          onShowCopyHistory={() => openHistoryPanel('copy')}
          onPaste={handlePasteFromClipboard}
          onAddToPasteHistory={handleAddToPasteHistory}
          onShowPasteHistory={() => openHistoryPanel('paste')}
          onSetCharset={handleSetCharset}
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
