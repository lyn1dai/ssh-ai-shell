import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Folder, File, Link, Download, Trash2, Upload, FolderPlus,
  RefreshCw, Home, AlertCircle, Loader2, Search, X, Pencil,
  ChevronRight, ChevronDown, FileText, Save, PanelRightClose, Copy, Check, RotateCcw,
} from 'lucide-react';
import type { SFTPFile } from '../types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTransferSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '--';
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  if (bytesPerSecond < 1024 * 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
  return `${(bytesPerSecond / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}

function formatDate(ts: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
}

function joinPath(...parts: string[]): string {
  const p = parts.join('/').replace(/\/+/g, '/');
  return p || '/';
}

function parentPath(path: string): string {
  if (path === '/') return '/';
  const parts = path.replace(/\/$/, '').split('/');
  parts.pop();
  return parts.join('/') || '/';
}

function createUploadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getAncestorPaths(path: string): string[] {
  const normalized = path === '/' ? '/' : path.replace(/\/$/, '');
  if (normalized === '/') return ['/'];
  const parts = normalized.split('/').filter(Boolean);
  const paths = ['/'];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    paths.push(current);
  }
  return paths;
}

function isProbablyTextFile(file: SFTPFile): boolean {
  if (file.type !== 'file') return false;
  if (file.size > 1024 * 1024) return false;
  const lower = file.name.toLowerCase();
  const dotfileNames = new Set([
    '.bash_history', '.zsh_history', '.python_history',
    '.bashrc', '.zshrc', '.profile', '.bash_profile', '.zprofile', '.zlogin', '.zlogout',
    '.inputrc', '.vimrc', '.gvimrc', '.tmux.conf', '.screenrc', '.nanorc',
    '.gitconfig', '.gitignore', '.gitattributes', '.gitmodules',
    '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs', '.editorconfig',
    '.env', '.envrc', '.prettierrc', '.eslintrc', '.babelrc', '.stylelintrc',
    '.dockerignore', '.npmignore', '.wgetrc', '.curlrc',
  ]);
  const textExts = [
    '.txt', '.md', '.markdown', '.log', '.json', '.yml', '.yaml', '.toml', '.ini', '.conf', '.cfg',
    '.env', '.xml', '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue',
    '.py', '.sh', '.bash', '.zsh', '.java', '.go', '.rs', '.c', '.cc', '.cpp', '.h', '.hpp', '.sql',
    '.csv', '.tsv', '.gitignore', '.dockerfile', '.properties', '.pem', '.crt', '.key', '.service',
  ];
  if (textExts.some(ext => lower.endsWith(ext))) return true;
  if (dotfileNames.has(lower)) return true;
  if (/^\.(?:.*\.)?(?:rc|conf|cfg|profile|aliases|exports|functions|history)$/.test(lower)) return true;
  return !lower.includes('.');
}

function createVirtualTextFile(filePath: string): SFTPFile {
  const normalized = filePath === '/' ? '/' : filePath.replace(/\/+$/, '');
  const name = normalized.split('/').filter(Boolean).pop() || normalized || '/';
  return {
    name,
    path: normalized,
    type: 'file',
    size: 0,
    modifyTime: Date.now(),
    permissions: '---------',
  };
}

function isMissingFileError(message: string): boolean {
  return /(not found|no such file|enoent|不存在|未找到)/i.test(message);
}

function createEmptyEditorState(): TextEditorState {
  return {
    file: null,
    content: '',
    originalContent: '',
    loading: false,
    saving: false,
    error: null,
  };
}

function getEditorPanelBounds(layoutWidth: number): { min: number; max: number } {
  const gutter = layoutWidth < 720 ? 12 : 24;
  const max = Math.max(320, layoutWidth - gutter);
  const min = layoutWidth < 720
    ? max
    : Math.min(max, Math.max(380, Math.round(layoutWidth * 0.34)));
  return { min, max };
}

function clampEditorPanelWidth(width: number, layoutWidth: number): number {
  const { min, max } = getEditorPanelBounds(layoutWidth);
  return Math.max(min, Math.min(width, max));
}

function getDefaultEditorPanelWidth(layoutWidth: number): number {
  const ratio = layoutWidth < 720 ? 1 : 0.58;
  return clampEditorPanelWidth(Math.round(layoutWidth * ratio), layoutWidth);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTextMatches(content: string, query: string): Array<{ start: number; end: number }> {
  const keyword = query.trim();
  if (!keyword) return [];

  const haystack = content.toLowerCase();
  const needle = keyword.toLowerCase();
  const matches: Array<{ start: number; end: number }> = [];
  let fromIndex = 0;

  while (fromIndex <= haystack.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index < 0) break;
    matches.push({ start: index, end: index + needle.length });
    fromIndex = index + Math.max(needle.length, 1);
  }

  return matches;
}

const EDITOR_LINE_HEIGHT = 24;

async function copyPlainText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('复制失败');
  } finally {
    document.body.removeChild(textarea);
  }
}

const UPLOAD_ABORTED_MESSAGE = '上传已取消';

interface ColWidths { size: number; date: number; perms: number }
const DEFAULT_COLS: ColWidths = { size: 68, date: 88, perms: 88 };
const COL_MIN = 40;
const STORAGE_KEY_COLS = 'fm-col-widths';
const ACTION_COL_WIDTH = 132;

function loadColWidths(): ColWidths {
  try {
    const s = localStorage.getItem(STORAGE_KEY_COLS);
    if (s) return { ...DEFAULT_COLS, ...JSON.parse(s) };
  } catch {}
  return DEFAULT_COLS;
}

function uploadFileXHR(
  url: string,
  file: File,
  onCreate?: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onCreate?.(xhr);
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try { reject((JSON.parse(xhr.responseText) as { error?: string }).error || '上传失败'); }
        catch { reject('上传失败'); }
      }
    });
    xhr.addEventListener('error', () => reject('网络错误'));
    xhr.addEventListener('abort', () => reject(UPLOAD_ABORTED_MESSAGE));
    const fd = new FormData();
    fd.append('file', file);
    xhr.open('POST', url);
    xhr.setRequestHeader('X-File-Size', String(file.size));
    xhr.send(fd);
  });
}

function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-terminal-surface border border-terminal-border rounded-xl shadow-2xl p-5 w-full max-w-xs">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className="w-5 h-5 text-terminal-red flex-shrink-0 mt-0.5" />
          <p className="text-sm text-terminal-text leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-md border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">取消</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-xs rounded-md bg-terminal-red hover:bg-terminal-red/80 text-white transition-colors">删除</button>
        </div>
      </div>
    </div>
  );
}

function NewFolderDialog({ onConfirm, onCancel }: {
  onConfirm: (name: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-terminal-surface border border-terminal-border rounded-xl shadow-2xl p-5 w-full max-w-xs">
        <h3 className="text-sm font-semibold text-terminal-text mb-3">新建文件夹</h3>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); if (e.key === 'Escape') onCancel(); }}
          placeholder="文件夹名称"
          className="w-full bg-terminal-bg border border-terminal-border rounded-md px-3 py-2 text-sm text-terminal-text outline-none focus:border-terminal-blue/60 mb-3"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-md border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">取消</button>
          <button onClick={() => name.trim() && onConfirm(name.trim())} disabled={!name.trim()} className="px-3 py-1.5 text-xs rounded-md bg-terminal-blue hover:bg-terminal-blue/80 text-white transition-colors disabled:opacity-40">创建</button>
        </div>
      </div>
    </div>
  );
}

function RenameDialog({ file, onConfirm, onCancel }: {
  file: SFTPFile; onConfirm: (newName: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(file.name);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-terminal-surface border border-terminal-border rounded-xl shadow-2xl p-5 w-full max-w-xs">
        <h3 className="text-sm font-semibold text-terminal-text mb-3">重命名</h3>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && name.trim() && name.trim() !== file.name) onConfirm(name.trim());
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="新名称"
          className="w-full bg-terminal-bg border border-terminal-border rounded-md px-3 py-2 text-sm text-terminal-text outline-none focus:border-terminal-blue/60 mb-3"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-md border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">取消</button>
          <button onClick={() => name.trim() && name.trim() !== file.name && onConfirm(name.trim())} disabled={!name.trim() || name.trim() === file.name} className="px-3 py-1.5 text-xs rounded-md bg-terminal-blue hover:bg-terminal-blue/80 text-white transition-colors disabled:opacity-40">重命名</button>
        </div>
      </div>
    </div>
  );
}

interface UploadState {
  uploadId: string;
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  speedBps: number;
  lastSampleBytes: number;
  lastSampleAt: number;
  serverProgress: boolean;
  cancelRequested: boolean;
}

interface TextEditorState {
  file: SFTPFile | null;
  content: string;
  originalContent: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface Props {
  ws: WebSocket | null;
  sessionToken: string;
  onClose: () => void;
  initialPath?: string;
  visible?: boolean;
  openNonce?: number;
  mode?: 'panel' | 'workspace' | 'editor';
  onOpenWorkspaceView?: () => void;
  openFilePath?: string;
  editorOpenNonce?: number;
  insertTextRequest?: { text: string; nonce: number; selection?: { start: number; end: number } } | null;
  onEditorSelectionChange?: (selection: { start: number; end: number }) => void;
}

export default function FileManager({ ws, sessionToken, onClose, initialPath, visible = true, openNonce = 0, mode = 'panel', onOpenWorkspaceView, openFilePath, editorOpenNonce = 0, insertTextRequest = null, onEditorSelectionChange }: Props) {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<SFTPFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<SFTPFile | null>(null);
  const [renameTarget, setRenameTarget] = useState<SFTPFile | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [colWidths, setColWidths] = useState<ColWidths>(loadColWidths);
  const [treeChildren, setTreeChildren] = useState<Record<string, SFTPFile[]>>({});
  const [treeLoadingPaths, setTreeLoadingPaths] = useState<string[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<string[]>(['/']);
  const [editor, setEditor] = useState<TextEditorState>(createEmptyEditorState);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [editorWidth, setEditorWidth] = useState(0);
  const [editorActionState, setEditorActionState] = useState<'idle' | 'copied'>('idle');
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [showEditorFindReplace, setShowEditorFindReplace] = useState(false);
  const [editorSearch, setEditorSearch] = useState('');
  const [editorReplace, setEditorReplace] = useState('');
  const [editorMatchIndex, setEditorMatchIndex] = useState(0);

  const [pathBarValue, setPathBarValue] = useState('');
  const pathBarFocusedRef = useRef(false);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingPathRef = useRef<string>('/');
  const wsRef = useRef<WebSocket | null>(ws);
  const homeRetryRef = useRef(0);
  const activeUploadXhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelUploadRequestedRef = useRef(false);
  const tildePathRef = useRef<string | null>(null);
  const pendingOpenFilePathRef = useRef<string | null>(null);
  const latestOpenTextFileByPathRef = useRef<((filePath: string) => Promise<void>) | null>(null);
  const lastExternalEditorRequestRef = useRef<string>('');
  const lastInsertTextNonceRef = useRef(0);
  const editorSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editorLineNumberRef = useRef<HTMLDivElement>(null);
  const editorSearchInputRef = useRef<HTMLInputElement>(null);

  const syncEditorSelection = useCallback(() => {
    const textarea = editorTextareaRef.current;
    if (!textarea) return;
    const nextSelection = {
      start: textarea.selectionStart ?? 0,
      end: textarea.selectionEnd ?? textarea.selectionStart ?? 0,
    };
    editorSelectionRef.current = nextSelection;
    onEditorSelectionChange?.(nextSelection);
  }, [onEditorSelectionChange]);

  useEffect(() => { wsRef.current = ws; }, [ws]);

  useEffect(() => {
    if (!pathBarFocusedRef.current) setPathBarValue(currentPath);
  }, [currentPath]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(colWidths));
  }, [colWidths]);

  useEffect(() => {
    const el = layoutRef.current;
    if (!el) return undefined;

    const updateWidth = () => setLayoutWidth(el.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editor.file || layoutWidth <= 0) return;
    setEditorWidth(prev => {
      if (prev > 0) return clampEditorPanelWidth(prev, layoutWidth);
      return getDefaultEditorPanelWidth(layoutWidth);
    });
  }, [editor.file, layoutWidth]);

  useEffect(() => {
    if (editorActionState === 'idle') return undefined;
    const timer = window.setTimeout(() => setEditorActionState('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [editorActionState]);

  useEffect(() => {
    setEditorSearch('');
    setEditorReplace('');
    setEditorMatchIndex(0);
    setShowEditorFindReplace(false);
    if (editorLineNumberRef.current) editorLineNumberRef.current.scrollTop = 0;
  }, [editor.file?.path]);

  useEffect(() => {
    if (!showEditorFindReplace) return;
    requestAnimationFrame(() => editorSearchInputRef.current?.focus());
  }, [showEditorFindReplace]);

  useEffect(() => {
    if (!editor.file || editor.loading) return;
    requestAnimationFrame(() => {
      const textarea = editorTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.scrollTop = 0;
      textarea.setSelectionRange(0, 0);
      const nextSelection = { start: 0, end: 0 };
      editorSelectionRef.current = nextSelection;
      onEditorSelectionChange?.(nextSelection);
    });
  }, [editor.file, editor.loading, onEditorSelectionChange, syncEditorSelection]);

  useEffect(() => {
    if (!editor.file) return undefined;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (showNewFolder || renameTarget || confirmDelete) return;

      e.preventDefault();
      e.stopPropagation();

      if (showEditorFindReplace) {
        setShowEditorFindReplace(false);
        return;
      }

      closeEditorPane();
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [editor.file, showEditorFindReplace, showNewFolder, renameTarget, confirmDelete]);

  useEffect(() => () => {
    cancelUploadRequestedRef.current = true;
    activeUploadXhrRef.current?.abort();
    activeUploadXhrRef.current = null;
  }, []);

  const startColResize = useCallback((col: keyof ColWidths, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[col];
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      const newW = Math.max(COL_MIN, startW + (ev.clientX - startX));
      setColWidths(prev => ({ ...prev, [col]: newW }));
    }
    function onUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [colWidths]);

  const requestTree = useCallback((path: string, options?: { silent?: boolean }) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!options?.silent) {
      setTreeLoadingPaths(prev => prev.includes(path) ? prev : [...prev, path]);
    }
    socket.send(JSON.stringify({ type: 'sftp_tree_ls', payload: { path } }));
  }, []);

  const loadDir = useCallback((path: string, options?: { silent?: boolean }) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError('WebSocket 未连接');
      setLoading(false);
      return;
    }
    if (!options?.silent) setLoading(true);
    setError(null);
    pendingPathRef.current = path;
    socket.send(JSON.stringify({ type: 'sftp_ls', payload: { path } }));
  }, []);

  const expandPathTree = useCallback((path: string) => {
    const paths = getAncestorPaths(path);
    setExpandedDirs(prev => Array.from(new Set([...prev, ...paths])));
    paths.forEach(item => requestTree(item));
  }, [requestTree]);

  const openTextFileByPath = useCallback(async (filePath: string) => {
    const normalizedPath = (filePath || '').trim();
    if (!normalizedPath || !sessionToken) return;

    if (normalizedPath === '~' || normalizedPath.startsWith('~/')) {
      pendingOpenFilePathRef.current = normalizedPath;
      wsRef.current?.send(JSON.stringify({ type: 'sftp_home' }));
      return;
    }

    pendingOpenFilePathRef.current = null;
    const targetDir = parentPath(normalizedPath);
    const file = files.find(item => item.path === normalizedPath) || createVirtualTextFile(normalizedPath);

    setSearch('');
    expandPathTree(targetDir);
    if (currentPath !== targetDir) {
      pendingPathRef.current = targetDir;
      loadDir(targetDir, { silent: true });
    }

    setEditor({ file, content: '', originalContent: '', loading: true, saving: false, error: null });

    try {
      const res = await fetch(`/api/sftp/read-text?token=${encodeURIComponent(sessionToken)}&path=${encodeURIComponent(normalizedPath)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '读取文件失败');
      const nextContent = typeof data.content === 'string' ? data.content : '';
      setEditor({ file, content: nextContent, originalContent: nextContent, loading: false, saving: false, error: null });
    } catch (err: any) {
      const message = err?.message || '读取文件失败';
      if (isMissingFileError(message)) {
        setEditor({ file, content: '', originalContent: '', loading: false, saving: false, error: null });
      } else {
        setEditor({ file, content: '', originalContent: '', loading: false, saving: false, error: message });
      }
    }
  }, [currentPath, expandPathTree, files, loadDir, sessionToken]);

  useEffect(() => {
    latestOpenTextFileByPathRef.current = openTextFileByPath;
  }, [openTextFileByPath]);

  useEffect(() => {
    const socket = wsRef.current;
    if (!socket) return undefined;

    function handleMsg(e: MessageEvent) {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'sftp_home_result') {
          const { path: homePath, error: err } = msg.payload;
          const pendingOpenPath = pendingOpenFilePathRef.current;
          const resolvedOpenPath = pendingOpenPath && (pendingOpenPath === '~' || pendingOpenPath.startsWith('~/')) && homePath
            ? (pendingOpenPath === '~' ? homePath : homePath + pendingOpenPath.slice(1))
            : null;
          if (!err && homePath) {
            homeRetryRef.current = 0;
            const tp = tildePathRef.current;
            tildePathRef.current = null;
            const resolved = tp ? (tp === '~' ? homePath : homePath + tp.slice(1)) : homePath;
            expandPathTree(resolved);
            loadDir(resolved);
            if (resolvedOpenPath) {
              pendingOpenFilePathRef.current = null;
              void latestOpenTextFileByPathRef.current?.(resolvedOpenPath);
            }
          } else if (err && (err.includes('未就绪') || err.includes('not ready')) && homeRetryRef.current < 8) {
            homeRetryRef.current += 1;
            setTimeout(() => { wsRef.current?.send(JSON.stringify({ type: 'sftp_home' })); }, 500);
          } else {
            homeRetryRef.current = 0;
            tildePathRef.current = null;
            pendingOpenFilePathRef.current = null;
            expandPathTree('/');
            loadDir('/');
          }
          return;
        }

        if (msg.type === 'sftp_upload_progress') {
          const { uploadId, percent, bytes, total, done } = msg.payload || {};
          if (typeof uploadId !== 'string' || typeof percent !== 'number') return;
          setUploadState(prev => {
            if (!prev || prev.uploadId !== uploadId) return prev;
            const nextBytes = typeof bytes === 'number' && bytes >= 0 ? bytes : prev.uploadedBytes;
            const nextTotal = typeof total === 'number' && total > 0 ? total : prev.totalBytes;
            const now = Date.now();
            const elapsedMs = Math.max(1, now - prev.lastSampleAt);
            const deltaBytes = Math.max(0, nextBytes - prev.lastSampleBytes);
            const instantSpeed = deltaBytes > 0 ? (deltaBytes * 1000) / elapsedMs : prev.speedBps * 0.85;
            const speedBps = done ? prev.speedBps : (prev.speedBps > 0 ? prev.speedBps * 0.7 + instantSpeed * 0.3 : instantSpeed);
            return {
              ...prev,
              percent: Math.max(prev.percent, Math.min(100, percent)),
              uploadedBytes: nextBytes,
              totalBytes: nextTotal,
              speedBps,
              lastSampleBytes: nextBytes,
              lastSampleAt: now,
              serverProgress: true,
            };
          });
          return;
        }

        if (msg.type === 'sftp_ls_result') {
          const { path, files: fl, error: err } = msg.payload;
          if (path !== pendingPathRef.current) return;
          setLoading(false);
          setManualRefreshing(false);
          if (err) {
            setError(err);
            if (err.includes('未就绪') || err.includes('not ready')) {
              setTimeout(() => loadDir(path), 800);
            }
            return;
          }
          setCurrentPath(path);
          expandPathTree(path);
          const sorted = [...fl].sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
          });
          setFiles(sorted);
          return;
        }

        if (msg.type === 'sftp_tree_ls_result') {
          const { path, files: fl } = msg.payload;
          setTreeLoadingPaths(prev => prev.filter(item => item !== path));
          setTreeChildren(prev => ({ ...prev, [path]: Array.isArray(fl) ? fl : [] }));
          return;
        }

        if (msg.type === 'sftp_op_result') {
          const { success, error: err } = msg.payload;
          setLoading(false);
          setManualRefreshing(false);
          if (!success) {
            setError(err || '操作失败');
          } else {
            requestTree(parentPath(pendingPathRef.current || currentPath));
            requestTree(pendingPathRef.current || currentPath);
            loadDir(pendingPathRef.current || currentPath);
          }
          setShowNewFolder(false);
          setRenameTarget(null);
        }
      } catch {}
    }

    socket.addEventListener('message', handleMsg);
    return () => socket.removeEventListener('message', handleMsg);
  }, [currentPath, expandPathTree, loadDir, requestTree]);

  useEffect(() => {
    const socket = wsRef.current;
    if (!socket || !visible) return undefined;
    const activeSocket = socket;

    homeRetryRef.current = 0;

    function doLoad() {
      requestTree('/');
      if (initialPath && initialPath.startsWith('/')) {
        pendingPathRef.current = initialPath;
        expandPathTree(initialPath);
        loadDir(initialPath);
      } else if (initialPath && (initialPath === '~' || initialPath.startsWith('~/'))) {
        tildePathRef.current = initialPath;
        activeSocket.send(JSON.stringify({ type: 'sftp_home' }));
      } else {
        activeSocket.send(JSON.stringify({ type: 'sftp_home' }));
      }
    }

    if (activeSocket.readyState === WebSocket.OPEN) doLoad();
    else activeSocket.addEventListener('open', doLoad, { once: true });

    return undefined;
  }, [visible, openNonce, ws, initialPath, loadDir, requestTree, expandPathTree]);

  useEffect(() => {
    if (!visible) return undefined;

    const timer = window.setInterval(() => {
      loadDir(currentPath, { silent: true });
      Array.from(new Set(expandedDirs)).forEach(path => requestTree(path, { silent: true }));
    }, 10000);

    return () => window.clearInterval(timer);
  }, [visible, currentPath, expandedDirs, loadDir, requestTree]);

  useEffect(() => {
    if (!visible || !openFilePath || editorOpenNonce <= 0) return;
    const requestKey = `${editorOpenNonce}:${openFilePath}`;
    if (lastExternalEditorRequestRef.current === requestKey) return;
    lastExternalEditorRequestRef.current = requestKey;
    void latestOpenTextFileByPathRef.current?.(openFilePath);
  }, [editorOpenNonce, openFilePath, visible]);

  useEffect(() => {
    if (!visible || !insertTextRequest || !editor.file) return;
    if (insertTextRequest.nonce === lastInsertTextNonceRef.current) return;
    lastInsertTextNonceRef.current = insertTextRequest.nonce;
    const textarea = editorTextareaRef.current;
    const text = insertTextRequest.text;
    if (!textarea || !text) return;

    const requestedSelection = insertTextRequest.selection;
    const hasFocus = document.activeElement === textarea;
    const start = requestedSelection?.start ?? (hasFocus ? (textarea.selectionStart ?? editorSelectionRef.current.start) : editorSelectionRef.current.start);
    const end = requestedSelection?.end ?? (hasFocus ? (textarea.selectionEnd ?? start) : editorSelectionRef.current.end);
    const nextContent = `${editor.content.slice(0, start)}${text}${editor.content.slice(end)}`;
    const nextCaret = start + text.length;

    setEditor(prev => ({ ...prev, content: nextContent, error: null }));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
      const nextSelection = { start: nextCaret, end: nextCaret };
      editorSelectionRef.current = nextSelection;
      onEditorSelectionChange?.(nextSelection);
    });
  }, [editor.content, editor.file, insertTextRequest, onEditorSelectionChange, visible]);

  function navigate(path: string) {
    setSearch('');
    setFiles([]);
    expandPathTree(path);
    loadDir(path);
  }

  function handleManualRefresh() {
    setManualRefreshing(true);
    loadDir(currentPath);
  }

  function focusPathInput(placeCursorAtEnd = true) {
    requestAnimationFrame(() => {
      const el = pathInputRef.current;
      if (!el) return;
      el.focus();
      if (placeCursorAtEnd) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  }

  function submitPathEdit() {
    const p = pathBarValue.trim() || '/';
    pathBarFocusedRef.current = false;
    pathInputRef.current?.blur();
    navigate(p);
  }

  async function handleFileClick(file: SFTPFile) {
    if (file.type === 'directory') {
      navigate(file.path);
      return;
    }
    if (isProbablyTextFile(file)) {
      await openTextFileByPath(file.path);
    }
  }

  function handleTextFileDoubleClick(file: SFTPFile) {
    if (!isProbablyTextFile(file)) return;
    void handleFileClick(file);
  }

  function startEditorResize(e: React.MouseEvent<HTMLDivElement>) {
    if (layoutWidth <= 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = editorWidth || getDefaultEditorPanelWidth(layoutWidth);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      const nextWidth = clampEditorPanelWidth(startWidth + (startX - ev.clientX), layoutWidth);
      setEditorWidth(nextWidth);
    }

    function onUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  async function handleSaveTextFile() {
    if (!editor.file) return;
    setEditor(prev => ({ ...prev, saving: true, error: null }));
    try {
      const res = await fetch('/api/sftp/write-text', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: sessionToken, path: editor.file.path, content: editor.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      setEditor(prev => ({ ...prev, saving: false, originalContent: prev.content }));
      const targetDir = parentPath(editor.file.path);
      requestTree(targetDir);
      loadDir(targetDir, { silent: true });
    } catch (err: any) {
      setEditor(prev => ({ ...prev, saving: false, error: err?.message || '保存失败' }));
    }
  }

  function handleRollbackTextFile() {
    setEditor(prev => {
      if (!prev.file || prev.loading || prev.saving) return prev;
      return { ...prev, content: prev.originalContent, error: null };
    });
  }

  async function handleCopyTextFile() {
    if (!editor.file || editor.loading) return;
    try {
      await copyPlainText(editor.content);
      setEditorActionState('copied');
    } catch (err: any) {
      setEditor(prev => ({ ...prev, error: err?.message || '复制失败' }));
    }
  }

  function focusEditorMatch(index: number) {
    const match = editorMatches[index];
    const textarea = editorTextareaRef.current;
    if (!match || !textarea) return;

    const lineIndex = editor.content.slice(0, match.start).split('\n').length - 1;
    textarea.focus();
    textarea.setSelectionRange(match.start, match.end);
    const nextSelection = { start: match.start, end: match.end };
    editorSelectionRef.current = nextSelection;
    onEditorSelectionChange?.(nextSelection);
    textarea.scrollTop = Math.max(0, lineIndex * EDITOR_LINE_HEIGHT - (textarea.clientHeight / 2) + EDITOR_LINE_HEIGHT);
    if (editorLineNumberRef.current) editorLineNumberRef.current.scrollTop = textarea.scrollTop;
  }

  function handleFindMatch(direction: 'prev' | 'next' = 'next') {
    if (editorMatches.length === 0) {
      setEditor(prev => ({ ...prev, error: editorSearch.trim() ? '没有找到匹配内容' : null }));
      return;
    }

    const nextIndex = direction === 'next'
      ? (editorMatchIndex + 1) % editorMatches.length
      : (editorMatchIndex - 1 + editorMatches.length) % editorMatches.length;

    setEditorMatchIndex(nextIndex);
    setEditor(prev => ({ ...prev, error: null }));
    requestAnimationFrame(() => focusEditorMatch(nextIndex));
  }

  function handleReplaceCurrentMatch() {
    if (!currentEditorMatch) {
      setEditor(prev => ({ ...prev, error: editorSearch.trim() ? '没有可替换的匹配内容' : null }));
      return;
    }

    const { start, end } = currentEditorMatch;
    const nextContent = `${editor.content.slice(0, start)}${editorReplace}${editor.content.slice(end)}`;
    setEditor(prev => ({ ...prev, content: nextContent, error: null }));
    requestAnimationFrame(() => {
      const textarea = editorTextareaRef.current;
      if (!textarea) return;
      const caret = start + editorReplace.length;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      const nextSelection = { start: caret, end: caret };
      editorSelectionRef.current = nextSelection;
      onEditorSelectionChange?.(nextSelection);
    });
  }

  function handleReplaceAllMatches() {
    const keyword = editorSearch.trim();
    if (!keyword) return;

    const nextContent = editor.content.replace(new RegExp(escapeRegExp(keyword), 'gi'), editorReplace);
    setEditor(prev => ({ ...prev, content: nextContent, error: null }));
    setEditorMatchIndex(0);
  }

  function handleEditorScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (editorLineNumberRef.current) {
      editorLineNumberRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }

  function handleDownload(file: SFTPFile) {
    if (!sessionToken) return;
    const url = `/api/sftp/download?token=${encodeURIComponent(sessionToken)}&path=${encodeURIComponent(file.path)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleDeleteConfirm() {
    const socket = wsRef.current;
    if (!confirmDelete || !socket) return;
    socket.send(JSON.stringify({ type: 'sftp_delete', payload: { path: confirmDelete.path } }));
    pendingPathRef.current = currentPath;
    setConfirmDelete(null);
    if (editor.file?.path === confirmDelete.path) {
      setEditor(createEmptyEditorState());
    }
  }

  function handleRenameConfirm(newName: string) {
    const socket = wsRef.current;
    if (!renameTarget || !socket) return;
    const newPath = joinPath(parentPath(renameTarget.path), newName);
    socket.send(JSON.stringify({ type: 'sftp_rename', payload: { oldPath: renameTarget.path, newPath } }));
    pendingPathRef.current = currentPath;
    if (editor.file?.path === renameTarget.path) {
      setEditor(prev => prev.file ? { ...prev, file: { ...prev.file, name: newName, path: newPath } } : prev);
    }
    setRenameTarget(null);
  }

  function handleNewFolder(name: string) {
    const socket = wsRef.current;
    if (!socket) return;
    const newPath = joinPath(currentPath, name);
    pendingPathRef.current = currentPath;
    socket.send(JSON.stringify({ type: 'sftp_mkdir', payload: { path: newPath } }));
    setShowNewFolder(false);
  }

  async function handleUpload(uploadFiles: FileList) {
    if (!sessionToken || !uploadFiles.length) return;
    const uploadPath = currentPath;
    const total = uploadFiles.length;
    let cancelled = false;
    cancelUploadRequestedRef.current = false;
    setError(null);

    for (let i = 0; i < total; i += 1) {
      if (cancelUploadRequestedRef.current) {
        cancelled = true;
        break;
      }

      const file = uploadFiles[i];
      const uploadId = createUploadId();
      setUploadState({
        uploadId,
        fileName: file.name,
        fileIndex: i + 1,
        totalFiles: total,
        percent: 0,
        uploadedBytes: 0,
        totalBytes: file.size,
        speedBps: 0,
        lastSampleBytes: 0,
        lastSampleAt: Date.now(),
        serverProgress: false,
        cancelRequested: false,
      });

      const url = `/api/sftp/upload?token=${encodeURIComponent(sessionToken)}&path=${encodeURIComponent(uploadPath)}&uploadId=${encodeURIComponent(uploadId)}`;
      try {
        await uploadFileXHR(url, file, (xhr) => { activeUploadXhrRef.current = xhr; });
        setUploadState(prev => prev && prev.uploadId === uploadId ? {
          ...prev,
          percent: 100,
          uploadedBytes: prev.totalBytes || file.size,
          totalBytes: prev.totalBytes || file.size,
          serverProgress: true,
        } : prev);
      } catch (err: unknown) {
        if (err === UPLOAD_ABORTED_MESSAGE) {
          cancelled = true;
          break;
        }
        setError(typeof err === 'string' ? err : `上传 ${file.name} 失败`);
      } finally {
        if (activeUploadXhrRef.current && activeUploadXhrRef.current.readyState === XMLHttpRequest.DONE) {
          activeUploadXhrRef.current = null;
        }
      }
    }

    activeUploadXhrRef.current = null;
    cancelUploadRequestedRef.current = false;
    setUploadState(null);
    requestTree(currentPath);
    loadDir(uploadPath);
    if (cancelled) fileInputRef.current?.blur();
  }

  function handleCancelUpload() {
    cancelUploadRequestedRef.current = true;
    setUploadState(prev => prev ? { ...prev, cancelRequested: true } : prev);
    activeUploadXhrRef.current?.abort();
  }

  const filtered = search ? files.filter(f => f.name.toLowerCase().includes(search.toLowerCase())) : files;
  const editorDirty = editor.file && editor.content !== editor.originalContent;
  const currentAncestors = useMemo(() => new Set(getAncestorPaths(currentPath)), [currentPath]);
  const isWorkspace = mode === 'workspace';
  const isEditorMode = mode === 'editor';
  const editorMatches = useMemo(() => findTextMatches(editor.content, editorSearch), [editor.content, editorSearch]);
  const editorLineCount = useMemo(() => Math.max(1, editor.content.split('\n').length), [editor.content]);
  const currentEditorMatch = editorMatches.length > 0
    ? editorMatches[Math.min(editorMatchIndex, editorMatches.length - 1)]
    : null;
  const lineNumberDigits = Math.max(2, String(editorLineCount).length);

  useEffect(() => {
    setEditorMatchIndex(prev => {
      if (editorMatches.length === 0) return 0;
      return Math.min(prev, editorMatches.length - 1);
    });
  }, [editorMatches.length]);

  useEffect(() => {
    if (!editorSearch.trim() || editorMatches.length === 0) return;
    setEditorMatchIndex(0);
    requestAnimationFrame(() => focusEditorMatch(0));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSearch, editor.file?.path]);

  function toggleTreeDir(path: string) {
    setExpandedDirs(prev => prev.includes(path) ? prev.filter(item => item !== path) : [...prev, path]);
    if (!treeChildren[path]) requestTree(path);
  }

  function renderTree(path: string, depth = 0): React.ReactNode {
    const children = treeChildren[path] || [];
    return children.map(dir => {
      const expanded = expandedDirs.includes(dir.path);
      const loadingTree = treeLoadingPaths.includes(dir.path);
      const active = dir.path === currentPath;
      const highlighted = currentAncestors.has(dir.path);
      return (
        <div key={dir.path}>
          <div className={`group flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${active ? 'bg-terminal-blue/12 text-terminal-blue' : highlighted ? 'text-terminal-text' : 'text-terminal-muted hover:bg-terminal-border/20 hover:text-terminal-text'}`} style={{ paddingLeft: 8 + depth * 14 }}>
            <button type="button" onClick={() => toggleTreeDir(dir.path)} className="flex h-4 w-4 items-center justify-center rounded text-terminal-muted hover:text-terminal-text">
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <button type="button" onClick={() => navigate(dir.path)} className="min-w-0 flex-1 truncate text-left">
              <span className="inline-flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />
                <span className="truncate">{dir.name}</span>
              </span>
            </button>
            {loadingTree && <Loader2 className="w-3 h-3 animate-spin text-terminal-muted" />}
          </div>
          {expanded && renderTree(dir.path, depth + 1)}
        </div>
      );
    });
  }

  function closeEditorPane() {
    setEditor(createEmptyEditorState());
    if (isEditorMode) onClose();
  }

  function renderEditorPane(fillContainer = false) {
    if (!editor.file || (!fillContainer && layoutWidth <= 0)) return null;

    return (
      <div className={fillContainer ? 'flex min-h-0 flex-1 flex-col' : 'absolute inset-y-2 right-2 z-20 pointer-events-none'}>
        <div
          className={`relative ${fillContainer ? 'flex min-h-0 flex-1 flex-col rounded-none border-0 shadow-none' : 'h-full rounded-2xl border border-terminal-border/70 bg-terminal-surface shadow-[-24px_0_48px_rgba(0,0,0,0.28)] pointer-events-auto'}`}
          style={fillContainer ? undefined : { width: editorWidth || getDefaultEditorPanelWidth(layoutWidth) }}
        >
          {!fillContainer && (
            <div
              className="absolute left-0 top-0 bottom-0 w-4 -translate-x-1/2 cursor-col-resize"
              onMouseDown={startEditorResize}
              title="拖动调整编辑区宽度"
            >
              <div className="absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-terminal-border/80 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]" />
            </div>
          )}

          <div className={`flex h-full min-h-0 flex-col overflow-hidden ${fillContainer ? '' : 'rounded-2xl'}`}>
            <div className="flex items-center justify-between gap-3 border-b border-terminal-border/50 bg-terminal-surface px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] text-terminal-muted">
                  <span>{isEditorMode ? '内置文本编辑器' : '文本查看 / 编辑'}</span>
                  {editorDirty && <span className="rounded-full bg-terminal-yellow/12 px-1.5 py-0.5 text-terminal-yellow">未保存</span>}
                </div>
                <div className="mt-1 truncate text-sm font-medium text-terminal-text">{editor.file.name}</div>
                <div className="mt-1 truncate font-mono text-[10px] text-terminal-muted">{editor.file.path}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setShowEditorFindReplace(prev => !prev)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10px] transition-colors ${showEditorFindReplace ? 'border-terminal-blue/30 bg-terminal-blue/10 text-terminal-blue' : 'border-terminal-border text-terminal-muted hover:border-terminal-blue/35 hover:text-terminal-text'}`}
                >
                  <Search className="w-3 h-3" />{showEditorFindReplace ? '隐藏搜索' : '搜索替换'}
                </button>
                <button
                  onClick={handleRollbackTextFile}
                  disabled={editor.loading || editor.saving || !editorDirty}
                  className="inline-flex items-center gap-1 rounded-md border border-terminal-border px-2.5 py-1.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-yellow/35 hover:text-terminal-text disabled:opacity-40"
                >
                  <RotateCcw className="w-3 h-3" />回滚
                </button>
                <button
                  onClick={() => { void handleCopyTextFile(); }}
                  disabled={editor.loading || !editor.file}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10px] transition-colors disabled:opacity-40 ${editorActionState === 'copied' ? 'border-terminal-green/30 bg-terminal-green/10 text-terminal-green' : 'border-terminal-border text-terminal-muted hover:border-terminal-green/35 hover:text-terminal-text'}`}
                >
                  {editorActionState === 'copied' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {editorActionState === 'copied' ? '已复制' : '复制'}
                </button>
                <button
                  onClick={handleSaveTextFile}
                  disabled={editor.loading || editor.saving || !editorDirty}
                  className="inline-flex items-center gap-1 rounded-md border border-terminal-blue/30 bg-terminal-blue/10 px-2.5 py-1.5 text-[10px] text-terminal-blue transition-colors hover:bg-terminal-blue/15 disabled:opacity-40"
                >
                  {editor.saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}保存
                </button>
                <button
                  onClick={closeEditorPane}
                  className="inline-flex items-center gap-1 rounded-md border border-terminal-border px-2.5 py-1.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-blue/35 hover:text-terminal-text"
                >
                  <PanelRightClose className="w-3 h-3" />{isEditorMode ? '退出编辑' : '收起'}
                </button>
              </div>
            </div>

            <div className={`flex min-h-0 flex-1 flex-col overflow-hidden border border-terminal-border/60 bg-terminal-bg shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] ${fillContainer ? 'm-0 rounded-none border-0 shadow-none' : 'mx-4 my-4 rounded-2xl'}`}>
              <div className="flex items-center justify-between gap-3 border-b border-terminal-border/50 bg-terminal-surface px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2 text-[11px] text-terminal-muted">
                  <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">正在编辑</span>
                </div>
                <div className="whitespace-nowrap text-[10px] text-terminal-muted">
                  {fillContainer ? 'Esc 退出编辑器' : '拖左侧把手可调宽度'}
                </div>
              </div>
              {showEditorFindReplace && (
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-b border-terminal-border/50 bg-terminal-surface px-4 py-2.5">
                  <div className="flex items-center gap-2 rounded-lg border border-terminal-border bg-terminal-bg px-2.5 py-2">
                    <Search className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
                    <input
                      ref={editorSearchInputRef}
                      type="text"
                      value={editorSearch}
                      onChange={e => setEditorSearch(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleFindMatch(e.shiftKey ? 'prev' : 'next');
                        }
                      }}
                      placeholder="搜索内容..."
                      className="min-w-0 flex-1 bg-transparent text-xs text-terminal-text placeholder:text-terminal-muted/60 outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-terminal-border bg-terminal-bg px-2.5 py-2">
                    <input
                      type="text"
                      value={editorReplace}
                      onChange={e => setEditorReplace(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleReplaceCurrentMatch();
                        }
                      }}
                      placeholder="替换为..."
                      className="min-w-0 flex-1 bg-transparent text-xs text-terminal-text placeholder:text-terminal-muted/60 outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => handleFindMatch('prev')} disabled={!editorSearch.trim() || editorMatches.length === 0} className="rounded-md border border-terminal-border px-2 py-1.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-blue/35 hover:text-terminal-text disabled:opacity-40">上一个</button>
                    <button onClick={() => handleFindMatch('next')} disabled={!editorSearch.trim() || editorMatches.length === 0} className="rounded-md border border-terminal-border px-2 py-1.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-blue/35 hover:text-terminal-text disabled:opacity-40">下一个</button>
                    <button onClick={handleReplaceCurrentMatch} disabled={!currentEditorMatch} className="rounded-md border border-terminal-yellow/30 bg-terminal-yellow/10 px-2 py-1.5 text-[10px] text-terminal-yellow transition-colors hover:bg-terminal-yellow/15 disabled:opacity-40">替换当前</button>
                    <button onClick={handleReplaceAllMatches} disabled={!editorSearch.trim() || editorMatches.length === 0} className="rounded-md border border-terminal-blue/30 bg-terminal-blue/10 px-2 py-1.5 text-[10px] text-terminal-blue transition-colors hover:bg-terminal-blue/15 disabled:opacity-40">全部替换</button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 border-b border-terminal-border/50 bg-terminal-surface/50 px-4 py-1.5 text-[10px] text-terminal-muted">
                <span>行号已开启</span>
                <span>
                  {editorSearch.trim()
                    ? (editorMatches.length > 0 ? `匹配 ${Math.min(editorMatchIndex + 1, editorMatches.length)}/${editorMatches.length}` : '没有匹配')
                    : `共 ${editorLineCount} 行`}
                </span>
              </div>
              {editor.error && <div className="border-b border-terminal-red/20 bg-terminal-red/10 px-4 py-2 text-[11px] text-terminal-red">{editor.error}</div>}
              {editor.loading ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-terminal-muted">
                  <Loader2 className="w-4 h-4 animate-spin" />读取中...
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <div ref={editorLineNumberRef} className="w-14 flex-shrink-0 overflow-hidden border-r border-terminal-border/50 bg-terminal-surface/35 px-2 py-4 text-right text-[12px] leading-6 text-terminal-muted select-none">
                    <pre className="m-0 whitespace-pre font-mono" style={{ minWidth: `${lineNumberDigits}ch` }}>{Array.from({ length: editorLineCount }, (_, i) => i + 1).join('\n')}</pre>
                  </div>
                  <textarea
                    ref={editorTextareaRef}
                    value={editor.content}
                    onChange={e => setEditor(prev => ({ ...prev, content: e.target.value, error: null }))}
                    onScroll={handleEditorScroll}
                    onSelect={syncEditorSelection}
                    onKeyUp={syncEditorSelection}
                    onClick={syncEditorSelection}
                    onMouseUp={syncEditorSelection}
                    onFocus={syncEditorSelection}
                    onBlur={syncEditorSelection}
                    wrap="soft"
                    className="flex-1 min-h-[420px] resize-none overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words border-none bg-transparent px-4 py-4 text-[13px] leading-6 font-mono text-terminal-text outline-none"
                    spellCheck={false}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isEditorMode) {
    return (
      <div className="flex h-full min-h-0 flex-col border border-terminal-border/60 bg-terminal-surface/95">
        {renderEditorPane(true)}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-terminal-border bg-terminal-surface">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-terminal-text">{isWorkspace ? '文件表格视图' : '文件管理'}</span>
          {!isWorkspace && onOpenWorkspaceView && (
            <div className="mt-0.5 text-[10px] text-terminal-muted">
              可点击 <button onClick={onOpenWorkspaceView} className="text-terminal-blue hover:text-terminal-blue/80 transition-colors">表格视图</button>，更好地管理文件
            </div>
          )}
          {isWorkspace && <div className="text-[10px] text-terminal-muted mt-0.5">当前区域已切换为专用文件处理 tab</div>}
        </div>
        <div className="flex items-center gap-1">
          {!isWorkspace && onOpenWorkspaceView && (
            <button onClick={onOpenWorkspaceView} title="在主区域打开表格视图" className="px-2 h-6 rounded-md border border-terminal-blue/25 bg-terminal-blue/10 text-[10px] text-terminal-blue hover:bg-terminal-blue/15 transition-colors">
              表格视图
            </button>
          )}
          <button onClick={handleManualRefresh} title="刷新" className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${manualRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowNewFolder(true)} title="新建文件夹" className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors">
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => fileInputRef.current?.click()} title="上传文件" disabled={!!uploadState} className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors disabled:opacity-40">
            {uploadState ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onClose} title={isWorkspace ? '关闭文件 tab' : '关闭'} className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-red/20 text-terminal-muted hover:text-terminal-red transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-shrink-0 border-b border-terminal-border/50 bg-terminal-surface/80">
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <button onClick={() => navigate('/')} title="根目录" className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors">
            <Home className="w-3 h-3" />
          </button>
          {currentPath !== '/' && !loading && (
            <button onClick={() => navigate(parentPath(currentPath))} title="上一级" className="flex-shrink-0 text-[10px] text-terminal-muted hover:text-terminal-text px-1 py-0.5 rounded hover:bg-terminal-border/40 transition-colors">↑</button>
          )}
          {loading && <Loader2 className="w-3 h-3 text-terminal-muted animate-spin flex-shrink-0" />}
          <div className="flex-1 min-w-0 flex items-center gap-1 rounded-md border border-terminal-border/70 bg-terminal-bg px-1.5 py-0.5 focus-within:border-terminal-blue/40" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
            <input
              ref={pathInputRef}
              type="text"
              value={pathBarValue}
              onChange={e => setPathBarValue(e.target.value)}
              onFocus={() => { pathBarFocusedRef.current = true; }}
              onBlur={() => { pathBarFocusedRef.current = false; }}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); submitPathEdit(); }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  pathBarFocusedRef.current = false;
                  setPathBarValue(currentPath);
                  pathInputRef.current?.blur();
                }
              }}
              onKeyUp={e => e.stopPropagation()}
              className="flex-1 bg-transparent border-none outline-none text-xs text-terminal-blue font-mono min-w-0 cursor-text"
              spellCheck={false}
              autoComplete="off"
              title="输入路径后按 Enter 导航，Esc 恢复当前路径"
            />
            {pathBarValue && pathBarValue !== currentPath && (
              <button onMouseDown={e => e.preventDefault()} onClick={() => { setPathBarValue(''); focusPathInput(false); }} className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors" title="清空路径">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 px-2 py-1.5 border-b border-terminal-border/50">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="过滤当前目录文件名..."
            className="w-full bg-terminal-bg border border-terminal-border rounded-md pl-7 pr-7 py-1 text-xs text-terminal-text outline-none focus:border-terminal-blue/50 placeholder:text-terminal-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted hover:text-terminal-text">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {uploadState && (
        <div className="flex-shrink-0 px-3 py-2 bg-terminal-blue/10 border-b border-terminal-blue/20">
          <div className="flex items-center justify-between text-[11px] text-terminal-blue mb-1.5">
            <span className="truncate mr-2 flex items-center gap-1.5 min-w-0">
              <Upload className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{uploadState.fileName}</span>
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="font-mono">{uploadState.fileIndex}/{uploadState.totalFiles}</span>
              <button onClick={handleCancelUpload} disabled={uploadState.cancelRequested} className="px-2 py-0.5 rounded border border-terminal-blue/30 text-[10px] text-terminal-blue hover:bg-terminal-blue/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {uploadState.cancelRequested ? '取消中...' : '取消'}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] text-terminal-blue/90 mb-1.5 font-mono">
            <span>{uploadState.percent}%</span>
            <span>{uploadState.cancelRequested ? '取消中...' : formatTransferSpeed(uploadState.speedBps)}</span>
            <span>{formatSize(uploadState.uploadedBytes)} / {formatSize(uploadState.totalBytes)}</span>
          </div>
          <div className="h-1.5 bg-terminal-border rounded-full overflow-hidden">
            <div className="h-full bg-terminal-blue rounded-full transition-all duration-150" style={{ width: `${uploadState.percent}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-terminal-red/10 border-b border-terminal-red/20 text-xs text-terminal-red flex items-center gap-2">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} className="flex-shrink-0 hover:opacity-70"><X className="w-3 h-3" /></button>
        </div>
      )}

      <div ref={layoutRef} className="flex-1 min-h-0 relative overflow-hidden">
        <div className="absolute inset-0 flex min-h-0">
          <div className="w-56 flex-shrink-0 border-r border-terminal-border/50 bg-terminal-surface/35">
            <div className="px-3 py-2 border-b border-terminal-border/50 text-[10px] font-medium text-terminal-muted">目录树</div>
            <div className="h-[calc(100%-33px)] overflow-y-auto py-1">
              <div className={`group flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${currentPath === '/' ? 'bg-terminal-blue/12 text-terminal-blue' : 'text-terminal-text hover:bg-terminal-border/20'}`} style={{ paddingLeft: 8 }}>
                <button type="button" onClick={() => toggleTreeDir('/')} className="flex h-4 w-4 items-center justify-center rounded text-terminal-muted hover:text-terminal-text">
                  {expandedDirs.includes('/') ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
                <button type="button" onClick={() => navigate('/')} className="min-w-0 flex-1 truncate text-left inline-flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />
                  /
                </button>
                {treeLoadingPaths.includes('/') && <Loader2 className="w-3 h-3 animate-spin text-terminal-muted" />}
              </div>
              {expandedDirs.includes('/') && renderTree('/', 1)}
            </div>
          </div>

          <div className="min-w-0 flex-1 flex flex-col bg-terminal-bg/15">
            <div className="flex-shrink-0 flex items-center justify-between gap-3 px-3 py-2 border-b border-terminal-border/50 bg-terminal-surface/35">
              <div className="min-w-0">
                <div className="text-[10px] text-terminal-muted">当前目录</div>
                <div className="truncate text-xs text-terminal-text mt-0.5 font-mono">{currentPath}</div>
              </div>
              <div className="text-[10px] text-terminal-muted whitespace-nowrap">
                {search ? `${filtered.length}/${files.length} 项` : `${files.length} 项`}
              </div>
            </div>
            <div className="flex-shrink-0 flex items-center px-2 py-1 border-b border-terminal-border/50 bg-terminal-surface/50 text-[10px] text-terminal-muted font-medium select-none">
              <span className="flex-1 min-w-0 pl-5">名称</span>
              <div className="relative flex items-center justify-end pr-1 flex-shrink-0" style={{ width: colWidths.size }}>
                <span>大小</span>
                <div className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-end cursor-col-resize group/handle" onMouseDown={e => startColResize('size', e)} title="拖动调整列宽">
                  <div className="w-px h-3 bg-terminal-border/60 group-hover/handle:bg-terminal-blue/60 transition-colors" />
                </div>
              </div>
              <div className="relative flex items-center justify-end pr-1 flex-shrink-0" style={{ width: colWidths.date }}>
                <span>修改时间</span>
                <div className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-end cursor-col-resize group/handle" onMouseDown={e => startColResize('date', e)} title="拖动调整列宽">
                  <div className="w-px h-3 bg-terminal-border/60 group-hover/handle:bg-terminal-blue/60 transition-colors" />
                </div>
              </div>
              <div className="relative flex items-center justify-end pr-1 flex-shrink-0" style={{ width: colWidths.perms }}>
                <span>权限</span>
                <div className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-end cursor-col-resize group/handle" onMouseDown={e => startColResize('perms', e)} title="拖动调整列宽">
                  <div className="w-px h-3 bg-terminal-border/60 group-hover/handle:bg-terminal-blue/60 transition-colors" />
                </div>
              </div>
              <span className="text-right flex-shrink-0" style={{ width: ACTION_COL_WIDTH }}>操作</span>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {loading && files.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-terminal-muted gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-xs">加载中...</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-terminal-muted gap-2">
                  <Folder className="w-6 h-6 opacity-30" />
                  <span className="text-xs">{search ? '无匹配文件' : '目录为空'}</span>
                </div>
              ) : (
                <div className="py-0.5">
                  {filtered.map(file => (
                    <FileRow
                      key={file.path}
                      file={file}
                      colWidths={colWidths}
                      active={editor.file?.path === file.path || currentPath === file.path}
                      canPreviewText={isProbablyTextFile(file)}
                      onClick={() => { void handleFileClick(file); }}
                      onDoubleClick={() => handleTextFileDoubleClick(file)}
                      onDownload={file.type === 'file' ? () => handleDownload(file) : undefined}
                      onRename={() => setRenameTarget(file)}
                      onDelete={() => setConfirmDelete(file)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex-shrink-0 px-3 py-1 border-t border-terminal-border/50 text-[10px] text-terminal-muted flex items-center justify-between bg-terminal-surface/50">
              <span>{search ? `${filtered.length}/${files.length} 项` : `${files.length} 项`}</span>
              {sessionToken ? <span className="text-terminal-green/60">SFTP 已连接</span> : <span className="text-terminal-red/60">SFTP 未连接</span>}
            </div>
          </div>
        </div>

        {editor.file && layoutWidth > 0 && (
          <div className="absolute inset-y-2 right-2 z-20 pointer-events-none">
            <div
              className="relative h-full rounded-2xl border border-terminal-border/70 bg-terminal-surface shadow-[-24px_0_48px_rgba(0,0,0,0.28)] pointer-events-auto"
              style={{ width: editorWidth || getDefaultEditorPanelWidth(layoutWidth) }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 w-4 -translate-x-1/2 cursor-col-resize"
                onMouseDown={startEditorResize}
                title="拖动调整编辑区宽度"
              >
                <div className="absolute left-1/2 top-1/2 h-14 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-terminal-border/80 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]" />
              </div>

              <div className="flex h-full flex-col overflow-hidden rounded-2xl">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-terminal-border/50 bg-terminal-surface">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] text-terminal-muted">
                      <span>文本查看 / 编辑</span>
                      {editorDirty && <span className="rounded-full bg-terminal-yellow/12 px-1.5 py-0.5 text-terminal-yellow">未保存</span>}
                    </div>
                    <div className="truncate text-sm text-terminal-text mt-1 font-medium">{editor.file.name}</div>
                    <div className="truncate text-[10px] text-terminal-muted mt-1 font-mono">{editor.file.path}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setShowEditorFindReplace(prev => !prev)}
                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10px] transition-colors ${showEditorFindReplace ? 'border-terminal-blue/30 bg-terminal-blue/10 text-terminal-blue' : 'border-terminal-border text-terminal-muted hover:border-terminal-blue/35 hover:text-terminal-text'}`}
                    >
                      <Search className="w-3 h-3" />{showEditorFindReplace ? '隐藏搜索' : '搜索替换'}
                    </button>
                    <button
                      onClick={handleRollbackTextFile}
                      disabled={editor.loading || editor.saving || !editorDirty}
                      className="inline-flex items-center gap-1 rounded-md border border-terminal-border px-2.5 py-1.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-yellow/35 hover:text-terminal-text disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" />回滚
                    </button>
                    <button
                      onClick={() => { void handleCopyTextFile(); }}
                      disabled={editor.loading || !editor.file}
                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[10px] transition-colors disabled:opacity-40 ${editorActionState === 'copied' ? 'border-terminal-green/30 bg-terminal-green/10 text-terminal-green' : 'border-terminal-border text-terminal-muted hover:border-terminal-green/35 hover:text-terminal-text'}`}
                    >
                      {editorActionState === 'copied' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {editorActionState === 'copied' ? '已复制' : '复制'}
                    </button>
                    <button
                      onClick={handleSaveTextFile}
                      disabled={editor.loading || editor.saving || !editorDirty}
                      className="inline-flex items-center gap-1 rounded-md border border-terminal-blue/30 bg-terminal-blue/10 px-2.5 py-1.5 text-[10px] text-terminal-blue transition-colors hover:bg-terminal-blue/15 disabled:opacity-40"
                    >
                      {editor.saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}保存
                    </button>
                    <button
                      onClick={() => setEditor(createEmptyEditorState())}
                      className="inline-flex items-center gap-1 rounded-md border border-terminal-border px-2.5 py-1.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-blue/35 hover:text-terminal-text"
                    >
                      <PanelRightClose className="w-3 h-3" />收起
                    </button>
                  </div>
                </div>

                <div className="mx-4 my-4 flex flex-1 flex-col overflow-hidden rounded-2xl border border-terminal-border/60 bg-terminal-bg shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-terminal-border/50 bg-terminal-surface">
                    <div className="flex items-center gap-2 text-[11px] text-terminal-muted min-w-0">
                      <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">正在编辑</span>
                    </div>
                    <div className="text-[10px] text-terminal-muted whitespace-nowrap">
                      拖左侧把手可调宽度
                    </div>
                  </div>
                  {showEditorFindReplace && (
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-b border-terminal-border/50 bg-terminal-surface px-4 py-2.5">
                      <div className="flex items-center gap-2 rounded-lg border border-terminal-border bg-terminal-bg px-2.5 py-2">
                        <Search className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
                        <input
                          ref={editorSearchInputRef}
                          type="text"
                          value={editorSearch}
                          onChange={e => setEditorSearch(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleFindMatch(e.shiftKey ? 'prev' : 'next');
                            }
                          }}
                          placeholder="搜索内容..."
                          className="min-w-0 flex-1 bg-transparent text-xs text-terminal-text placeholder:text-terminal-muted/60 outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border border-terminal-border bg-terminal-bg px-2.5 py-2">
                        <input
                          type="text"
                          value={editorReplace}
                          onChange={e => setEditorReplace(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleReplaceCurrentMatch();
                            }
                          }}
                          placeholder="替换为..."
                          className="min-w-0 flex-1 bg-transparent text-xs text-terminal-text placeholder:text-terminal-muted/60 outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleFindMatch('prev')}
                          disabled={!editorSearch.trim() || editorMatches.length === 0}
                          className="rounded-md border border-terminal-border px-2 py-1.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-blue/35 hover:text-terminal-text disabled:opacity-40"
                        >
                          上一个
                        </button>
                        <button
                          onClick={() => handleFindMatch('next')}
                          disabled={!editorSearch.trim() || editorMatches.length === 0}
                          className="rounded-md border border-terminal-border px-2 py-1.5 text-[10px] text-terminal-muted transition-colors hover:border-terminal-blue/35 hover:text-terminal-text disabled:opacity-40"
                        >
                          下一个
                        </button>
                        <button
                          onClick={handleReplaceCurrentMatch}
                          disabled={!currentEditorMatch}
                          className="rounded-md border border-terminal-yellow/30 bg-terminal-yellow/10 px-2 py-1.5 text-[10px] text-terminal-yellow transition-colors hover:bg-terminal-yellow/15 disabled:opacity-40"
                        >
                          替换当前
                        </button>
                        <button
                          onClick={handleReplaceAllMatches}
                          disabled={!editorSearch.trim() || editorMatches.length === 0}
                          className="rounded-md border border-terminal-blue/30 bg-terminal-blue/10 px-2 py-1.5 text-[10px] text-terminal-blue transition-colors hover:bg-terminal-blue/15 disabled:opacity-40"
                        >
                          全部替换
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 border-b border-terminal-border/50 bg-terminal-surface/50 px-4 py-1.5 text-[10px] text-terminal-muted">
                    <span>行号已开启</span>
                    <span>
                      {editorSearch.trim()
                        ? (editorMatches.length > 0 ? `匹配 ${Math.min(editorMatchIndex + 1, editorMatches.length)}/${editorMatches.length}` : '没有匹配')
                        : `共 ${editorLineCount} 行`}
                    </span>
                  </div>
                  {editor.error && (
                    <div className="px-4 py-2 text-[11px] text-terminal-red border-b border-terminal-red/20 bg-terminal-red/10">{editor.error}</div>
                  )}
                  {editor.loading ? (
                    <div className="flex-1 flex items-center justify-center text-terminal-muted text-sm gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />读取中...
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 overflow-hidden">
                      <div
                        ref={editorLineNumberRef}
                        className="w-14 flex-shrink-0 overflow-hidden border-r border-terminal-border/50 bg-terminal-surface/35 px-2 py-4 text-right text-[12px] leading-6 text-terminal-muted select-none"
                      >
                        <pre className="m-0 whitespace-pre font-mono" style={{ minWidth: `${lineNumberDigits}ch` }}>{Array.from({ length: editorLineCount }, (_, i) => i + 1).join('\n')}</pre>
                      </div>
                      <textarea
                        ref={editorTextareaRef}
                        value={editor.content}
                        onChange={e => setEditor(prev => ({ ...prev, content: e.target.value, error: null }))}
                        onScroll={handleEditorScroll}
                        wrap="off"
                        className="flex-1 min-h-[420px] resize-none overflow-auto border-none bg-transparent px-4 py-4 text-[13px] leading-6 font-mono text-terminal-text outline-none"
                        spellCheck={false}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files?.length) {
            void handleUpload(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {confirmDelete && <ConfirmDialog message={`确认删除 "${confirmDelete.name}"？此操作不可撤销。`} onConfirm={handleDeleteConfirm} onCancel={() => setConfirmDelete(null)} />}
      {showNewFolder && <NewFolderDialog onConfirm={handleNewFolder} onCancel={() => setShowNewFolder(false)} />}
      {renameTarget && <RenameDialog file={renameTarget} onConfirm={handleRenameConfirm} onCancel={() => setRenameTarget(null)} />}
    </div>
  );
}

function FileRow({ file, colWidths, active, canPreviewText, onClick, onDoubleClick, onDownload, onRename, onDelete }: {
  file: SFTPFile;
  colWidths: ColWidths;
  active?: boolean;
  canPreviewText?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onDownload?: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const isDir = file.type === 'directory';
  const isSymlink = file.type === 'symlink';
  const clickable = isDir || !!canPreviewText;

  const icon = isDir
    ? <Folder className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />
    : isSymlink
      ? <Link className="w-3.5 h-3.5 text-terminal-blue flex-shrink-0" />
      : <File className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />;

  return (
    <div className={`group flex items-center px-2 py-1 transition-colors ${active ? 'bg-terminal-blue/8' : 'hover:bg-terminal-border/20'} ${clickable ? 'cursor-pointer' : ''}`} onClick={clickable ? onClick : undefined} onDoubleClick={onDoubleClick}>
      <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-0">
        {icon}
        <div className="min-w-0 flex items-center gap-2">
          <span className={`text-xs truncate ${clickable ? 'text-terminal-text hover:text-terminal-blue' : 'text-terminal-text'}`} title={file.name}>
            {file.name}
            {isSymlink && <span className="text-terminal-muted ml-1 text-[10px]">→</span>}
          </span>
        </div>
      </div>
      <span className="text-right text-[10px] text-terminal-muted flex-shrink-0 overflow-hidden" style={{ width: colWidths.size }}>
        {isDir ? '-' : formatSize(file.size)}
      </span>
      <span className="text-right text-[10px] text-terminal-muted flex-shrink-0 overflow-hidden" style={{ width: colWidths.date }}>
        {formatDate(file.modifyTime)}
      </span>
      <span className="text-right text-[10px] text-terminal-muted font-mono flex-shrink-0 truncate" style={{ width: colWidths.perms }} title={file.permissions}>
        {file.permissions?.slice(0, 9) || '---------'}
      </span>
      <div className="flex items-center justify-end gap-1 flex-shrink-0" style={{ width: ACTION_COL_WIDTH }} onClick={e => e.stopPropagation()}>
        {canPreviewText && (
          <button onClick={onClick} title="打开文本" className="w-5 h-5 flex items-center justify-center rounded opacity-60 group-hover:opacity-100 hover:bg-terminal-blue/20 text-terminal-blue transition-all">
            <FileText className="w-3 h-3" />
          </button>
        )}
        {onDownload && (
          <button onClick={onDownload} title="下载" className="w-5 h-5 flex items-center justify-center rounded opacity-60 group-hover:opacity-100 hover:bg-terminal-blue/20 text-terminal-blue transition-all">
            <Download className="w-3 h-3" />
          </button>
        )}
        <button onClick={onRename} title="重命名" className="w-5 h-5 flex items-center justify-center rounded opacity-60 group-hover:opacity-100 hover:bg-terminal-yellow/20 text-terminal-yellow transition-all">
          <Pencil className="w-3 h-3" />
        </button>
        <button onClick={onDelete} title="删除" className="w-5 h-5 flex items-center justify-center rounded opacity-60 group-hover:opacity-100 hover:bg-terminal-red/20 text-terminal-red transition-all">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
