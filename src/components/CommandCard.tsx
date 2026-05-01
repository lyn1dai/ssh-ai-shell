import React, { useState, useEffect, useRef } from 'react';
import { Check, Pencil, X, Play, AlertTriangle } from 'lucide-react';
import type { Risk, CommandCardStatus } from '../types';

interface Props {
  commandId: string;
  command: string;
  risk: Risk;
  status: CommandCardStatus;
  onConfirm: (commandId: string, command: string) => void;
  onReject: (commandId: string) => void;
}

const riskBorderColor: Record<Risk, string> = {
  low: 'border-terminal-green/40',
  normal: 'border-terminal-border',
  high: 'border-terminal-red/50',
};

const riskHeaderColor: Record<Risk, string> = {
  low: 'text-terminal-green',
  normal: 'text-terminal-text',
  high: 'text-terminal-red',
};

export default function CommandCard({
  commandId, command, risk, status, onConfirm, onReject,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(command);
  const [showDangerConfirm, setShowDangerConfirm] = useState(false);
  const execBtnRef = useRef<HTMLButtonElement>(null);

  // Keyboard shortcuts (only while pending)
  useEffect(() => {
    if (status !== 'pending') return;

    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+Enter → confirm / execute
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleConfirmClick();
      }
      // Ctrl+E → toggle edit mode
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        setEditing(v => !v);
      }
      // Escape → close danger popup or reject
      if (e.key === 'Escape') {
        if (showDangerConfirm) {
          setShowDangerConfirm(false);
        } else {
          onReject(commandId);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, showDangerConfirm, commandId, editing]);

  function handleConfirmClick() {
    if (risk === 'high') {
      setShowDangerConfirm(true);
    } else {
      onConfirm(commandId, editing ? editValue : command);
    }
  }

  function handleConfirmWithValue(value: string) {
    if (risk === 'high') {
      setShowDangerConfirm(true);
    } else {
      onConfirm(commandId, value);
      setEditing(false);
    }
  }

  function handleDangerConfirm() {
    setShowDangerConfirm(false);
    onConfirm(commandId, editing ? editValue : command);
    setEditing(false);
  }

  const isSettled = status === 'rejected' || status === 'executing' || status === 'done';

  // ── Settled: auto-approved ─────────────────────────────────────────────────
  if (status === 'approved') {
    return (
      <div className={`my-1.5 ml-4 rounded-lg border ${riskBorderColor[risk]} bg-terminal-surface/60 overflow-hidden animate-slide-up`}>
        <div className="flex items-center gap-2 px-3 py-2">
          <Check className="w-3.5 h-3.5 text-terminal-green flex-shrink-0" />
          <span className="text-xs text-terminal-green font-medium">已自动执行</span>
        </div>
        <div className="px-3 pb-2.5">
          <code className="text-xs text-terminal-text font-mono break-all">{command}</code>
        </div>
      </div>
    );
  }

  // ── Settled: executing / done / rejected ───────────────────────────────────
  if (isSettled) {
    return (
      <div className={`my-1.5 ml-4 rounded-lg border ${
        status === 'rejected' ? 'border-terminal-muted/20' : riskBorderColor[risk]
      } bg-terminal-surface/40 overflow-hidden`}>
        <div className="flex items-center gap-2 px-3 py-2">
          {status === 'rejected' ? (
            <><X className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
            <span className="text-xs text-terminal-muted">已拒绝</span></>
          ) : status === 'executing' ? (
            <><span className="w-3.5 h-3.5 border-2 border-terminal-blue border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span className="text-xs text-terminal-blue">执行中…</span></>
          ) : (
            /* done — user manually confirmed → "已同意" */
            <><Check className="w-3.5 h-3.5 text-terminal-green flex-shrink-0" />
            <span className="text-xs text-terminal-green font-medium">已同意</span></>
          )}
        </div>
        <div className="px-3 pb-2.5">
          <code className="text-xs text-terminal-muted font-mono break-all">{command}</code>
        </div>
      </div>
    );
  }

  // ── Pending: waiting for user ──────────────────────────────────────────────
  return (
    <div
      className={`my-1.5 ml-4 rounded-lg border ${riskBorderColor[risk]} bg-terminal-surface/80 overflow-visible animate-slide-up`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border/50">
        <span className={`text-xs font-medium ${riskHeaderColor[risk]}`}>
          {risk === 'high'
            ? '⚠ 是否同意执行以下高危命令并查看输出？'
            : '是否同意执行以下命令并查看输出？'}
        </span>

        {/* Action buttons */}
        <div className="relative flex items-center gap-1 ml-3 flex-shrink-0">
          {/* Execute button */}
          <button
            ref={execBtnRef}
            onClick={handleConfirmClick}
            title="确认执行 (Ctrl+Enter)"
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors
              ${risk === 'high'
                ? 'bg-terminal-red hover:bg-terminal-red/80 text-white'
                : 'bg-terminal-blue hover:bg-terminal-blue/80 text-white'
              }`}
          >
            <Play className="w-3 h-3" />
            执行 <kbd className="text-[9px] opacity-70 ml-0.5">Ctrl↵</kbd>
          </button>

          {/* Edit button */}
          <button
            onClick={() => setEditing(!editing)}
            title="修改命令 (Ctrl+E)"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-terminal-surface hover:bg-terminal-border text-terminal-muted hover:text-terminal-text transition-colors border border-terminal-border"
          >
            <Pencil className="w-3 h-3" />
            修改 <kbd className="text-[9px] opacity-60 ml-0.5">CtrlE</kbd>
          </button>

          {/* Reject button */}
          <button
            onClick={() => onReject(commandId)}
            title="拒绝 (Esc)"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-terminal-surface hover:bg-terminal-border text-terminal-muted hover:text-terminal-text transition-colors border border-terminal-border"
          >
            <X className="w-3 h-3" />
            拒绝 <kbd className="text-[9px] opacity-60 ml-0.5">Esc</kbd>
          </button>

          {/* High-risk floating confirm popup — anchored below the exec button */}
          {showDangerConfirm && (
            <div
              className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-lg border border-terminal-red/40 bg-terminal-surface shadow-lg shadow-black/40 animate-slide-up"
              style={{ minWidth: '11rem' }}
            >
              <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-terminal-red flex-shrink-0" />
                <span className="text-xs text-terminal-red font-medium">确认执行这条高危命令吗？</span>
              </div>
              <div className="flex gap-2 justify-end px-3 pb-2.5">
                <button
                  onClick={() => setShowDangerConfirm(false)}
                  className="px-3 py-1 text-xs rounded border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleDangerConfirm}
                  className="px-3 py-1 text-xs rounded bg-terminal-red hover:bg-terminal-red/80 text-white font-medium transition-colors"
                >
                  确认
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Command display / edit */}
      <div className="px-3 py-2.5">
        {editing ? (
          <div className="flex gap-2 items-start">
            <textarea
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              rows={Math.min(5, editValue.split('\n').length + 1)}
              className="flex-1 bg-terminal-bg border border-terminal-blue rounded px-2 py-1.5 text-xs text-terminal-text font-mono resize-none focus:outline-none focus:ring-1 focus:ring-terminal-blue"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleConfirmWithValue(editValue);
                }
              }}
            />
            <button
              onClick={() => handleConfirmWithValue(editValue)}
              className="flex-shrink-0 px-2.5 py-1.5 bg-terminal-blue hover:bg-terminal-blue/80 text-white text-xs rounded font-medium transition-colors"
            >
              确认
            </button>
          </div>
        ) : (
          <code className="text-xs text-terminal-text font-mono break-all leading-relaxed">
            {command}
          </code>
        )}
      </div>
    </div>
  );
}
