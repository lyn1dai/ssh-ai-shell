import React, { useState, useEffect } from 'react';
import ConnectForm from './components/ConnectForm';
import TerminalPage from './components/TerminalPage';
import type { ConnectConfig, Theme } from './types';
import { Plus, X } from 'lucide-react';

type Page = 'connect' | 'terminal';

interface Session {
  id: string;
  config: ConnectConfig;
  label: string;
}

function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`; }

// ─── Split icons ──────────────────────────────────────────────────────────

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

export default function App() {
  const [page, setPage] = useState<Page>('connect');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState<'none' | 'horizontal' | 'vertical'>('none');
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    // Use versioned key 'app-theme-v2' so stale 'light' from older builds is ignored
    return (localStorage.getItem('app-theme-v2') as Theme) || 'dark';
  });

  // Apply theme to root element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme-v2', theme);
  }, [theme]);

  function handleConnect(cfg: ConnectConfig) {
    const id = genId();
    const label = cfg.name || `${cfg.username}@${cfg.host}`;
    setSessions([{ id, config: cfg, label }]);
    setActiveId(id);
    setPage('terminal');
  }

  function handleAddTab(config?: ConnectConfig) {
    const cfg = config || sessions.find(s => s.id === activeId)?.config;
    if (!cfg) return;
    const id = genId();
    const label = cfg.name || `${cfg.username}@${cfg.host}`;
    setSessions(prev => [...prev, { id, config: cfg, label }]);
    setActiveId(id);
    // If in split mode, update secondary to the new tab
    if (splitMode !== 'none') setSecondaryId(id);
  }

  function handleCloseTab(id: string) {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        setPage('connect');
        setActiveId(null);
        return [];
      }
      // Update active id if closing active tab
      setActiveId(prev2 => {
        if (prev2 !== id) return prev2;
        const idx = sessions.findIndex(s => s.id === id);
        const newSessions = sessions.filter(s => s.id !== id);
        if (newSessions.length === 0) return null;
        const newIdx = Math.min(idx, newSessions.length - 1);
        return newSessions[newIdx].id;
      });
      return filtered;
    });
    if (secondaryId === id) {
      setSecondaryId(null);
      setSplitMode('none');
    }
  }

  function handleSplitModeToggle(mode: 'horizontal' | 'vertical') {
    if (splitMode === mode) {
      setSplitMode('none');
      setSecondaryId(null);
      return;
    }
    setSplitMode(mode);
    // Pick a secondary: the next session or create a new one
    const otherSession = sessions.find(s => s.id !== activeId);
    if (otherSession) {
      setSecondaryId(otherSession.id);
    } else {
      // Create a duplicate tab for split view
      const cfg = sessions.find(s => s.id === activeId)?.config;
      if (cfg) {
        const id = genId();
        const label = cfg.name || `${cfg.username}@${cfg.host}`;
        setSessions(prev => [...prev, { id, config: cfg, label }]);
        setSecondaryId(id);
      }
    }
  }

  if (page === 'connect') {
    return (
      <ConnectForm
        onConnect={handleConnect}
        theme={theme}
        onThemeChange={setTheme}
      />
    );
  }

  const activeSess = sessions.find(s => s.id === activeId);
  const secondarySess = sessions.find(s => s.id === secondaryId);

  return (
    <div className="flex flex-col h-screen bg-terminal-bg overflow-hidden" style={{ fontFamily: 'JetBrains Mono, Fira Code, monospace' }}>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center bg-terminal-surface border-b border-terminal-border h-9 overflow-x-auto" style={{ minWidth: 0 }}>
        {/* Tabs */}
        <div className="flex items-center gap-0.5 px-2 flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {sessions.map(s => {
            const isActive = s.id === activeId;
            const isSecondary = splitMode !== 'none' && s.id === secondaryId;
            return (
              <div
                key={s.id}
                className={`flex items-center gap-1.5 px-3 h-7 rounded-md text-xs cursor-pointer flex-shrink-0 group select-none transition-colors ${
                  isActive
                    ? 'bg-terminal-bg text-terminal-text border border-terminal-border'
                    : isSecondary
                    ? 'bg-terminal-blue/10 text-terminal-blue border border-terminal-blue/30'
                    : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/30'
                }`}
                onClick={() => {
                  if (splitMode !== 'none' && !isActive) {
                    // In split mode, clicking a tab makes it the secondary pane
                    setSecondaryId(s.id);
                  } else {
                    setActiveId(s.id);
                  }
                }}
                onDoubleClick={() => setActiveId(s.id)}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? 'bg-terminal-green' : 'bg-terminal-muted/40'}`} />
                <span className="max-w-[140px] truncate">{s.label}</span>
                {isSecondary && <span className="text-[9px] text-terminal-blue">副</span>}
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

          {/* New tab button */}
          <button
            onClick={() => handleAddTab()}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-terminal-border/50 text-terminal-muted hover:text-terminal-text flex-shrink-0 transition-colors"
            title="新建标签页 (同主机)"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1 px-2 flex-shrink-0 border-l border-terminal-border/50 ml-auto">
          {/* Horizontal split */}
          <button
            onClick={() => handleSplitModeToggle('horizontal')}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              splitMode === 'horizontal'
                ? 'bg-terminal-blue/20 text-terminal-blue'
                : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/50'
            }`}
            title="左右分屏"
          >
            <IconSplitH />
          </button>

          {/* Vertical split */}
          <button
            onClick={() => handleSplitModeToggle('vertical')}
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
              splitMode === 'vertical'
                ? 'bg-terminal-blue/20 text-terminal-blue'
                : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/50'
            }`}
            title="上下分屏"
          >
            <IconSplitV />
          </button>

          {/* Disconnect all / back to connect */}
          <button
            onClick={() => { setPage('connect'); setSessions([]); setActiveId(null); setSplitMode('none'); }}
            className="px-2 h-7 text-[11px] text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/50 rounded transition-colors flex items-center gap-1"
            title="返回连接页"
          >
            <IconPanel />
            <span>主机列表</span>
          </button>
        </div>
      </div>

      {/* ── Terminal area ────────────────────────────────────────────────── */}
      <div className={`flex-1 overflow-hidden flex ${splitMode === 'vertical' ? 'flex-col' : 'flex-row'}`}>
        {sessions.map(s => {
          const isActive = s.id === activeId;
          const isSecondary = splitMode !== 'none' && s.id === secondaryId;
          const visible = isActive || isSecondary;

          return (
            <div
              key={s.id}
              className={`overflow-hidden ${visible ? 'flex' : 'hidden'}`}
              style={
                visible && splitMode !== 'none'
                  ? { flex: '0 0 50%', minWidth: 0, minHeight: 0, borderRight: isActive && splitMode === 'horizontal' ? '1px solid rgb(var(--tw-c-border))' : undefined, borderBottom: isActive && splitMode === 'vertical' ? '1px solid rgb(var(--tw-c-border))' : undefined }
                  : { flex: 1, minWidth: 0 }
              }
            >
              <TerminalPage
                config={s.config}
                onDisconnect={() => handleCloseTab(s.id)}
                onNewTab={handleAddTab}
                theme={theme}
                onThemeChange={setTheme}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
