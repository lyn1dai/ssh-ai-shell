import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Folder, File, Link, Download, Trash2, Upload, FolderPlus,
  RefreshCw, Home, AlertCircle, Loader2, Search, X, GripVertical, Pencil,
} from 'lucide-react';
import type { SFTPFile } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────

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

const UPLOAD_ABORTED_MESSAGE = '上传已取消';

// ─── Column widths ────────────────────────────────────────────────────────

interface ColWidths { size: number; date: number; perms: number }
const DEFAULT_COLS: ColWidths = { size: 68, date: 88, perms: 88 };
const COL_MIN = 40;
const STORAGE_KEY_COLS = 'fm-col-widths';

function loadColWidths(): ColWidths {
  try {
    const s = localStorage.getItem(STORAGE_KEY_COLS);
    if (s) return { ...DEFAULT_COLS, ...JSON.parse(s) };
  } catch { /* ignore */ }
  return DEFAULT_COLS;
}

// ─── XHR upload with progress ─────────────────────────────────────────────

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

// ─── Confirm dialog ───────────────────────────────────────────────────────

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
          <button onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">
            取消
          </button>
          <button onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded-md bg-terminal-red hover:bg-terminal-red/80 text-white transition-colors">
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New folder dialog ────────────────────────────────────────────────────

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
          <button onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">
            取消
          </button>
          <button onClick={() => name.trim() && onConfirm(name.trim())} disabled={!name.trim()}
            className="px-3 py-1.5 text-xs rounded-md bg-terminal-blue hover:bg-terminal-blue/80 text-white transition-colors disabled:opacity-40">
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Rename dialog ────────────────────────────────────────────────────────

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
          <button onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">
            取消
          </button>
          <button
            onClick={() => name.trim() && name.trim() !== file.name && onConfirm(name.trim())}
            disabled={!name.trim() || name.trim() === file.name}
            className="px-3 py-1.5 text-xs rounded-md bg-terminal-blue hover:bg-terminal-blue/80 text-white transition-colors disabled:opacity-40">
            重命名
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FileManager ──────────────────────────────────────────────────────────

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

interface Props {
  ws: WebSocket | null;
  sessionToken: string;
  onClose: () => void;
  /** If provided (and is an absolute path), open here instead of home dir */
  initialPath?: string;
}

