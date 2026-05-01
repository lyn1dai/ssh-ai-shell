import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Tailwind width class — used only when resizable=false. Defaults to 'w-64'. */
  widthClass?: string;
  /** If true, suppress the default title/close header row */
  noHeader?: boolean;
  /** Left offset in px when the panel first opens. Defaults to 40. */
  defaultLeft?: number;
  /** Top offset in px when the panel first opens. Defaults to 0. */
  defaultTop?: number;
  /** Enable drag-to-resize on the right edge */
  resizable?: boolean;
  /** Initial pixel width when resizable. Defaults to 256. */
  defaultWidth?: number;
  /** Min pixel width when resizable. Defaults to 180. */
  minWidth?: number;
  /** Max pixel width when resizable. Defaults to 900. */
  maxWidth?: number;
  /** Enable drag-to-resize on the bottom edge */
  resizableHeight?: boolean;
  /** Initial pixel height when resizableHeight=true. Defaults to 400. */
  defaultHeight?: number;
  /** Min pixel height when resizableHeight=true. Defaults to 120. */
  minHeight?: number;
  /** Max pixel height when resizableHeight=true. Defaults to 900. */
  maxHeight?: number;
  /** localStorage key for persisting width/height. Only used when resizable/resizableHeight=true. */
  storageKey?: string;
  /** localStorage key for persisting dragged position. Falls back to storageKey when omitted. */
  positionKey?: string;
  /** When true, clicking outside the panel does NOT close it. Only the explicit onClose call closes it. */
  noCloseOnClickOutside?: boolean;
  /** When true, the panel can be dragged horizontally / vertically. */
  draggable?: boolean;
}

