import React from 'react';
import { Wifi, WifiOff } from 'lucide-react';

interface Props {
  connected: boolean;
  host: string;
  latencyMs: number;
  rows: number;
  cols: number;
  sessionId: string;
}

export default function StatusBar({ connected, host, latencyMs, rows, cols, sessionId }: Props) {
  return (
    <div className="flex items-center gap-3 px-3 py-1 bg-terminal-surface border-t border-terminal-border text-[11px] text-terminal-muted font-mono flex-shrink-0 overflow-x-auto">
      {/* Connection */}
      <span className={`flex items-center gap-1 ${connected ? 'text-terminal-green' : 'text-terminal-red'}`}>
        {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        {connected ? '已连接' : '未连接'}
      </span>

      <span className="text-terminal-border">|</span>

      {host && <span className="text-terminal-blue">{host}</span>}

      {sessionId && (
        <>
          <span className="text-terminal-border">|</span>
          <span>{sessionId}</span>
        </>
      )}

      <span className="text-terminal-border">|</span>

      <span>{rows} Rows {cols} Cols</span>

      <span className="text-terminal-border">|</span>
      <span>en_US.UTF-8</span>

      {latencyMs > 0 && (
        <>
          <span className="text-terminal-border">|</span>
          <span className={latencyMs > 200 ? 'text-terminal-yellow' : 'text-terminal-green'}>
            {latencyMs} ms
          </span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      <span className="text-terminal-muted/50">SSH AI Shell</span>
    </div>
  );
}
