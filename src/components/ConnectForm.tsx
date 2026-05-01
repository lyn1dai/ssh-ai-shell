import React, { useState, useEffect, useCallback } from 'react';
import {
  Terminal, Key, Server, User, Lock, Trash2, Edit3, Plus, Settings,
  Search, ChevronRight, ChevronDown, Folder, FolderOpen, Monitor,
  AlertTriangle, Clock, Zap, LogIn, X, FolderPlus,
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

/** Parse group string "Prod/Web" → ['Prod', 'Web'], max 2 levels */
function parseGroup(g?: string): string[] {
  if (!g) return [];
  return g.split('/').filter(Boolean).slice(0, 2);
}

interface HostTreeNode {
  id: string;           // unique key
  label: string;
  level: number;        // 0 = root group, 1 = subgroup, 2 = leaf host
  host?: SavedHost;
  children: HostTreeNode[];
  path: string;         // full group path e.g. "Prod" or "Prod/Web"
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
      if (!parent.children.find(c => c.id === child.id)) {
        parent.children.push(child);
      }
      child.children.push({ id: host.id, label: host.name, level: 2, host, children: [], path: childPath });
    }
  }

  // Collect groups not yet in rootNodes
  for (const node of groupMap.values()) {
    if (node.level === 0 && !rootNodes.find(n => n.id === node.id)) {
      rootNodes.push(node);
    }
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
          {isExpanded
            ? <ChevronDown className="w-3 h-3 flex-shrink-0" />
            : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
          {isExpanded
            ? <FolderOpen className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />
            : <Folder className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />}
          <span className="truncate font-medium">{node.label}</span>
          <span className="ml-auto text-[10px] text-terminal-muted/60">{node.children.length}</span>
        </button>
        {isExpanded && (
          <div>
            {node.children.map(child => (
              <HostTreeItem
                key={child.id}
                node={child}
                selectedId={selectedId}
                expandedGroups={expandedGroups}
                onToggleGroup={onToggleGroup}
                onSelect={onSelect}
                onEdit={onEdit}
                onDelete={onDelete}
                onConnect={onConnect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors text-xs ${
        isSelected
          ? 'bg-terminal-blue/15 text-terminal-blue'
          : 'hover:bg-terminal-border/20 text-terminal-text'
      }`}
      style={{ paddingLeft: `${(node.level === 2 && node.path ? 3 : 2) * 12}px` }}
      onClick={() => node.host && onSelect(node.host)}
      onDoubleClick={() => node.host && onConnect(node.host)}
      title="单击选择，双击快速连接"
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSelected ? 'bg-terminal-blue' : 'bg-terminal-green'}`} />
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium">{node.label}</p>
        <p className="text-[10px] text-terminal-muted truncate">
          {node.host?.username}@{node.host?.host}
        </p>
      </div>
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => { e.stopPropagation(); node.host && onEdit(node.host); }}
          className="w-5 h-5 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue"
          title="编辑"
        >
          <Edit3 className="w-3 h-3" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); node.host && onDelete(node.host.id); }}
          className="w-5 h-5 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-red"
          title="删除"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
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
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [aiConfigured, setAIConfigured] = useState<boolean | null>(null);
  const [showNewConnForm, setShowNewConnForm] = useState(false);
  const [showGroupInput, setShowGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // Lazy-import settings page to avoid circular deps
  const [SettingsPage, setSettingsPage] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    import('./SettingsPage').then(m => setSettingsPage(() => m.default));
  }, []);

  useEffect(() => {
    fetch('/api/hosts').then(r => r.json()).then(setSavedHosts).catch(() => {});
    fetch('/api/ai-settings').then(r => r.json()).then(d => setAIConfigured(d.configured ?? false)).catch(() => {});
  }, []);

  // Build tree and recent hosts
  const recentHosts = [...savedHosts]
    .filter(h => h.lastConnectedAt)
    .sort((a, b) => new Date(b.lastConnectedAt!).getTime() - new Date(a.lastConnectedAt!).getTime())
    .slice(0, 6);

  const filteredHosts = search
    ? savedHosts.filter(h =>
        h.name.toLowerCase().includes(search.toLowerCase()) ||
        h.host.toLowerCase().includes(search.toLowerCase()) ||
        h.username.toLowerCase().includes(search.toLowerCase())
      )
    : savedHosts;

  const treeNodes = buildTree(filteredHosts);

  // Auto-expand all groups on first load
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

  // ── Persist host to server ─────────────────────────────────────────────

  async function upsertHost(body: Partial<SavedHost>): Promise<SavedHost | null> {
    try {
      if (editingId) {
        const res = await fetch(`/api/hosts/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const updated = await res.json();
        setSavedHosts(prev => prev.map(h => h.id === editingId ? updated : h));
        setEditingId(null);
        return updated;
      } else {
        const res = await fetch('/api/hosts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const newHost = await res.json();
        setSavedHosts(prev => [...prev, newHost]);
        return newHost;
      }
    } catch (err: any) {
      setError('保存失败: ' + err.message);
      return null;
    }
  }

  // ── Connect (auto-save) ─────────────────────────────────────────────────

  async function handleConnect(cfg: ConnectConfig) {
    try {
      const res = await fetch('/api/hosts/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      } else {
        onConnect(cfg);
      }
    } catch {
      onConnect(cfg);
    }
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

  function handleAddGroup() {
    if (!newGroupName.trim()) return;
    setHostGroup(newGroupName.trim());
    setNewGroupName('');
    setShowGroupInput(false);
  }

  // ── Recent host card ───────────────────────────────────────────────────

  function RecentCard({ host }: { host: SavedHost }) {
    return (
      <div
        className="group relative bg-terminal-surface border border-terminal-border rounded-xl p-4 cursor-pointer hover:border-terminal-blue/40 hover:bg-terminal-blue/5 transition-all"
        onClick={() => handleSelectHost(host)}
        onDoubleClick={() => handleQuickConnect(host)}
        title="单击编辑，双击快速连接"
      >
        <div className="flex items-start justify-between mb-2">
          <div className="w-8 h-8 rounded-lg bg-terminal-blue/15 flex items-center justify-center border border-terminal-blue/20">
            <Monitor className="w-4 h-4 text-terminal-blue" />
          </div>
          <button
            onClick={e => { e.stopPropagation(); handleQuickConnect(host); }}
            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-[10px] bg-terminal-blue text-white rounded-md transition-all"
            title="快速连接"
          >
            <LogIn className="w-3 h-3" /> 连接
          </button>
        </div>
        <p className="text-sm font-medium text-terminal-text truncate">{host.name}</p>
        <p className="text-[11px] text-terminal-muted mt-0.5 truncate font-mono">
          {host.username}@{host.host}:{host.port}
        </p>
        {host.group && (
          <p className="text-[10px] text-terminal-yellow mt-0.5 truncate">
            <Folder className="w-2.5 h-2.5 inline mr-0.5" />{host.group}
          </p>
        )}
        <div className="flex items-center gap-1 mt-2 text-[10px] text-terminal-muted">
          <Clock className="w-2.5 h-2.5" />
          <span>{timeAgo(host.lastConnectedAt!)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-terminal-bg flex overflow-hidden">

      {/* ── Left: Host Tree Panel ───────────────────────────────────────── */}
      <div className="w-56 flex-shrink-0 bg-terminal-surface border-r border-terminal-border flex flex-col overflow-hidden">
        {/* Panel header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-terminal-border">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-terminal-blue" />
            <span className="text-xs font-semibold text-terminal-text">SSH AI Shell</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { resetForm(); setShowNewConnForm(true); }}
              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors"
              title="新建连接"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors"
              title="设置"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-2 py-2 border-b border-terminal-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索主机..."
              className="w-full bg-terminal-bg border border-terminal-border rounded-md pl-7 pr-2 py-1.5 text-xs text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors"
            />
          </div>
        </div>

        {/* Host tree */}
        <div className="flex-1 overflow-y-auto py-1">
          {treeNodes.length === 0 ? (
            <div className="text-center py-8">
              <Monitor className="w-6 h-6 mx-auto text-terminal-muted/30 mb-2" />
              <p className="text-xs text-terminal-muted/50">
                {search ? '未找到匹配主机' : '暂无主机'}
              </p>
            </div>
          ) : (
            treeNodes.map(node => (
              <HostTreeItem
                key={node.id}
                node={node}
                selectedId={selectedHostId}
                expandedGroups={expandedGroups}
                onToggleGroup={toggleGroup}
                onSelect={handleSelectHost}
                onEdit={handleEditHost}
                onDelete={handleDeleteHost}
                onConnect={handleQuickConnect}
              />
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 text-xs text-terminal-muted hover:text-terminal-blue transition-colors px-2 py-1 rounded hover:bg-terminal-blue/10"
            >
              <Settings className="w-3.5 h-3.5" />
              设置
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* AI Warning Banner */}
          {aiConfigured === false && (
            <div className="bg-terminal-yellow/10 border border-terminal-yellow/30 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-terminal-yellow/20 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4 text-terminal-yellow" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-terminal-yellow">AI 功能未配置</p>
                  <p className="text-[11px] text-terminal-yellow/70 mt-0.5">
                    配置 AI 服务后，可在终端中使用自然语言控制服务器、智能命令补全等功能
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSettings(true)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-terminal-yellow text-black font-semibold rounded-lg hover:bg-terminal-yellow/80 transition-colors ml-4"
              >
                <Zap className="w-3 h-3" />
                立即配置
              </button>
            </div>
          )}

          {/* Recent connections */}
          {recentHosts.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-3.5 h-3.5 text-terminal-muted" />
                <h2 className="text-xs font-semibold text-terminal-muted uppercase tracking-wider">最近使用</h2>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {recentHosts.map(host => <RecentCard key={host.id} host={host} />)}
              </div>
            </div>
          )}

          {/* New connection section */}
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
                      <input type="text" value={hostName}
                        onChange={e => setHostName(e.target.value)}
                        placeholder="My Server"
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
                    </div>
                    <div className="w-40">
                      <label className="block text-xs text-terminal-muted mb-1">分组</label>
                      <div className="relative">
                        <Folder className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-terminal-muted" />
                        <input type="text" value={hostGroup}
                          onChange={e => setHostGroup(e.target.value)}
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
                        <input type="text" value={form.host}
                          onChange={e => setForm({ ...form, host: e.target.value })}
                          placeholder="192.168.1.1"
                          className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-8 pr-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
                      </div>
                    </div>
                    <div className="w-24">
                      <label className="block text-xs text-terminal-muted mb-1">端口</label>
                      <input type="number" value={form.port}
                        onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue transition-colors font-mono text-center" />
                    </div>
                  </div>

                  {/* Username */}
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">用户名</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted" />
                      <input type="text" value={form.username}
                        onChange={e => setForm({ ...form, username: e.target.value })}
                        placeholder="root"
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-8 pr-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
                    </div>
                  </div>

                  {/* Auth mode */}
                  <div>
                    <div className="flex rounded-lg overflow-hidden border border-terminal-border mb-2">
                      {(['password', 'key'] as const).map(m => (
                        <button key={m} type="button" onClick={() => setAuthMode(m)}
                          className={`flex-1 py-1.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5
                            ${authMode === m ? 'bg-terminal-blue/20 text-terminal-blue' : 'bg-transparent text-terminal-muted hover:text-terminal-text'}`}>
                          {m === 'password' ? <Lock className="w-3 h-3" /> : <Key className="w-3 h-3" />}
                          {m === 'password' ? '密码' : '密钥'}
                        </button>
                      ))}
                    </div>
                    {authMode === 'password' ? (
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted" />
                        <input type="password" value={form.password}
                          onChange={e => setForm({ ...form, password: e.target.value })}
                          placeholder="密码"
                          className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-8 pr-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono" />
                      </div>
                    ) : (
                      <textarea value={form.privateKey || ''}
                        onChange={e => setForm({ ...form, privateKey: e.target.value })}
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
                      <Terminal className="w-4 h-4" />
                      连接
                    </button>
                    <button type="button" onClick={handleSaveAndConnect}
                      className="flex-1 bg-terminal-green/20 hover:bg-terminal-green/30 text-terminal-green font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-terminal-green/30">
                      <Plus className="w-4 h-4" />
                      保存并连接
                    </button>
                  </div>

                  {editingId && (
                    <div className="flex gap-2">
                      <button type="button" onClick={handleSaveEdit}
                        className="flex-1 bg-terminal-surface hover:bg-terminal-border text-terminal-text font-medium py-2 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-terminal-border">
                        <Edit3 className="w-4 h-4" />
                        保存修改
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

          {/* Empty state */}
          {savedHosts.length === 0 && recentHosts.length === 0 && !showNewConnForm && (
            <div className="text-center py-16">
              <Terminal className="w-12 h-12 mx-auto text-terminal-muted/20 mb-4" />
              <p className="text-terminal-muted/50 text-sm mb-1">欢迎使用 SSH AI Shell</p>
              <p className="text-terminal-muted/30 text-xs mb-4">点击上方「新建连接」开始连接服务器</p>
              <button
                onClick={() => setShowNewConnForm(true)}
                className="px-4 py-2 bg-terminal-blue text-white text-sm rounded-lg hover:bg-terminal-blue/80 transition-colors"
              >
                新建连接
              </button>
            </div>
          )}
        </div>

        {/* Bottom status bar */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 bg-terminal-surface border-t border-terminal-border text-[10px] text-terminal-muted font-mono">
          <span>AI 增强 Web 终端</span>
          <span className={aiConfigured ? 'text-terminal-green' : 'text-terminal-yellow'}>
            {aiConfigured === null ? '...' : aiConfigured ? '● AI 就绪' : '⚠ AI 未配置'}
          </span>
        </div>
      </div>

      {/* Settings overlay */}
      {showSettings && SettingsPage && (
        <SettingsPage
          onClose={() => {
            setShowSettings(false);
            // Re-check AI config
            fetch('/api/ai-settings').then(r => r.json()).then(d => setAIConfigured(d.configured ?? false)).catch(() => {});
          }}
          theme={theme}
          onThemeChange={onThemeChange}
        />
      )}
    </div>
  );
}