export default function SidePanel({
  title, onClose, children, widthClass = 'w-64', noHeader = false, defaultLeft = 40, defaultTop = 0,
  resizable = false, defaultWidth = 256, minWidth = 180, maxWidth = 900,
  resizableHeight = false, defaultHeight = 400, minHeight = 120, maxHeight = 900,
  storageKey, positionKey,
  noCloseOnClickOutside = false, draggable = true,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const draggingRef = useRef(false);

  const resolvedPositionKey = positionKey || storageKey;

  const [panelPos, setPanelPos] = useState<{ left: number; top: number }>(() => {
    if (draggable && resolvedPositionKey) {
      try {
        const stored = localStorage.getItem(`panel-position-${resolvedPositionKey}`);
        if (stored) {
          const parsed = JSON.parse(stored) as { left?: number; top?: number };
          return {
            left: typeof parsed.left === 'number' ? parsed.left : defaultLeft,
            top: typeof parsed.top === 'number' ? parsed.top : defaultTop,
          };
        }
      } catch { /* ignore */ }
    }
    return { left: defaultLeft, top: defaultTop };
  });

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (!resizable) return defaultWidth;
    if (storageKey) {
      try {
        const stored = localStorage.getItem(`panel-width-${storageKey}`);
        if (stored) return Math.max(minWidth, Math.min(maxWidth, parseInt(stored, 10)));
      } catch { /* ignore */ }
    }
    return defaultWidth;
  });

  const [panelHeight, setPanelHeight] = useState<number>(() => {
    if (!resizableHeight) return defaultHeight;
    if (storageKey) {
      try {
        const stored = localStorage.getItem(`panel-height-${storageKey}`);
        if (stored) return Math.max(minHeight, Math.min(maxHeight, parseInt(stored, 10)));
      } catch { /* ignore */ }
    }
    return defaultHeight;
  });

  useEffect(() => {
    if (draggable && resolvedPositionKey) {
      localStorage.setItem(`panel-position-${resolvedPositionKey}`, JSON.stringify(panelPos));
    }
  }, [panelPos, draggable, resolvedPositionKey]);

  // Persist width when it changes
  useEffect(() => {
    if (resizable && storageKey) {
      localStorage.setItem(`panel-width-${storageKey}`, String(panelWidth));
    }
  }, [panelWidth, resizable, storageKey]);

  // Persist height when it changes
  useEffect(() => {
    if (resizableHeight && storageKey) {
      localStorage.setItem(`panel-height-${storageKey}`, String(panelHeight));
    }
  }, [panelHeight, resizableHeight, storageKey]);

  // Close on click-outside; skip while a resize drag is in progress or when disabled
  useEffect(() => {
    if (noCloseOnClickOutside) return;
    function handleClickOutside(e: MouseEvent) {
      if (resizingRef.current || draggingRef.current) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, noCloseOnClickOutside]);

  const clampPosition = useCallback((left: number, top: number) => {
    const parent = panelRef.current?.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    const panelEl = panelRef.current;
    const panelW = panelEl?.offsetWidth || panelWidth || defaultWidth;

    const maxLeft = Math.max(0, (parentRect?.width ?? window.innerWidth) - Math.min(panelW, 180));
    const maxTop = Math.max(0, (parentRect?.height ?? window.innerHeight) - (resizableHeight ? minHeight : 140));

    return {
      left: Math.max(0, Math.min(maxLeft, left)),
      top: Math.max(0, Math.min(maxTop, top)),
    };
  }, [panelWidth, defaultWidth, resizableHeight, minHeight]);

  const startDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!draggable) return;
    if ((e.target as HTMLElement).closest('[data-panel-no-drag="true"]')) return;

    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;

    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = panelPos.left;
    const startTop = panelPos.top;

    function onMove(ev: PointerEvent) {
      setPanelPos(clampPosition(
        startLeft + (ev.clientX - startX),
        startTop + (ev.clientY - startY),
      ));
    }

    function onUp() {
      draggingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [clampPosition, draggable, panelPos.left, panelPos.top]);

  // Right-edge width resize
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;
    const startX = e.clientX;
    const startW = panelWidth;

    function onMove(ev: PointerEvent) {
      const newW = Math.max(minWidth, Math.min(maxWidth, startW + (ev.clientX - startX)));
      setPanelWidth(newW);
    }
    function onUp() {
      resizingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [panelWidth, minWidth, maxWidth]);

  // Bottom-edge height resize
  const startResizeHeight = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;
    const startY = e.clientY;
    const startH = panelHeight;

    // Clamp to parent available space
    const parent = panelRef.current?.parentElement;
    const parentH = parent?.getBoundingClientRect().height ?? window.innerHeight;
    const effectiveMax = Math.min(maxHeight, parentH - panelPos.top - 2);

    function onMove(ev: PointerEvent) {
      const newH = Math.max(minHeight, Math.min(effectiveMax, startH + (ev.clientY - startY)));
      setPanelHeight(newH);
    }
    function onUp() {
      resizingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [panelHeight, minHeight, maxHeight, panelPos.top]);

  useEffect(() => {
    setPanelPos(prev => clampPosition(prev.left, prev.top));
  }, [clampPosition, panelWidth]);

  return (
    <div
      ref={panelRef}
      className={`absolute z-40 bg-terminal-surface border-r border-terminal-border flex flex-col shadow-xl animate-fade-in ${!resizable ? widthClass : ''}`}
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest('[data-panel-drag-handle="true"]')) {
          startDrag(e);
        }
      }}
      style={{
        left: panelPos.left,
        top: panelPos.top,
        height: resizableHeight ? panelHeight : `calc(100% - ${panelPos.top}px)`,
        ...(resizable ? { width: panelWidth } : undefined),
      }}
    >
      {noHeader && draggable && (
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 z-20 cursor-move"
          onPointerDown={startDrag}
          title="拖动面板位置"
        >
          <div className="flex h-5 w-14 items-center justify-center rounded-full border border-terminal-border bg-terminal-surface/95 shadow-sm hover:border-terminal-blue/60 transition-colors">
            <div className="space-y-0.5">
              <div className="h-0.5 w-6 rounded-full bg-terminal-muted/80" />
              <div className="h-0.5 w-6 rounded-full bg-terminal-muted/80" />
            </div>
          </div>
        </div>
      )}

      {!noHeader && (
        <div
          className={`flex items-center justify-between px-3 py-2.5 border-b border-terminal-border flex-shrink-0 ${draggable ? 'cursor-move' : ''}`}
          onPointerDown={startDrag}
          title={draggable ? '拖动面板位置' : undefined}
        >
          <span className="text-xs font-medium text-terminal-text">{title}</span>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={onClose}
            data-panel-no-drag="true"
            className="text-terminal-muted hover:text-terminal-text transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {children}
      </div>

      {/* Drag-to-resize handle on the right edge */}
      {resizable && (
        <div
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 group"
          onPointerDown={startResize}
        >
          <div className="absolute right-0 top-0 bottom-0 w-px bg-terminal-border group-hover:bg-terminal-blue/60 transition-colors" />
        </div>
      )}

      {/* Drag-to-resize handle on the bottom edge */}
      {resizableHeight && (
        <div
          className="absolute bottom-0 left-0 right-0 h-2.5 cursor-row-resize z-10 group flex items-end justify-center pb-0.5"
          onPointerDown={startResizeHeight}
          title="拖动调整高度"
        >
          {/* Highlight line */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-terminal-border group-hover:bg-terminal-blue/60 transition-colors" />
          {/* Grip dots */}
          <div className="flex gap-0.5 relative z-10">
            <div className="w-3.5 h-0.5 rounded-full bg-terminal-muted/50 group-hover:bg-terminal-blue/70 transition-colors" />
          </div>
        </div>
      )}
    </div>
  );
}
