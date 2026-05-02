import React, { useState, useEffect, useRef } from 'react';
import {
  X, Save, Cpu, ChevronDown, ExternalLink, CheckCircle2, AlertCircle,
  Shield, Download, Upload, Plus, Trash2, Server, Brain, Star,
  RefreshCw, LogIn, LogOut,
} from 'lucide-react';
import type { AISettings, AIProvider, AutoApproveSettings, AutoApproveRule, MCPServer, Skill } from '../types';

// ─── AI provider presets ──────────────────────────────────────────────────

const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    apiKeyHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-3-5', 'claude-sonnet-4-6'],
    apiKeyHint: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    apiKeyHint: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'qwen',
    name: '通义千问 (Qwen)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
    apiKeyHint: 'sk-...',
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    apiKeyHint: 'sk-...',
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    name: '智谱 AI (GLM)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4', 'glm-4-flash', 'glm-4-air', 'glm-3-turbo'],
    apiKeyHint: '...',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'deepseek/deepseek-chat'],
    apiKeyHint: 'sk-or-...',
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen2.5', 'deepseek-coder-v2', 'mistral'],
    apiKeyHint: 'ollama',
    docsUrl: 'https://ollama.ai',
  },
  {
    id: 'custom',
    name: '自定义 / 其他',
    baseUrl: '',
    models: [],
    apiKeyHint: '...',
  },
];

// ─── Types ────────────────────────────────────────────────────────────────

type Tab = 'ai' | 'rules' | 'mcp' | 'skills' | 'data';

interface Props {
  onClose: () => void;
  onSaved?: () => void;
  initialTab?: Tab;
}

