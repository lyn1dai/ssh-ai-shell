import React, { useState } from 'react';
import { Terminal, Key, Server, User, Lock } from 'lucide-react';
import type { ConnectConfig } from '../types';

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
  const [authMode, setAuthMode] = useState<'password' | 'key'>('password');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.host.trim()) { setError('请输入主机地址'); return; }
    if (!form.username.trim()) { setError('请输入用户名'); return; }
    setError('');
    onConnect(form);
  }

  return (
    <div className="min-h-screen bg-terminal-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 bg-terminal-blue/20 rounded-lg flex items-center justify-center border border-terminal-blue/30">
            <Terminal className="w-5 h-5 text-terminal-blue" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-terminal-text font-mono">SSH AI Shell</h1>
            <p className="text-xs text-terminal-muted">AI 增强的 Web 终端</p>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-terminal-surface border border-terminal-border rounded-xl p-6 shadow-2xl">
          <h2 className="text-sm font-medium text-terminal-muted mb-5 uppercase tracking-wider">
            新建连接
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            <button
              type="submit"
              className="w-full bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              <Terminal className="w-4 h-4" />
              连接
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-terminal-muted/50 mt-4 font-mono">
          SSH AI Shell · 智能终端
        </p>
      </div>
    </div>
  );
}
