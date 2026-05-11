import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import ConnectForm from './components/ConnectForm';
import TerminalPage from './components/TerminalPage';
import AIChatPanel from './components/AIChatPanel';
import type { ConnectConfig, SavedHost, Theme, SavedCommand } from './types';
import { Plus, X, Search, Bot } from 'lucide-react';

type Page = 'connect' | 'terminal';

function normalizeTheme(value: string | null | undefined): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

// ─── Pane tree ────────────────────────────────────────────────────────────

type Pane = LeafPane | SplitPane;

interface LeafPane {
  type: 'leaf';
  id: string;
  config: ConnectConfig;
}

interface SplitPane {
  type: 'split';
  id: string;          // unique ID so we can identify this split for resize
  direction: 'horizontal' | 'vertical';
  ratio: number;       // fraction [0.1, 0.9] of bounding box given to `first`
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
  const r = pane.ratio ?? 0.5;
  const fb = isH
    ? { l: b.l,              t: b.t,              w: b.w * r,       h: b.h           }
    : { l: b.l,              t: b.t,              w: b.w,           h: b.h * r       };
  const sb = isH
    ? { l: b.l + b.w * r,   t: b.t,              w: b.w * (1 - r), h: b.h           }
    : { l: b.l,              t: b.t + b.h * r,   w: b.w,           h: b.h * (1 - r) };
  return new Map([...computeLeafRects(pane.first, fb), ...computeLeafRects(pane.second, sb)]);
}

/** Collect every split divider's position so we can render a drag handle. */
interface DivInfo {
  isH: boolean;
  l: number; t: number; w: number; h: number;
  split: number;    // divider position as % (left-of-container if isH, top-of-container if !isH)
  splitId: string;  // id of the SplitPane node owning this divider
}
function collectDividers(pane: Pane, b = { l: 0, t: 0, w: 100, h: 100 }): DivInfo[] {
  if (pane.type === 'leaf') return [];
  const isH = pane.direction === 'horizontal';
  const r = pane.ratio ?? 0.5;
  const split = isH ? b.l + b.w * r : b.t + b.h * r;
  const fb = isH ? { l: b.l,             t: b.t,             w: b.w * r,       h: b.h           }
                 : { l: b.l,             t: b.t,             w: b.w,           h: b.h * r       };
  const sb = isH ? { l: b.l + b.w * r,  t: b.t,             w: b.w * (1 - r), h: b.h           }
                 : { l: b.l,             t: b.t + b.h * r,   w: b.w,           h: b.h * (1 - r) };
  return [
    { isH, l: b.l, t: b.t, w: b.w, h: b.h, split, splitId: pane.id },
    ...collectDividers(pane.first, fb),
    ...collectDividers(pane.second, sb),
  ];
}