// ─── Toggle component ─────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-2 px-3 rounded-lg hover:bg-terminal-border/20 transition-colors group"
    >
      <div className="text-left">
        <div className="text-xs text-terminal-text">{label}</div>
        {description && <div className="text-[10px] text-terminal-muted mt-0.5">{description}</div>}
      </div>
      <div className={`relative rounded-full transition-colors flex-shrink-0 ml-3 ${
        checked ? 'bg-terminal-blue' : 'bg-terminal-border'
      }`} style={{ height: '18px', width: '32px' }}>
        <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[14px]' : 'translate-x-0.5'
        }`} />
      </div>
    </button>
  );
}

// ─── Copilot status type ──────────────────────────────────────────────────

interface CopilotStatus {
  connected: boolean;
  username?: string;
  model?: string;
}

function normalizeCopilotStatus(data: Partial<CopilotStatus> & { loggedIn?: boolean } | null | undefined): CopilotStatus {
  return {
    connected: !!(data?.connected ?? data?.loggedIn),
    username: data?.username,
    model: data?.model,
  };
}

// ─── Main component ────────────────────────────────────────────────────────

export default function SettingsDialog({ onClose, onSaved, initialTab = 'ai' }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // ── AI settings state ──────────────────────────────────────────────────
  const [settings, setSettings] = useState<AISettings>({ baseUrl: '', apiKey: '', model: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('custom');
  const [showProviders, setShowProviders] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Copilot state
  const [copilot, setCopilot] = useState<CopilotStatus>({ connected: false });
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auto-approve state ────────────────────────────────────────────────
  const [approveSettings, setApproveSettings] = useState<AutoApproveSettings>({
    globalAutoApprove: { low: true, normal: false, high: false },
    rules: [],
    highRiskRules: [],
  });
  const [newPattern, setNewPattern] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [approveSaving, setApproveSaving] = useState(false);
  const [approveSuccess, setApproveSuccess] = useState(false);
  const [approveError, setApproveError] = useState('');

  // ── MCP state ────────────────────────────────────────────────────────
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [mcpForm, setMcpForm] = useState<Partial<MCPServer>>({ transport: 'stdio', enabled: true });
  const [mcpEditing, setMcpEditing] = useState<string | null>(null);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpError, setMcpError] = useState('');
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [mcpTesting, setMcpTesting] = useState<string | null>(null);

  // ── Skills state ──────────────────────────────────────────────────────
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillForm, setSkillForm] = useState<Partial<Skill>>({ enabled: true });
  const [skillEditing, setSkillEditing] = useState<string | null>(null);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillError, setSkillError] = useState('');

  // ── Data management state ──────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load initial data ─────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/ai-settings').then(r => r.json()),
      fetch('/api/auto-approve').then(r => r.json()).catch(() => approveSettings),
      fetch('/api/copilot/status').then(r => r.json()).catch(() => ({ loggedIn: false })),
      fetch('/api/mcp-servers').then(r => r.json()).catch(() => []),
      fetch('/api/skills').then(r => r.json()).catch(() => []),
    ]).then(([aiData, approveData, copilotData, mcpData, skillsData]) => {
      setSettings(aiData);
      const matched = AI_PROVIDERS.find(p => p.id !== 'custom' && p.baseUrl === aiData.baseUrl);
      setSelectedProvider(matched?.id || 'custom');
      setApproveSettings(approveData);
      setCopilot(normalizeCopilotStatus(copilotData));
      setMcpServers(mcpData);
      setSkills(skillsData);
      setLoading(false);
    }).catch(err => { setError(err.message); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup device flow poll on unmount
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // ── AI tab handlers ────────────────────────────────────────────────────

  function selectProvider(provider: AIProvider) {
    setSelectedProvider(provider.id);
    setShowProviders(false);
    if (provider.id !== 'custom') {
      setSettings(prev => ({
        ...prev,
        baseUrl: provider.baseUrl,
        model: provider.models[0] || prev.model,
      }));
    }
  }

  const currentProvider = AI_PROVIDERS.find(p => p.id === selectedProvider) || AI_PROVIDERS[AI_PROVIDERS.length - 1];
  const modelOptions = currentProvider.models;

  async function handleResetAI() {
    setResetting(true);
    setError('');
    try {
      await fetch('/api/ai-settings', { method: 'DELETE' });
      setSettings({ baseUrl: '', apiKey: '', model: '' });
      setSelectedProvider('custom');
      setShowResetConfirm(false);
      setSuccess(false);
      onSaved?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '移除失败');
    } finally {
      setResetting(false);
    }
  }

  async function handleSave() {
    if (!settings.baseUrl.trim()) { setError('请输入 API 地址'); return; }
    if (!settings.apiKey.trim()) { setError('请输入 API Key'); return; }
    if (!settings.model.trim()) { setError('请输入模型名称'); return; }

    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const res = await fetch('/api/ai-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('保存失败');
      setSuccess(true);
      onSaved?.();
      setTimeout(() => onClose(), 900);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  // ── Copilot handlers ───────────────────────────────────────────────────

  async function startCopilotLogin() {
    setCopilotLoading(true);
    setError('');
    try {
      const res = await fetch('/api/copilot/device-start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '启动失败');
      setDeviceFlow({
        userCode: data.userCode ?? data.user_code,
        verificationUri: data.verificationUri ?? data.verification_uri,
      });
      // Start polling
      pollRef.current = setInterval(async () => {
        const pollRes = await fetch('/api/copilot/device-poll');
        const pollData = await pollRes.json();
        if (pollData.status === 'success') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setDeviceFlow(null);
          setCopilot({ connected: true, username: pollData.username, model: pollData.model });
          onSaved?.();
        } else if (pollData.status === 'error') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setDeviceFlow(null);
          setError(pollData.error || '认证失败');
        }
      }, 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '启动失败');
    } finally {
      setCopilotLoading(false);
    }
  }

  async function logoutCopilot() {
    await fetch('/api/copilot/logout', { method: 'DELETE' }).catch(() => {});
    setCopilot({ connected: false });
    setDeviceFlow(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    onSaved?.();
  }

  // ── Rules tab handlers ─────────────────────────────────────────────────

  function addRule() {
    if (!newPattern.trim()) return;
    const rule: AutoApproveRule = {
      id: `rule_${Date.now()}`,
      pattern: newPattern.trim(),
      enabled: true,
      description: newDesc.trim() || undefined,
    };
    setApproveSettings(prev => ({ ...prev, rules: [...prev.rules, rule] }));
    setNewPattern('');
    setNewDesc('');
  }

  function removeRule(id: string) {
    setApproveSettings(prev => ({ ...prev, rules: prev.rules.filter(r => r.id !== id) }));
  }

  function toggleRule(id: string) {
    setApproveSettings(prev => ({
      ...prev,
      rules: prev.rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r),
    }));
  }

  async function saveApproveSettings() {
    setApproveSaving(true);
    setApproveError('');
    setApproveSuccess(false);
    try {
      const res = await fetch('/api/auto-approve', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(approveSettings),
      });
      if (!res.ok) throw new Error('保存失败');
      setApproveSuccess(true);
      setTimeout(() => setApproveSuccess(false), 2000);
    } catch (err: unknown) {
      setApproveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setApproveSaving(false);
    }
  }

  // ── MCP handlers ──────────────────────────────────────────────────────

  function startMcpEdit(srv: MCPServer) {
    setMcpEditing(srv.id);
    setMcpForm({ ...srv });
    setMcpError('');
  }

  function cancelMcpEdit() {
    setMcpEditing(null);
    setMcpForm({ transport: 'stdio', enabled: true });
    setMcpError('');
  }

  async function saveMcpServer() {
    if (!mcpForm.name?.trim()) { setMcpError('请输入名称'); return; }
    if (mcpForm.transport === 'stdio' && !mcpForm.command?.trim()) { setMcpError('请输入命令'); return; }
    if (mcpForm.transport === 'http' && !mcpForm.url?.trim()) { setMcpError('请输入 URL'); return; }

    setMcpSaving(true);
    setMcpError('');
    try {
      if (mcpEditing) {
        const res = await fetch(`/api/mcp-servers/${mcpEditing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mcpForm),
        });
        if (!res.ok) throw new Error('保存失败');
        const updated = await res.json();
        setMcpServers(prev => prev.map(s => s.id === mcpEditing ? updated : s));
      } else {
        const res = await fetch('/api/mcp-servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mcpForm),
        });
        if (!res.ok) throw new Error('创建失败');
        const created = await res.json();
        setMcpServers(prev => [...prev, created]);
      }
      cancelMcpEdit();
    } catch (err: unknown) {
      setMcpError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setMcpSaving(false);
    }
  }

  async function deleteMcpServer(id: string) {
    await fetch(`/api/mcp-servers/${id}`, { method: 'DELETE' });
    setMcpServers(prev => prev.filter(s => s.id !== id));
  }

  async function testMcpServer(id: string) {
    setMcpTesting(id);
    try {
      const res = await fetch(`/api/mcp-servers/${id}/test`, { method: 'POST' });
      const data = await res.json();
      setMcpTestResults(prev => ({
        ...prev,
        [id]: { ok: data.ok, msg: data.ok ? `${data.toolCount ?? 0} 个工具` : data.error || '连接失败' },
      }));
    } catch {
      setMcpTestResults(prev => ({ ...prev, [id]: { ok: false, msg: '请求失败' } }));
    } finally {
      setMcpTesting(null);
    }
  }

  async function toggleMcpEnabled(srv: MCPServer) {
    const updated = { ...srv, enabled: !srv.enabled };
    await fetch(`/api/mcp-servers/${srv.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});
    setMcpServers(prev => prev.map(s => s.id === srv.id ? updated : s));
  }

  // ── Skills handlers ────────────────────────────────────────────────────

  function startSkillEdit(skill: Skill) {
    setSkillEditing(skill.id);
    setSkillForm({ ...skill });
    setSkillError('');
  }

  function cancelSkillEdit() {
    setSkillEditing(null);
    setSkillForm({ enabled: true });
    setSkillError('');
  }

  async function saveSkill() {
    if (!skillForm.name?.trim()) { setSkillError('请输入名称'); return; }
    if (!skillForm.systemPromptAddition?.trim()) { setSkillError('请输入系统提示词'); return; }

    setSkillSaving(true);
    setSkillError('');
    try {
      if (skillEditing) {
        const res = await fetch(`/api/skills/${skillEditing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(skillForm),
        });
        if (!res.ok) throw new Error('保存失败');
        const updated = await res.json();
        setSkills(prev => prev.map(s => s.id === skillEditing ? updated : s));
      } else {
        const res = await fetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(skillForm),
        });
        if (!res.ok) throw new Error('创建失败');
        const created = await res.json();
        setSkills(prev => [...prev, created]);
      }
      cancelSkillEdit();
    } catch (err: unknown) {
      setSkillError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSkillSaving(false);
    }
  }

  async function deleteSkill(id: string) {
    await fetch(`/api/skills/${id}`, { method: 'DELETE' });
    setSkills(prev => prev.filter(s => s.id !== id));
  }

  async function toggleSkillEnabled(skill: Skill) {
    const updated = { ...skill, enabled: !skill.enabled };
    await fetch(`/api/skills/${skill.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});
    setSkills(prev => prev.map(s => s.id === skill.id ? updated : s));
  }

  // ── Data management handlers ───────────────────────────────────────────

  async function handleExport() {
    try {
      const res = await fetch('/api/export-settings');
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ssh-ai-shell-${new Date().toISOString().slice(0, 10)}.enc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError('');
    setImportSuccess(false);
    try {
      const text = await file.text();
      const res = await fetch('/api/import-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: text,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `导入失败 (${res.status})`);
      }
      setImportSuccess(true);
      const [aiData, approveData] = await Promise.all([
        fetch('/api/ai-settings').then(r => r.json()),
        fetch('/api/auto-approve').then(r => r.json()),
      ]);
      setSettings(aiData);
      const matched = AI_PROVIDERS.find(p => p.id !== 'custom' && p.baseUrl === aiData.baseUrl);
      setSelectedProvider(matched?.id || 'custom');
      setApproveSettings(approveData);
      window.dispatchEvent(new CustomEvent('hosts-updated'));
      onSaved?.();
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'ai',     label: 'AI 配置',  icon: <Cpu className="w-3 h-3" /> },
    { id: 'rules',  label: '命令规则',  icon: <Shield className="w-3 h-3" /> },
    { id: 'mcp',    label: 'MCP 服务', icon: <Server className="w-3 h-3" /> },
    { id: 'skills', label: '技能',      icon: <Brain className="w-3 h-3" /> },
    { id: 'data',   label: '数据管理',  icon: <Download className="w-3 h-3" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-terminal-surface border border-terminal-border rounded-xl shadow-2xl w-full max-w-lg animate-slide-up flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-terminal-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-terminal-blue/20 rounded-lg flex items-center justify-center border border-terminal-blue/20">
              <Cpu className="w-3.5 h-3.5 text-terminal-blue" />
            </div>
            <h2 className="text-sm font-semibold text-terminal-text">设置</h2>
          </div>
          <button onClick={onClose} className="text-terminal-muted hover:text-terminal-text transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-terminal-border flex-shrink-0 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-terminal-blue text-terminal-blue'
                  : 'border-transparent text-terminal-muted hover:text-terminal-text'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">

          {/* ── AI 配置 tab ─────────────────────────────────────────────── */}
          {activeTab === 'ai' && (
            loading ? (
              <div className="text-center text-terminal-muted text-sm py-8">加载中...</div>
            ) : (
              <>
                {/* GitHub Copilot section */}
                <div className="bg-terminal-bg rounded-lg border border-terminal-border p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Star className="w-3.5 h-3.5 text-terminal-yellow" />
                    <span className="text-xs font-medium text-terminal-text">GitHub Copilot</span>
                    {copilot.connected && (
                      <span className="ml-auto text-[10px] bg-terminal-green/10 text-terminal-green border border-terminal-green/20 rounded px-1.5 py-0.5">已连接</span>
                    )}
                  </div>

                  {copilot.connected ? (
                    <div className="space-y-2">
                      <div className="text-[11px] text-terminal-muted">
                        用户: <span className="text-terminal-text">{copilot.username}</span>
                        {copilot.model && <> · 模型: <span className="text-terminal-text">{copilot.model}</span></>}
                      </div>
                      <button
                        onClick={logoutCopilot}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-terminal-red/10 hover:bg-terminal-red/20 text-terminal-red border border-terminal-red/20 transition-colors"
                      >
                        <LogOut className="w-3 h-3" />
                        退出 Copilot 账号
                      </button>
                    </div>
                  ) : deviceFlow ? (
                    <div className="space-y-2">
                      <p className="text-[11px] text-terminal-muted">在浏览器中打开并输入代码：</p>
                      <a
                        href={deviceFlow.verificationUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] text-terminal-blue hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {deviceFlow.verificationUri}
                      </a>
                      <div className="font-mono text-lg font-bold text-terminal-text tracking-widest text-center py-2">
                        {deviceFlow.userCode}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-terminal-muted">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        等待认证...
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={startCopilotLogin}
                      disabled={copilotLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-terminal-blue/10 hover:bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/20 transition-colors disabled:opacity-50"
                    >
                      <LogIn className="w-3 h-3" />
                      {copilotLoading ? '启动中...' : '通过 GitHub 登录 Copilot'}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[10px] text-terminal-muted">
                  <div className="flex-1 h-px bg-terminal-border" />
                  <span>或使用自定义 AI 服务</span>
                  <div className="flex-1 h-px bg-terminal-border" />
                </div>

                {/* Provider selector */}
                <div>
                  <label className="block text-xs text-terminal-muted mb-1.5">AI 服务商</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowProviders(!showProviders)}
                      className="w-full flex items-center justify-between bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2.5 text-sm text-terminal-text hover:border-terminal-blue transition-colors"
                    >
                      <span>{currentProvider.name}</span>
                      <ChevronDown className={`w-3.5 h-3.5 text-terminal-muted transition-transform ${showProviders ? 'rotate-180' : ''}`} />
                    </button>
                    {showProviders && (
                      <div className="absolute top-full mt-1 left-0 right-0 bg-terminal-surface border border-terminal-border rounded-lg shadow-xl z-10 overflow-hidden max-h-48 overflow-y-auto">
                        {AI_PROVIDERS.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => selectProvider(p)}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between
                              ${selectedProvider === p.id
                                ? 'bg-terminal-blue/10 text-terminal-blue'
                                : 'hover:bg-terminal-border/30 text-terminal-text'}`}
                          >
                            <span>{p.name}</span>
                            {selectedProvider === p.id && <CheckCircle2 className="w-3.5 h-3.5" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {currentProvider.docsUrl && (
                    <a
                      href={currentProvider.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-terminal-blue hover:underline mt-1"
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      获取 API Key
                    </a>
                  )}
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-xs text-terminal-muted mb-1.5">API Base URL</label>
                  <input
                    type="text"
                    value={settings.baseUrl}
                    onChange={e => setSettings({ ...settings, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                    className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2.5 text-sm text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-xs text-terminal-muted mb-1.5">API Key</label>
                  <input
                    type="password"
                    value={settings.apiKey}
                    onChange={e => setSettings({ ...settings, apiKey: e.target.value })}
                    placeholder={currentProvider.apiKeyHint || 'sk-...'}
                    className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2.5 text-sm text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                  />
                </div>

                {/* Model */}
                <div>
                  <label className="block text-xs text-terminal-muted mb-1.5">模型</label>
                  {modelOptions.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {modelOptions.map(m => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setSettings({ ...settings, model: m })}
                            className={`px-2.5 py-1 rounded text-xs transition-colors border font-mono
                              ${settings.model === m
                                ? 'bg-terminal-blue/20 border-terminal-blue text-terminal-blue'
                                : 'bg-transparent border-terminal-border text-terminal-muted hover:text-terminal-text'}`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={settings.model}
                        onChange={e => setSettings({ ...settings, model: e.target.value })}
                        placeholder="或手动输入模型名称..."
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                      />
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={settings.model}
                      onChange={e => setSettings({ ...settings, model: e.target.value })}
                      placeholder="例如: gpt-4o, claude-3-5-sonnet, deepseek-chat..."
                      className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2.5 text-sm text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                    />
                  )}
                </div>

                {error && (
                  <div className="flex items-start gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}
                {success && (
                  <div className="flex items-start gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    保存成功，AI 功能已启用
                  </div>
                )}
              </>
            )
          )}

          {/* ── 命令规则 tab ─────────────────────────────────────────────── */}
          {activeTab === 'rules' && (
            <>
              <div>
                <div className="text-xs font-medium text-terminal-muted mb-2 uppercase tracking-wider">全局自动审批</div>
                <div className="bg-terminal-bg rounded-lg border border-terminal-border divide-y divide-terminal-border/50">
                  <div className="px-1 py-0.5">
                    <Toggle
                      checked={approveSettings.globalAutoApprove.low}
                      onChange={v => setApproveSettings(prev => ({
                        ...prev, globalAutoApprove: { ...prev.globalAutoApprove, low: v },
                      }))}
                      label="低风险命令自动执行"
                      description="ls, cat, pwd, git status 等只读操作"
                    />
                  </div>
                  <div className="px-1 py-0.5">
                    <Toggle
                      checked={approveSettings.globalAutoApprove.normal}
                      onChange={v => setApproveSettings(prev => ({
                        ...prev, globalAutoApprove: { ...prev.globalAutoApprove, normal: v },
                      }))}
                      label="普通风险命令自动执行"
                      description="mkdir, cp, git clone, npm install 等可逆操作"
                    />
                  </div>
                  <div className="px-1 py-0.5">
                    <Toggle
                      checked={approveSettings.globalAutoApprove.high}
                      onChange={v => setApproveSettings(prev => ({
                        ...prev, globalAutoApprove: { ...prev.globalAutoApprove, high: v },
                      }))}
                      label="高风险命令自动执行"
                      description="⚠ rm, sudo, kill, reboot 等不可逆操作"
                    />
                  </div>
                </div>
                {approveSettings.globalAutoApprove.high && (
                  <div className="flex items-center gap-1.5 text-[10px] text-terminal-yellow mt-1.5">
                    <AlertCircle className="w-3 h-3" />
                    高风险自动执行已启用，AI 将无需确认即可执行危险命令
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-medium text-terminal-muted mb-2 uppercase tracking-wider">命令规则</div>
                <p className="text-[10px] text-terminal-muted mb-2">
                  匹配模式：精确字符串、<span className="font-mono text-terminal-text">glob*</span>、
                  或 <span className="font-mono text-terminal-text">/regex/</span>
                </p>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={newPattern}
                    onChange={e => setNewPattern(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addRule()}
                    placeholder="模式，如: git * 或 /^npm /"
                    className="flex-1 bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                  />
                  <input
                    type="text"
                    value={newDesc}
                    onChange={e => setNewDesc(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addRule()}
                    placeholder="备注（可选）"
                    className="w-28 bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors"
                  />
                  <button
                    onClick={addRule}
                    disabled={!newPattern.trim()}
                    className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg bg-terminal-blue/20 hover:bg-terminal-blue/30 text-terminal-blue border border-terminal-blue/30 transition-colors disabled:opacity-40"
                  >
                    <Plus className="w-3 h-3" />
                    添加
                  </button>
                </div>
                {approveSettings.rules.length === 0 ? (
                  <div className="text-center text-terminal-muted text-xs py-4 bg-terminal-bg rounded-lg border border-terminal-border">
                    暂无规则，添加后特定命令可自动执行
                  </div>
                ) : (
                  <div className="space-y-1">
                    {approveSettings.rules.map(rule => (
                      <div
                        key={rule.id}
                        className="flex items-center gap-2 px-3 py-2 bg-terminal-bg rounded-lg border border-terminal-border group"
                      >
                        <button
                          onClick={() => toggleRule(rule.id)}
                          className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${
                            rule.enabled ? 'bg-terminal-blue border-terminal-blue' : 'border-terminal-border'
                          }`}
                        >
                          {rule.enabled && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                        </button>
                        <span className={`flex-1 text-xs font-mono truncate ${
                          rule.enabled ? 'text-terminal-text' : 'text-terminal-muted line-through'
                        }`}>
                          {rule.pattern}
                        </span>
                        {rule.description && (
                          <span className="text-[10px] text-terminal-muted truncate max-w-[80px]">
                            {rule.description}
                          </span>
                        )}
                        <button
                          onClick={() => removeRule(rule.id)}
                          className="opacity-0 group-hover:opacity-100 text-terminal-muted hover:text-terminal-red transition-all flex-shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {approveError && (
                <div className="flex items-center gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {approveError}
                </div>
              )}
              {approveSuccess && (
                <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  规则已保存
                </div>
              )}
            </>
          )}

          {/* ── MCP 服务 tab ─────────────────────────────────────────────── */}
          {activeTab === 'mcp' && (
            <>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] text-terminal-muted">通过 MCP 协议扩展 AI 工具能力</p>
                {mcpEditing === null && (
                  <button
                    onClick={() => { setMcpEditing(''); setMcpForm({ transport: 'stdio', enabled: true }); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-terminal-blue/10 hover:bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/20 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    添加
                  </button>
                )}
              </div>

              {/* Form: add / edit */}
              {mcpEditing !== null && (
                <div className="bg-terminal-bg rounded-lg border border-terminal-border p-3 space-y-2">
                  <div className="text-xs font-medium text-terminal-text mb-1">
                    {mcpEditing ? '编辑 MCP 服务' : '新建 MCP 服务'}
                  </div>
                  <input
                    type="text"
                    value={mcpForm.name || ''}
                    onChange={e => setMcpForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="名称"
                    className="w-full bg-terminal-surface border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors"
                  />
                  <div className="flex gap-2">
                    {(['stdio', 'http'] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setMcpForm(f => ({ ...f, transport: t }))}
                        className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                          mcpForm.transport === t
                            ? 'bg-terminal-blue/20 border-terminal-blue text-terminal-blue'
                            : 'border-terminal-border text-terminal-muted hover:text-terminal-text'
                        }`}
                      >
                        {t === 'stdio' ? '本地进程 (stdio)' : 'HTTP 服务'}
                      </button>
                    ))}
                  </div>
                  {mcpForm.transport === 'stdio' ? (
                    <>
                      <input
                        type="text"
                        value={mcpForm.command || ''}
                        onChange={e => setMcpForm(f => ({ ...f, command: e.target.value }))}
                        placeholder="命令，如: npx -y @modelcontextprotocol/server-filesystem"
                        className="w-full bg-terminal-surface border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                      />
                      <input
                        type="text"
                        value={(mcpForm.args || []).join(' ')}
                        onChange={e => setMcpForm(f => ({ ...f, args: e.target.value ? e.target.value.split(' ') : [] }))}
                        placeholder="额外参数（空格分隔，可选）"
                        className="w-full bg-terminal-surface border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                      />
                    </>
                  ) : (
                    <input
                      type="text"
                      value={mcpForm.url || ''}
                      onChange={e => setMcpForm(f => ({ ...f, url: e.target.value }))}
                      placeholder="URL，如: http://localhost:8080"
                      className="w-full bg-terminal-surface border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors font-mono"
                    />
                  )}
                  {mcpError && (
                    <div className="flex items-center gap-1.5 text-xs text-terminal-red">
                      <AlertCircle className="w-3 h-3" />
                      {mcpError}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveMcpServer}
                      disabled={mcpSaving}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50"
                    >
                      <Save className="w-3 h-3" />
                      {mcpSaving ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={cancelMcpEdit}
                      className="px-4 py-2 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* List */}
              {mcpServers.length === 0 && mcpEditing === null ? (
                <div className="text-center text-terminal-muted text-xs py-6 bg-terminal-bg rounded-lg border border-terminal-border">
                  <Server className="w-5 h-5 mx-auto mb-2 opacity-30" />
                  暂无 MCP 服务，点击「添加」接入工具
                </div>
              ) : (
                <div className="space-y-1.5">
                  {mcpServers.map(srv => (
                    <div
                      key={srv.id}
                      className="flex items-center gap-2 px-3 py-2.5 bg-terminal-bg rounded-lg border border-terminal-border group"
                    >
                      <button
                        onClick={() => toggleMcpEnabled(srv)}
                        className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${
                          srv.enabled ? 'bg-terminal-green border-terminal-green' : 'border-terminal-border'
                        }`}
                      >
                        {srv.enabled && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-terminal-text truncate">{srv.name}</div>
                        <div className="text-[10px] text-terminal-muted font-mono truncate">
                          {srv.transport === 'stdio' ? srv.command : srv.url}
                        </div>
                      </div>
                      {mcpTestResults[srv.id] && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          mcpTestResults[srv.id].ok
                            ? 'bg-terminal-green/10 text-terminal-green'
                            : 'bg-terminal-red/10 text-terminal-red'
                        }`}>
                          {mcpTestResults[srv.id].msg}
                        </span>
                      )}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => testMcpServer(srv.id)}
                          disabled={mcpTesting === srv.id}
                          title="测试连接"
                          className="text-terminal-muted hover:text-terminal-blue transition-colors text-[10px] px-1.5 py-0.5 rounded border border-terminal-border hover:border-terminal-blue"
                        >
                          {mcpTesting === srv.id ? '...' : '测试'}
                        </button>
                        <button
                          onClick={() => startMcpEdit(srv)}
                          title="编辑"
                          className="text-terminal-muted hover:text-terminal-text transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteMcpServer(srv.id)}
                          title="删除"
                          className="text-terminal-muted hover:text-terminal-red transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── 技能 tab ─────────────────────────────────────────────────── */}
          {activeTab === 'skills' && (
            <>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] text-terminal-muted">向 AI 系统提示词注入自定义指令</p>
                {skillEditing === null && (
                  <button
                    onClick={() => { setSkillEditing(''); setSkillForm({ enabled: true }); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-terminal-blue/10 hover:bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/20 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    添加
                  </button>
                )}
              </div>

              {/* Form */}
              {skillEditing !== null && (
                <div className="bg-terminal-bg rounded-lg border border-terminal-border p-3 space-y-2">
                  <div className="text-xs font-medium text-terminal-text mb-1">
                    {skillEditing ? '编辑技能' : '新建技能'}
                  </div>
                  <input
                    type="text"
                    value={skillForm.name || ''}
                    onChange={e => setSkillForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="技能名称"
                    className="w-full bg-terminal-surface border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors"
                  />
                  <input
                    type="text"
                    value={skillForm.description || ''}
                    onChange={e => setSkillForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="描述（可选）"
                    className="w-full bg-terminal-surface border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors"
                  />
                  <textarea
                    value={skillForm.systemPromptAddition || ''}
                    onChange={e => setSkillForm(f => ({ ...f, systemPromptAddition: e.target.value }))}
                    placeholder="追加到系统提示词的内容，例如：当用户问到 Docker 相关问题时，优先使用 compose v2 语法..."
                    rows={4}
                    className="w-full bg-terminal-surface border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue transition-colors resize-none font-mono"
                  />
                  {skillError && (
                    <div className="flex items-center gap-1.5 text-xs text-terminal-red">
                      <AlertCircle className="w-3 h-3" />
                      {skillError}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveSkill}
                      disabled={skillSaving}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50"
                    >
                      <Save className="w-3 h-3" />
                      {skillSaving ? '保存中...' : '保存'}
                    </button>
                    <button
                      onClick={cancelSkillEdit}
                      className="px-4 py-2 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* List */}
              {skills.length === 0 && skillEditing === null ? (
                <div className="text-center text-terminal-muted text-xs py-6 bg-terminal-bg rounded-lg border border-terminal-border">
                  <Brain className="w-5 h-5 mx-auto mb-2 opacity-30" />
                  暂无技能，点击「添加」创建自定义指令
                </div>
              ) : (
                <div className="space-y-1.5">
                  {skills.map(skill => (
                    <div
                      key={skill.id}
                      className="flex items-start gap-2 px-3 py-2.5 bg-terminal-bg rounded-lg border border-terminal-border group"
                    >
                      <button
                        onClick={() => toggleSkillEnabled(skill)}
                        className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border transition-colors mt-0.5 ${
                          skill.enabled ? 'bg-terminal-green border-terminal-green' : 'border-terminal-border'
                        }`}
                      >
                        {skill.enabled && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-terminal-text">{skill.name}</div>
                        {skill.description && (
                          <div className="text-[10px] text-terminal-muted truncate">{skill.description}</div>
                        )}
                        <div className="text-[10px] text-terminal-muted font-mono truncate mt-0.5 opacity-60">
                          {skill.systemPromptAddition.slice(0, 60)}{skill.systemPromptAddition.length > 60 ? '...' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => startSkillEdit(skill)}
                          title="编辑"
                          className="text-terminal-muted hover:text-terminal-text transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteSkill(skill.id)}
                          title="删除"
                          className="text-terminal-muted hover:text-terminal-red transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── 数据管理 tab ─────────────────────────────────────────────── */}
          {activeTab === 'data' && (
            <>
              <div className="bg-terminal-bg rounded-lg border border-terminal-border p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-terminal-green/10 border border-terminal-green/20 flex items-center justify-center flex-shrink-0">
                    <Download className="w-4 h-4 text-terminal-green" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-terminal-text">导出配置</div>
                    <div className="text-[10px] text-terminal-muted mt-0.5">
                      导出为加密 JSON 备份，包含主机列表、AI 配置、命令规则、MCP 服务和技能
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleExport}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs rounded-lg bg-terminal-green/10 hover:bg-terminal-green/20 text-terminal-green border border-terminal-green/20 transition-colors font-medium"
                >
                  <Download className="w-3.5 h-3.5" />
                  下载配置文件
                </button>
              </div>

              <div className="bg-terminal-bg rounded-lg border border-terminal-border p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-terminal-blue/10 border border-terminal-blue/20 flex items-center justify-center flex-shrink-0">
                    <Upload className="w-4 h-4 text-terminal-blue" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-terminal-text">导入配置</div>
                    <div className="text-[10px] text-terminal-muted mt-0.5">
                      从加密 JSON 备份恢复配置；若解密失败会提示错误并中止导入
                    </div>
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".enc,.json,text/plain,application/json"
                  onChange={handleImport}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs rounded-lg bg-terminal-blue/10 hover:bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/20 transition-colors font-medium disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {importing ? '导入中...' : '选择文件并导入'}
                </button>
                {importError && (
                  <div className="flex items-center gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2 mt-2">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {importError}
                  </div>
                )}
                {importSuccess && (
                  <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2 mt-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    导入成功，配置已更新
                  </div>
                )}
              </div>

              <div className="text-[10px] text-terminal-muted bg-terminal-bg rounded-lg border border-terminal-border px-3 py-2.5 leading-relaxed">
                配置文件存储在服务器 <span className="font-mono text-terminal-text">data/</span> 目录下，
                挂载为 Docker volume 可持久化数据。
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center gap-2 px-5 py-3 border-t border-terminal-border flex-shrink-0">
          {activeTab === 'ai' && (
            <>
              {showResetConfirm ? (
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-[10px] text-terminal-red leading-tight">将清除所有 API 凭据，AI 功能停止工作</span>
                  <button
                    onClick={() => setShowResetConfirm(false)}
                    className="flex-shrink-0 px-2.5 py-1 text-[10px] rounded border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleResetAI}
                    disabled={resetting}
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-[10px] rounded bg-terminal-red hover:bg-terminal-red/80 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                    {resetting ? '移除中...' : '确认移除'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="flex items-center gap-1 text-[10px] text-terminal-muted hover:text-terminal-red transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  移除配置
                </button>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || loading}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50"
                >
                  <Save className="w-3 h-3" />
                  {saving ? '保存中...' : '保存配置'}
                </button>
              </div>
            </>
          )}
          {activeTab === 'rules' && (
            <>
              <p className="text-[10px] text-terminal-muted">规则实时生效，无需重启</p>
              <button
                onClick={saveApproveSettings}
                disabled={approveSaving}
                className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50"
              >
                <Save className="w-3 h-3" />
                {approveSaving ? '保存中...' : '保存规则'}
              </button>
            </>
          )}
          {(activeTab === 'mcp' || activeTab === 'skills' || activeTab === 'data') && (
            <button
              onClick={onClose}
              className="ml-auto px-4 py-2 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
