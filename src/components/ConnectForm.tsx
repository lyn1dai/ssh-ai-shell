import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Terminal, Key, Server, User, Lock, Trash2, Edit3, Plus, Settings,
  Search, ChevronRight, ChevronDown, Folder, FolderOpen, FolderPlus, Monitor,
  AlertTriangle, Clock, Zap, LogIn, X, Wifi, Star, Upload, Download, ArrowLeft,
} from 'lucide-react';
import type { ConnectConfig, SavedHost, Theme } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

function parseGroup(g?: string): string[] {
  if (!g) return [];
  return g.split('/').filter(Boolean).slice(0, 2);
}

interface HostTreeNode {
  id: string;
  label: string;
  level: number;
  host?: SavedHost;
  children: HostTreeNode[];
  path: string;
}

function buildTree(hosts: SavedHost[], standaloneGroups: string[] = []): HostTreeNode[] {
  const groupMap = new Map<string, HostTreeNode>();

  function getOrCreateGroup(path: string, label: string, level: number): HostTreeNode {
    if (!groupMap.has(path)) {
      groupMap.set(path, { id: `g_${path}`, label, level, children: [], path });
    }
    return groupMap.get(path)!;
  }

  const rootNodes: HostTreeNode[] = [];

  for (const host of hosts) {
    const parts = parseGroup(host.group);
    if (parts.length === 0) {
      rootNodes.push({ id: host.id, label: host.name, level: 2, host, children: [], path: '' });
    } else if (parts.length === 1) {
      const group = getOrCreateGroup(parts[0], parts[0], 0);
      group.children.push({ id: host.id, label: host.name, level: 2, host, children: [], path: parts[0] });
    } else {
      const parentPath = parts[0];
      const childPath = parts[0] + '/' + parts[1];
      const parent = getOrCreateGroup(parentPath, parts[0], 0);
      const child = getOrCreateGroup(childPath, parts[1], 1);
      if (!parent.children.find(c => c.id === child.id)) parent.children.push(child);
      child.children.push({ id: host.id, label: host.name, level: 2, host, children: [], path: childPath });
    }
  }

  // Include standalone (potentially empty) groups
  for (const gpath of standaloneGroups) {
    const parts = gpath.split('/').filter(Boolean).slice(0, 2);
    if (parts.length === 1) {
      getOrCreateGroup(parts[0], parts[0], 0);
    } else if (parts.length === 2) {
      const parentPath = parts[0];
      const childPath = parts[0] + '/' + parts[1];
      const parent = getOrCreateGroup(parentPath, parts[0], 0);
      const child = getOrCreateGroup(childPath, parts[1], 1);
      if (!parent.children.find(c => c.id === child.id)) parent.children.push(child);
    }
  }

  for (const node of groupMap.values()) {
    if (node.level === 0 && !rootNodes.find(n => n.id === node.id)) rootNodes.push(node);
  }

  return rootNodes;
}

// ─── Props ────────────────────────────────────────────────────────────────

interface Props {
  onConnect: (cfg: ConnectConfig) => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  hasActiveSessions?: boolean;
  onBackToTerminal?: () => void;
}

// ─── HostTreeItem ─────────────────────────────────────────────────────────