function splitLeaf(
  root: Pane,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  position: 'after' | 'before' = 'after',
): { root: Pane; newPaneId: string } {
  let newPaneId = '';
  function recurse(pane: Pane): Pane {
    if (pane.type === 'leaf') {
      if (pane.id !== targetId) return pane;
      const newLeaf = makeLeaf(pane.config);
      newPaneId = newLeaf.id;
      const [first, second] = position === 'after' ? [pane, newLeaf] : [newLeaf, pane];
      return { type: 'split', id: genId(), direction, ratio: 0.5, first, second };
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

/** Walk the tree and update the ratio of the split identified by splitId. */
function updateSplitRatio(root: Pane, splitId: string, ratio: number): Pane {
  if (root.type === 'leaf') return root;
  const clamped = Math.max(0.1, Math.min(0.9, ratio));
  if (root.id === splitId) return { ...root, ratio: clamped };
  return {
    ...root,
    first:  updateSplitRatio(root.first,  splitId, ratio),
    second: updateSplitRatio(root.second, splitId, ratio),
  };
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
  isActivePane: boolean;
  hasSplit: boolean;
  isPrimary: boolean;
  onFocusPane: () => void;
  onSplitPane: (direction: 'horizontal' | 'vertical', position?: 'after' | 'before') => void;
  onClosePane: () => void;
  onNewTab: (config?: ConnectConfig) => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  savedCommands: SavedCommand[];
  frequentCommandsCount: number;
  onConnectionChange: (paneId: string, connected: boolean) => void;
}

function LeafPaneView({
  leaf, rect, isFocused, isActivePane, hasSplit, isPrimary,
  onFocusPane, onSplitPane, onClosePane, onNewTab,
  theme, onThemeChange, savedCommands, frequentCommandsCount, onConnectionChange,
}: LeafPaneViewProps) {
  const [pendingCmd, setPendingCmd] = useState<{ cmd: SavedCommand; nonce: number } | null>(null);

  // ── Draggable strip position ───────────────────────────────────────────
  // No persistence — position resets each session.
  const [stripPos, setStripPos] = useState<{ x: number; y: number } | null>(null);
  // isDragging state (for CSS) + ref mirror (for stale-closure-safe callbacks)
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const suppressNextStripClickRef = useRef(false);
  const clearStripClickSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pointer offset within the strip when drag started
  const dragOffset = useRef<{ ox: number; oy: number } | null>(null);
  // Client coords where pointer first went down (for distance threshold)
  const dragStartClient = useRef<{ x: number; y: number } | null>(null);
  // Saved pointerId so we can call setPointerCapture lazily (only when drag starts)
  const pendingCapturePointerIdRef = useRef<number | null>(null);
  // Min pointer travel before drag actually starts (distinguishes click from drag)
  const DRAG_THRESHOLD = 5;

  const handleStripPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const strip = stripRef.current;
    if (!strip) return;
    if (clearStripClickSuppressionTimerRef.current) {
      clearTimeout(clearStripClickSuppressionTimerRef.current);
      clearStripClickSuppressionTimerRef.current = null;
    }
    suppressNextStripClickRef.current = false;
    const stripRect = strip.getBoundingClientRect();
    dragOffset.current = {
      ox: e.clientX - stripRect.left,
      oy: e.clientY - stripRect.top,
    };
    dragStartClient.current = { x: e.clientX, y: e.clientY };
    // DO NOT call setPointerCapture here.
    // Calling it eagerly redirects the subsequent pointerup (and click) to this
    // div, so inner buttons' onClick never fires on a plain click.
    // Instead, save the pointerId and set capture only when the drag threshold
    // is actually exceeded in handleStripPointerMove.
    pendingCapturePointerIdRef.current = e.pointerId;
    e.stopPropagation(); // prevent pane focus handler from firing
  }, []);

  const handleStripPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current || !dragStartClient.current) return;
    const pane  = paneRef.current;
    const strip = stripRef.current;
    if (!pane || !strip) return;

    const dx = e.clientX - dragStartClient.current.x;
    const dy = e.clientY - dragStartClient.current.y;
    // Only commit to dragging once pointer has travelled beyond threshold
    if (!isDraggingRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!isDraggingRef.current) {
      isDraggingRef.current = true;
      suppressNextStripClickRef.current = true;
      setIsDragging(true);
      // Now that we're definitely dragging, set pointer capture so subsequent
      // pointer events (including moves outside the strip) are routed here.
      if (pendingCapturePointerIdRef.current !== null) {
        strip.setPointerCapture(pendingCapturePointerIdRef.current);
      }
    }

    const paneRect = pane.getBoundingClientRect();
    const stripW   = strip.offsetWidth;
    const stripH   = strip.offsetHeight;
    const MARGIN   = 8;
    const rawX = e.clientX - paneRect.left - dragOffset.current.ox;
    const rawY = e.clientY - paneRect.top  - dragOffset.current.oy;
    const x = Math.max(MARGIN, Math.min(paneRect.width  - stripW - MARGIN, rawX));
    const y = Math.max(MARGIN, Math.min(paneRect.height - stripH - MARGIN, rawY));
    setStripPos({ x, y });
  }, []);

  const handleStripPointerUp = useCallback(() => {
    if (isDraggingRef.current) {
      suppressNextStripClickRef.current = true;
      if (clearStripClickSuppressionTimerRef.current) {
        clearTimeout(clearStripClickSuppressionTimerRef.current);
      }
      clearStripClickSuppressionTimerRef.current = setTimeout(() => {
        suppressNextStripClickRef.current = false;
        clearStripClickSuppressionTimerRef.current = null;
      }, 0);
    }
    dragOffset.current = null;
    dragStartClient.current = null;
    pendingCapturePointerIdRef.current = null;
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  const handleStripPointerCancel = useCallback(() => {
    suppressNextStripClickRef.current = false;
    if (clearStripClickSuppressionTimerRef.current) {
      clearTimeout(clearStripClickSuppressionTimerRef.current);
      clearStripClickSuppressionTimerRef.current = null;
    }
    dragOffset.current = null;
    dragStartClient.current = null;
    pendingCapturePointerIdRef.current = null;
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    return () => {
      if (clearStripClickSuppressionTimerRef.current) {
        clearTimeout(clearStripClickSuppressionTimerRef.current);
      }
    };
  }, []);

  // ── Hover tracking (JS-based, because CSS group-hover fails over iframes) ──
  const [isPaneHovered, setIsPaneHovered] = useState(false);

  // ── Default strip position: anchored to terminal-shell-host top-right edge ─
  const [defaultStripPos, setDefaultStripPos] = useState<{ top: number; right: number }>({ top: 50, right: 8 });

  useLayoutEffect(() => {
    const INSET = 6;

    function computeStripPos() {
      const pane = paneRef.current;
      if (!pane) return;
      const host = pane.querySelector('.terminal-shell-host') as HTMLElement | null;
      if (!host) return;

      const paneRect = pane.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const radius = Number.parseFloat(window.getComputedStyle(host).borderTopRightRadius || '0') || 0;

      // Circle-arc math: find the minimum top inset so the strip sits just
      // inside the rounded corner at the given right inset.
      const dx = Math.max(0, radius - INSET);
      const curveY = dx > 0 ? radius - Math.sqrt(Math.max(0, radius * radius - dx * dx)) : 0;
      const topInset = Math.max(INSET, curveY + INSET);

      setDefaultStripPos({
        top: hostRect.top - paneRect.top + topInset,
        right: paneRect.right - hostRect.right + INSET,
      });
    }

    computeStripPos();

    const ro = new ResizeObserver(computeStripPos);
    if (paneRef.current) ro.observe(paneRef.current);

    // Re-run when the terminal-shell-host itself appears/resizes
    let hostObserved = false;
    const mo = new MutationObserver(() => {
      const pane = paneRef.current;
      if (!pane) return;
      const host = pane.querySelector('.terminal-shell-host') as HTMLElement | null;
      if (host && !hostObserved) {
        hostObserved = true;
        ro.observe(host);
        computeStripPos();
      }
    });
    if (paneRef.current) {
      const host = paneRef.current.querySelector('.terminal-shell-host') as HTMLElement | null;
      if (host) { hostObserved = true; ro.observe(host); }
      else mo.observe(paneRef.current, { childList: true, subtree: true });
    }

    window.addEventListener('resize', computeStripPos);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', computeStripPos);
    };
  }, []);

  const handleStripClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressNextStripClickRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressNextStripClickRef.current = false;
    if (clearStripClickSuppressionTimerRef.current) {
      clearTimeout(clearStripClickSuppressionTimerRef.current);
      clearStripClickSuppressionTimerRef.current = null;
    }
  }, []);

  // Filter to strip-eligible commands (showInStrip !== false), then sort by usageCount desc and take top N
  const topCmds = savedCommands
    .filter(c => c.showInStrip !== false)
    .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
    .slice(0, frequentCommandsCount);

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

  // Remove a command from the strip by setting showInStrip: false.
  // Uses the event-bus pattern so App re-fetches and updates the prop.
  async function removeFromStrip(id: string) {
    const res = await fetch(`/api/saved-commands/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showInStrip: false }),
    });
    if (!res.ok) return; // don't dispatch event if the PUT failed
    window.dispatchEvent(new CustomEvent('saved-commands-updated'));
  }

  return (
    <div
      ref={paneRef}
      className="group/pane"
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        overflow: 'hidden',
        outline: (hasSplit && isFocused) ? '1.5px solid rgb(var(--tw-c-blue) / 0.4)' : 'none',
        outlineOffset: '-1px',
      }}
      onMouseDown={e => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-allow-selection="true"]')) return;
        onFocusPane();
      }}
      onMouseEnter={() => setIsPaneHovered(true)}
      onMouseLeave={() => setIsPaneHovered(false)}
    >
      <TerminalPage
        config={leaf.config}
        onDisconnect={onClosePane}
        onNewTab={onNewTab}
        theme={theme}
        onThemeChange={onThemeChange}
        isActivePane={isActivePane}
        pendingCommand={pendingCmd ?? undefined}
        isPrimary={isPrimary}
        onSplitPane={onSplitPane}
        onConnectionChange={(c) => onConnectionChange(leaf.id, c)}
      />

      {/* Per-pane control strip — draggable overlay on hover */}
      {/*
        JS-based hover state (isPaneHovered) is used instead of CSS group-hover
        because CSS :hover on the parent doesn't trigger when the cursor is over
        an iframe child (hterm renders into an iframe), so group-hover/pane fails.

        pointer-events on the outer strip div:
          • dragging         → pointer-events-auto (receives captured pointer events)
          • hovering, idle   → pointer-events-auto (so buttons are clickable)
          • not hovering     → pointer-events-none (click passes through to terminal)

        Inner button wrapper gets pointer-events-none while dragging so that
        individual button onClick handlers never fire mid-drag; the existing
        handleStripClickCapture suppresses any stray click on pointer-up.
      */}
      <div
        ref={stripRef}
        className={`absolute z-30 transition-opacity duration-150 ${isDragging
          ? 'opacity-100 pointer-events-auto !cursor-grabbing'
          : isPaneHovered
            ? 'opacity-100 pointer-events-auto cursor-grab'
            : 'opacity-0 pointer-events-none cursor-grab'}`}
        style={stripPos !== null
          ? { left: stripPos.x, top: stripPos.y }
          : { top: defaultStripPos.top, right: defaultStripPos.right }}
        onClickCapture={handleStripClickCapture}
        onPointerDown={handleStripPointerDown}
        onPointerMove={handleStripPointerMove}
        onPointerUp={handleStripPointerUp}
        onPointerCancel={handleStripPointerCancel}
      >
        {/* pointer-events-none during drag so individual button onClick handlers
            never fire mid-drag; the outer div's handleStripClickCapture also
            suppresses any stray click on pointer-up as a safety net. */}
        <div className={isDragging ? 'pointer-events-none' : undefined}>
        <div
          className="flex max-w-[calc(100vw-48px)] items-center overflow-x-auto bg-terminal-surface/92 backdrop-blur-sm border border-terminal-border/70 rounded-lg shadow-lg px-0.5 py-0.5 gap-px scrollbar-none"
        >

          {/* ── Top-7 most-used command buttons ── */}
          {topCmds.length > 0 && (
            <>
              {topCmds.map(cmd => (
                <div key={cmd.id} className="relative group/cmd">
                  <button
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPendingCmd({ cmd, nonce: Date.now() });
                    }}
                    title={cmdTooltip(cmd)}
                    className="h-6 px-1.5 flex items-center rounded-md text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors font-mono text-[10px] leading-none whitespace-nowrap"
                  >
                    {shortLabel(cmd.name)}
                  </button>
                  <button
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeFromStrip(cmd.id).catch(() => {});
                    }}
                    title="从悬浮栏移除"
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-terminal-surface border border-terminal-border text-terminal-muted hover:text-terminal-red hover:border-terminal-red/50 transition-colors opacity-0 group-hover/cmd:opacity-100 text-[8px] leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="w-px h-3.5 bg-terminal-border/70 mx-0.5 flex-shrink-0" />
            </>
          )}

          {/* ── Split / close ── */}
          <button
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onSplitPane('horizontal', 'after');
            }}
            className="w-6 h-6 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/60 transition-colors"
            title="左右分屏"
          >
            <IconSplitH />
          </button>
          <button
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onSplitPane('vertical', 'after');
            }}
            className="w-6 h-6 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/60 transition-colors"
            title="上下分屏"
          >
            <IconSplitV />
          </button>
          <div className="w-px h-3.5 bg-terminal-border/70 mx-0.5 flex-shrink-0" />
          <button
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              onClosePane();
            }}
            className="w-6 h-6 flex items-center justify-center rounded-md text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 transition-colors"
            title="关闭窗格"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

function areLeafPaneViewPropsEqual(prev: LeafPaneViewProps, next: LeafPaneViewProps) {
  return prev.leaf === next.leaf
    && prev.rect.left === next.rect.left
    && prev.rect.top === next.rect.top
    && prev.rect.width === next.rect.width
    && prev.rect.height === next.rect.height
    && prev.isFocused === next.isFocused
    && prev.isActivePane === next.isActivePane
    && prev.hasSplit === next.hasSplit
    && prev.isPrimary === next.isPrimary
    && prev.theme === next.theme
    && prev.savedCommands === next.savedCommands
    && prev.frequentCommandsCount === next.frequentCommandsCount;
}

const MemoLeafPaneView = React.memo(LeafPaneView, areLeafPaneViewPropsEqual);

// ─── App ──────────────────────────────────────────────────────────────────

export default function App() {
  // ── Restore sessions from sessionStorage (survives page refresh) ──────────
  // Computed once per mount; ids are generated here so sessions + activeId share the same ids.
  const [restoredState] = useState<{ sessions: Session[]; activeId: string } | null>(() => {
    try {
      const raw = sessionStorage.getItem('ssh-sessions');
      if (!raw) return null;
      const { configs } = JSON.parse(raw) as { configs: ConnectConfig[] };
      if (!Array.isArray(configs) || configs.length === 0) return null;
      const newSessions: Session[] = configs.map((cfg: ConnectConfig) => {
        const id = genId();
        const rootPane = makeLeaf(cfg);
        return { id, label: cfg.name || `${cfg.username}@${cfg.host}`, rootPane, focusedPaneId: rootPane.id };
      });
      return { sessions: newSessions, activeId: newSessions[newSessions.length - 1].id };
    } catch { return null; }
  });

  const [page, setPage] = useState<Page>(restoredState ? 'terminal' : 'connect');
  const [sessions, setSessions] = useState<Session[]>(restoredState?.sessions ?? []);
  const [activeId, setActiveId] = useState<string | null>(restoredState?.activeId ?? null);
  // Track SSH connection status per pane (paneId → connected boolean)
  const [connectedPanes, setConnectedPanes] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<Theme>(() => {
    return normalizeTheme(localStorage.getItem('app-theme-v2'));
  });

  // ── Host picker popup ─────────────────────────────────────────────────
  const [showPicker, setShowPicker] = useState(false);
  const [pickerHosts, setPickerHosts] = useState<SavedHost[]>([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerLeft, setPickerLeft] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  // ── Connect overlay (shown over live terminals — keeps all sessions mounted) ─
  const [showConnectOverlay, setShowConnectOverlay] = useState(false);

  // ── AI assistant panel  ─────────────────────────────────────────────
  // 'hidden'    → closed (no bubble), panel stays mounted via display:none
  // 'visible'   → full panel open
  // 'minimized' → panel CSS-hidden, floating bubble shown (WeChat-style)
  const [aiPanelState, setAIPanelState] = useState<'hidden' | 'visible' | 'minimized'>('hidden');

  // ── AI configured state ──────────────────────────────────────────────
  const [aiConfigured, setAIConfigured] = useState(false);

  useEffect(() => {
    function loadAIConfig() {
      fetch('/api/ai-settings')
        .then(r => r.json())
        .then(d => {
          const configured = !!d.configured;
          setAIConfigured(configured);
          // If AI is no longer configured, hide the chat panel
          if (!configured) setAIPanelState('hidden');
        })
        .catch(() => setAIConfigured(false));
    }
    loadAIConfig();
    window.addEventListener('ai-settings-updated', loadAIConfig);
    return () => window.removeEventListener('ai-settings-updated', loadAIConfig);
  }, []);

  // ── Divider drag-to-resize ────────────────────────────────────────────
  const terminalAreaRef = useRef<HTMLDivElement>(null);
  const [draggingDiv, setDraggingDiv] = useState<{
    sessionId: string; splitId: string; isH: boolean;
    l: number; t: number; w: number; h: number;
  } | null>(null);

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

  // ── Frequent-commands count (from app settings) ───────────────────────
  const [frequentCommandsCount, setFrequentCommandsCount] = useState(10);

  useEffect(() => {
    fetch('/api/app-settings').then(r => r.json()).then(s => {
      if (s.frequentCommandsCount !== undefined) setFrequentCommandsCount(s.frequentCommandsCount);
    }).catch(() => {});
    function onAppSettingsUpdated(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.frequentCommandsCount !== undefined) setFrequentCommandsCount(detail.frequentCommandsCount);
    }
    window.addEventListener('app-settings-updated', onAppSettingsUpdated);
    return () => window.removeEventListener('app-settings-updated', onAppSettingsUpdated);
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

  useLayoutEffect(() => {
    const normalized = normalizeTheme(theme);
    document.documentElement.setAttribute('data-theme', normalized);
    localStorage.setItem('app-theme-v2', normalized);
  }, [theme]);

  // Persist active sessions to sessionStorage so a page refresh auto-reconnects
  useEffect(() => {
    if (sessions.length === 0) {
      sessionStorage.removeItem('ssh-sessions');
      return;
    }
    const configs = sessions.map(s => firstLeafConfig(s.rootPane));
    sessionStorage.setItem('ssh-sessions', JSON.stringify({ configs }));
  }, [sessions]);

  function sessionHasConnectedPane(session: Session) {
    return getLeaves(session.rootPane).some(leaf => connectedPanes[leaf.id] === true);
  }

  function confirmCloseDisconnect(label: string, target: '标签页' | '分屏') {
    return window.confirm(
      `关闭${target}“${label}”会断开 SSH 连接。\n\n如果终端里正在前台运行 docker / 构建 / 日志任务，它们可能会被直接中止。\n如需保活，请先使用 docker compose up -d、nohup 或 tmux/screen。\n\n仍然关闭吗？`
    );
  }

  function removePaneConnectionState(paneIds: string[]) {
    if (paneIds.length === 0) return;
    setConnectedPanes(prev => {
      const next = { ...prev };
      paneIds.forEach(id => { delete next[id]; });
      return next;
    });
  }

  function handleBackToConnect() {
    if (sessions.length > 0) {
      // Show ConnectForm as an overlay — keeps all terminal sessions alive
      setShowConnectOverlay(true);
    } else {
      setPage('connect');
    }
  }

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
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    if (sessionHasConnectedPane(session) && !confirmCloseDisconnect(session.label, '标签页')) return;

    removePaneConnectionState(getLeaves(session.rootPane).map(leaf => leaf.id));
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
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    if (connectedPanes[paneId] && !confirmCloseDisconnect(session.label, '分屏')) return;

    const paneIdsToRemove = (() => {
      const leaves = getLeaves(session.rootPane);
      return leaves.length === 1 ? leaves.map(leaf => leaf.id) : [paneId];
    })();
    removePaneConnectionState(paneIdsToRemove);

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

  function handleSplitPane(sessionId: string, paneId: string, direction: 'horizontal' | 'vertical', position: 'after' | 'before' = 'after') {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const { root: newRoot, newPaneId } = splitLeaf(s.rootPane, paneId, direction, position);
      return { ...s, rootPane: newRoot, focusedPaneId: newPaneId };
    }));
  }

  function handleResizeSplit(sessionId: string, splitId: string, ratio: number) {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      return { ...s, rootPane: updateSplitRatio(s.rootPane, splitId, ratio) };
    }));
  }

  // ── Connect page ────────────────────────────────────────────────────────
  if (page === 'connect') {
    return (
      <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <ConnectForm
          onConnect={handleConnect}
          theme={theme}
          onThemeChange={setTheme}
          hasActiveSessions={sessions.length > 0}
          onBackToTerminal={sessions.length > 0 ? () => setPage('terminal') : undefined}
          onOpenAI={() => setAIPanelState('visible')}
        />
        {/* AI panel overlay — same as terminal page, shares aiPanelState */}
        <div
          className="absolute top-0 right-0 bottom-0 z-[70] flex"
          style={{ boxShadow: '-4px 0 24px rgba(0,0,0,0.25)', display: aiPanelState === 'visible' ? undefined : 'none' }}
        >
          {/* Always mounted so state (conversations, model) survives hide/minimize */}
          <AIChatPanel
            onClose={() => setAIPanelState('hidden')}
            onMinimize={() => setAIPanelState('minimized')}
            onHostsImported={() => window.dispatchEvent(new Event('hosts-updated'))}
          />
        </div>
        {aiPanelState === 'minimized' && (
          <div className="absolute top-3 right-3 z-[70]">
            <button
              onClick={() => setAIPanelState('visible')}
              title="恢复 AI 助手"
              className="flex h-10 items-center gap-2 rounded-md border border-terminal-border bg-terminal-surface px-3 text-terminal-text transition-colors hover:border-terminal-blue/40 hover:bg-terminal-blue/10 active:bg-terminal-blue/15 select-none"
              style={{
                boxShadow: '0 10px 26px rgba(0,0,0,0.28)',
              }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-terminal-blue text-white">
                <Bot className="w-3.5 h-3.5" />
              </span>
              <span className="text-xs font-medium">AI 助手</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell flex flex-col h-screen bg-terminal-bg overflow-hidden" style={{ fontFamily: 'JetBrains Mono, Fira Code, monospace' }}>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="app-titlebar flex-shrink-0 flex items-center h-10" style={{ minWidth: 0 }}>
        <div className="flex items-center gap-0.5 px-2 flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {sessions.map(s => {
            const isActive = s.id === activeId;
            const hasSplit = s.rootPane.type !== 'leaf';
            // Determine connection status from all leaves in this session
            const leaves = getLeaves(s.rootPane);
            const anyConnected = leaves.some(l => connectedPanes[l.id] === true);
            const anyReported  = leaves.some(l => connectedPanes[l.id] !== undefined);
            const dotColor = anyConnected
              ? 'bg-terminal-green'
              : anyReported ? 'bg-terminal-red' : 'bg-terminal-muted/40';
            return (
              <div
                key={s.id}
                className={`flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs cursor-pointer flex-shrink-0 group select-none transition-all ${
                  isActive
                    ? 'bg-terminal-bg/95 text-terminal-text border border-terminal-border shadow-[0_10px_24px_rgba(0,0,0,0.18)]'
                    : 'text-terminal-muted border border-transparent hover:text-terminal-text hover:bg-terminal-surface/76 hover:border-terminal-border/70'
                }`}
                onClick={() => setActiveId(s.id)}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
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
              className={`w-7 h-7 flex items-center justify-center rounded-lg border border-transparent hover:border-terminal-border/70 flex-shrink-0 transition-all ${showPicker ? 'bg-terminal-surface text-terminal-text border-terminal-border/80 shadow-[0_8px_18px_rgba(0,0,0,0.14)]' : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-surface/76'}`}
              title="新建连接"
            >
              <Plus className="w-4 h-4" />
            </button>

            {showPicker && (
              <div style={{ position: 'fixed', top: '40px', left: pickerLeft }} className="w-64 bg-terminal-surface/95 backdrop-blur-xl border border-terminal-border rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.32)] z-50 overflow-hidden">
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
        <div className="flex items-center gap-1 px-2 flex-shrink-0 border-l border-terminal-border/50">
          {/* AI assistant toggle — only shown when AI is configured */}
          {aiConfigured && (
            <button
              onClick={() => setAIPanelState(s => s === 'visible' ? 'hidden' : 'visible')}
              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all ${
                aiPanelState === 'visible'
                  ? 'bg-terminal-blue text-white shadow-[0_10px_24px_rgba(69,145,255,0.35)]'
                  : aiPanelState === 'minimized'
                    ? 'bg-terminal-blue/18 text-terminal-blue ring-1 ring-terminal-blue/35'
                    : 'text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10'
              }`}
              title={aiPanelState === 'minimized' ? 'AI 助手（已最小化）' : 'AI 终端助手'}
            >
              <Bot className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleBackToConnect}
            className="px-2.5 h-7 text-[11px] text-terminal-muted hover:text-terminal-text hover:bg-terminal-surface/76 border border-transparent hover:border-terminal-border/70 rounded-lg transition-all flex items-center gap-1"
            title="主机列表（保留所有标签）"
          >
            <IconPanel />
            <span>主机列表</span>
          </button>
        </div>
      </div>

      {/* ── Terminal area ────────────────────────────────────────────────── */}
      <div
        ref={terminalAreaRef}
        className="flex-1 overflow-hidden relative"
        style={draggingDiv ? { cursor: draggingDiv.isH ? 'col-resize' : 'row-resize', userSelect: 'none' } : undefined}
      >
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
              {/* Dividers: 1 px visual line + 8 px invisible drag handle */}
              {dividers.map((d, i) => {
                const isActive = draggingDiv?.splitId === d.splitId;
                return (
                  <React.Fragment key={i}>
                    {/* Visual line */}
                    <div
                      style={{
                        position: 'absolute',
                        backgroundColor: isActive ? 'rgb(var(--tw-c-accent, 59 130 246))' : 'rgb(var(--tw-c-border))',
                        zIndex: 5,
                        transition: isActive ? 'none' : 'background-color 0.15s',
                        ...(d.isH
                          ? { left: `calc(${d.split}% - 0.5px)`, top: `${d.t}%`,                    width: '1px',  height: `${d.h}%`  }
                          : { left: `${d.l}%`,                   top: `calc(${d.split}% - 0.5px)`,  width: `${d.w}%`, height: '1px'   }
                        ),
                      }}
                    />
                    {/* Drag handle (wider invisible hit target) */}
                    <div
                      style={{
                        position: 'absolute',
                        zIndex: 10,
                        cursor: d.isH ? 'col-resize' : 'row-resize',
                        ...(d.isH
                          ? { left: `calc(${d.split}% - 4px)`, top: `${d.t}%`,                   width: '8px',  height: `${d.h}%`  }
                          : { left: `${d.l}%`,                  top: `calc(${d.split}% - 4px)`,   width: `${d.w}%`, height: '8px'   }
                        ),
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        setDraggingDiv({ sessionId: s.id, splitId: d.splitId, isH: d.isH, l: d.l, t: d.t, w: d.w, h: d.h });
                      }}
                      onPointerMove={(e) => {
                        if (!draggingDiv || draggingDiv.splitId !== d.splitId) return;
                        const container = terminalAreaRef.current;
                        if (!container) return;
                        const rect = container.getBoundingClientRect();
                        const ratio = draggingDiv.isH
                          ? ((e.clientX - rect.left) / rect.width  * 100 - draggingDiv.l) / draggingDiv.w
                          : ((e.clientY - rect.top)  / rect.height * 100 - draggingDiv.t) / draggingDiv.h;
                        handleResizeSplit(draggingDiv.sessionId, draggingDiv.splitId, ratio);
                      }}
                      onPointerUp={() => setDraggingDiv(null)}
                    />
                  </React.Fragment>
                );
              })}

              {leaves.map(leaf => {
                const rect = rects.get(leaf.id)!;
                const isFocused = leaf.id === s.focusedPaneId;
                const isActivePane = isActive && isFocused;
                return (
                  <MemoLeafPaneView
                    key={leaf.id}
                    leaf={leaf}
                    rect={rect}
                    isFocused={isFocused}
                    isActivePane={isActivePane}
                    hasSplit={hasSplit}
                    isPrimary={leaf.id === firstLeafId(s.rootPane)}
                    onFocusPane={() => handleFocusPane(s.id, leaf.id)}
                    onSplitPane={(dir, pos) => handleSplitPane(s.id, leaf.id, dir, pos)}
                    onClosePane={() => handleClosePane(s.id, leaf.id)}
                    onNewTab={handleAddTab}
                    theme={theme}
                    onThemeChange={setTheme}
                    savedCommands={savedCommands}
                    frequentCommandsCount={frequentCommandsCount}
                    onConnectionChange={(paneId, c) =>
                      setConnectedPanes(prev => ({ ...prev, [paneId]: c }))
                    }
                  />
                );
              })}
            </div>
          );
        })}

        {/* ── AI assistant panel overlay (fixed right side, full height) ── */}
        {/* Always mounted so state (conversations, model) survives hide/minimize */}
        <div
          className="absolute top-0 right-0 bottom-0 z-[70] flex"
          style={{ boxShadow: '-4px 0 24px rgba(0,0,0,0.25)', display: aiPanelState === 'visible' ? undefined : 'none' }}
        >
          <AIChatPanel
            onClose={() => setAIPanelState('hidden')}
            onMinimize={() => setAIPanelState('minimized')}
            onHostsImported={() => window.dispatchEvent(new Event('hosts-updated'))}
          />
        </div>

        {/* ── Floating bubble when AI panel is minimized (WeChat-style) ─── */}
        {aiPanelState === 'minimized' && (
          <div className="absolute top-3 right-3 z-[70]">
            <button
              onClick={() => setAIPanelState('visible')}
              title="恢复 AI 助手"
              className="flex h-10 items-center gap-2 rounded-md border border-terminal-border bg-terminal-surface px-3 text-terminal-text transition-colors hover:border-terminal-blue/40 hover:bg-terminal-blue/10 active:bg-terminal-blue/15 select-none"
              style={{
                boxShadow: '0 10px 26px rgba(0,0,0,0.28)',
              }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-terminal-blue text-white">
                <Bot className="w-3.5 h-3.5" />
              </span>
              <span className="text-xs font-medium">AI 助手</span>
            </button>
          </div>
        )}

        {/* ── Connect overlay — shown over live sessions so terminals stay mounted ── */}
        {showConnectOverlay && (
          <div className="absolute inset-0 z-[60] overflow-auto">
            <ConnectForm
              onConnect={(cfg) => { handleConnect(cfg); setShowConnectOverlay(false); }}
              theme={theme}
              onThemeChange={setTheme}
              hasActiveSessions
              onBackToTerminal={() => setShowConnectOverlay(false)}
              onOpenAI={() => setAIPanelState('visible')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
