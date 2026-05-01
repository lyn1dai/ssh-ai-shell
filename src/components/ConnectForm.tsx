import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Terminal, Key, Server, User, Lock, Trash2, Edit3, Plus, Settings,
  Search, ChevronRight, ChevronDown, Folder, FolderOpen, Monitor,
  AlertTriangle, Clock, Zap, LogIn, X, Wifi, Star,
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

function buildTree(hosts: SavedHost[]): HostTreeNode[] {
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
}

// ─── HostTreeItem ─────────────────────────────────────────────────────────

function HostTreeItem({
  node, selectedId, expandedGroups, onToggleGroup, onSelect, onEdit, onDelete, onConnect,
}: {
  node: HostTreeNode;
  selectedId: string | null;
  expandedGroups: Set<string>;
  onToggleGroup: (path: string) => void;
  onSelect: (host: SavedHost) => void;
  onEdit: (host: SavedHost) => void;
  onDelete: (id: string) => void;
  onConnect: (host: SavedHost) => void;
}) {
  const isGroup = node.level < 2;
  const isExpanded = expandedGroups.has(node.path || node.id);
  const isSelected = node.host?.id === selectedId;

  if (isGroup) {
    return (
      <div>
        <button
          onClick={() => onToggleGroup(node.path || node.id)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/20 rounded transition-colors"
          style={{ paddingLeft: `${(node.level + 1) * 12}px` }}
        >
          {isExpanded ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
          {isExpanded
            ? <FolderOpen className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />
            : <Folder className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />}
          <span className="truncate font-medium">{node.label}</span>
          <span className="ml-auto text-[10px] text-terminal-muted/60">{node.children.length}</span>
        </button>
        {isExpanded && (
          <div>
            {node.children.map(child => (
              <HostTreeItem key={child.id} node={child} selectedId={selectedId}
                expandedGroups={expandedGroups} onToggleGroup={onToggleGroup}
                onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} onConnect={onConnect} />
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
            <span className="text-[10px] text-terminal-muted hidden group-hover:hidden lg:block">{timeAgo(host.lastConnectedAt)}</span>
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

// ─── Main ConnectForm ──────────────────────────────────────────────────────

export default function ConnectForm({ onConnect, theme, onThemeChange }: Props) {
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

  const [SettingsPage, setSettingsPage] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    import('./SettingsPage').then(m => setSettingsPage(() => m.default));
  }, []);

  useEffect(() => {
    fetch('/api/hosts').then(r => r.json()).then(setSavedHosts).catch(() => {});
    fetch('/api/ai-settings').then(r => r.json()).then(d => setAIConfigured(d.configured ?? false)).catch(() => {});
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

  const treeNodes = buildTree(filteredHosts);

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
    const saved = await upsertHost({
      name: hostName || `${form.username}@${form.host}`,
      host: form.host, port: form.port, username: form.username,
      password: form.password || '', privateKey: form.privateKey || '',
      group: hostGroup,
    });
    onConnect({ ...form, name: saved?.name || hostName, hostId: saved?.id });
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

  const hasHosts = savedHosts.length > 0;
  const hasRecent = recentHosts.some(h => h.lastConnectedAt);

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
            <button onClick={() => { setShowSettingsTab(undefined); setShowSettings(true); }}
              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors" title="设置">
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="px-2 py-2 border-b border-terminal-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索主机..."
              className="w-full bg-terminal-bg border border-terminal-border rounded-md pl-7 pr-2 py-1.5 text-xs text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
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
                onDelete={handleDeleteHost} onConnect={handleQuickConnect} />
            ))
          )}
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
              <p className="text-[10px] text-terminal-muted">AI 增强的 Web 终端</p>
            </div>
          </div>
          <button onClick={() => { setShowSettingsTab(undefined); setShowSettings(true); }}
            className="flex items-center gap-1.5 text-xs text-terminal-muted hover:text-terminal-blue transition-colors px-2 py-1 rounded hover:bg-terminal-blue/10">
            <Settings className="w-3.5 h-3.5" />设置
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* ── AI not configured: Hero section ────────────────────────────── */}
          {aiConfigured === false && !hasHosts && (
            <div className="rounded-2xl overflow-hidden border border-terminal-border bg-terminal-surface">
              {/* Hero header */}
              <div className="relative px-8 py-8 bg-gradient-to-br from-terminal-blue/10 via-terminal-surface to-terminal-surface border-b border-terminal-border">
                <div className="absolute top-0 right-0 w-64 h-64 bg-terminal-blue/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
                <div className="relative">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-terminal-blue/20 rounded-xl flex items-center justify-center border border-terminal-blue/30">
                      <Zap className="w-5 h-5 text-terminal-blue" />
                    </div>
                    <div>
                      <h1 className="text-lg font-bold text-terminal-text">欢迎使用 SSH AI Shell</h1>
                      <p className="text-xs text-terminal-muted">用自然语言控制你的服务器</p>
                    </div>
                  </div>
                  <p className="text-sm text-terminal-muted leading-relaxed max-w-lg">
                    配置 AI 后，在终端中输入自然语言指令（如"查看磁盘使用情况"），AI 将自动转换为 Shell 命令并执行。
                  </p>
                </div>
              </div>

              {/* Demo + CTA */}
              <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-semibold text-terminal-muted uppercase tracking-wider mb-3">演示效果</p>
                  <AIDemoAnimation />
                </div>
                <div className="flex flex-col justify-center space-y-4">
                  <div className="space-y-3">
                    {[
                      { icon: '🌐', title: '自然语言控制', desc: '直接输入中文指令，AI 理解并执行' },
                      { icon: '🛡️', title: '安全审批', desc: '危险命令需要确认，白名单命令自动执行' },
                      { icon: '⚡', title: '智能补全', desc: '根据历史预测命令，Tab 一键补全' },
                    ].map(f => (
                      <div key={f.title} className="flex items-start gap-3 p-3 rounded-lg bg-terminal-bg border border-terminal-border/50">
                        <span className="text-lg">{f.icon}</span>
                        <div>
                          <p className="text-sm font-medium text-terminal-text">{f.title}</p>
                          <p className="text-xs text-terminal-muted">{f.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-4 bg-terminal-yellow/10 border border-terminal-yellow/30 rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-terminal-yellow flex-shrink-0" />
                      <p className="text-sm font-semibold text-terminal-yellow">AI 功能尚未配置</p>
                    </div>
                    <p className="text-xs text-terminal-yellow/70 mb-3">需要配置 AI API 才能使用自然语言功能</p>
                    <button
                      onClick={() => { setShowSettingsTab('ai'); setShowSettings(true); }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-terminal-blue text-white text-sm font-semibold rounded-lg hover:bg-terminal-blue/80 transition-colors"
                    >
                      <Zap className="w-4 h-4" />立即配置 AI
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── AI not configured banner (when there are hosts) ────────────── */}
          {aiConfigured === false && hasHosts && (
            <div className="bg-terminal-yellow/10 border border-terminal-yellow/30 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-terminal-yellow/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 text-terminal-yellow" />
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

          {/* ── Recent / All hosts ────────────────────────────────────────── */}
          {hasHosts && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-terminal-muted" />
                  <h2 className="text-xs font-semibold text-terminal-muted uppercase tracking-wider">主机列表</h2>
                  <span className="text-[10px] text-terminal-muted/60 bg-terminal-surface px-1.5 py-0.5 rounded border border-terminal-border">{savedHosts.length}</span>
                </div>
                <button onClick={() => { resetForm(); setShowNewConnForm(prev => !prev); }}
                  className="flex items-center gap-1 text-xs text-terminal-muted hover:text-terminal-blue transition-colors">
                  <Plus className="w-3 h-3" />新建连接
                </button>
              </div>

              {/* Recent used (top 3 with lastConnectedAt as large cards) */}
              {recentHosts.filter(h => h.lastConnectedAt).length > 0 && (
                <>
                  <p className="text-[10px] text-terminal-muted/60 uppercase tracking-wider mb-2">最近登录</p>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                    {recentHosts.filter(h => h.lastConnectedAt).slice(0, 6).map(host => (
                      <HostCard key={host.id} host={host}
                        onSelect={() => handleSelectHost(host)}
                        onConnect={() => handleQuickConnect(host)}
                        onDelete={() => handleDeleteHost(host.id)} />
                    ))}
                  </div>
                </>
              )}

              {/* All hosts as compact list */}
              {savedHosts.filter(h => !h.lastConnectedAt).length > 0 && (
                <>
                  <p className="text-[10px] text-terminal-muted/60 uppercase tracking-wider mb-2">其他主机</p>
                  <div className="space-y-1.5">
                    {savedHosts.filter(h => !h.lastConnectedAt).map(host => (
                      <HostCard key={host.id} host={host} compact
                        onSelect={() => handleSelectHost(host)}
                        onConnect={() => handleQuickConnect(host)}
                        onDelete={() => handleDeleteHost(host.id)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── New connection section ────────────────────────────────────── */}
          {(showNewConnForm || !hasHosts) && (
            <div>
              <button
                onClick={() => { resetForm(); setShowNewConnForm(prev => !prev); }}
                className="flex items-center gap-2 mb-3 w-full text-left"
              >
                <Plus className="w-3.5 h-3.5 text-terminal-muted" />
                <h2 className="text-xs font-semibold text-terminal-muted uppercase tracking-wider">
                  {editingId ? '编辑主机' : '新建连接'}
                </h2>
                <ChevronDown className={`w-3.5 h-3.5 text-terminal-muted ml-auto transition-transform ${showNewConnForm ? '' : '-rotate-90'}`} />
              </button>

              {showNewConnForm && (
                <div className="bg-terminal-surface border border-terminal-border rounded-xl p-5 shadow-xl">
                  <form onSubmit={handleSubmit} className="space-y-3.5">
                    {/* Name + Group row */}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-xs text-terminal-muted mb-1">名称 (可选)</label>
                        <input type="text" value={hostName} onChange={e => setHostName(e.target.value)}
                          placeholder="My Server"
                          className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
                      </div>
                      <div className="w-40">
                        <label className="block text-xs text-terminal-muted mb-1">分组</label>
                        <div className="relative">
                          <Folder className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted" />
                          <input type="text" value={hostGroup} onChange={e => setHostGroup(e.target.value)}
                            placeholder="Production/Web"
                            className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-7 pr-2 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
                        </div>
                        <p className="text-[10px] text-terminal-muted/50 mt-0.5">用 / 分隔最多2层</p>
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
                      <button type="button" onClick={handleSaveAndConnect}
                        className="flex-1 bg-terminal-green/20 hover:bg-terminal-green/30 text-terminal-green font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-terminal-green/30">
                        <Plus className="w-4 h-4" />保存并连接
                      </button>
                    </div>

                    {editingId && (
                      <div className="flex gap-2">
                        <button type="button" onClick={handleSaveEdit}
                          className="flex-1 bg-terminal-surface hover:bg-terminal-border text-terminal-text font-medium py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-terminal-border">
                          <Edit3 className="w-4 h-4" />保存修改
                        </button>
                        <button type="button" onClick={() => { resetForm(); setShowNewConnForm(false); }}
                          className="px-4 py-2 text-xs text-terminal-muted hover:text-terminal-text border border-terminal-border rounded-lg transition-colors">
                          取消
                        </button>
                      </div>
                    )}
                  </form>
                </div>
              )}
            </div>
          )}

          {/* Empty state CTA */}
          {!hasHosts && !showNewConnForm && aiConfigured !== false && (
            <div className="text-center py-16">
              <Terminal className="w-12 h-12 mx-auto text-terminal-muted/20 mb-4" />
              <p className="text-terminal-muted/50 text-sm mb-1">还没有保存的主机</p>
              <p className="text-terminal-muted/30 text-xs mb-4">点击下方按钮连接你的第一台服务器</p>
              <button onClick={() => setShowNewConnForm(true)}
                className="px-4 py-2 bg-terminal-blue text-white text-sm rounded-lg hover:bg-terminal-blue/80 transition-colors">
                新建连接
              </button>
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
            fetch('/api/ai-settings').then(r => r.json()).then(d => setAIConfigured(d.configured ?? false)).catch(() => {});
          }}
          initialSection={showSettingsTab}
          theme={theme}
          onThemeChange={onThemeChange}
        />
      )}
    </div>
  );
}
