import React, { useEffect, useRef } from 'react';

interface Props {
  /** Ref to the anchor element (stop button) — card positions above it */
  anchorRef: React.RefObject<HTMLElement | null>;
  onNewSession: () => void;
  onKeepSession: () => void;
  onDismiss: () => void;
}

export default function StopAIConfirmCard({ anchorRef, onNewSession, onKeepSession, onDismiss }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Click outside dismisses the card
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const card = cardRef.current;
      const anchor = anchorRef.current;
      if (!card) return;
      const target = e.target as Node;
      if (card.contains(target) || anchor?.contains(target)) return;
      onDismiss();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [anchorRef, onDismiss]);

  // Escape key dismisses the card
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onDismiss]);

  // Position: compute inline style anchored above the stop button
  function getStyle(): React.CSSProperties {
    const anchor = anchorRef.current;
    if (!anchor) return { position: 'fixed', bottom: 80, right: 24 };
    const rect = anchor.getBoundingClientRect();
    return {
      position: 'fixed',
      bottom: window.innerHeight - rect.top + 8,
      left: rect.left + rect.width / 2,
      transform: 'translateX(-50%)',
      zIndex: 200,
    };
  }

  return (
    <div
      ref={cardRef}
      style={getStyle()}
      className="flex flex-col gap-2 p-3 rounded-xl border border-terminal-border bg-terminal-surface shadow-2xl min-w-[200px]"
    >
      <p className="text-[11px] text-terminal-muted text-center select-none">停止生成后…</p>
      <div className="flex gap-2">
        <button
          onClick={onKeepSession}
          className="flex-1 px-3 py-1.5 text-[11px] rounded-lg border border-terminal-border text-terminal-text hover:bg-terminal-border/30 transition-colors"
        >
          保留当前会话
        </button>
        <button
          onClick={onNewSession}
          className="flex-1 px-3 py-1.5 text-[11px] rounded-lg border border-terminal-blue/40 bg-terminal-blue/10 text-terminal-blue hover:bg-terminal-blue/20 transition-colors"
        >
          开启新会话
        </button>
      </div>
    </div>
  );
}
