import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  command: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DangerDialog({ command, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-terminal-surface border border-terminal-red/50 rounded-xl shadow-2xl p-5 w-full max-w-sm animate-slide-up">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-terminal-red/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-terminal-red" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">高危命令确认</h3>
            <p className="text-xs text-terminal-muted">该命令可能造成不可逆的操作，请确认</p>
          </div>
        </div>
        <pre className="bg-terminal-bg border border-terminal-red/30 rounded-lg px-3 py-2 text-xs text-terminal-red font-mono mb-4 whitespace-pre-wrap break-all">
          {command}
        </pre>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text hover:border-terminal-text transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-terminal-red hover:bg-terminal-red/80 text-white font-medium transition-colors"
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
