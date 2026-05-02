import React, { useState, useEffect, useRef } from 'react';
import { Check, Pencil, X, Play, AlertTriangle } from 'lucide-react';
import type { Risk, CommandCardStatus } from '../types';

interface Props {
  commandId: string;
  command: string;
  risk: Risk;
  status: CommandCardStatus;
  requiresHighRiskConfirm: (command: string, risk: Risk) => boolean;
  onConfirm: (commandId: string, command: string, risk: Risk) => void;
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

const pendingCardClass: Record<Risk, string> = {
  low: 'border-terminal-green/40 bg-terminal-surface/80',
  normal: 'border-terminal-border bg-terminal-surface/80',
  high: 'border-terminal-red/30 bg-terminal-surface/85 shadow-[0_10px_28px_rgba(0,0,0,0.18)]',
};

const pendingHeaderBorderClass: Record<Risk, string> = {
  low: 'border-terminal-border/50',
  normal: 'border-terminal-border/50',
  high: 'border-terminal-red/12',
};

const pendingCodeClass: Record<Risk, string> = {
  low: 'bg-terminal-bg/50 border-terminal-border/40 text-terminal-text',
  normal: 'bg-terminal-bg/50 border-terminal-border/40 text-terminal-text',
  high: 'bg-terminal-red/5 border-terminal-red/12 text-terminal-text',
};

export default function CommandCard({
  commandId, command, risk, status, requiresHighRiskConfirm, onConfirm, onReject,
}: Props) {
  const [currentCommand, setCurrentCommand] = useState(command);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(command);
  const [showDangerConfirm, setShowDangerConfirm] = useState(false);
  const execBtnRef = useRef<HTMLButtonElement>(null);
  const confirmPopoverRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  function focusExecButton() {
    requestAnimationFrame(() => execBtnRef.current?.focus());
  }

  function closeDangerConfirm(restoreFocus = false) {
    setShowDangerConfirm(false);
    if (restoreFocus) focusExecButton();
  }

  useEffect(() => {
    setCurrentCommand(command);
    setEditValue(command);
  }, [command]);

  useEffect(() => {
    if (status !== 'pending') {
      closeDangerConfirm();
      setEditing(false);
    }
  }, [status]);

  useEffect(() => {
    if (!showDangerConfirm) return;
    if (!requiresHighRiskConfirm(getCurrentCommand(), risk)) {
      closeDangerConfirm();
    }
  }, [showDangerConfirm, editValue, command, risk, requiresHighRiskConfirm]);

  useEffect(() => {
    if (!showDangerConfirm) return;

    requestAnimationFrame(() => confirmBtnRef.current?.focus());

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (confirmPopoverRef.current?.contains(target)) return;
      if (execBtnRef.current?.contains(target)) return;
      closeDangerConfirm(true);
    }

    window.addEventListener('mousedown', handlePointerDown, true);
    return () => window.removeEventListener('mousedown', handlePointerDown, true);
  }, [showDangerConfirm]);

  useEffect(() => {
    if (!showDangerConfirm) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const nextCommand = getCurrentCommand();
        if (!nextCommand) return;
        submitConfirmedCommand(nextCommand);
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showDangerConfirm, editValue, command]);

  function getCurrentCommand() {
    return editing ? editValue.trim() : currentCommand;
  }

  function saveEditedCommand(value: string) {
    const nextValue = value.trim();
    if (!nextValue) return;
    setCurrentCommand(nextValue);
    setEditValue(nextValue);
    setEditing(false);
    closeDangerConfirm();
    focusExecButton();
  }

  function submitConfirmedCommand(value: string) {
    setCurrentCommand(value);
    setEditValue(value);
    onConfirm(commandId, value, risk);
    setEditing(false);
    closeDangerConfirm();
  }

  // Keyboard shortcuts (only while pending)
  useEffect(() => {
    if (status !== 'pending') return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return;
      // Ctrl+Enter → confirm / execute
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (editing) {
          saveEditedCommand(editValue);
          return;
        }
        handleConfirmClick();
        return;
      }
      // Ctrl+E → toggle edit mode
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        setShowDangerConfirm(false);
        setEditing(v => !v);
        return;
      }
      // Escape → close danger popup or reject
      if (e.key === 'Escape') {
        if (showDangerConfirm) {
          e.preventDefault();
          e.stopPropagation();
          closeDangerConfirm(true);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onReject(commandId);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, commandId, editing, showDangerConfirm, editValue, command, risk, requiresHighRiskConfirm]);

  function handleConfirmClick() {
    const nextCommand = getCurrentCommand();
    if (!nextCommand) return;
    if (requiresHighRiskConfirm(nextCommand, risk)) {
      setShowDangerConfirm(true);
      return;
    }
    submitConfirmedCommand(nextCommand);
  }

  const isSettled = status === 'rejected' || status === 'executing' || status === 'done' || status === 'cancelled';

