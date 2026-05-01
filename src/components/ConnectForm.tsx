import React, { useState, useEffect } from 'react';
import { Terminal, Key, Server, User, Lock, Trash2, Edit3, Plus, Settings, MonitorSmartphone } from 'lucide-react';
import SettingsDialog from './SettingsDialog';
import type { ConnectConfig, SavedHost } from '../types';

interface Props {
  onConnect: (cfg: ConnectConfig) => void;
}

export default function ConnectForm({ onConnect }: Props) {
  const [form, setForm] = useState<ConnectConfig>({
    host: '',
    port: 22,
    username: '',
    password: '',
  });
  const [hostName, setHostName] = useState('');
  const [authMode, setAuthMode] = useState<'password' | 'key'>('password');
  const [error, setError] = useState('');
  const [savedHosts, setSavedHosts] = useState<SavedHost[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Load saved hosts on mount
  useEffect(() => {
    fetch('/api/hosts')
      .then(r => r.json())
      .then(setSavedHosts)
      .catch(() => {});
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.host.trim()) { setError('请输入主机地址'); return; }
    if (!form.username.trim()) { setError('请输入用户名'); return; }
    setError('');
    onConnect(form);
  }

  async function handleSaveHost() {
    if (!form.host.trim() || !form.username.trim()) {
      setError('请先填写主机地址和用户名');
      return;
    }
    setError('');
    const body = {
      name: hostName || `${form.username}@${form.host}`,
      host: form.host,
      port: form.port,
      username: form.username,
      password: form.password || '',
      privateKey: form.privateKey || '',
    };

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
      } else {
        const res = await fetch('/api/hosts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const newHost = await res.json();
        setSavedHosts(prev => [...prev, newHost]);
      }
    } catch (err: any) {
      setError('保存失败: ' + err.message);
    }
  }

  async function handleDeleteHost(id: string) {
    try {
      await fetch(`/api/hosts/${id}`, { method: 'DELETE' });
      setSavedHosts(prev => prev.filter(h => h.id !== id));
      if (editingId === id) setEditingId(null);
    } catch {}
  }

  function handleSelectHost(host: SavedHost) {
    setForm({
      host: host.host,
      port: host.port,
      username: host.username,
      password: host.password || '',
      privateKey: host.privateKey || '',
    });
    setHostName(host.name);
    setAuthMode(host.privateKey ? 'key' : 'password');
    setEditingId(null);
    setError('');
  }

  function handleEditHost(host: SavedHost) {
    handleSelectHost(host);
    setEditingId(host.id);
  }

  function handleQuickConnect(host: SavedHost) {
    onConnect({
      host: host.host,
      port: host.port,
      username: host.username,
      password: host.password,
      privateKey: host.privateKey,
    });
  }

  function handleSaveAndConnect() {
    handleSaveHost().then(() => {
      if (form.host.trim() && form.username.trim()) {
        onConnect(form);
      }
    });
  }

  function resetForm() {
    setForm({ host: '', port: 22, username: '', password: '' });
    setHostName('');
    setEditingId(null);
    setError('');
  }

  return (
    <div className="min-h-screen bg-terminal-bg flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="w-10 h-10 bg-terminal-blue/20 rounded-lg flex items-center justify-center border border-terminal-blue/30">
            <Terminal className="w-5 h-5 text-terminal-blue" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-terminal-text font-mono">SSH AI Shell</h1>
            <p className="text-xs text-terminal-muted">AI 增强的 Web 终端</p>
          </div>
        </div>

        <div className="flex gap-4">
          {/* ── Saved hosts list ─────────────────────────────────────────── */}
          <div className="w-56 flex-shrink-0">
            <div className="bg-terminal-surface border border-terminal-border rounded-xl p-4 shadow-2xl h-full">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-medium text-terminal-muted uppercase tracking-wider flex items-center gap-1.5">
                  <MonitorSmartphone className="w-3.5 h-3.5" />
                  主机列表
                </h2>
                <button
                  onClick={resetForm}
                  title="新建连接"
                  className="w-6 h-6 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {savedHosts.length === 0 ? (
                <p className="text-xs text-terminal-muted/50 text-center py-6">暂无保存的主机</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {savedHosts.map(host => (
                    <div
                      key={host.id}
                      className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                        editingId === host.id
                          ? 'bg-terminal-blue/10 border border-terminal-blue/30'
                          : 'hover:bg-terminal-border/30 border border-transparent'
                      }`}
                      onClick={() => handleSelectHost(host)}
                      onDoubleClick={() => handleQuickConnect(host)}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-terminal-green flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-terminal-text truncate font-medium">{host.name}</p>
                        <p className="text-[10px] text-terminal-muted truncate">{host.host}:{host.port}</p>
                      </div>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); handleEditHost(host); }}
                          className="w-5 h-5 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-blue transition-colors"
                          title="编辑"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteHost(host.id); }}
                          className="w-5 h-5 flex items-center justify-center rounded text-terminal-muted hover:text-terminal-red transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Connection form ──────────────────────────────────────────── */}
          <div className="flex-1">
            <div className="bg-terminal-surface border border-terminal-border rounded-xl p-6 shadow-2xl">
              <h2 className="text-sm font-medium text-terminal-muted mb-5 uppercase tracking-wider">
                {editingId ? '编辑主机' : '新建连接'}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">名称 (可选)</label>
                  <input
                    type="text"
                    value={hostName}
                    onChange={e => setHostName(e.target.value)}
                    placeholder="My Server"
                    className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2.5 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                  />
                </div>

                {/* Host + Port */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-terminal-muted mb-1">主机地址</label>
                    <div className="relative">
                      <Server className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted" />
                      <input
                        type="text"
                        value={form.host}
                        onChange={e => setForm({ ...form, host: e.target.value })}
                        placeholder="192.168.1.1"
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-8 pr-3 py-2.5 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                      />
                    </div>
                  </div>
                  <div className="w-24">
                    <label className="block text-xs text-terminal-muted mb-1">端口</label>
                    <input
                      type="number"
                      value={form.port}
                      onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
                      className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2.5 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue transition-colors font-mono text-center"
                    />
                  </div>
                </div>

                {/* Username */}
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">用户名</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted" />
                    <input
                      type="text"
                      value={form.username}
                      onChange={e => setForm({ ...form, username: e.target.value })}
                      placeholder="root"
                      className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-8 pr-3 py-2.5 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                    />
                  </div>
                </div>

                {/* Auth mode toggle */}
                <div>
                  <div className="flex rounded-lg overflow-hidden border border-terminal-border mb-3">
                    {(['password', 'key'] as const).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setAuthMode(m)}
                        className={`flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5
                          ${authMode === m
                            ? 'bg-terminal-blue/20 text-terminal-blue'
                            : 'bg-transparent text-terminal-muted hover:text-terminal-text'
                          }`}
                      >
                        {m === 'password' ? <Lock className="w-3 h-3" /> : <Key className="w-3 h-3" />}
                        {m === 'password' ? '密码' : '密钥'}
                      </button>
                    ))}
                  </div>

                  {authMode === 'password' ? (
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted" />
                      <input
                        type="password"
                        value={form.password}
                        onChange={e => setForm({ ...form, password: e.target.value })}
                        placeholder="密码"
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg pl-8 pr-3 py-2.5 text-sm text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                      />
                    </div>
                  ) : (
                    <textarea
                      value={form.privateKey || ''}
                      onChange={e => setForm({ ...form, privateKey: e.target.value })}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                      rows={4}
                      className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2.5 text-xs text-terminal-text placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-blue transition-colors font-mono resize-none"
                    />
                  )}
                </div>

                {error && (
                  <p className="text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                    {error}
                  </p>
                )}

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    <Terminal className="w-4 h-4" />
                    连接
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAndConnect}
                    className="flex-1 bg-terminal-green/20 hover:bg-terminal-green/30 text-terminal-green font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-terminal-green/30"
                  >
                    <Plus className="w-4 h-4" />
                    保存并连接
                  </button>
                </div>

                {editingId && (
                  <button
                    type="button"
                    onClick={handleSaveHost}
                    className="w-full bg-terminal-surface hover:bg-terminal-border text-terminal-text font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 border border-terminal-border"
                  >
                    <Edit3 className="w-4 h-4" />
                    保存修改
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>

        {/* Bottom bar: settings + info */}
        <div className="flex items-center justify-between mt-4 px-1">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 text-xs text-terminal-muted/60 hover:text-terminal-blue transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            AI 设置
          </button>
          <p className="text-xs text-terminal-muted/50 font-mono">
            SSH AI Shell · 智能终端
          </p>
        </div>
      </div>

      {showSettings && (
        <SettingsDialog onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