function HostTreeItem({
  node, selectedId, expandedGroups, onToggleGroup, onSelect, onEdit, onDelete, onConnect,
  onAddToGroup, onRenameGroup, onDeleteGroup,
}: {
  node: HostTreeNode;
  selectedId: string | null;
  expandedGroups: Set<string>;
  onToggleGroup: (path: string) => void;
  onSelect: (host: SavedHost) => void;
  onEdit: (host: SavedHost) => void;
  onDelete: (id: string) => void;
  onConnect: (host: SavedHost) => void;
  onAddToGroup: (groupPath: string) => void;
  onRenameGroup: (oldPath: string) => void;
  onDeleteGroup: (groupPath: string) => void;
}) {
  const isGroup = node.level < 2;
  const isExpanded = expandedGroups.has(node.path || node.id);
  const isSelected = node.host?.id === selectedId;

  if (isGroup) {
    return (
      <div>
        <div
          className="group w-full flex items-center gap-1.5 text-xs text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/20 rounded transition-colors"
          style={{ paddingLeft: `${(node.level + 1) * 12}px`, paddingRight: '4px' }}
        >
          <button
            className="flex items-center gap-1.5 flex-1 py-1.5 min-w-0"
            onClick={() => onToggleGroup(node.path || node.id)}
          >
            {isExpanded ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
            {isExpanded
              ? <FolderOpen className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />
              : <Folder className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />}
            <span className="truncate font-medium">{node.label}</span>
            <span className="ml-auto text-[10px] text-terminal-muted/60 mr-1">{node.children.length}</span>
          </button>
          {/* Group action buttons — appear on hover */}
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 flex-shrink-0 transition-opacity">
            <button
              onClick={e => { e.stopPropagation(); onAddToGroup(node.path); }}
              title={`在「${node.label}」中新建主机`}
              className="w-4.5 h-5 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10"
              style={{ width: '18px', height: '20px' }}
            >
              <Plus className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onRenameGroup(node.path); }}
              title="重命名分组"
              className="w-4.5 h-5 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-yellow hover:bg-terminal-yellow/10"
              style={{ width: '18px', height: '20px' }}
            >
              <Edit3 className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDeleteGroup(node.path); }}
              title="删除分组及其下所有主机"
              className="w-4.5 h-5 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10"
              style={{ width: '18px', height: '20px' }}
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          </div>
        </div>
        {isExpanded && (
          <div>
            {node.children.map(child => (
              <HostTreeItem key={child.id} node={child} selectedId={selectedId}
                expandedGroups={expandedGroups} onToggleGroup={onToggleGroup}
                onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} onConnect={onConnect}
                onAddToGroup={onAddToGroup} onRenameGroup={onRenameGroup} onDeleteGroup={onDeleteGroup} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors text-xs ${
        isSelected ? 'bg-terminal-blue/15 text-terminal-blue' : 'hover:bg-terminal-border/20 text-terminal-text'
      }`}
      style={{ paddingLeft: `${(node.level === 2 && node.path ? 3 : 2) * 12}px` }}
      onClick={() => node.host && onSelect(node.host)}
      onDoubleClick={() => node.host && onConnect(node.host)}
      title="单击选择，双击快速连接"
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSelected ? 'bg-terminal-blue' : 'bg-terminal-green'}`} />
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium">{node.label}</p>
        <p className="text-[10px] text-terminal-muted truncate">{node.host?.username}@{node.host?.host}</p>
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={e => { e.stopPropagation(); node.host && onEdit(node.host); }}
          className="w-5 h-5 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue" title="编辑">
          <Edit3 className="w-3 h-3" />
        </button>
        <button onClick={e => { e.stopPropagation(); node.host && onDelete(node.host.id); }}
          className="w-5 h-5 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-red" title="删除">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── AI Demo Animation ─────────────────────────────────────────────────────

const DEMO_STEPS = [
  { type: 'input',   text: '查看所有占用 80 端口的进程' },
  { type: 'cmd',     text: 'lsof -i :80 -P -n | grep LISTEN' },
  { type: 'output',  text: 'COMMAND  PID   USER   FD   TYPE\nnginx    1234  www    6u   IPv4\nnginx    1235  www    6u   IPv4' },
  { type: 'input',   text: '查看 nginx 服务的内存使用' },
  { type: 'cmd',     text: 'ps aux | grep nginx | awk \'{sum+=$6} END {print sum/1024 " MB"}\''},
  { type: 'output',  text: '45.2 MB' },
];

function AIDemoAnimation() {
  const [stepIdx, setStepIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'showing' | 'pause'>('typing');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const step = DEMO_STEPS[stepIdx];

  useEffect(() => {
    if (phase === 'typing') {
      if (charIdx < step.text.length) {
        timerRef.current = setTimeout(() => setCharIdx(c => c + 1), step.type === 'input' ? 60 : 20);
      } else {
        timerRef.current = setTimeout(() => setPhase('showing'), 400);
      }
    } else if (phase === 'showing') {
      timerRef.current = setTimeout(() => setPhase('pause'), step.type === 'output' ? 1500 : 800);
    } else if (phase === 'pause') {
      timerRef.current = setTimeout(() => {
        const next = (stepIdx + 1) % DEMO_STEPS.length;
        setStepIdx(next);
        setCharIdx(0);
        setPhase('typing');
      }, 600);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [phase, charIdx, stepIdx, step]);

  const displayedText = step.text.slice(0, charIdx);

  return (
    <div className="bg-[#0d1117] rounded-xl border border-[#30363d] overflow-hidden shadow-2xl">
      {/* Terminal title bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[#161b22] border-b border-[#30363d]">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#f85149]" />
          <div className="w-3 h-3 rounded-full bg-[#d29922]" />
          <div className="w-3 h-3 rounded-full bg-[#3fb950]" />
        </div>
        <span className="text-[11px] text-[#8b949e] font-mono ml-2">root@production-server</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 bg-[#3fb950] rounded-full animate-pulse" />
          <span className="text-[10px] text-[#3fb950]">AI 已就绪</span>
        </div>
      </div>

      {/* Terminal content */}
      <div className="p-4 font-mono text-xs space-y-2 min-h-[160px]">
        {/* Previous completed steps (last 2) */}
        {DEMO_STEPS.slice(Math.max(0, stepIdx - 2), stepIdx).map((s, i) => (
          <div key={i} className="opacity-50">
            {s.type === 'input' && (
              <div className="flex items-start gap-2">
                <span className="text-[#8b949e]">$</span>
                <span className="text-[#d29922] italic">{s.text}</span>
              </div>
            )}
            {s.type === 'cmd' && (
              <div className="flex items-start gap-2 ml-4">
                <span className="text-[#8b949e]">→</span>
                <span className="text-[#58a6ff] font-mono">{s.text}</span>
              </div>
            )}
            {s.type === 'output' && (
              <div className="ml-4 text-[#e6edf3] whitespace-pre">{s.text}</div>
            )}
          </div>
        ))}

        {/* Current step */}
        <div>
          {step.type === 'input' && (
            <div className="flex items-start gap-2">
              <span className="text-[#3fb950]">$</span>
              <span className="text-[#d29922] italic">
                {displayedText}
                {phase === 'typing' && <span className="animate-pulse">|</span>}
              </span>
            </div>
          )}
          {step.type === 'cmd' && (
            <div className="flex items-start gap-2 ml-4">
              <span className="text-[#58a6ff]">→ AI 生成命令:</span>
              <span className="text-[#58a6ff] font-mono">
                {displayedText}
                {phase === 'typing' && <span className="animate-pulse">|</span>}
              </span>
            </div>
          )}
          {step.type === 'output' && phase !== 'typing' && (
            <div className="ml-4 text-[#e6edf3] whitespace-pre bg-[#161b22] rounded p-2 border border-[#30363d]">{step.text}</div>
          )}
        </div>

        {/* Prompt */}
        {step.type !== 'input' && phase === 'pause' && (
          <div className="flex items-center gap-2">
            <span className="text-[#3fb950]">$</span>
            <span className="w-2 h-4 bg-[#e6edf3] animate-pulse" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Recent Host Card ────────────────────────────────────────────────────────

function HostCard({ host, onSelect, onConnect, onDelete, compact = false }: {
  host: SavedHost;
  onSelect: () => void;
  onConnect: () => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const initials = host.name.slice(0, 2).toUpperCase();
  const colors = ['bg-terminal-blue', 'bg-terminal-green', 'bg-terminal-yellow', 'bg-purple-500', 'bg-pink-500'];
  const colorIdx = host.name.charCodeAt(0) % colors.length;

  if (compact) {
    return (
      <div
        className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-terminal-border bg-terminal-surface hover:border-terminal-blue/40 hover:bg-terminal-blue/5 cursor-pointer transition-all"
        onClick={onSelect}
        onDoubleClick={onConnect}
        title="单击编辑，双击快速连接"
      >
        <div className={`w-8 h-8 rounded-lg ${colors[colorIdx]} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-terminal-text truncate">{host.name}</p>
          <p className="text-[11px] text-terminal-muted font-mono truncate">{host.username}@{host.host}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {host.lastConnectedAt && (
            <span className="text-[10px] text-terminal-muted flex items-center gap-0.5 flex-shrink-0">
              <Clock className="w-2.5 h-2.5" />
              {timeAgo(host.lastConnectedAt)}
            </span>
          )}
          {!host.lastConnectedAt && (
            <span className="text-[10px] text-terminal-muted/40 flex-shrink-0">从未连接</span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onConnect(); }}
            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-[10px] bg-terminal-blue text-white rounded transition-all"
          >
            <LogIn className="w-3 h-3" />连接
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-terminal-muted hover:text-terminal-red rounded transition-all"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group relative bg-terminal-surface border border-terminal-border rounded-xl p-4 cursor-pointer hover:border-terminal-blue/40 hover:bg-terminal-blue/5 transition-all"
      onClick={onSelect}
      onDoubleClick={onConnect}
      title="单击编辑，双击快速连接"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl ${colors[colorIdx]} flex items-center justify-center text-white text-sm font-bold`}>
          {initials}
        </div>
        <button
          onClick={e => { e.stopPropagation(); onConnect(); }}
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1 text-xs bg-terminal-blue text-white rounded-lg transition-all"
        >
          <LogIn className="w-3 h-3" />连接
        </button>
      </div>
      <p className="text-sm font-semibold text-terminal-text truncate">{host.name}</p>
      <p className="text-[11px] text-terminal-muted mt-0.5 truncate font-mono">{host.username}@{host.host}:{host.port}</p>
      {host.group && (
        <p className="text-[10px] text-terminal-yellow mt-1 truncate">
          <Folder className="w-2.5 h-2.5 inline mr-0.5" />{host.group}
        </p>
      )}
      <div className="flex items-center gap-1 mt-2 text-[10px] text-terminal-muted">
        <Clock className="w-2.5 h-2.5" />
        <span>{host.lastConnectedAt ? timeAgo(host.lastConnectedAt) : '从未连接'}</span>
      </div>
      {/* Delete button on hover */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-terminal-muted hover:text-terminal-red rounded transition-all"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Group Picker ─────────────────────────────────────────────────────────────

function GroupPicker({ value, onChange, groups }: {
  value: string;
  onChange: (v: string) => void;
  groups: string[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Folder className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => groups.length > 0 && setOpen(true)}
          placeholder="选择或输入分组..."
          className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-7 pr-7 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
        />
        {groups.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted hover:text-terminal-text"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && groups.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-terminal-surface border border-terminal-border rounded-lg shadow-xl overflow-y-auto max-h-44">
          {/* Clear/ungroup option */}
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); onChange(''); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-terminal-muted hover:bg-terminal-border/30 transition-colors text-left italic border-b border-terminal-border"
          >
            <X className="w-3 h-3 flex-shrink-0" />
            不分组
          </button>
          {groups.map(g => (
            <button
              key={g}
              type="button"
              onMouseDown={e => { e.preventDefault(); onChange(g); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left ${
                value === g
                  ? 'bg-terminal-blue/15 text-terminal-blue'
                  : 'text-terminal-text hover:bg-terminal-blue/10'
              }`}
            >
              <Folder className={`w-3 h-3 flex-shrink-0 ${value === g ? 'text-terminal-blue' : 'text-terminal-yellow'}`} />
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared connection form fields ───────────────────────────────────────────

interface ConnFormProps {
  form: ConnectConfig;
  setForm: (f: ConnectConfig) => void;
  hostName: string;
  setHostName: (v: string) => void;
  hostGroup: string;
  setHostGroup: (v: string) => void;
  authMode: 'password' | 'key';
  setAuthMode: (v: 'password' | 'key') => void;
  error: string;
  editingId: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onSaveAndConnect: () => void;
  onSaveEdit: () => void;
  onCancel: () => void;
  existingGroups?: string[];
}

function ConnForm({
  form, setForm, hostName, setHostName, hostGroup, setHostGroup,
  authMode, setAuthMode, error, editingId, onSubmit, onSaveAndConnect, onSaveEdit, onCancel,
  existingGroups = [],
}: ConnFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      {/* Name + Group */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs text-terminal-muted mb-1">名称 (可选)</label>
          <input type="text" value={hostName} onChange={e => setHostName(e.target.value)}
            placeholder="My Server"
            className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
        </div>
        <div className="w-40">
          <label className="block text-xs text-terminal-muted mb-1">分组</label>
          <GroupPicker value={hostGroup} onChange={setHostGroup} groups={existingGroups} />
          <p className="text-[10px] text-terminal-muted/50 mt-0.5">/ 分隔最多2层，如 Dev/Web</p>
        </div>
      </div>

      {/* Host + Port */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs text-terminal-muted mb-1">主机地址</label>
          <div className="relative">
            <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted" />
            <input type="text" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })}
              placeholder="192.168.1.1"
              className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-8 pr-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
          </div>
        </div>
        <div className="w-24">
          <label className="block text-xs text-terminal-muted mb-1">端口</label>
          <input type="number" value={form.port} onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
            className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue transition-colors font-mono text-center" />
        </div>
      </div>

      {/* Username */}
      <div>
        <label className="block text-xs text-terminal-muted mb-1">用户名</label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted" />
          <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
            placeholder="root"
            className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-8 pr-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
        </div>
      </div>

      {/* Auth mode */}
      <div>
        <div className="flex rounded-lg overflow-hidden border border-terminal-border mb-2">
          {(['password', 'key'] as const).map(m => (
            <button key={m} type="button" onClick={() => setAuthMode(m)}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                authMode === m ? 'bg-terminal-blue/20 text-terminal-blue' : 'bg-transparent text-terminal-muted hover:text-terminal-text'
              }`}>
              {m === 'password' ? <Lock className="w-3 h-3" /> : <Key className="w-3 h-3" />}
              {m === 'password' ? '密码' : '密钥'}
            </button>
          ))}
        </div>
        {authMode === 'password' ? (
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted" />
            <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder="密码"
              className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-8 pr-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
          </div>
        ) : (
          <textarea value={form.privateKey || ''} onChange={e => setForm({ ...form, privateKey: e.target.value })}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
            rows={3}
            className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono resize-none" />
        )}
      </div>

      {error && (
        <p className="text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex gap-2">
        <button type="submit"
          className="flex-1 bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
          <Terminal className="w-4 h-4" />连接
        </button>
        <button type="button" onClick={onSaveAndConnect}
          className="flex-1 bg-terminal-green/20 hover:bg-terminal-green/30 text-terminal-green font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-terminal-green/30">
          <Plus className="w-4 h-4" />保存并连接
        </button>
      </div>

      {editingId && (
        <div className="flex gap-2">
          <button type="button" onClick={onSaveEdit}
            className="flex-1 bg-terminal-surface hover:bg-terminal-border text-terminal-text font-medium py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-terminal-border">
            <Edit3 className="w-4 h-4" />保存修改
          </button>
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-xs text-terminal-muted hover:text-terminal-text border border-terminal-border rounded-lg transition-colors">
            取消
          </button>
        </div>
      )}
    </form>
  );
}

// ─── Main ConnectForm ──────────────────────────────────────────────────────

export default function ConnectForm({ onConnect, theme, onThemeChange, hasActiveSessions, onBackToTerminal }: Props) {
  const [form, setForm] = useState<ConnectConfig>({ host: '', port: 22, username: '', password: '' });
  const [hostName, setHostName] = useState('');
  const [hostGroup, setHostGroup] = useState('');
  const [authMode, setAuthMode] = useState<'password' | 'key'>('password');
  const [error, setError] = useState('');
  const [savedHosts, setSavedHosts] = useState<SavedHost[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSettingsTab, setShowSettingsTab] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [aiConfigured, setAIConfigured] = useState<boolean | null>(null);
  const [showNewConnForm, setShowNewConnForm] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);
  const [renamingGroupPath, setRenamingGroupPath] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [standaloneGroups, setStandaloneGroups] = useState<string[]>([]);
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupValue, setNewGroupValue] = useState('');
  const newGroupInputRef = useRef<HTMLInputElement>(null);

  const [SettingsPage, setSettingsPage] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    import('./SettingsPage').then(m => setSettingsPage(() => m.default));
  }, []);

  function refreshAIConfigured() {
    fetch('/api/ai-settings')
      .then(r => r.json())
      .then(d => setAIConfigured(d.configured ?? false))
      .catch(() => {});
  }

  useEffect(() => {
    fetch('/api/hosts').then(r => r.json()).then(setSavedHosts).catch(() => {});
    refreshAIConfigured();
    fetch('/api/groups').then(r => r.json()).then(setStandaloneGroups).catch(() => {});
  }, []);

  // Sort ALL hosts by lastConnectedAt desc
  const recentHosts = [...savedHosts]
    .sort((a, b) => {
      const ta = a.lastConnectedAt ? new Date(a.lastConnectedAt).getTime() : 0;
      const tb = b.lastConnectedAt ? new Date(b.lastConnectedAt).getTime() : 0;
      return tb - ta;
    });

  const filteredHosts = search
    ? savedHosts.filter(h =>
        h.name.toLowerCase().includes(search.toLowerCase()) ||
        h.host.toLowerCase().includes(search.toLowerCase()) ||
        h.username.toLowerCase().includes(search.toLowerCase())
      )
    : savedHosts;

  const treeNodes = buildTree(filteredHosts, standaloneGroups);

  useEffect(() => {
    const groups = new Set<string>();
    savedHosts.forEach(h => {
      const parts = parseGroup(h.group);
      if (parts.length > 0) { groups.add(parts[0]); if (parts.length > 1) groups.add(parts[0] + '/' + parts[1]); }
    });
    setExpandedGroups(groups);
  }, [savedHosts.length]);

  function toggleGroup(path: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  async function upsertHost(body: Partial<SavedHost>): Promise<SavedHost | null> {
    try {
      if (editingId) {
        const res = await fetch(`/api/hosts/${editingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const updated = await res.json();
        setSavedHosts(prev => prev.map(h => h.id === editingId ? updated : h));
        setEditingId(null);
        return updated;
      } else {
        const res = await fetch('/api/hosts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const newHost = await res.json();
        setSavedHosts(prev => [...prev, newHost]);
        return newHost;
      }
    } catch (err: any) { setError('保存失败: ' + err.message); return null; }
  }

  async function handleConnect(cfg: ConnectConfig) {
    try {
      const res = await fetch('/api/hosts/upsert', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(cfg.hostId && { id: cfg.hostId }),
          host: cfg.host, port: cfg.port, username: cfg.username,
          password: cfg.password, privateKey: cfg.privateKey,
          name: hostName || cfg.name || `${cfg.username}@${cfg.host}`,
          group: hostGroup,
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        setSavedHosts(prev => {
          const idx = prev.findIndex(h => h.id === saved.id);
          if (idx !== -1) return prev.map(h => h.id === saved.id ? saved : h);
          return [...prev, saved];
        });
        onConnect({ ...cfg, hostId: saved.id, name: saved.name });
      } else { onConnect(cfg); }
    } catch { onConnect(cfg); }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.host.trim()) { setError('请输入主机地址'); return; }
    if (!form.username.trim()) { setError('请输入用户名'); return; }
    setError('');
    handleConnect({ ...form, name: hostName || `${form.username}@${form.host}` });
  }

  async function handleSaveAndConnect() {
    if (!form.host.trim() || !form.username.trim()) { setError('请先填写主机地址和用户名'); return; }
    setError('');
    try {
      let saved: SavedHost | null = null;
      if (editingId) {
        // Updating an existing host: PUT to preserve id, also set lastConnectedAt
        const res = await fetch(`/api/hosts/${editingId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: hostName || `${form.username}@${form.host}`,
            host: form.host, port: form.port, username: form.username,
            password: form.password || '', privateKey: form.privateKey || '',
            group: hostGroup, lastConnectedAt: new Date().toISOString(),
          }),
        });
        saved = await res.json();
        setSavedHosts(prev => prev.map(h => h.id === editingId ? saved! : h));
        setEditingId(null);
      } else {
        // New or existing-by-address: use upsert so lastConnectedAt is set
        const res = await fetch('/api/hosts/upsert', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: hostName || `${form.username}@${form.host}`,
            host: form.host, port: form.port, username: form.username,
            password: form.password || '', privateKey: form.privateKey || '',
            group: hostGroup,
          }),
        });
        saved = await res.json();
        setSavedHosts(prev => {
          const idx = prev.findIndex(h => h.id === saved!.id);
          if (idx !== -1) return prev.map(h => h.id === saved!.id ? saved! : h);
          return [...prev, saved!];
        });
      }
      onConnect({ ...form, name: saved?.name || hostName, hostId: saved?.id });
    } catch (err: any) { setError('保存失败: ' + err.message); }
  }

  async function handleSaveEdit() {
    if (!form.host.trim() || !form.username.trim()) { setError('请先填写主机地址和用户名'); return; }
    setError('');
    await upsertHost({
      name: hostName || `${form.username}@${form.host}`,
      host: form.host, port: form.port, username: form.username,
      password: form.password || '', privateKey: form.privateKey || '',
      group: hostGroup,
    });
  }

  function handleDownloadTemplate() {
    const template = [
      { name: '示例服务器', host: '192.168.1.1', port: 22, username: 'root', password: 'your_password', privateKey: '', group: 'Production/Web' },
      { name: '开发机', host: '10.0.0.2', port: 22, username: 'ubuntu', password: '', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n...', group: 'Development' },
    ];
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'hosts-template.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const incoming = Array.isArray(json) ? json : (json.hosts || []);
        const res = await fetch('/api/hosts/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(incoming),
        });
        const result = await res.json();
        const hostsRes = await fetch('/api/hosts');
        setSavedHosts(await hostsRes.json());
        setImportMsg(`已导入 ${result.added} 台，跳过重复 ${result.skipped} 台`);
        setTimeout(() => setImportMsg(''), 4000);
      } catch { setError('导入失败：文件格式不正确'); }
    };
    reader.readAsText(file);
  }

  async function handleDeleteHost(id: string) {
    try {
      await fetch(`/api/hosts/${id}`, { method: 'DELETE' });
      setSavedHosts(prev => prev.filter(h => h.id !== id));
      if (editingId === id) resetForm();
      if (selectedHostId === id) setSelectedHostId(null);
    } catch {}
  }

  function handleSelectHost(host: SavedHost) {
    setForm({ host: host.host, port: host.port, username: host.username,
      password: host.password || '', privateKey: host.privateKey || '' });
    setHostName(host.name);
    setHostGroup(host.group || '');
    setAuthMode(host.privateKey ? 'key' : 'password');
    setEditingId(null);
    setSelectedHostId(host.id);
    setError('');
    setShowNewConnForm(true);
  }

  function handleEditHost(host: SavedHost) {
    handleSelectHost(host);
    setEditingId(host.id);
  }

  function handleQuickConnect(host: SavedHost) {
    handleConnect({ host: host.host, port: host.port, username: host.username,
      password: host.password, privateKey: host.privateKey, name: host.name, hostId: host.id });
  }

  function resetForm() {
    setForm({ host: '', port: 22, username: '', password: '' });
    setHostName(''); setHostGroup(''); setEditingId(null); setError(''); setSelectedHostId(null);
  }

  function handleAddToGroup(groupPath: string) {
    resetForm();
    setHostGroup(groupPath);
    setShowNewConnForm(true);
  }

  function handleRenameGroup(oldPath: string) {
    const lastSegment = oldPath.split('/').pop() || oldPath;
    setRenameGroupValue(lastSegment);
    setRenamingGroupPath(oldPath);
  }

  async function handleConfirmRenameGroup() {
    if (!renamingGroupPath || !renameGroupValue.trim()) return;
    const parts = renamingGroupPath.split('/');
    parts[parts.length - 1] = renameGroupValue.trim();
    const newPath = parts.join('/');
    if (newPath !== renamingGroupPath) {
      const toUpdate = savedHosts.filter(h =>
        h.group === renamingGroupPath || (h.group || '').startsWith(renamingGroupPath + '/')
      );
      await Promise.all(toUpdate.map(h =>
        fetch(`/api/hosts/${h.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...h, group: h.group!.replace(renamingGroupPath, newPath) }),
        })
      ));
      const res = await fetch('/api/hosts');
      setSavedHosts(await res.json());
      // Update standalone groups name
      if (standaloneGroups.includes(renamingGroupPath)) {
        await fetch(`/api/groups/${encodeURIComponent(renamingGroupPath)}`, { method: 'DELETE' });
        await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newPath }) });
        setStandaloneGroups(prev => prev.map(g => g === renamingGroupPath ? newPath : g));
      }
    }
    setRenamingGroupPath(null);
  }

  async function handleCreateGroup() {
    const name = newGroupValue.trim();
    if (!name) return;
    try {
      await fetch('/api/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setStandaloneGroups(prev => prev.includes(name) ? prev : [...prev, name]);
      // Auto-expand the new group in the tree
      setExpandedGroups(prev => { const s = new Set(prev); s.add(name.split('/')[0]); return s; });
    } catch {}
    setNewGroupValue('');
    setShowNewGroupInput(false);
  }

  async function handleDeleteGroup(groupPath: string) {
    const affected = savedHosts.filter(h =>
      h.group === groupPath || (h.group || '').startsWith(groupPath + '/')
    );
    const msg = affected.length > 0
      ? `删除分组「${groupPath}」将同时删除其中 ${affected.length} 台主机，确定继续？`
      : `删除空分组「${groupPath}」？`;
    if (!window.confirm(msg)) return;
    // Delete all hosts in the group
    await Promise.all(affected.map(h => fetch(`/api/hosts/${h.id}`, { method: 'DELETE' })));
    setSavedHosts(prev => prev.filter(h =>
      h.group !== groupPath && !(h.group || '').startsWith(groupPath + '/')
    ));
    // Remove from standalone groups too
    await fetch(`/api/groups/${encodeURIComponent(groupPath)}`, { method: 'DELETE' });
    setStandaloneGroups(prev => prev.filter(g => g !== groupPath && !g.startsWith(groupPath + '/')));
    if (editingId && affected.find(h => h.id === editingId)) resetForm();
  }

  const hasHosts = savedHosts.length > 0;
  const hasRecent = recentHosts.some(h => h.lastConnectedAt);
  // All known groups: from hosts + standalone
  const hostDerivedGroups = [...new Set(savedHosts.map(h => h.group).filter(Boolean) as string[])];
  const allGroups = [...new Set([...standaloneGroups, ...hostDerivedGroups])];

  return (
    <div className="min-h-screen bg-terminal-bg flex overflow-hidden">

      {/* ── Left: Host Tree Panel ───────────────────────────────────────── */}
      <div className="w-56 flex-shrink-0 bg-terminal-surface border-r border-terminal-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-terminal-border">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-terminal-blue" />
            <span className="text-xs font-semibold text-terminal-text">SSH AI Shell</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { resetForm(); setShowNewConnForm(true); }}
              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors" title="新建连接">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { setShowNewGroupInput(true); setNewGroupValue(''); setTimeout(() => newGroupInputRef.current?.focus(), 50); }}
              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-yellow hover:bg-terminal-yellow/10 transition-colors" title="新建分组">
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { setShowSettingsTab(undefined); setShowSettings(true); }}
              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors" title="设置">
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Back to terminal button (shown when already connected) */}
        {hasActiveSessions && onBackToTerminal && (
          <button
            onClick={onBackToTerminal}
            className="flex items-center gap-2 px-3 py-2 text-xs text-terminal-green hover:bg-terminal-green/10 border-b border-terminal-border transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>返回终端</span>
          </button>
        )}

        <div className="px-2 py-2 border-b border-terminal-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索主机..."
              className="w-full bg-terminal-bg border border-terminal-border rounded-md pl-7 pr-2 py-1.5 text-xs text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {/* Inline new-group input */}
          {showNewGroupInput && (
            <div className="px-2 pb-1.5 border-b border-terminal-border">
              <div className="flex items-center gap-1">
                <div className="relative flex-1">
                  <Folder className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-yellow pointer-events-none" />
                  <input
                    ref={newGroupInputRef}
                    type="text"
                    value={newGroupValue}
                    onChange={e => setNewGroupValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); handleCreateGroup(); }
                      if (e.key === 'Escape') { setShowNewGroupInput(false); setNewGroupValue(''); }
                    }}
                    placeholder="分组名，如 Dev/Web"
                    className="w-full bg-terminal-bg border border-terminal-border rounded pl-6 pr-2 py-1 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-yellow transition-colors font-mono"
                  />
                </div>
                <button
                  onClick={handleCreateGroup}
                  className="w-6 h-6 flex items-center justify-center rounded bg-terminal-yellow/20 hover:bg-terminal-yellow/30 text-terminal-yellow transition-colors"
                  title="创建分组 (Enter)"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <button
                  onClick={() => { setShowNewGroupInput(false); setNewGroupValue(''); }}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-terminal-border/30 text-terminal-muted transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
          {treeNodes.length === 0 ? (
            <div className="text-center py-8">
              <Monitor className="w-6 h-6 mx-auto text-terminal-muted/30 mb-2" />
              <p className="text-xs text-terminal-muted/50">{search ? '未找到匹配主机' : '暂无主机'}</p>
            </div>
          ) : (
            treeNodes.map(node => (
              <HostTreeItem key={node.id} node={node} selectedId={selectedHostId}
                expandedGroups={expandedGroups} onToggleGroup={toggleGroup}
                onSelect={handleSelectHost} onEdit={handleEditHost}
                onDelete={handleDeleteHost} onConnect={handleQuickConnect}
                onAddToGroup={handleAddToGroup}
                onRenameGroup={handleRenameGroup}
                onDeleteGroup={handleDeleteGroup} />
            ))
          )}
        </div>

        {/* Import message */}
        {importMsg && (
          <div className="px-3 py-1.5 text-[10px] text-terminal-green bg-terminal-green/10 border-t border-terminal-green/20">
            {importMsg}
          </div>
        )}

        {/* Import / Export template buttons */}
        <div className="px-2 py-1.5 border-t border-terminal-border flex items-center gap-1">
          <button
            onClick={handleDownloadTemplate}
            title="下载导入模板"
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 rounded transition-colors"
          >
            <Download className="w-3 h-3" />模板
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            title="从 JSON 文件导入主机"
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] text-terminal-muted hover:text-terminal-green hover:bg-terminal-green/10 rounded transition-colors"
          >
            <Upload className="w-3 h-3" />导入
          </button>
          <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        </div>

        <div className="px-3 py-1.5 border-t border-terminal-border">
          <p className="text-[10px] text-terminal-muted/40 text-center">双击快速连接</p>
        </div>
      </div>

      {/* ── Right: Main area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-terminal-surface border-b border-terminal-border">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-terminal-blue/20 rounded-lg flex items-center justify-center border border-terminal-blue/30">
              <Terminal className="w-3.5 h-3.5 text-terminal-blue" />
            </div>
            <div>
              <p className="text-sm font-semibold text-terminal-text font-mono">SSH AI Shell</p>
              <p className="text-[10px] text-terminal-muted">
                {hasActiveSessions ? '点击主机新建标签，或双击快速连接' : 'AI 增强的 Web 终端'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveSessions && onBackToTerminal && (
              <button onClick={onBackToTerminal}
                className="flex items-center gap-1.5 text-xs text-terminal-green hover:text-terminal-green/80 transition-colors px-2 py-1 rounded hover:bg-terminal-green/10">
                <ArrowLeft className="w-3.5 h-3.5" />返回终端
              </button>
            )}
            <button onClick={() => { setShowSettingsTab(undefined); setShowSettings(true); }}
              className="flex items-center gap-1.5 text-xs text-terminal-muted hover:text-terminal-blue transition-colors px-2 py-1 rounded hover:bg-terminal-blue/10">
              <Settings className="w-3.5 h-3.5" />设置
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* ── No hosts: welcome screen ────────────────────────────────────── */}
          {!hasHosts && !showNewConnForm && (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 py-8">
              {aiConfigured === false && (
                <div className="w-full max-w-lg bg-terminal-yellow/10 border border-terminal-yellow/30 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-4 h-4 text-terminal-yellow flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-terminal-yellow">AI 功能未配置</p>
                      <p className="text-[11px] text-terminal-yellow/70 mt-0.5">配置 AI 服务后可使用自然语言控制服务器</p>
                    </div>
                  </div>
                  <button onClick={() => { setShowSettingsTab('ai'); setShowSettings(true); }}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-terminal-yellow text-black font-semibold rounded-lg hover:bg-terminal-yellow/80 transition-colors ml-4">
                    <Zap className="w-3 h-3" />立即配置
                  </button>
                </div>
              )}
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-terminal-surface border border-terminal-border flex items-center justify-center mx-auto mb-4">
                  <Terminal className="w-8 h-8 text-terminal-muted/20" />
                </div>
                <h2 className="text-base font-semibold text-terminal-text">欢迎使用 SSH AI Shell</h2>
                <p className="text-xs text-terminal-muted mt-1">新建连接，或导入已有配置快速开始</p>
              </div>
              <div className="flex gap-3 flex-wrap justify-center">
                <button
                  onClick={() => setShowNewConnForm(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-terminal-blue hover:bg-terminal-blue/80 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />新建连接
                </button>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="flex items-center gap-2 px-6 py-3 bg-terminal-surface border border-terminal-border hover:bg-terminal-border/30 text-terminal-text font-medium rounded-xl text-sm transition-colors"
                >
                  <Upload className="w-4 h-4" />导入历史配置
                </button>
              </div>
            </div>
          )}

          {/* ── No hosts: new connection form ───────────────────────────────── */}
          {!hasHosts && showNewConnForm && (
            <div>
              <button
                onClick={() => { resetForm(); setShowNewConnForm(false); }}
                className="flex items-center gap-1.5 mb-4 text-xs text-terminal-muted hover:text-terminal-text transition-colors"
              >
                <X className="w-3.5 h-3.5" />返回
              </button>
              <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5 shadow-xl">
                 <ConnForm
                  form={form} setForm={setForm}
                  hostName={hostName} setHostName={setHostName}
                  hostGroup={hostGroup} setHostGroup={setHostGroup}
                  authMode={authMode} setAuthMode={setAuthMode}
                  error={error} editingId={editingId}
                  onSubmit={handleSubmit}
                  onSaveAndConnect={handleSaveAndConnect}
                  onSaveEdit={handleSaveEdit}
                  onCancel={() => { resetForm(); setShowNewConnForm(false); }}
                  existingGroups={allGroups}
                />
              </div>
            </div>
          )}

          {/* ── Has hosts ────────────────────────────────────────────────────── */}
          {hasHosts && (
            <div>
              {/* AI not configured banner */}
              {aiConfigured === false && (
                <div className="mb-4 bg-terminal-yellow/10 border border-terminal-yellow/30 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-terminal-yellow/20 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5 text-terminal-yellow" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-terminal-yellow">AI 功能未配置</p>
                      <p className="text-[11px] text-terminal-yellow/70 mt-0.5">配置 AI 服务后可使用自然语言控制服务器</p>
                    </div>
                  </div>
                  <button onClick={() => { setShowSettingsTab('ai'); setShowSettings(true); }}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-terminal-yellow text-black font-semibold rounded-lg hover:bg-terminal-yellow/80 transition-colors ml-4">
                    <Zap className="w-3 h-3" />立即配置
                  </button>
                </div>
              )}

              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-terminal-muted" />
                  <h2 className="text-xs font-semibold text-terminal-muted uppercase tracking-wider">主机记录</h2>
                  <span className="text-[10px] text-terminal-muted/60 bg-terminal-surface px-1.5 py-0.5 rounded border border-terminal-border">{savedHosts.length}</span>
                </div>
                <button
                  onClick={() => { resetForm(); setShowNewConnForm(prev => !prev); }}
                  className="flex items-center gap-1 text-xs text-terminal-muted hover:text-terminal-blue transition-colors"
                >
                  <Plus className="w-3 h-3" />新建连接
                </button>
              </div>

              {/* New connection / edit form (inline) */}
              {showNewConnForm && (
                <div className="mb-4 bg-terminal-surface border border-terminal-border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-terminal-text">{editingId ? '编辑主机' : '新建连接'}</h3>
                    <button onClick={() => { resetForm(); setShowNewConnForm(false); }}>
                      <X className="w-3.5 h-3.5 text-terminal-muted hover:text-terminal-text transition-colors" />
                    </button>
                  </div>
                <ConnForm
                  form={form} setForm={setForm}
                  hostName={hostName} setHostName={setHostName}
                  hostGroup={hostGroup} setHostGroup={setHostGroup}
                  authMode={authMode} setAuthMode={setAuthMode}
                  error={error} editingId={editingId}
                  onSubmit={handleSubmit}
                  onSaveAndConnect={handleSaveAndConnect}
                  onSaveEdit={handleSaveEdit}
                  onCancel={() => { resetForm(); setShowNewConnForm(false); }}
                  existingGroups={allGroups}
                />
                </div>
              )}

              {/* All hosts sorted by lastConnectedAt desc */}
              <div className="space-y-1.5">
                {recentHosts.map(host => (
                  <HostCard
                    key={host.id}
                    host={host}
                    compact
                    onSelect={() => handleSelectHost(host)}
                    onConnect={() => handleQuickConnect(host)}
                    onDelete={() => handleDeleteHost(host.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom status bar */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 bg-terminal-surface border-t border-terminal-border text-[10px] text-terminal-muted font-mono">
          <div className="flex items-center gap-3">
            <span>SSH AI Shell v1.0</span>
            {hasHosts && <span className="text-terminal-muted/60">{savedHosts.length} 台主机</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${aiConfigured === null ? 'bg-terminal-muted' : aiConfigured ? 'bg-terminal-green' : 'bg-terminal-yellow'}`} />
            <span className={aiConfigured ? 'text-terminal-green' : 'text-terminal-yellow'}>
              {aiConfigured === null ? '...' : aiConfigured ? 'AI 就绪' : 'AI 未配置'}
            </span>
          </div>
        </div>
      </div>

      {/* Settings overlay */}
      {showSettings && SettingsPage && (
        <SettingsPage
          onClose={() => {
            setShowSettings(false);
            setShowSettingsTab(undefined);
            refreshAIConfigured();
          }}
          onSaved={refreshAIConfigured}
          initialSection={showSettingsTab}
          theme={theme}
          onThemeChange={onThemeChange}
        />
      )}

      {/* Rename group modal */}
      {renamingGroupPath !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-terminal-surface border border-terminal-border rounded-xl shadow-2xl p-5 w-80">
            <h3 className="text-sm font-semibold text-terminal-text mb-3 flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-terminal-yellow" />重命名分组
            </h3>
            <p className="text-[11px] text-terminal-muted mb-3">
              当前：<span className="font-mono text-terminal-text">{renamingGroupPath}</span>
            </p>
            <input
              type="text"
              value={renameGroupValue}
              onChange={e => setRenameGroupValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmRenameGroup(); if (e.key === 'Escape') setRenamingGroupPath(null); }}
              autoFocus
              className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue font-mono mb-3"
              placeholder="新分组名称"
            />
            <div className="flex gap-2">
              <button
                onClick={handleConfirmRenameGroup}
                className="flex-1 bg-terminal-blue hover:bg-terminal-blue/80 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                确认重命名
              </button>
              <button
                onClick={() => setRenamingGroupPath(null)}
                className="px-4 py-2 text-sm text-terminal-muted hover:text-terminal-text border border-terminal-border rounded-lg transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