  // ── Settled: auto-approved ─────────────────────────────────────────────────
  if (status === 'approved') {
    return (
      <div
        className={`my-1.5 ml-4 rounded-lg border ${riskBorderColor[risk]} bg-terminal-surface/60 overflow-hidden animate-slide-up`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Check className="w-3.5 h-3.5 text-terminal-green flex-shrink-0" />
          <span className="text-xs text-terminal-green font-medium">已自动批准</span>
        </div>
        <div className="px-3 pb-2.5">
          <code className="text-xs text-terminal-text font-mono break-all">{currentCommand}</code>
        </div>
      </div>
    );
  }

  // ── Settled: executing / done / rejected ───────────────────────────────────
  if (isSettled) {
    return (
      <div
        className={`my-1.5 ml-4 rounded-lg border ${
          status === 'rejected' || status === 'cancelled' ? 'border-terminal-muted/20' : riskBorderColor[risk]
        } bg-terminal-surface/40 overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          {status === 'rejected' ? (
            <><X className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
            <span className="text-xs text-terminal-muted">已拒绝</span></>
          ) : status === 'cancelled' ? (
            <><X className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" />
            <span className="text-xs text-terminal-muted">已中断</span></>
          ) : status === 'executing' ? (
            <><span className="w-3.5 h-3.5 border-2 border-terminal-blue border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <span className="text-xs text-terminal-blue">执行中…</span></>
          ) : (
            /* done */
            <><Check className="w-3.5 h-3.5 text-terminal-green flex-shrink-0" />
            <span className="text-xs text-terminal-green font-medium">已执行完成</span></>
          )}
        </div>
        <div className="px-3 pb-2.5">
          <code className="text-xs text-terminal-muted font-mono break-all">{currentCommand}</code>
        </div>
      </div>
    );
  }

  // ── Pending: waiting for user ──────────────────────────────────────────────
  return (
    <div
      className={`my-1.5 ml-4 rounded-xl border ${pendingCardClass[risk]} animate-slide-up`}
      onClick={e => e.stopPropagation()}
    >
      {/* Header row */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${pendingHeaderBorderClass[risk]}`}>
        <div className="flex items-center gap-2 min-w-0">
          {risk === 'high' && (
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-terminal-red/10 text-terminal-red">
              <AlertTriangle className="h-3 w-3" />
            </span>
          )}
          <span className={`text-xs font-medium ${riskHeaderColor[risk]}`}>
            {risk === 'high'
              ? '⚠ 是否同意执行以下高危命令并查看输出？'
              : '是否同意执行以下命令并查看输出？'}
          </span>
        </div>

        {/* Action buttons */}
        <div className="relative flex items-center gap-1 ml-3 flex-shrink-0">
          {/* Execute button */}
          <button
            ref={execBtnRef}
            onClick={handleConfirmClick}
            title="确认执行 (Ctrl+Enter)"
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors
              ${risk === 'high'
                ? showDangerConfirm
                  ? 'bg-terminal-red/90 ring-2 ring-terminal-red/30 text-white'
                  : 'bg-terminal-red hover:bg-terminal-red/85 text-white'
                : 'bg-terminal-blue hover:bg-terminal-blue/80 text-white'
              }`}
          >
            <Play className="w-3 h-3" />
            执行 <kbd className="text-[9px] opacity-70 ml-0.5">Ctrl↵</kbd>
          </button>

          {showDangerConfirm && (
            <div
              ref={confirmPopoverRef}
              className="absolute right-0 top-full z-10 mt-1.5 w-56 rounded-lg border border-terminal-red/18 bg-terminal-surface px-3 py-3 shadow-xl"
              role="dialog"
              aria-modal="false"
              aria-label="高危命令二次确认"
            >
              <div className="absolute -top-1 right-6 h-2 w-2 rotate-45 border-l border-t border-terminal-red/18 bg-terminal-surface" />
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-terminal-red/10 text-terminal-red">
                  <AlertTriangle className="h-3 w-3" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-terminal-text leading-relaxed">
                    确认执行这条高危命令吗？
                  </p>
                  <p className="mt-1 text-[10px] text-terminal-muted leading-relaxed">
                    这条命令可能影响系统状态，确认后会立即执行。
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="text-[9px] text-terminal-muted/70">Esc 取消</span>
                <button
                  onClick={() => closeDangerConfirm(true)}
                  className="px-2.5 py-1 text-xs rounded-md border border-terminal-border text-terminal-muted hover:border-terminal-border/80 hover:text-terminal-text transition-colors"
                >
                  取消
                </button>
                <button
                  ref={confirmBtnRef}
                  onClick={() => submitConfirmedCommand(getCurrentCommand())}
                  className="px-2.5 py-1 text-xs rounded-md bg-terminal-red hover:bg-terminal-red/85 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-terminal-red/30"
                >
                  确认执行
                </button>
              </div>
            </div>
          )}

          {/* Edit button */}
          <button
            onClick={() => {
              closeDangerConfirm();
              setEditing(!editing);
            }}
            title="修改命令 (Ctrl+E)"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-terminal-surface hover:bg-terminal-border text-terminal-muted hover:text-terminal-text transition-colors border border-terminal-border"
          >
            <Pencil className="w-3 h-3" />
            修改 <kbd className="text-[9px] opacity-60 ml-0.5">CtrlE</kbd>
          </button>

          {/* Reject button */}
          <button
            onClick={() => {
              closeDangerConfirm();
              onReject(commandId);
            }}
            title="拒绝 (Esc)"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-terminal-surface hover:bg-terminal-border text-terminal-muted hover:text-terminal-text transition-colors border border-terminal-border"
          >
            <X className="w-3 h-3" />
            拒绝 <kbd className="text-[9px] opacity-60 ml-0.5">Esc</kbd>
          </button>
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
                  saveEditedCommand(editValue);
                }
              }}
            />
            <button
              onClick={() => saveEditedCommand(editValue)}
              className="flex-shrink-0 px-2.5 py-1.5 bg-terminal-blue hover:bg-terminal-blue/80 text-white text-xs rounded font-medium transition-colors"
            >
              确认修改
            </button>
          </div>
        ) : (
          <div className={`rounded-lg border px-2.5 py-2 ${pendingCodeClass[risk]}`}>
            <code className="text-xs font-mono break-all leading-relaxed">
              {currentCommand}
            </code>
          </div>
        )}
      </div>

    </div>
  );
}
