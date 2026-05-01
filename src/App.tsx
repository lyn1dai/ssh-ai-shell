import React, { useState, useEffect, useRef } from 'react';
import ConnectForm from './components/ConnectForm';
import TerminalPage from './components/TerminalPage';
import AIChatPanel from './components/AIChatPanel';
import type { ConnectConfig, SavedHost, Theme, SavedCommand } from './types';
import { Plus, X, Search, Bot } from 'lucide-react';

type Page = 'connect' | 'terminal';

// ─── Pane tree ────────────────────────────────────────────────────────────

type Pane = LeafPane | SplitPane;

interface LeafPane {
  type: 'leaf';
  id: string;
  config: ConnectConfig;
}

interface SplitPane {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  first: Pane;
  second: Pane;
}

interface Session {
  id: string;
  label: string;
  rootPane: Pane;
  focusedPaneId: string;
}

// ─── Pane utilities ───────────────────────────────────────────────────────

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`; }

function makeLeaf(config: ConnectConfig): LeafPane {
  return { type: 'leaf', id: genId(), config };
}

function firstLeafConfig(pane: Pane): ConnectConfig {
  return pane.type === 'leaf' ? pane.config : firstLeafConfig(pane.first);
}

function firstLeafId(pane: Pane): string {
  return pane.type === 'leaf' ? pane.id : firstLeafId(pane.first);
}

function getLeaves(pane: Pane): LeafPane[] {
  if (pane.type === 'leaf') return [pane];
  return [...getLeaves(pane.first), ...getLeaves(pane.second)];
}

/** Compute absolute-position percentages for every leaf in the tree. */
interface LeafRect { left: string; top: string; width: string; height: string; }
function computeLeafRects(
  pane: Pane,
  b = { l: 0, t: 0, w: 100, h: 100 },
): Map<string, LeafRect> {
  if (pane.type === 'leaf') {
    return new Map([[pane.id, {
      left: `${b.l}%`, top: `${b.t}%`, width: `${b.w}%`, height: `${b.h}%`,
    }]]);
  }
  const isH = pane.direction === 'horizontal';
  const fb = isH
    ? { l: b.l,           t: b.t,           w: b.w / 2, h: b.h      }
    : { l: b.l,           t: b.t,           w: b.w,     h: b.h / 2  };
  const sb = isH
    ? { l: b.l + b.w / 2, t: b.t,           w: b.w / 2, h: b.h      }
    : { l: b.l,           t: b.t + b.h / 2, w: b.w,     h: b.h / 2  };
  return new Map([...computeLeafRects(pane.first, fb), ...computeLeafRects(pane.second, sb)]);
}

/** Collect every split divider's position so we can render a 1 px line. */
interface DivInfo { isH: boolean; l: number; t: number; w: number; h: number; split: number; }
function collectDividers(pane: Pane, b = { l: 0, t: 0, w: 100, h: 100 }): DivInfo[] {
  if (pane.type === 'leaf') return [];
  const isH = pane.direction === 'horizontal';
  const split = isH ? b.l + b.w / 2 : b.t + b.h / 2;
  const fb = isH ? { l: b.l,           t: b.t,           w: b.w / 2, h: b.h      }
                 : { l: b.l,           t: b.t,           w: b.w,     h: b.h / 2  };
  const sb = isH ? { l: b.l + b.w / 2, t: b.t,           w: b.w / 2, h: b.h      }
                 : { l: b.l,           t: b.t + b.h / 2, w: b.w,     h: b.h / 2  };
  return [
    { isH, l: b.l, t: b.t, w: b.w, h: b.h, split },
    ...collectDividers(pane.first, fb),
    ...collectDividers(pane.second, sb),
  ];
}

function splitLeaf(
  root: Pane,
  targetId: string,
  direction: 'horizontal' | 'vertical',
): { root: Pane; newPaneId: string } {
  let newPaneId = '';
  function recurse(pane: Pane): Pane {
    if (pane.type === 'leaf') {
      if (pane.id !== targetId) return pane;
      const newLeaf = makeLeaf(pane.config);
      newPaneId = newLeaf.id;
      return { type: 'split', direction, first: pane, second: newLeaf };
    }
    return { ...pane, first: recurse(pane.first), second: recurse(pane.second) };
  }
  return { root: recurse(root), newPaneId };
}

function closeLeaf(root: Pane, targetId: string): Pane | null {
  if (root.type === 'leaf') return root.id === targetId ? null : root;
  const f = closeLeaf(root.first, targetId);
  const s = closeLeaf(root.second, targetId);
  if (f === null) return s;
  if (s === null) return f;
  return { ...root, first: f, second: s };
}

// ─── SVG icons ────────────────────────────────────────────────────────────

function IconSplitH() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="6" height="12" rx="1.2" opacity="0.6"/>
      <rect x="9" y="2" width="6" height="12" rx="1.2" opacity="0.6"/>
    </svg>
  );
}

function IconSplitV() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="1" width="12" height="6" rx="1.2" opacity="0.6"/>
      <rect x="2" y="9" width="12" height="6" rx="1.2" opacity="0.6"/>
    </svg>
  );
}

function IconPanel() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="currentColor">
      <rect x="1" y="1" width="4" height="12" rx="1" opacity="0.5"/>
      <rect x="7" y="1" width="6" height="12" rx="1" opacity="0.8"/>
    </svg>
  );
}

// ─── LeafPaneView ─────────────────────────────────────────────────────────
// Extracted so each leaf can own its dropdown / pendingCommand state.

interface LeafPaneViewProps {
  leaf: LeafPane;
  rect: LeafRect;
  isFocused: boolean;
  hasSplit: boolean;
  onFocusPane: () => void;
  onSplitPane: (direction: 'horizontal' | 'vertical') => void;
  onClosePane: () => void;
  onNewTab: (config?: ConnectConfig) => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  savedCommands: SavedCommand[];
}

function LeafPaneView({
  leaf, rect, isFocused, hasSplit,
  onFocusPane, onSplitPane, onClosePane, onNewTab,
  theme, onThemeChange, savedCommands,
}: LeafPaneViewProps) {
  const [pendingCmd, setPendingCmd] = useState<{ cmd: SavedCommand; nonce: number } | null>(null);

  // Sort by usageCount desc, fall back to creation order; take top 7
  const topCmds = [...savedCommands]
    .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
    .slice(0, 7);

  // Truncate label to max 8 chars so buttons stay compact
  function shortLabel(name: string) {
    return name.length > 8 ? name.slice(0, 7) + '…' : name;
  }

  // Build tooltip: name + shortcut + first line of content
  function cmdTooltip(cmd: SavedCommand) {
    const lines: string[] = [cmd.name];
    if (cmd.shortcut) lines.push(`快捷键: ${cmd.shortcut}`);
    const firstLine = cmd.content.split('\n')[0].trim();
    if (firstLine) lines.push(firstLine);
    return lines.join('\n');
  }

  return (
    <div
      className="group/pane"
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        overflow: 'hidden',
        outline: (hasSplit && isFocused) ? '1.5px solid rgba(var(--tw-c-blue), 0.4)' : 'none',
        outlineOffset: '-1px',
      }}
      onMouseDown={onFocusPane}
    >
      <TerminalPage
        config={leaf.config}
        onDisconnect={onClosePane}
        onNewTab={onNewTab}
        theme={theme}
        onThemeChange={onThemeChange}
        pendingCommand={pendingCmd ?? undefined}
      />

      {/* Per-pane control strip — shown on hover */}
      <div
        className="absolute z-30 opacity-0 group-hover/pane:opacity-100 transition-opacity duration-150 pointer-events-none group-hover/pane:pointer-events-auto"
        style={{ top: 5, right: 8 }}
      >
        <div className="flex items-center bg-terminal-surface/90 backdrop-blur-sm border border-terminal-border/70 rounded-lg shadow-lg px-0.5 py-0.5 gap-px">

          {/* ── Top-7 most-used command buttons ── */}
          {topCmds.length > 0 && (
            <>
              {topCmds.map(cmd => (
                <button
                  key={cmd.id}
                  onMouseDown={e => {
                    e.stopPropagation();
                    setPendingCmd({ cmd, nonce: Date.now() });
                  }}
                  title={cmdTooltip(cmd)}
                  className="h-6 px-1.5 flex items-center rounded-md text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors font-mono text-[10px] leading-none whitespace-nowrap"
                >
                  {shortLabel(cmd.name)}
                </button>
              ))}
              <div className="w-px h-3.5 bg-terminal-border/70 mx-0.5 flex-shrink-0" />
            </>
          )}

          {/* ── Split / close ── */}
          <button
            onMouseDown={e => { e.stopPropagation(); onSplitPane('horizontal'); }}
            className="w-6 h-6 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/60 transition-colors"
            title="左右分屏"
          >
            <IconSplitH />
          </button>
          <button
            onMouseDown={e => { e.stopPropagation(); onSplitPane('vertical'); }}
            className="w-6 h-6 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/60 transition-colors"
            title="上下分屏"
          >
            <IconSplitV />
          </button>
          <div className="w-px h-3.5 bg-terminal-border/70 mx-0.5 flex-shrink-0" />
          <button
            onMouseDown={e => { e.stopPropagation(); onClosePane(); }}
            className="w-6 h-6 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 transition-colors"
            title="关闭窗格"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState<Page>('connect');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('app-theme-v2') as Theme) || 'dark';
  });

  // ── Host picker popup ─────────────────────────────────────────────────
  const [showPicker, setShowPicker] = useState(false);
  const [pickerHosts, setPickerHosts] = useState<SavedHost[]>([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerLeft, setPickerLeft] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  // ── AI assistant panel ────────────────────────────────────────────────
  const [showAIPanel, setShowAIPanel] = useState(false);

  // ── Saved commands (for quick-launch overlay) ─────────────────────────
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);

  useEffect(() => {
    function loadCmds() {
      fetch('/api/saved-commands').then(r => r.json()).then(d => setSavedCommands(Array.isArray(d) ? d : [])).catch(() => {});
    }
    loadCmds();
    window.addEventListener('saved-commands-updated', loadCmds);
    return () => window.removeEventListener('saved-commands-updated', loadCmds);
  }, []);

  useEffect(() => {
    if (!showPicker) return;
    fetch('/api/hosts')
      .then(r => r.json())
      .then(d => setPickerHosts(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [showPicker]);

  useEffect(() => {
    if (!showPicker) return;
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
        setPickerSearch('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showPicker]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme-v2', theme);
  }, [theme]);

  async function downloadConfig() {
    try {
      const res = await fetch('/api/export-settings');
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ssh-ai-shell-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  }

  function handleBackToConnect() { setPage('connect'); }

  function handleConnect(cfg: ConnectConfig) {
    const id = genId();
    const label = cfg.name || `${cfg.username}@${cfg.host}`;
    const rootPane = makeLeaf(cfg);
    setSessions(prev => [...prev, { id, label, rootPane, focusedPaneId: rootPane.id }]);
    setActiveId(id);
    setPage('terminal');
  }

  function handleAddTab(config?: ConnectConfig) {
    const activeSession = sessions.find(s => s.id === activeId);
    const cfg = config || (activeSession ? firstLeafConfig(activeSession.rootPane) : undefined);
    if (!cfg) return;
    const id = genId();
    const label = cfg.name || `${cfg.username}@${cfg.host}`;
    const rootPane = makeLeaf(cfg);
    setSessions(prev => [...prev, { id, label, rootPane, focusedPaneId: rootPane.id }]);
    setActiveId(id);
  }

  function handlePickerConnect(host: SavedHost) {
    handleAddTab({
      host: host.host, port: host.port, username: host.username,
      password: host.password, privateKey: host.privateKey,
      name: host.name, hostId: host.id,
    });
    setShowPicker(false);
    setPickerSearch('');
  }

  function handleCloseTab(id: string) {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        setPage('connect');
        setActiveId(null);
        return [];
      }
      setActiveId(prev2 => {
        if (prev2 !== id) return prev2;
        const idx = prev.findIndex(s => s.id === id);
        const remaining = prev.filter(s => s.id !== id);
        if (remaining.length === 0) return null;
        return remaining[Math.min(idx, remaining.length - 1)].id;
      });
      return filtered;
    });
  }

  /** Close a single pane; if it was the last one in the session, close the session. */
  function handleClosePane(sessionId: string, paneId: string) {
    setSessions(prev => {
      const updated = prev.reduce<Session[]>((acc, s) => {
        if (s.id !== sessionId) { acc.push(s); return acc; }
        const newRoot = closeLeaf(s.rootPane, paneId);
        if (newRoot === null) return acc; // last pane — drop the session
        const newFocused = s.focusedPaneId === paneId ? firstLeafId(newRoot) : s.focusedPaneId;
        acc.push({ ...s, rootPane: newRoot, focusedPaneId: newFocused });
        return acc;
      }, []);
      if (updated.length === 0) {
        setPage('connect');
        setActiveId(null);
      } else if (!updated.find(s => s.id === activeId)) {
        setActiveId(updated[updated.length - 1].id);
      }
      return updated;
    });
  }

  function handleFocusPane(sessionId: string, paneId: string) {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, focusedPaneId: paneId } : s
    ));
  }

  function handleSplitPane(sessionId: string, paneId: string, direction: 'horizontal' | 'vertical') {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const { root: newRoot, newPaneId } = splitLeaf(s.rootPane, paneId, direction);
      return { ...s, rootPane: newRoot, focusedPaneId: newPaneId };
    }));
  }

  // ── Connect page ────────────────────────────────────────────────────────
  if (page === 'connect') {
    return (
      <ConnectForm
        onConnect={handleConnect}
        theme={theme}
        onThemeChange={setTheme}
        hasActiveSessions={sessions.length > 0}
        onBackToTerminal={sessions.length > 0 ? () => setPage('terminal') : undefined}
        onDownloadConfig={downloadConfig}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen bg-terminal-bg overflow-hidden" style={{ fontFamily: 'JetBrains Mono, Fira Code, monospace' }}>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center bg-terminal-surface border-b border-terminal-border h-9 overflow-x-auto" style={{ minWidth: 0 }}>
        <div className="flex items-center gap-0.5 px-2 flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {sessions.map(s => {
            const isActive = s.id === activeId;
            const hasSplit = s.rootPane.type !== 'leaf';
            return (
              <div
                key={s.id}
                className={`flex items-center gap-1.5 px-3 h-7 rounded-md text-xs cursor-pointer flex-shrink-0 group select-none transition-colors ${
                  isActive
                    ? 'bg-terminal-bg text-terminal-text border border-terminal-border'
                    : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/30'
                }`}
                onClick={() => setActiveId(s.id)}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-terminal-green' : 'bg-terminal-muted/40'}`} />
                <span className="max-w-[140px] truncate">{s.label}</span>
                {hasSplit && <span className="text-[9px] text-terminal-blue opacity-70">⊞</span>}
                <button
                  onClick={e => { e.stopPropagation(); handleCloseTab(s.id); }}
                  className="opacity-0 group-hover:opacity-100 hover:text-terminal-red transition-all w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 rounded"
                  title="关闭标签"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}

          {/* + button */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => {
                if (!showPicker && pickerRef.current) {
                  setPickerLeft(pickerRef.current.getBoundingClientRect().left);
                }
                setShowPicker(p => !p);
              }}
              className={`w-7 h-7 flex items-center justify-center rounded hover:bg-terminal-border/50 flex-shrink-0 transition-colors ${showPicker ? 'bg-terminal-border/50 text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'}`}
              title="新建连接"
            >
              <Plus className="w-4 h-4" />
            </button>

            {showPicker && (
              <div style={{ position: 'fixed', top: '37px', left: pickerLeft }} className="w-64 bg-terminal-surface border border-terminal-border rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="p-2 border-b border-terminal-border">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted" />
                    <input
                      autoFocus
                      value={pickerSearch}
                      onChange={e => setPickerSearch(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') { setShowPicker(false); setPickerSearch(''); }
                        if (e.key === 'Enter') {
                          const filtered = pickerHosts.filter(h =>
                            !pickerSearch || h.name.toLowerCase().includes(pickerSearch.toLowerCase()) || h.host.toLowerCase().includes(pickerSearch.toLowerCase())
                          );
                          if (filtered.length === 1) handlePickerConnect(filtered[0]);
                        }
                      }}
                      placeholder="搜索主机..."
                      className="w-full bg-terminal-bg border border-terminal-border rounded-md pl-6 pr-2 py-1.5 text-xs text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors"
                    />
                  </div>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {(() => {
                    const filtered = pickerHosts.filter(h =>
                      !pickerSearch ||
                      h.name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
                      h.host.toLowerCase().includes(pickerSearch.toLowerCase())
                    );
                    if (filtered.length === 0) {
                      return (
                        <div className="px-3 py-5 text-center text-xs text-terminal-muted">
                          {pickerSearch ? '无匹配主机' : '暂无已保存主机'}
                        </div>
                      );
                    }
                    return filtered.map(host => {
                      const colors = ['bg-terminal-blue/20 text-terminal-blue', 'bg-terminal-green/20 text-terminal-green', 'bg-terminal-yellow/20 text-terminal-yellow', 'bg-terminal-purple/20 text-terminal-purple', 'bg-terminal-cyan/20 text-terminal-cyan'];
                      const colorCls = colors[host.name.charCodeAt(0) % colors.length];
                      return (
                        <button
                          key={host.id}
                          onClick={() => handlePickerConnect(host)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-terminal-border/30 transition-colors text-left group"
                        >
                          <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 text-[9px] font-bold ${colorCls}`}>
                            {host.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-terminal-text truncate">{host.name}</p>
                            <p className="text-[10px] text-terminal-muted font-mono truncate">{host.username}@{host.host}</p>
                          </div>
                        </button>
                      );
                    });
                  })()}
                </div>
                <div className="border-t border-terminal-border p-1.5">
                  <button
                    onClick={() => { setShowPicker(false); setPickerSearch(''); handleBackToConnect(); }}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 rounded-lg transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    新建连接
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1 px-2 flex-shrink-0 border-l border-terminal-border/50 ml-auto">
          {/* AI assistant toggle */}
          <button
            onClick={() => setShowAIPanel(p => !p)}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              showAIPanel
                ? 'bg-terminal-blue text-white'
                : 'text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10'
            }`}
            title="AI 终端助手"
          >
            <Bot className="w-4 h-4" />
          </button>
          <button
            onClick={handleBackToConnect}
            className="px-2 h-7 text-[11px] text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/50 rounded transition-colors flex items-center gap-1"
            title="主机列表（保留所有标签）"
          >
            <IconPanel />
            <span>主机列表</span>
          </button>
        </div>
      </div>

      {/* ── Terminal area ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden relative">
        {sessions.map(s => {
          const isActive = s.id === activeId;
          const hasSplit = s.rootPane.type !== 'leaf';
          const rects = computeLeafRects(s.rootPane);
          const dividers = collectDividers(s.rootPane);
          const leaves = getLeaves(s.rootPane);

          return (
            <div
              key={s.id}
              className={`absolute inset-0 overflow-hidden ${isActive ? '' : 'hidden'}`}
            >
              {/* 1 px dividers between panes */}
              {dividers.map((d, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    backgroundColor: 'rgb(var(--tw-c-border))',
                    zIndex: 5,
                    ...(d.isH
                      ? { left: `calc(${d.split}% - 0.5px)`, top: `${d.t}%`,     width: '1px',  height: `${d.h}%`  }
                      : { left: `${d.l}%`,                   top: `calc(${d.split}% - 0.5px)`, width: `${d.w}%`, height: '1px' }
                    ),
                  }}
                />
              ))}

              {leaves.map(leaf => {
                const rect = rects.get(leaf.id)!;
                const isFocused = leaf.id === s.focusedPaneId;
                return (
                  <LeafPaneView
                    key={leaf.id}
                    leaf={leaf}
                    rect={rect}
                    isFocused={isFocused}
                    hasSplit={hasSplit}
                    onFocusPane={() => handleFocusPane(s.id, leaf.id)}
                    onSplitPane={dir => handleSplitPane(s.id, leaf.id, dir)}
                    onClosePane={() => handleClosePane(s.id, leaf.id)}
                    onNewTab={handleAddTab}
                    theme={theme}
                    onThemeChange={setTheme}
                    savedCommands={savedCommands}
                  />
                );
              })}
            </div>
          );
        })}

        {/* ── AI assistant panel overlay (fixed right side, full height) ── */}
        {showAIPanel && (
          <div
            className="absolute top-0 right-0 bottom-0 z-50 flex"
            style={{ width: '320px', boxShadow: '-4px 0 24px rgba(0,0,0,0.25)' }}
          >
            <AIChatPanel onClose={() => setShowAIPanel(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