export default function FileManager({ ws, sessionToken, onClose, initialPath }: Props) {
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

  const [pathBarValue, setPathBarValue] = useState('');
  const pathBarFocusedRef = useRef(false);
  const pathInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingPathRef = useRef<string>('/');
  const wsRef = useRef<WebSocket | null>(ws);
  const homeRetryRef = useRef(0);
  const activeUploadXhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelUploadRequestedRef = useRef(false);
  // Stores a tilde-prefixed initialPath until home dir is resolved
  const tildePathRef = useRef<string | null>(null);

  // Sync ws prop to internal ref
  useEffect(() => { wsRef.current = ws; }, [ws]);

  // Keep path bar in sync with currentPath when not focused
  useEffect(() => {
    if (!pathBarFocusedRef.current) setPathBarValue(currentPath);
  }, [currentPath]);

  // Persist column widths
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(colWidths));
  }, [colWidths]);

  useEffect(() => () => {
    cancelUploadRequestedRef.current = true;
    activeUploadXhrRef.current?.abort();
    activeUploadXhrRef.current = null;
  }, []);

  // ── Column drag-resize ────────────────────────────────────────────────

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

  // ── Send sftp_ls ──────────────────────────────────────────────────────

  const loadDir = useCallback((path: string) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError('WebSocket 未连接');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    pendingPathRef.current = path;
    socket.send(JSON.stringify({ type: 'sftp_ls', payload: { path } }));
  }, []);

  // ── Listen for sftp messages ──────────────────────────────────────────

  useEffect(() => {
    const socket = wsRef.current;
    if (!socket) return;

    function handleMsg(e: MessageEvent) {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'sftp_home_result') {
          const { path: homePath, error: err } = msg.payload;
          if (!err && homePath) {
            homeRetryRef.current = 0;
            // Resolve a tilde-prefixed initialPath if we were waiting for home
            const tp = tildePathRef.current;
            tildePathRef.current = null;
            if (tp) {
              const resolved = tp === '~' ? homePath : homePath + tp.slice(1);
              loadDir(resolved);
            } else {
              loadDir(homePath);
            }
          } else if (err && (err.includes('未就绪') || err.includes('not ready')) && homeRetryRef.current < 8) {
            homeRetryRef.current++;
            setTimeout(() => {
              wsRef.current?.send(JSON.stringify({ type: 'sftp_home' }));
            }, 500);
          } else {
            homeRetryRef.current = 0;
            tildePathRef.current = null;
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
            const speedBps = done
              ? prev.speedBps
              : prev.speedBps > 0
                ? prev.speedBps * 0.7 + instantSpeed * 0.3
                : instantSpeed;

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
          if (path === pendingPathRef.current) {
            setLoading(false);
            if (err) {
              setError(err);
              if (err.includes('未就绪') || err.includes('not ready')) {
                setTimeout(() => loadDir(path), 800);
              }
            } else {
              setCurrentPath(path);
              const sorted = [...fl].sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1;
                if (a.type !== 'directory' && b.type === 'directory') return 1;
                return a.name.localeCompare(b.name);
              });
              setFiles(sorted);
            }
          }
          return;
        }

        if (msg.type === 'sftp_op_result') {
          const { success, error: err } = msg.payload;
          setLoading(false);
          if (!success) {
            setError(err || '操作失败');
          } else {
            loadDir(pendingPathRef.current || currentPath);
          }
          setShowNewFolder(false);
          setRenameTarget(null);
        }
      } catch {
        // ignore parse errors
      }
    }

    socket.addEventListener('message', handleMsg);
    return () => socket.removeEventListener('message', handleMsg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  // ── Initial load: resolve home dir OR use initialPath ─────────────────

  useEffect(() => {
    const socket = wsRef.current;
    if (!socket) { setLoading(false); return; }

    homeRetryRef.current = 0;

    function doLoad() {
      // Absolute path — navigate directly
      if (initialPath && initialPath.startsWith('/')) {
        pendingPathRef.current = initialPath;
        loadDir(initialPath);
      } else if (initialPath && (initialPath === '~' || initialPath.startsWith('~/'))) {
        // Tilde path — resolve home dir first, then substitute
        tildePathRef.current = initialPath;
        socket!.send(JSON.stringify({ type: 'sftp_home' }));
      } else {
        // No usable initialPath — fall back to SFTP home
        socket!.send(JSON.stringify({ type: 'sftp_home' }));
      }
    }

    if (socket.readyState === WebSocket.OPEN) {
      doLoad();
    } else {
      socket.addEventListener('open', doLoad, { once: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, initialPath]);

  // ── Actions ───────────────────────────────────────────────────────────

  function navigate(path: string) {
    setSearch('');
    setFiles([]);
    loadDir(path);
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

  function handleFileClick(file: SFTPFile) {
    if (file.type === 'directory') navigate(file.path);
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
  }

  function handleRenameConfirm(newName: string) {
    const socket = wsRef.current;
    if (!renameTarget || !socket) return;
    const newPath = joinPath(parentPath(renameTarget.path), newName);
    socket.send(JSON.stringify({ type: 'sftp_rename', payload: { oldPath: renameTarget.path, newPath } }));
    pendingPathRef.current = currentPath;
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

    for (let i = 0; i < total; i++) {
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
        await uploadFileXHR(url, file, (xhr) => {
          activeUploadXhrRef.current = xhr;
        });

        setUploadState(prev => prev && prev.uploadId === uploadId
          ? {
              ...prev,
              percent: 100,
              uploadedBytes: prev.totalBytes || file.size,
              totalBytes: prev.totalBytes || file.size,
              serverProgress: true,
            }
          : prev);
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
    loadDir(uploadPath);
    if (cancelled) {
      fileInputRef.current?.blur();
    }
  }

  function handleCancelUpload() {
    cancelUploadRequestedRef.current = true;
    setUploadState(prev => prev ? { ...prev, cancelRequested: true } : prev);
    activeUploadXhrRef.current?.abort();
  }

  // ── Filtered files ────────────────────────────────────────────────────

  const filtered = search
    ? files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : files;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-terminal-border bg-terminal-surface">
        <span className="text-xs font-semibold text-terminal-text">文件管理</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => loadDir(currentPath)}
            title="刷新"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowNewFolder(true)}
            title="新建文件夹"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="上传文件"
            disabled={!!uploadState}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors disabled:opacity-40"
          >
            {uploadState ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          </button>
          {/* X is the ONLY way to close */}
          <button
            onClick={onClose}
            title="关闭"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-red/20 text-terminal-muted hover:text-terminal-red transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Address bar */}
      <div className="flex-shrink-0 border-b border-terminal-border/50 bg-terminal-surface/80">
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <button
            onClick={() => navigate('/')}
            title="根目录"
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors"
          >
            <Home className="w-3 h-3" />
          </button>
          {currentPath !== '/' && !loading && (
            <button
              onClick={() => navigate(parentPath(currentPath))}
              title="上一级"
              className="flex-shrink-0 text-[10px] text-terminal-muted hover:text-terminal-text px-1 py-0.5 rounded hover:bg-terminal-border/40 transition-colors"
            >
              ↑
            </button>
          )}
          {loading && <Loader2 className="w-3 h-3 text-terminal-muted animate-spin flex-shrink-0" />}
          <div
            className="flex-1 min-w-0 flex items-center gap-1 rounded-md border border-terminal-border/70 bg-terminal-bg px-1.5 py-0.5 focus-within:border-terminal-blue/40"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <input
              ref={pathInputRef}
              type="text"
              value={pathBarValue}
              onChange={e => setPathBarValue(e.target.value)}
              onFocus={() => {
                pathBarFocusedRef.current = true;
              }}
              onBlur={() => {
                pathBarFocusedRef.current = false;
              }}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitPathEdit();
                }
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
              <button
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  setPathBarValue('');
                  focusPathInput(false);
                }}
                className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors"
                title="清空路径"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-terminal-border/50">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="过滤文件名（当前目录）..."
            className="w-full bg-terminal-bg border border-terminal-border rounded-md pl-7 pr-7 py-1 text-xs text-terminal-text outline-none focus:border-terminal-blue/50 placeholder:text-terminal-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted hover:text-terminal-text">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {search && (
          <div className="mt-1 text-[10px] text-terminal-muted px-0.5">
            {filtered.length}/{files.length} 匹配
          </div>
        )}
      </div>

      {/* Upload progress bar */}
      {uploadState && (
        <div className="flex-shrink-0 px-3 py-2 bg-terminal-blue/10 border-b border-terminal-blue/20">
          <div className="flex items-center justify-between text-[11px] text-terminal-blue mb-1.5">
            <span className="truncate mr-2 flex items-center gap-1.5 min-w-0">
              <Upload className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{uploadState.fileName}</span>
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="font-mono">
                {uploadState.fileIndex}/{uploadState.totalFiles}
              </span>
              <button
                onClick={handleCancelUpload}
                disabled={uploadState.cancelRequested}
                className="px-2 py-0.5 rounded border border-terminal-blue/30 text-[10px] text-terminal-blue hover:bg-terminal-blue/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploadState.cancelRequested ? '取消中...' : '取消'}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] text-terminal-blue/90 mb-1.5 font-mono">
            <span>{uploadState.percent}%</span>
            <span>{uploadState.cancelRequested ? '取消中...' : formatTransferSpeed(uploadState.speedBps)}</span>
            <span>
              {formatSize(uploadState.uploadedBytes)} / {formatSize(uploadState.totalBytes)}
            </span>
          </div>
          <div className="h-1.5 bg-terminal-border rounded-full overflow-hidden">
            <div
              className="h-full bg-terminal-blue rounded-full transition-all duration-150"
              style={{ width: `${uploadState.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-terminal-red/10 border-b border-terminal-red/20 text-xs text-terminal-red flex items-center gap-2">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span className="flex-1 truncate">{error}</span>
          <button onClick={() => setError(null)} className="flex-shrink-0 hover:opacity-70">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Column headers with drag-to-resize handles */}
      <div className="flex-shrink-0 flex items-center px-2 py-1 border-b border-terminal-border/50 bg-terminal-surface/50 text-[10px] text-terminal-muted font-medium select-none">
        <span className="flex-1 min-w-0 pl-5">名称</span>

        {/* Size column */}
        <div className="relative flex items-center justify-end pr-1 flex-shrink-0" style={{ width: colWidths.size }}>
          <span>大小</span>
          <div
            className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-end cursor-col-resize group/handle"
            onMouseDown={e => startColResize('size', e)}
            title="拖动调整列宽"
          >
            <div className="w-px h-3 bg-terminal-border/60 group-hover/handle:bg-terminal-blue/60 transition-colors" />
          </div>
        </div>

        {/* Date column */}
        <div className="relative flex items-center justify-end pr-1 flex-shrink-0" style={{ width: colWidths.date }}>
          <span>修改时间</span>
          <div
            className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-end cursor-col-resize group/handle"
            onMouseDown={e => startColResize('date', e)}
            title="拖动调整列宽"
          >
            <div className="w-px h-3 bg-terminal-border/60 group-hover/handle:bg-terminal-blue/60 transition-colors" />
          </div>
        </div>

        {/* Perms column */}
        <div className="relative flex items-center justify-end pr-1 flex-shrink-0" style={{ width: colWidths.perms }}>
          <span>权限</span>
          <div
            className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-end cursor-col-resize group/handle"
            onMouseDown={e => startColResize('perms', e)}
            title="拖动调整列宽"
          >
            <div className="w-px h-3 bg-terminal-border/60 group-hover/handle:bg-terminal-blue/60 transition-colors" />
          </div>
        </div>

        {/* Actions — fixed, no resize */}
        <span className="w-16 text-right flex-shrink-0">操作</span>
      </div>

      {/* File list */}
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
            {filtered.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                colWidths={colWidths}
                onClick={() => handleFileClick(file)}
                onDownload={file.type === 'file' ? () => handleDownload(file) : undefined}
                onRename={() => setRenameTarget(file)}
                onDelete={() => setConfirmDelete(file)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-3 py-1 border-t border-terminal-border/50 text-[10px] text-terminal-muted flex items-center justify-between bg-terminal-surface/50">
        <span>
          {search
            ? `${filtered.length}/${files.length} 项`
            : `${files.length} 项`}
        </span>
        {sessionToken ? (
          <span className="text-terminal-green/60">SFTP 已连接</span>
        ) : (
          <span className="text-terminal-red/60">SFTP 未连接</span>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files?.length) {
            handleUpload(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Dialogs */}
      {confirmDelete && (
        <ConfirmDialog
          message={`确认删除 "${confirmDelete.name}"？此操作不可撤销。`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {showNewFolder && (
        <NewFolderDialog
          onConfirm={handleNewFolder}
          onCancel={() => setShowNewFolder(false)}
        />
      )}
      {renameTarget && (
        <RenameDialog
          file={renameTarget}
          onConfirm={handleRenameConfirm}
          onCancel={() => setRenameTarget(null)}
        />
      )}
    </div>
  );
}

// ─── FileRow ──────────────────────────────────────────────────────────────

function FileRow({ file, colWidths, onClick, onDownload, onRename, onDelete }: {
  file: SFTPFile;
  colWidths: ColWidths;
  onClick: () => void;
  onDownload?: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const isDir = file.type === 'directory';
  const isSymlink = file.type === 'symlink';

  const icon = isDir
    ? <Folder className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />
    : isSymlink
    ? <Link className="w-3.5 h-3.5 text-terminal-blue flex-shrink-0" />
    : <File className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />;

  return (
    <div
      className={`group flex items-center px-2 py-0.5 hover:bg-terminal-border/20 transition-colors ${isDir ? 'cursor-pointer' : ''}`}
      onClick={isDir ? onClick : undefined}
    >
      {/* Icon + name */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-0">
        {icon}
        <span
          className={`text-xs truncate ${isDir ? 'text-terminal-text hover:text-terminal-blue' : 'text-terminal-text'}`}
          title={file.name}
        >
          {file.name}
          {isSymlink && <span className="text-terminal-muted ml-1 text-[10px]">→</span>}
        </span>
      </div>
      {/* Size */}
      <span
        className="text-right text-[10px] text-terminal-muted flex-shrink-0 overflow-hidden"
        style={{ width: colWidths.size }}
      >
        {isDir ? '-' : formatSize(file.size)}
      </span>
      {/* Date */}
      <span
        className="text-right text-[10px] text-terminal-muted flex-shrink-0 overflow-hidden"
        style={{ width: colWidths.date }}
      >
        {formatDate(file.modifyTime)}
      </span>
      {/* Permissions */}
      <span
        className="text-right text-[10px] text-terminal-muted font-mono flex-shrink-0 truncate"
        style={{ width: colWidths.perms }}
        title={file.permissions}
      >
        {file.permissions?.slice(0, 9) || '---------'}
      </span>
      {/* Actions */}
      <div
        className="w-16 flex items-center justify-end gap-0.5 flex-shrink-0"
        onClick={e => e.stopPropagation()}
      >
        {onDownload && (
          <button
            onClick={onDownload}
            title="下载"
            className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-terminal-blue/20 text-terminal-blue transition-all"
          >
            <Download className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={onRename}
          title="重命名"
          className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-terminal-yellow/20 text-terminal-yellow transition-all"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={onDelete}
          title="删除"
          className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-terminal-red/20 text-terminal-red transition-all"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
