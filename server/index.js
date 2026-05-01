'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Client: SSHClient } = require('ssh2');
const { OpenAI } = require('openai');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;

// ─── Data directory ───────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, defaultVal) {
  const p = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return defaultVal; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ─── In-memory session store ──────────────────────────────────────────────────
const sessions = new Map();

// ─── Settings ─────────────────────────────────────────────────────────────────

let aiSettings = readJSON('ai-settings.json', {
  baseUrl: '', apiKey: '', model: '', configured: false,
  terminalModel: '', enabledModels: [],
});

let autoApproveSettings = readJSON('auto-approve.json', {
  globalAutoApprove: { low: true, normal: false, high: false },
  rules: [],
});

let appSettings = readJSON('app-settings.json', {
  showStatusBar: true,
  language: 'zh-CN',
});

// GitHub Copilot auth state (persistent)
let copilotState = readJSON('copilot-auth.json', {
  githubToken: null,
  username: null,
  copilotToken: null,
  copilotTokenExpiry: 0,
  model: 'gpt-4o',
});

// Copilot device-flow in progress
let copilotDeviceFlow = null; // { device_code, interval, pollTimer, expires }

// MCP client cache (serverId → client instance)
const mcpClientCache = new Map();

// ─── Helpers ───────────────────────────────────────────────────────────────────

function matchesPattern(pattern, command) {
  const p = pattern.trim();
  if (p.startsWith('/') && p.endsWith('/') && p.length > 2) {
    try { return new RegExp(p.slice(1, -1)).test(command); } catch { return false; }
  }
  if (p.includes('*')) {
    const re = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${re}$`).test(command);
  }
  return p === command.trim();
}

function shouldAutoApprove(command, risk) {
  const execMode = aiSettings.agentExecMode;
  // Full auto mode: approve everything
  if (execMode === 'auto_approve_all') return true;
  // Ask each: never auto-approve
  if (execMode === 'ask_each') return false;
  // Whitelist mode (default): check rules only — no risk-level toggles
  const s = autoApproveSettings;
  if (s.globalAutoApprove && s.globalAutoApprove[risk]) return true;
  return (s.rules || []).some(r => r.enabled && matchesPattern(r.pattern, command));
}

function isAIConfigured() {
  if (copilotState.githubToken && copilotState.copilotToken) return true;
  // Trust the explicitly-stored `configured` flag set by the PUT endpoint
  return !!aiSettings.configured;
}

function generateToken() {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function formatPermissions(mode) {
  const oct = (mode & 0o777).toString(8).padStart(3, '0');
  const types = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  return types[parseInt(oct[0])] + types[parseInt(oct[1])] + types[parseInt(oct[2])];
}

// ─── GitHub Copilot helpers ───────────────────────────────────────────────────

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'Iv1.b507a08c87ecfe98';

async function refreshCopilotTokenIfNeeded() {
  if (!copilotState.githubToken) return null;
  const now = Date.now();
  if (copilotState.copilotToken && copilotState.copilotTokenExpiry > now + 60_000) {
    return copilotState.copilotToken;
  }
  try {
    const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
      headers: {
        Authorization: `Bearer ${copilotState.githubToken}`,
        Accept: 'application/json',
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.1',
        'User-Agent': 'ssh-ai-shell/1.0',
      },
    });
    if (!res.ok) { console.warn('Copilot token refresh failed:', res.status); return null; }
    const data = await res.json();
    copilotState.copilotToken = data.token;
    copilotState.copilotTokenExpiry = (data.expires_at ?? (now / 1000 + 1800)) * 1000;
    writeJSON('copilot-auth.json', copilotState);
    return copilotState.copilotToken;
  } catch (e) {
    console.warn('Copilot token refresh error:', e.message);
    return null;
  }
}

// ─── AI Client factory ────────────────────────────────────────────────────────

async function createAIClientAsync() {
  // Copilot takes priority if logged in
  if (copilotState.githubToken) {
    const token = await refreshCopilotTokenIfNeeded();
    if (token) {
      return new OpenAI({ apiKey: token, baseURL: 'https://api.githubcopilot.com' });
    }
  }
  if (!aiSettings.baseUrl || !aiSettings.apiKey || !aiSettings.model) return null;
  return new OpenAI({ apiKey: aiSettings.apiKey, baseURL: aiSettings.baseUrl });
}

function getActiveModel() {
  if (copilotState.githubToken && copilotState.copilotToken) return copilotState.model || 'gpt-4o';
  // Prefer the explicitly designated terminal model, fall back to the single model field
  return aiSettings.terminalModel || aiSettings.model;
}

// ─── MCP Clients ──────────────────────────────────────────────────────────────

class MCPStdioClient {
  constructor(id, command, args = [], env = {}) {
    this.id = id;
    this.command = command;
    this.args = args;
    this.env = env;
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.lineBuf = '';
    this.tools = [];
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MCP connection timeout')), 20000);
      try {
        this.proc = spawn(this.command, this.args, {
          env: { ...process.env, ...this.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (e) { clearTimeout(timeout); return reject(e); }

      this.proc.stdout.on('data', (data) => {
        this.lineBuf += data.toString();
        const lines = this.lineBuf.split('\n');
        this.lineBuf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try { this._handleMsg(JSON.parse(line.trim())); } catch {}
        }
      });

      this.proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
      this.proc.on('exit', () => {
        this.connected = false;
        for (const [, p] of this.pending) p.reject(new Error('Process exited'));
        this.pending.clear();
      });

      this._request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { sampling: {} },
        clientInfo: { name: 'ssh-ai-shell', version: '1.0' },
      }).then(() => {
        this._notify('notifications/initialized');
        return this._request('tools/list', {});
      }).then((result) => {
        this.tools = this._normalizeTools(result.tools || []);
        this.connected = true;
        clearTimeout(timeout);
        resolve(this.tools);
      }).catch((err) => { clearTimeout(timeout); reject(err); });
    });
  }

  _normalizeTools(tools) {
    return tools.map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
  }

  _handleMsg(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
      else resolve(msg.result || {});
    }
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('MCP request timeout')); }, 15000);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this._write({ jsonrpc: '2.0', method, params, id });
    });
  }

  _notify(method, params = {}) {
    this._write({ jsonrpc: '2.0', method, params });
  }

  _write(obj) {
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(JSON.stringify(obj) + '\n');
    }
  }

  async callTool(name, args) {
    return this._request('tools/call', { name, arguments: args });
  }

  disconnect() {
    try { if (this.proc) this.proc.kill(); } catch {}
    this.proc = null;
    this.connected = false;
  }
}

class MCPHttpClient {
  constructor(id, url) {
    this.id = id;
    this.url = url;
    this.nextId = 1;
    this.tools = [];
    this.connected = false;
  }

  async connect() {
    await this._rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ssh-ai-shell', version: '1.0' },
    });
    const result = await this._rpc('tools/list', {});
    this.tools = (result.tools || []).map(t => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    this.connected = true;
    return this.tools;
  }

  async _rpc(method, params) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: this.nextId++ }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result || {};
  }

  async callTool(name, args) {
    return this._rpc('tools/call', { name, arguments: args });
  }

  disconnect() { this.connected = false; }
}

async function getMCPClientCached(server) {
  const cached = mcpClientCache.get(server.id);
  if (cached?.connected) return cached;
  // Create new client
  let client;
  if (server.transport === 'stdio') {
    client = new MCPStdioClient(server.id, server.command, server.args || [], server.env || {});
  } else {
    client = new MCPHttpClient(server.id, server.url);
  }
  await client.connect();
  mcpClientCache.set(server.id, client);
  return client;
}

// ─── Express middleware ────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true }));

// ─── Hosts CRUD ──────────────────────────────────────────────────────────────

app.get('/api/hosts', (_, res) => res.json(readJSON('hosts.json', [])));

app.post('/api/hosts', (req, res) => {
  const hosts = readJSON('hosts.json', []);
  const host = {
    id: `host_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: req.body.name || `${req.body.username}@${req.body.host}`,
    host: req.body.host,
    port: req.body.port || 22,
    username: req.body.username,
    password: req.body.password || '',
    privateKey: req.body.privateKey || '',
    group: req.body.group || '',
    createdAt: new Date().toISOString(),
    lastConnectedAt: null,
  };
  hosts.push(host);
  writeJSON('hosts.json', hosts);
  res.json(host);
});

app.put('/api/hosts/:id', (req, res) => {
  const hosts = readJSON('hosts.json', []);
  const idx = hosts.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  hosts[idx] = { ...hosts[idx], ...req.body };
  writeJSON('hosts.json', hosts);
  res.json(hosts[idx]);
});

app.delete('/api/hosts/:id', (req, res) => {
  const hosts = readJSON('hosts.json', []);
  writeJSON('hosts.json', hosts.filter(h => h.id !== req.params.id));
  res.json({ ok: true });
});

// Upsert: find by id (if provided) or by host+port+username; create if not found.
// Always sets lastConnectedAt to now.
app.post('/api/hosts/upsert', (req, res) => {
  const hosts = readJSON('hosts.json', []);
  const { host, port, username, password, privateKey, name, group, id } = req.body;
  const portNum = Number(port) || 22;
  let idx = id ? hosts.findIndex(h => h.id === id) : -1;
  if (idx === -1) idx = hosts.findIndex(h => h.host === host && h.port === portNum && h.username === username);
  if (idx !== -1) {
    hosts[idx] = {
      ...hosts[idx],
      ...(name && { name }),
      ...(password !== undefined && { password }),
      ...(privateKey !== undefined && { privateKey }),
      ...(group !== undefined && { group }),
      lastConnectedAt: new Date().toISOString(),
    };
    writeJSON('hosts.json', hosts);
    return res.json(hosts[idx]);
  }
  const newHost = {
    id: `host_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name || `${username}@${host}`,
    host, port: portNum, username,
    password: password || '', privateKey: privateKey || '',
    group: group || '',
    createdAt: new Date().toISOString(),
    lastConnectedAt: new Date().toISOString(),
  };
  hosts.push(newHost);
  writeJSON('hosts.json', hosts);
  res.json(newHost);
});

// Bulk import: skip hosts that already exist (same host+port+username).
app.post('/api/hosts/import', (req, res) => {
  const hosts = readJSON('hosts.json', []);
  const incoming = Array.isArray(req.body) ? req.body : (req.body.hosts || []);
  let added = 0, skipped = 0;
  for (const h of incoming) {
    if (!h.host || !h.username) { skipped++; continue; }
    const portNum = Number(h.port) || 22;
    const exists = hosts.find(x => x.host === h.host && x.port === portNum && x.username === h.username);
    if (exists) { skipped++; continue; }
    hosts.push({
      id: `host_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: h.name || `${h.username}@${h.host}`,
      host: h.host, port: portNum, username: h.username,
      password: h.password || '', privateKey: h.privateKey || '',
      group: h.group || '',
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
    });
    added++;
  }
  writeJSON('hosts.json', hosts);
  res.json({ added, skipped, total: hosts.length });
});

// ─── Groups CRUD ──────────────────────────────────────────────────────────────

// Groups are standalone named group paths (stored separately from hosts).
// This allows creating empty groups before any hosts are assigned to them.

app.get('/api/groups', (_, res) => res.json(readJSON('groups.json', [])));

app.post('/api/groups', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const groups = readJSON('groups.json', []);
  if (!groups.includes(name)) { groups.push(name); writeJSON('groups.json', groups); }
  res.json({ ok: true, name });
});

app.delete('/api/groups/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const groups = readJSON('groups.json', []);
  writeJSON('groups.json', groups.filter(g => g !== name));
  res.json({ ok: true });
});

// ─── AI Settings ──────────────────────────────────────────────────────────────

app.get('/api/ai-settings', (_, res) => {
  res.json({
    ...aiSettings,
    configured: isAIConfigured(),
    copilot: {
      loggedIn: !!(copilotState.githubToken),
      username: copilotState.username,
      model: copilotState.model,
    },
  });
});

app.put('/api/ai-settings', (req, res) => {
  const updatable = ['baseUrl', 'apiKey', 'model', 'terminalModel', 'enabledModels', 'enableCommandExplain', 'enableAIAssistant', 'enableAutoComplete', 'agentExecMode', 'commandWhitelist'];
  for (const k of updatable) {
    if (req.body[k] !== undefined) aiSettings[k] = req.body[k];
  }
  // Recompute `configured`: all three required fields must be non-empty strings
  aiSettings.configured = !!(
    (aiSettings.baseUrl || '').trim() &&
    (aiSettings.apiKey  || '').trim() &&
    (aiSettings.model   || '').trim()
  );
  writeJSON('ai-settings.json', aiSettings);
  res.json({ ...aiSettings, configured: isAIConfigured() });
});

// Reset AI credentials — clears provider/key/models but keeps behaviour prefs
app.delete('/api/ai-settings', (req, res) => {
  aiSettings = {
    baseUrl: '',
    apiKey: '',
    model: '',
    terminalModel: '',
    enabledModels: [],
    configured: false,
    // Preserve behaviour preferences
    enableCommandExplain: aiSettings.enableCommandExplain ?? true,
    enableAIAssistant:    aiSettings.enableAIAssistant    ?? true,
    enableAutoComplete:   aiSettings.enableAutoComplete   ?? true,
    agentExecMode:        aiSettings.agentExecMode        ?? 'ask_each',
    commandWhitelist:     aiSettings.commandWhitelist     ?? [],
  };
  writeJSON('ai-settings.json', aiSettings);
  res.json({ ...aiSettings, configured: false });
});

// ─── AI Chat (HTTP SSE) ───────────────────────────────────────────────────────

app.post('/api/ai/chat', async (req, res) => {
  const { model, messages, systemPrompt } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  const client = await createAIClientAsync();
  if (!client) return res.status(503).json({ error: 'AI 未配置，请先在设置中配置 AI 服务' });

  const activeModel = model || getActiveModel();
  if (!activeModel) return res.status(400).json({ error: '未指定模型' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sysMsg = systemPrompt || '你是一个有帮助的 AI 助手。';

  try {
    const stream = await client.chat.completions.create({
      model: activeModel,
      max_tokens: 4096,
      messages: [{ role: 'system', content: sysMsg }, ...messages],
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason) {
        res.write(`data: ${JSON.stringify({ done: true, finishReason })}\n\n`);
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message || '请求失败' })}\n\n`);
  } finally {
    res.end();
  }
});

// ─── Auto-approve ─────────────────────────────────────────────────────────────

app.get('/api/auto-approve', (_, res) => res.json(autoApproveSettings));

app.put('/api/auto-approve', (req, res) => {
  autoApproveSettings = {
    globalAutoApprove: req.body.globalAutoApprove || autoApproveSettings.globalAutoApprove,
    rules: req.body.rules !== undefined ? req.body.rules : autoApproveSettings.rules,
  };
  writeJSON('auto-approve.json', autoApproveSettings);
  res.json(autoApproveSettings);
});

// ─── App Settings ──────────────────────────────────────────────────────────────

app.get('/api/app-settings', (_, res) => res.json(appSettings));

app.put('/api/app-settings', (req, res) => {
  const allowedKeys = ['showStatusBar', 'language'];
  for (const k of allowedKeys) {
    if (req.body[k] !== undefined) appSettings[k] = req.body[k];
  }
  writeJSON('app-settings.json', appSettings);
  res.json(appSettings);
});

// ─── Test AI connection + fetch models ────────────────────────────────────────

app.post('/api/test-ai-connection', async (req, res) => {
  const { baseUrl, apiKey, model } = req.body;
  if (!baseUrl || !apiKey) return res.status(400).json({ error: 'baseUrl and apiKey required' });

  const result = { ok: false, models: [], error: null, modelTest: null };

  // 1. Try to list models
  try {
    const modelsRes = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (modelsRes.ok) {
      const data = await modelsRes.json();
      const list = data.data || data.models || [];
      result.models = list.map(m => (typeof m === 'string' ? m : m.id || m.name || '')).filter(Boolean).sort();
    }
  } catch {}

  // 2. Test a specific model with a small message
  const testModel = model || result.models[0];
  if (testModel) {
    try {
      const t0 = Date.now();
      const client = new OpenAI({ apiKey, baseURL: baseUrl });
      const resp = await client.chat.completions.create({
        model: testModel,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      });
      result.modelTest = { ok: !!(resp.choices?.[0]), latencyMs: Date.now() - t0 };
      result.ok = true;
    } catch (e) {
      result.error = e.message;
    }
  } else {
    result.ok = result.models.length > 0;
    if (!result.ok) result.error = '无法连接到 API 服务';
  }

  res.json(result);
});

// Test a single model (quick ping)
app.post('/api/test-model', async (req, res) => {
  const { baseUrl, apiKey, model, isCopilot } = req.body;
  try {
    let client;
    if (isCopilot) {
      const token = await refreshCopilotTokenIfNeeded();
      if (!token) return res.json({ ok: false, error: 'Copilot not authenticated' });
      client = new OpenAI({ apiKey: token, baseURL: 'https://api.githubcopilot.com' });
    } else {
      if (!baseUrl || !apiKey) return res.status(400).json({ error: 'missing params' });
      client = new OpenAI({ apiKey, baseURL: baseUrl });
    }
    const t0 = Date.now();
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    });
    res.json({ ok: !!(resp.choices?.[0]), latencyMs: Date.now() - t0 });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── GitHub Copilot OAuth (device flow) ──────────────────────────────────────

app.get('/api/copilot/status', async (_, res) => {
  const loggedIn = !!(copilotState.githubToken);
  let models = [];
  if (loggedIn) {
    try {
      const token = await refreshCopilotTokenIfNeeded();
      if (token) {
        const r = await fetch('https://api.githubcopilot.com/models', {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Copilot-Integration-Id': 'vscode-chat',
          },
        });
        if (r.ok) {
          const d = await r.json();
          models = (d.data || d.models || []).map(m => m.id || m.name).filter(Boolean);
        }
      }
    } catch {}
  }
  res.json({ loggedIn, username: copilotState.username, model: copilotState.model, models });
});

app.post('/api/copilot/device-start', async (_, res) => {
  try {
    // Cancel any existing flow
    if (copilotDeviceFlow?.pollTimer) clearInterval(copilotDeviceFlow.pollTimer);
    copilotDeviceFlow = null;

    const r = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'read:user' }),
    });
    if (!r.ok) throw new Error(`GitHub API error: ${r.status}`);
    const data = await r.json();

    copilotDeviceFlow = {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires: Date.now() + (data.expires_in || 900) * 1000,
      interval: (data.interval || 5) * 1000,
      status: 'waiting',
      pollTimer: null,
    };

    // Start polling
    copilotDeviceFlow.pollTimer = setInterval(async () => {
      if (!copilotDeviceFlow || Date.now() > copilotDeviceFlow.expires) {
        clearInterval(copilotDeviceFlow?.pollTimer);
        copilotDeviceFlow = null;
        return;
      }
      try {
        const pr = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: copilotDeviceFlow.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });
        const pd = await pr.json();
        if (pd.access_token) {
          clearInterval(copilotDeviceFlow.pollTimer);
          copilotState.githubToken = pd.access_token;
          // Fetch username
          const uRes = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${pd.access_token}`, Accept: 'application/json' },
          });
          if (uRes.ok) {
            const u = await uRes.json();
            copilotState.username = u.login;
          }
          copilotState.copilotToken = null; // force refresh
          copilotState.copilotTokenExpiry = 0;
          copilotState.model = copilotState.model || 'gpt-4o';
          writeJSON('copilot-auth.json', copilotState);
          copilotDeviceFlow.status = 'success';
        } else if (pd.error && pd.error !== 'authorization_pending' && pd.error !== 'slow_down') {
          clearInterval(copilotDeviceFlow.pollTimer);
          copilotDeviceFlow.status = 'error';
          copilotDeviceFlow.error = pd.error_description || pd.error;
        }
      } catch {}
    }, copilotDeviceFlow.interval);

    res.json({
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/copilot/device-poll', (_, res) => {
  if (!copilotDeviceFlow) return res.json({ status: 'none' });
  res.json({
    status: copilotDeviceFlow.status,
    username: copilotState.username,
    error: copilotDeviceFlow.error,
  });
});

app.put('/api/copilot/model', (req, res) => {
  const { model } = req.body;
  if (model) { copilotState.model = model; writeJSON('copilot-auth.json', copilotState); }
  res.json({ ok: true, model: copilotState.model });
});

app.delete('/api/copilot/logout', (_, res) => {
  if (copilotDeviceFlow?.pollTimer) clearInterval(copilotDeviceFlow.pollTimer);
  copilotDeviceFlow = null;
  copilotState = { githubToken: null, username: null, copilotToken: null, copilotTokenExpiry: 0, model: 'gpt-4o' };
  writeJSON('copilot-auth.json', copilotState);
  // Clear from MCP cache etc.
  res.json({ ok: true });
});

// ─── Saved Commands CRUD ──────────────────────────────────────────────────────

app.get('/api/saved-commands', (_, res) => res.json(readJSON('saved-commands.json', [])));

app.post('/api/saved-commands', (req, res) => {
  const cmds = readJSON('saved-commands.json', []);
  const cmd = {
    id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: req.body.name || '未命名命令',
    content: req.body.content || '',
    type: req.body.type || 'shell', // 'shell' | 'natural' | 'script'
    shortcut: req.body.shortcut || '',
    createdAt: new Date().toISOString(),
  };
  cmds.push(cmd);
  writeJSON('saved-commands.json', cmds);
  res.json(cmd);
});

app.put('/api/saved-commands/:id', (req, res) => {
  const cmds = readJSON('saved-commands.json', []);
  const idx = cmds.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  cmds[idx] = { ...cmds[idx], ...req.body };
  writeJSON('saved-commands.json', cmds);
  res.json(cmds[idx]);
});

app.delete('/api/saved-commands/:id', (req, res) => {
  const cmds = readJSON('saved-commands.json', []);
  writeJSON('saved-commands.json', cmds.filter(c => c.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/saved-commands/:id/usage', (req, res) => {
  const cmds = readJSON('saved-commands.json', []);
  const idx = cmds.findIndex(c => c.id === req.params.id);
  if (idx !== -1) {
    cmds[idx].usageCount = (cmds[idx].usageCount || 0) + 1;
    writeJSON('saved-commands.json', cmds);
  }
  res.json({ ok: true });
});

// ─── Command History CRUD ─────────────────────────────────────────────────────

app.get('/api/command-history', (req, res) => {
  const all = readJSON('command-history.json', []);
  const { host } = req.query;
  res.json(host ? all.filter(e => e.host === host) : all);
});

app.post('/api/command-history', (req, res) => {
  const { command, host } = req.body;
  if (!command?.trim()) return res.status(400).json({ error: 'command required' });
  const all = readJSON('command-history.json', []);
  // Deduplicate: remove existing same command+host entry so the new one sorts first
  const filtered = all.filter(e => !(e.command === command.trim() && e.host === host));
  const entry = {
    id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    command: command.trim(),
    host: host || '',
    timestamp: new Date().toISOString(),
  };
  writeJSON('command-history.json', [entry, ...filtered].slice(0, 2000));
  res.json(entry);
});

// Delete a single entry
app.delete('/api/command-history/:id', (req, res) => {
  const all = readJSON('command-history.json', []);
  writeJSON('command-history.json', all.filter(e => e.id !== req.params.id));
  res.json({ ok: true });
});

// Clear all entries for a host (or all entries when no host param)
app.delete('/api/command-history', (req, res) => {
  const { host } = req.query;
  const all = readJSON('command-history.json', []);
  writeJSON('command-history.json', host ? all.filter(e => e.host !== host) : []);
  res.json({ ok: true });
});

// ─── MCP Servers CRUD ─────────────────────────────────────────────────────────

app.get('/api/mcp-servers', (_, res) => res.json(readJSON('mcp-servers.json', [])));

app.post('/api/mcp-servers', (req, res) => {
  const servers = readJSON('mcp-servers.json', []);
  const s = {
    id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: req.body.name || '新 MCP 服务',
    transport: req.body.transport || 'stdio',
    command: req.body.command || '',
    args: req.body.args || [],
    env: req.body.env || {},
    url: req.body.url || '',
    enabled: req.body.enabled !== false,
    description: req.body.description || '',
  };
  servers.push(s);
  writeJSON('mcp-servers.json', servers);
  res.json(s);
});

app.put('/api/mcp-servers/:id', (req, res) => {
  const servers = readJSON('mcp-servers.json', []);
  const idx = servers.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  servers[idx] = { ...servers[idx], ...req.body };
  writeJSON('mcp-servers.json', servers);
  // Disconnect cached client so it reconnects with new config
  const cached = mcpClientCache.get(req.params.id);
  if (cached) { try { cached.disconnect(); } catch {} mcpClientCache.delete(req.params.id); }
  res.json(servers[idx]);
});

app.delete('/api/mcp-servers/:id', (req, res) => {
  const servers = readJSON('mcp-servers.json', []);
  writeJSON('mcp-servers.json', servers.filter(s => s.id !== req.params.id));
  const cached = mcpClientCache.get(req.params.id);
  if (cached) { try { cached.disconnect(); } catch {} mcpClientCache.delete(req.params.id); }
  res.json({ ok: true });
});

// Test MCP server connection and return tool list
app.post('/api/mcp-servers/:id/test', async (req, res) => {
  const servers = readJSON('mcp-servers.json', []);
  const server = servers.find(s => s.id === req.params.id);
  if (!server) return res.status(404).json({ error: 'Not found' });

  // Disconnect cached client to force fresh connection
  const cached = mcpClientCache.get(server.id);
  if (cached) { try { cached.disconnect(); } catch {} mcpClientCache.delete(server.id); }

  try {
    const client = await getMCPClientCached(server);
    res.json({ ok: true, tools: client.tools });
  } catch (e) {
    res.json({ ok: false, error: e.message, tools: [] });
  }
});

// ─── Skills CRUD ──────────────────────────────────────────────────────────────

app.get('/api/skills', (_, res) => res.json(readJSON('skills.json', [])));

app.post('/api/skills', (req, res) => {
  const skills = readJSON('skills.json', []);
  const skill = {
    id: `skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: req.body.name || '新技能',
    description: req.body.description || '',
    systemPromptAddition: req.body.systemPromptAddition || '',
    triggerKeywords: req.body.triggerKeywords || [],
    enabled: req.body.enabled !== false,
    createdAt: new Date().toISOString(),
  };
  skills.push(skill);
  writeJSON('skills.json', skills);
  res.json(skill);
});

app.put('/api/skills/:id', (req, res) => {
  const skills = readJSON('skills.json', []);
  const idx = skills.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  skills[idx] = { ...skills[idx], ...req.body };
  writeJSON('skills.json', skills);
  res.json(skills[idx]);
});

app.delete('/api/skills/:id', (req, res) => {
  const skills = readJSON('skills.json', []);
  writeJSON('skills.json', skills.filter(s => s.id !== req.params.id));
  res.json({ ok: true });
});

// ─── Export / Import ──────────────────────────────────────────────────────────

app.get('/api/export-settings', (_, res) => {
  const data = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    hosts: readJSON('hosts.json', []),
    aiSettings: readJSON('ai-settings.json', {}),
    autoApprove: readJSON('auto-approve.json', {}),
    appSettings: readJSON('app-settings.json', {}),
    savedCommands: readJSON('saved-commands.json', []),
    mcpServers: readJSON('mcp-servers.json', []),
    skills: readJSON('skills.json', []),
  };
  res.setHeader('Content-Type', 'application/json');
  res.json(data);
});

app.post('/api/import-settings', (req, res) => {
  try {
    const { hosts, aiSettings: ai, autoApprove, appSettings: appS, savedCommands, mcpServers, skills } = req.body;
    if (Array.isArray(hosts)) writeJSON('hosts.json', hosts);
    if (ai && typeof ai === 'object') { writeJSON('ai-settings.json', ai); Object.assign(aiSettings, ai); }
    if (autoApprove) { writeJSON('auto-approve.json', autoApprove); autoApproveSettings = autoApprove; }
    if (appS && typeof appS === 'object') { writeJSON('app-settings.json', appS); Object.assign(appSettings, appS); }
    if (Array.isArray(savedCommands)) writeJSON('saved-commands.json', savedCommands);
    if (Array.isArray(mcpServers)) writeJSON('mcp-servers.json', mcpServers);
    if (Array.isArray(skills)) writeJSON('skills.json', skills);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── SFTP HTTP endpoints ──────────────────────────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

app.get('/api/sftp/download', (req, res) => {
  const { token, path: filePath } = req.query;
  if (!token || !filePath) return res.status(400).json({ error: 'Missing params' });
  const session = sessions.get(token);
  if (!session?.sftp) return res.status(401).json({ error: 'Session not found' });
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  const readStream = session.sftp.createReadStream(filePath);
  readStream.on('error', (e) => res.status(500).json({ error: e.message }));
  readStream.pipe(res);
});

app.post('/api/sftp/upload', upload.single('file'), (req, res) => {
  const { token, path: uploadPath } = req.query;
  if (!token || !uploadPath) return res.status(400).json({ error: 'Missing params' });
  const session = sessions.get(token);
  if (!session?.sftp) return res.status(401).json({ error: 'Session not found' });
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const targetPath = uploadPath.endsWith('/')
    ? uploadPath + req.file.originalname
    : uploadPath + '/' + req.file.originalname;

  const buf = req.file.buffer;
  const total = buf.length;
  const filename = req.file.originalname;
  const sessionWs = session.ws;
  const CHUNK = 64 * 1024; // 64 KB per chunk
  let sent = 0;

  function sendProgress(bytes) {
    if (sessionWs?.readyState === 1 /* OPEN */) {
      sessionWs.send(JSON.stringify({
        type: 'sftp_upload_progress',
        payload: {
          percent: total > 0 ? Math.min(100, Math.round((bytes / total) * 100)) : 100,
          bytes,
          total,
          filename,
        },
      }));
    }
  }

  const writeStream = session.sftp.createWriteStream(targetPath);
  writeStream.on('close', () => res.json({ ok: true, path: targetPath }));
  writeStream.on('error', (e) => res.status(500).json({ error: e.message }));

  function writeNextChunk() {
    if (sent >= total) {
      sendProgress(total);
      writeStream.end();
      return;
    }
    const end = Math.min(sent + CHUNK, total);
    const chunk = buf.slice(sent, end);
    sent = end;
    sendProgress(sent);
    if (!writeStream.write(chunk)) {
      writeStream.once('drain', writeNextChunk);
    } else {
      setImmediate(writeNextChunk);
    }
  }

  writeNextChunk();
});

// ─── Static frontend ──────────────────────────────────────────────────────────

const distDir = path.join(__dirname, '../dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  app.get('*', (_, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// ─── Input classifier ────────────────────────────────────────────────────────

function classifyInput(text) {
  const t = text.trim();
  if (!t) return 'shell';
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(t)) return 'natural';
  if (/^[./~]/.test(t)) return 'shell';
  if (/[|>&;`$()]/.test(t)) return 'shell';
  if (/^\w+=/.test(t)) return 'shell';

  const knownCmds = new Set([
    'ls','ll','la','cd','pwd','cat','echo','grep','egrep','fgrep','find','mkdir','rmdir',
    'rm','cp','mv','touch','chmod','chown','chgrp','ln','stat','file','du','df','free',
    'ps','top','htop','kill','killall','pkill','pgrep','jobs','fg','bg','nohup',
    'sudo','su','useradd','userdel','usermod','passwd','groupadd','groupdel',
    'apt','apt-get','apt-cache','yum','dnf','rpm','dpkg','brew','snap','flatpak',
    'pip','pip3','conda','npm','yarn','pnpm','npx','node','python','python3',
    'java','javac','mvn','gradle','go','cargo','rustc',
    'git','svn','hg',
    'docker','docker-compose','kubectl','helm','minikube','k3s',
    'systemctl','service','journalctl','cron','crontab',
    'ssh','scp','sftp','rsync','wget','curl','ping','traceroute','netstat','ss','ip',
    'ifconfig','iptables','firewall-cmd','nmap','nc','telnet','dig','nslookup',
    'tar','gzip','gunzip','zip','unzip','bzip2','xz','7z',
    'vim','vi','nano','emacs','less','more','head','tail','sort','uniq','wc','cut',
    'tr','tee','xargs','awk','sed','diff','patch','column','jq','yq',
    'make','cmake','gcc','g++','cc','ld','nm','objdump',
    'mount','umount','fdisk','parted','lsblk','blkid',
    'uname','hostname','whoami','id','uptime','date','cal','history','alias','which',
    'whereis','type','source','export','env','printenv','set','unset',
    'clear','reset','exit','logout','reboot','shutdown','halt','poweroff','init',
    'screen','tmux','nohup','watch','time','timeout',
    'mysql','psql','redis-cli','mongo','sqlite3',
    'nginx','apache2','httpd','php','perl','ruby','rake','bundle',
  ]);

  const words = t.split(/\s+/);
  const firstWord = words[0].toLowerCase().replace(/^.*\//, '');
  if (knownCmds.has(firstWord)) return 'shell';
  if (/^\S+$/.test(t) && /^[a-zA-Z0-9_.-]+$/.test(t)) return 'shell';
  // CLI flags anywhere → shell (e.g. "ssh-keygen -t rsa", "git commit --amend")
  if (/(?:^|\s)--?[a-zA-Z]/.test(t)) return 'shell';
  // Hyphenated first word → shell (e.g. "ssh-keygen foo", "apt-get install")
  if (/^[a-zA-Z]+-[a-zA-Z]/.test(words[0])) return 'shell';
  // Uppercase start only counts as natural language when it's a sentence (≥3 words)
  if (/^[A-Z]/.test(t) && words.length >= 3) return 'natural';
  // 4+ words without any shell indicators → natural
  if (words.length >= 4) return 'natural';
  return 'shell';
}

// ─── Risk classifier ──────────────────────────────────────────────────────────

function getRisk(cmd) {
  const c = cmd.trim();
  const HIGH = [
    /\bsudo\b/, /\bsu\s/, /\bsu$/, /\bdoas\b/,
    /\brm\b.*-[rRfF]*r[rRfF]*/, /\brm\b.*\/(?!tmp\/[^/]+$)/,
    /\bdd\b.*\bof=\/dev/, /\bdd\b.*\bof=\/[a-z]/,
    /\bmkfs\b/, /\bwipefs\b/, /\bshred\b/,
    /\bfdisk\b/, /\bparted\b/, /\bcfdisk\b/,
    /\bkill\b/, /\bkillall\b/, /\bpkill\b/,
    /\breboot\b/, /\bshutdown\b/, /\bhalt\b/, /\bpoweroff\b/, /\binit\s*[016]/,
    /\bsystemctl\b.*(stop|disable|mask|kill)/,
    /\biptables\b.*-[FXZ]/, /\bufw\b.*(disable|delete)/,
    /\bcurl\b.*\|\s*(bash|sh|zsh|fish)/, /\bwget\b.*\|\s*(bash|sh)/,
    />(\/etc\/|\/boot\/|\/sys\/|\/proc\/)/, /\btruncate\b/,
  ];
  if (HIGH.some(p => p.test(c))) return 'high';

  const LOW = [
    /^ls(\s|$)/, /^ll(\s|$)/, /^la(\s|$)/,
    /^cat\s(?!\/etc\/shadow|\/etc\/passwd)/, /^bat\s/,
    /^pwd(\s|$)/, /^whoami(\s|$)/, /^id(\s|$)/,
    /^uname(\s|$)/, /^hostname(\s|$)/, /^uptime(\s|$)/,
    /^date(\s|$)/, /^cal(\s|$)/,
    /^df(\s|$)/, /^free(\s|$)/, /^du\s.*-[shd]/,
    /^ps(\s|$)/, /^top(\s|$)/, /^htop(\s|$)/,
    /^env(\s|$)/, /^printenv(\s|$)/, /^echo(\s|$)/,
    /^grep(\s|$)/, /^egrep(\s|$)/, /^find\s(?!.*-exec\s.*rm)/,
    /^which(\s|$)/, /^whereis(\s|$)/, /^type(\s|$)/,
    /^head(\s|$)/, /^tail\s(?!.*-f.*>)/, /^less(\s|$)/, /^more(\s|$)/,
    /^wc(\s|$)/, /^sort(\s|$)/, /^uniq(\s|$)/,
    /^git\s(log|status|diff|show|branch|tag|remote\s+-v|describe)/,
    /^docker\s(ps|images|logs|inspect|stats)/,
    /^kubectl\s(get|describe|logs)/,
    /^ping(\s|$)/, /^dig(\s|$)/, /^nslookup(\s|$)/,
    /^ss(\s|$)/, /^netstat(\s|$)/,
    /^jq(\s|$)/, /^yq(\s|$)/,
    /^lsblk(\s|$)/, /^blkid(\s|$)/, /^history(\s|$)/,
  ];
  if (LOW.some(p => p.test(c))) return 'low';
  return 'normal';
}

// ─── Fallback command extractor (from markdown code blocks) ──────────────────

function looksLikeShellCommandLine(line) {
  const candidate = line
    .trim()
    .replace(/^\$\s*/, '')
    .replace(/^#\s*(?=\S)/, '');

  if (!candidate) return false;
  if (/^[-*•]\s+/.test(candidate)) return false;
  if (/^[\u4e00-\u9fff]/.test(candidate)) return false;

  return /^(?:sudo\s+)?(?:[A-Za-z_][\w.-]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*(?:\.{0,2}\/|~\/|\/|[A-Za-z]:\\|[A-Za-z_][\w.-]*)(?:\s|$|['"])/.test(candidate);
}

function normalizeExtractedCommand(raw) {
  if (!raw) return null;

  const stripped = raw
    .replace(/\r/g, '')
    .replace(/^```(?:bash|sh|shell|zsh|fish|cmd)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!stripped) return null;

  const lines = stripped.split('\n');
  const collected = [];

  for (const line of lines) {
    const candidate = line
      .trimEnd()
      .replace(/^\s*\$\s*/, '')
      .replace(/^\s*#\s*(?=\S)/, '');

    if (!candidate.trim()) {
      if (collected.length > 0) break;
      continue;
    }

    if (collected.length === 0) {
      if (!looksLikeShellCommandLine(candidate)) continue;
      collected.push(candidate.trim());
      continue;
    }

    if (/^[\u4e00-\u9fff]/.test(candidate.trim())) break;
    if (/^[-*•]\s+/.test(candidate.trim())) break;
    collected.push(candidate.trim());
  }

  if (collected.length === 0) return null;
  return collected.join('\n').trim();
}

/**
 * When the AI skips the <command> tag format, we still want to surface a
 * CommandCard. This extractor accepts a few common degraded formats, including
 * incomplete <command> tags that can happen in streaming output.
 */
function extractCommandFromText(text) {
  // ── 1. <command> tag (well-formed or truncated at end of reply) ─────────────
  const looseTagRe = /<command(?:\s+[^>]*)?>([\s\S]*?)(?:<\/command>|$)/i;
  const tagMatch = text.match(looseTagRe);
  const tagged = normalizeExtractedCommand(tagMatch?.[1]);
  if (tagged) return tagged;

  // ── 2. Fenced code blocks: ```[lang]\n...\n``` ───────────────────────────
  const codeBlockRe = /```(?:bash|sh|shell|zsh|fish|cmd)?\s*\n([\s\S]+?)\n```/gi;
  let match;
  while ((match = codeBlockRe.exec(text)) !== null) {
    const fromCodeBlock = normalizeExtractedCommand(match[1]);
    if (fromCodeBlock) return fromCodeBlock;
  }

  // ── 3. Inline backtick after Chinese command-prompt phrases ─────────────────
  const inlinePromptRe = /(?:执行(?:以下|如下)?命令|运行(?:以下|如下)?命令|执行|运行)[：:]\s*`([^`\n]{2,200})`/;
  const inlineM = text.match(inlinePromptRe);
  const inlineCmd = normalizeExtractedCommand(inlineM?.[1]);
  if (inlineCmd) return inlineCmd;

  // ── 4. Backtick-only command on the following line ──────────────────────────
  const endingBacktickRe = /[：:]\s*\n`([^`\n]{2,200})`\s*$/;
  const endBt = text.match(endingBacktickRe);
  const endingCmd = normalizeExtractedCommand(endBt?.[1]);
  if (endingCmd) return endingCmd;

  // ── 5. Plain text command on its own line after a Chinese prompt ────────────
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].trim();
    if (/(?:执行(?:以下|如下)?命令|运行(?:以下|如下)?命令|执行|运行)[：:]?$/.test(cur)) {
      const windowText = lines.slice(i + 1, Math.min(i + 6, lines.length)).join('\n');
      const plainCmd = normalizeExtractedCommand(windowText);
      if (plainCmd) return plainCmd;
    }
  }

  // ── 6. Final standalone shell-like line near the end of the reply ───────────
  const tailWindow = lines.slice(-4).join('\n');
  const tailCmd = normalizeExtractedCommand(tailWindow);
  if (tailCmd) return tailCmd;

  return null;
}

// ─── Strip ANSI ───────────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[()][AB012]/g, '')
            .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '');
}

// ─── AI Streaming ─────────────────────────────────────────────────────────────

async function* streamAI(systemPrompt, messages, signal) {
  const client = await createAIClientAsync();
  if (!client) throw new Error('AI 未配置，请先在设置中配置 AI 服务');

  const model = getActiveModel();
  const stream = await client.chat.completions.create({
    model,
    max_tokens: 2048,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream: true,
    ...(signal ? { signal } : {}),
  });

  for await (const chunk of stream) {
    if (signal?.aborted) return;
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
}

// ─── WebSocket handler ────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  let sshClient = null;
  let sshStream = null;
  let sftpSession = null;
  let sessionToken = null;

  let aiHistory = [];
  let shellCtx = { user: '', host: '', cwd: '~', os: 'Linux' };
  const pendingConfirms = new Map();
  let captureState = null;
  let aiAbortController = null;

  // Buffer for batching rapid SSH data chunks → fewer React renders
  let outputBuf = '';
  let outputTimer = null;
  function flushOutput() {
    outputTimer = null;
    if (outputBuf) { send('terminal_output', { data: outputBuf }); outputBuf = ''; }
  }

  // MCP tools available for this session
  let sessionMcpTools = [];

  function send(type, payload = {}) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, payload }));
  }

  function sendLog(message, level = 'info') {
    const prefix = { step: '→', ok: '✓', warn: '⚠', error: '✗', cmd: '❯', info: '·' }[level] ?? '·';
    console.log(`[AI ${level.toUpperCase().padEnd(5)}] ${prefix} ${message}`);
    send('ai_log', { message, level });
  }

  function updateCtx(line) {
    const m1 = line.match(/\[([^@\]]+)@([^\s\]]+)\s+([^\]]+)\][\$#]/);
    if (m1) { shellCtx.user = m1[1]; shellCtx.host = m1[2]; shellCtx.cwd = m1[3]; return; }
    const m2 = line.match(/([^@]+)@([^:]+):([^\$#]+)[\$#]/);
    if (m2) { shellCtx.user = m2[1]; shellCtx.host = m2[2]; shellCtx.cwd = m2[3]; }
  }

  // Regex to detect any line that contains our capture markers (all start with SSHAI_)
  const MARKER_RE = /SSHAI_\d+_END/;

  function filterMarkerLines(text) {
    const lines = text.split('\n');
    const filtered = lines.filter(l => !MARKER_RE.test(l));
    return filtered.join('\n');
  }

  function onSshData(data) {
    const text = data.toString();
    for (const line of text.split('\n')) updateCtx(line);

    if (captureState) {
      // Flush any pending buffered output first so ordering is preserved
      if (outputBuf) { clearTimeout(outputTimer); flushOutput(); }
      captureState.buffer += text;
      if (captureState.buffer.includes(captureState.marker)) {
        const fullBuf = captureState.buffer;
        const { marker, resolve } = captureState;
        captureState = null;
        const exitMatch = fullBuf.match(new RegExp(marker + ':(\\d+)'));
        const exitCode = exitMatch ? parseInt(exitMatch[1]) : 0;
        const stripped = stripAnsi(fullBuf);
        const lines = stripped.split('\n');
        const outputLines = [];
        let recording = false;
        for (const line of lines) {
          const plain = line.replace(/\r/g, '');
          if (!recording && MARKER_RE.test(plain)) continue;
          if (!recording) { recording = true; continue; }
          if (plain.includes(marker)) break;
          outputLines.push(plain);
        }
        resolve({ output: outputLines.join('\n').trim(), exitCode });
        // Filter ALL marker-related content before sending to terminal
        const cleanText = filterMarkerLines(text);
        if (cleanText.trim()) send('terminal_output', { data: cleanText });
        return;
      }
      // Still accumulating — filter marker lines from partial output
      const cleanText = filterMarkerLines(text);
      if (cleanText.trim()) send('terminal_output', { data: cleanText });
      return;
    }

    // Normal path: buffer for 16 ms so rapid successive chunks are merged into
    // a single WebSocket message → single React render → snappier feel
    outputBuf += text;
    if (!outputTimer) outputTimer = setTimeout(flushOutput, 16);
  }

  function executeAndCapture(command) {
    return new Promise((resolve) => {
      const marker = `SSHAI_${Date.now()}_END`;
      const wrapped = `(${command}); echo "${marker}:$?"`;
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; captureState = null; resolve({ output: '(超时)', exitCode: -1 }); }
      }, 30000);
      captureState = {
        marker, buffer: '',
        resolve: (result) => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(result); } },
      };
      sshStream.write(wrapped + '\r');
    });
  }

  // Load MCP tools for this session
  async function loadSessionMcpTools() {
    const servers = readJSON('mcp-servers.json', []).filter(s => s.enabled);
    sessionMcpTools = [];
    for (const server of servers) {
      try {
        const client = await getMCPClientCached(server);
        for (const tool of client.tools) {
          sessionMcpTools.push({ ...tool, serverName: server.name, serverId: server.id });
        }
      } catch (err) {
        sendLog(`MCP ${server.name} 连接失败: ${err.message}`, 'error');
      }
    }
    return sessionMcpTools;
  }

  function buildSystemPrompt() {
    const skills = readJSON('skills.json', []).filter(s => s.enabled);

    let p = `你是一个 Linux 运维 AI 助手，直接嵌入在用户的 SSH 终端中。

当前终端环境：
- 用户: ${shellCtx.user || 'unknown'}
- 主机: ${shellCtx.host || 'unknown'}
- 当前目录: ${shellCtx.cwd || '~'}
- 操作系统: Linux

你的职责：理解用户自然语言指令，给出简洁中文分析，转化为可执行 shell 命令，分析执行结果。

【重要】Shell 命令输出格式（必须严格使用，不得使用 markdown 代码块）：
  <command risk="low">只读命令</command>
  <command risk="normal">可逆操作命令</command>
  <command risk="high">危险/不可逆命令</command>

risk 等级：low（只读/查询）, normal（写入/可逆）, high（危险/不可逆/需 sudo）

正确示例：
  用户: 查看磁盘使用情况
  回复: 我来查看当前磁盘使用情况。<command risk="low">df -h</command>

  用户: 创建一个目录 test
  回复: 我来创建 test 目录。<command risk="normal">mkdir test</command>

错误示例（禁止使用以下格式，系统无法解析）：
  ❌ \`\`\`bash\ndf -h\n\`\`\`
  ❌ 请运行：df -h

每次只输出一条命令，等待结果后再继续。多步任务逐步完成，不要提前停止。`;

    if (sessionMcpTools.length > 0) {
      p += '\n\n## 可用 MCP 工具\n';
      p += '需要调用外部工具时，使用以下格式（一次只调用一个）：\n';
      p += '<mcp-call server="服务名" tool="工具名">{"参数名": "参数值"}</mcp-call>\n\n';
      p += '可用工具：\n';
      for (const t of sessionMcpTools) {
        p += `- **${t.serverName}.${t.name}**: ${t.description || '无描述'}\n`;
        const props = t.inputSchema?.properties || {};
        const required = t.inputSchema?.required || [];
        const paramStr = Object.entries(props)
          .map(([k, v]) => `${k}${required.includes(k) ? '*' : ''}: ${v.description || v.type || 'any'}`)
          .join(', ');
        if (paramStr) p += `  参数: { ${paramStr} }\n`;
      }
    }

    if (skills.length > 0) {
      p += '\n\n## 已启用的技能\n';
      for (const skill of skills) {
        p += `\n### ${skill.name}\n${skill.systemPromptAddition}\n`;
      }
    }

    return p;
  }

  async function executeMCPTool(serverName, toolName, argsJson) {
    const server = readJSON('mcp-servers.json', []).find(s => s.name === serverName);
    if (!server) throw new Error(`MCP 服务器 "${serverName}" 未找到`);
    const client = await getMCPClientCached(server);
    let args = {};
    try { args = JSON.parse(argsJson); } catch {}
    const result = await client.callTool(toolName, args);
    const content = result.content || result;
    if (Array.isArray(content)) {
      return content.map(c => c.text || c.data || JSON.stringify(c)).join('\n');
    }
    return typeof content === 'string' ? content : JSON.stringify(content);
  }

  let aiTurnCount = 0;

  async function handleAITurn(userMessage) {
    aiTurnCount++;
    const turnLabel = aiTurnCount === 1 ? '第 1 轮' : `第 ${aiTurnCount} 轮 (多步)`;
    aiHistory.push({ role: 'user', content: userMessage });

    // Create a fresh AbortController for this turn
    aiAbortController = new AbortController();
    const { signal } = aiAbortController;

    // ── Emit header logs BEFORE ai_thinking so they appear above the reply block ──
    sendLog(`${turnLabel} | 模型: ${getActiveModel()} | 上下文 ${aiHistory.length} 条`, 'info');
    if (aiTurnCount > 1) {
      // Show a short summary of what triggered this turn
      const preview = userMessage.slice(0, 80).replace(/\n/g, ' ');
      sendLog(`AI 输入: ${preview}${userMessage.length > 80 ? '…' : ''}`, 'info');
    }
    send('ai_thinking');

    let fullReply = '';
    let textBuf = '';
    let inCmd = false;
    let cmdBuf = '';
    let cmdRisk = 'normal';
    let inMcp = false;
    let mcpBuf = '';
    let mcpServer = '';
    let mcpTool = '';
    let actionEmitted = false;

    try {
      sendLog(`调用 AI 接口，等待响应...`, 'step');

      let firstChunk = true;
      for await (const chunk of streamAI(buildSystemPrompt(), aiHistory, signal)) {
        if (firstChunk) { sendLog(`AI 开始输出...`, 'step'); firstChunk = false; }
        if (signal.aborted || actionEmitted) break;
        fullReply += chunk;
        textBuf += chunk;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (!inCmd && !inMcp) {
            const cmdStart = textBuf.indexOf('<command');
            const mcpStart = textBuf.indexOf('<mcp-call');

            // Pick whichever tag comes first
            const useCmd = cmdStart !== -1 && (mcpStart === -1 || cmdStart <= mcpStart);
            const useMcp = mcpStart !== -1 && (cmdStart === -1 || mcpStart < cmdStart);

            if (!useCmd && !useMcp) {
              const safeLen = Math.max(0, textBuf.length - 25);
              if (safeLen > 0) { send('ai_reply_chunk', { text: textBuf.slice(0, safeLen) }); textBuf = textBuf.slice(safeLen); }
              break;
            }

            if (useCmd) {
              const before = textBuf.slice(0, cmdStart);
              if (before) send('ai_reply_chunk', { text: before });
              textBuf = textBuf.slice(cmdStart);
              const tagEnd = textBuf.indexOf('>');
              if (tagEnd === -1) break;
              const openTag = textBuf.slice(0, tagEnd + 1);
              const riskM = openTag.match(/risk="(low|normal|high)"/);
              cmdRisk = riskM ? riskM[1] : 'normal';
              inCmd = true;
              textBuf = textBuf.slice(tagEnd + 1);
            } else {
              const before = textBuf.slice(0, mcpStart);
              if (before) send('ai_reply_chunk', { text: before });
              textBuf = textBuf.slice(mcpStart);
              const tagEnd = textBuf.indexOf('>');
              if (tagEnd === -1) break;
              const openTag = textBuf.slice(0, tagEnd + 1);
              const serverM = openTag.match(/server="([^"]+)"/);
              const toolM = openTag.match(/tool="([^"]+)"/);
              mcpServer = serverM ? serverM[1] : '';
              mcpTool = toolM ? toolM[1] : '';
              inMcp = true;
              textBuf = textBuf.slice(tagEnd + 1);
            }
          } else if (inCmd) {
            const closeTag = textBuf.indexOf('</command>');
            if (closeTag === -1) { cmdBuf += textBuf; textBuf = ''; break; }
            cmdBuf += textBuf.slice(0, closeTag);
            textBuf = textBuf.slice(closeTag + 10);
            inCmd = false;

            const commandId = `cmd_${Date.now()}`;
            const command = cmdBuf.trim();
            cmdBuf = '';

            if (textBuf.trim()) { send('ai_reply_chunk', { text: textBuf }); textBuf = ''; }
            send('ai_reply_end');

            const riskLabel = { low: '低风险', normal: '中风险', high: '⚠ 高风险' }[cmdRisk] || cmdRisk;
            sendLog(`生成命令 [${riskLabel}]: ${command}`, 'cmd');
            send('command_card', { commandId, command, risk: cmdRisk });
            actionEmitted = true;

            if (shouldAutoApprove(command, cmdRisk)) {
              sendLog(`命令已自动批准 (白名单/低风险)，执行中...`, 'step');
              send('command_auto_approve', { commandId });
              const t0 = Date.now();
              const result = await executeAndCapture(command);
              const elapsed = Date.now() - t0;
              const exitOk = result.exitCode === 0;
              sendLog(
                `执行完成 | 耗时 ${elapsed}ms | 退出码 ${result.exitCode}` +
                (result.output ? ` | 输出 ${result.output.length} 字符` : ' | 无输出'),
                exitOk ? 'ok' : 'warn'
              );
              if (!exitOk) sendLog(`命令退出码非 0，AI 将分析错误`, 'warn');
              aiHistory.push({ role: 'assistant', content: fullReply });
              sendLog(`将执行结果反馈给 AI，继续下一步...`, 'step');
              await handleAITurn(`[命令已执行]\n命令: \`${command}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`);
            } else {
              sendLog(`等待用户确认...`, 'step');
              try {
                const decision = await waitForConfirm(commandId);
                aiHistory.push({ role: 'assistant', content: fullReply });
                if (decision.action === 'confirm') {
                  const cmd = decision.command || command;
                  sendLog(`用户已确认，执行命令: ${cmd}`, 'step');
                  send('command_executing', { commandId });
                  const t0 = Date.now();
                  const result = await executeAndCapture(cmd);
                  const elapsed = Date.now() - t0;
                  send('command_done', { commandId, exitCode: result.exitCode });
                  const exitOk = result.exitCode === 0;
                  sendLog(
                    `执行完成 | 耗时 ${elapsed}ms | 退出码 ${result.exitCode}` +
                    (result.output ? ` | 输出 ${result.output.length} 字符` : ' | 无输出'),
                    exitOk ? 'ok' : 'warn'
                  );
                  if (!exitOk) sendLog(`命令退出码非 0，AI 将分析错误`, 'warn');
                  sendLog(`将执行结果反馈给 AI，继续下一步...`, 'step');
                  await handleAITurn(`[命令已执行]\n命令: \`${cmd}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`);
                } else {
                  sendLog(`用户已拒绝执行，AI 将给出其他建议`, 'warn');
                  await handleAITurn('[用户拒绝执行该命令，请给出其他建议或结束任务]');
                }
              } catch {
                sendLog(`等待用户确认超时`, 'warn');
                send('error', { message: '命令确认超时' });
              }
            }
            return;

          } else if (inMcp) {
            const closeTag = textBuf.indexOf('</mcp-call>');
            if (closeTag === -1) { mcpBuf += textBuf; textBuf = ''; break; }
            mcpBuf += textBuf.slice(0, closeTag);
            textBuf = textBuf.slice(closeTag + 11);
            inMcp = false;

            const argsJson = mcpBuf.trim();
            mcpBuf = '';

            if (textBuf.trim()) { send('ai_reply_chunk', { text: textBuf }); textBuf = ''; }
            send('ai_reply_end');
            actionEmitted = true;

            sendLog(`调用 MCP 工具: ${mcpServer}.${mcpTool}`, 'step');
            sendLog(`参数: ${argsJson.slice(0, 120)}${argsJson.length > 120 ? '…' : ''}`, 'info');
            try {
              const result = await executeMCPTool(mcpServer, mcpTool, argsJson);
              sendLog(`MCP 工具调用成功，结果 ${result.length} 字符`, 'ok');
              aiHistory.push({ role: 'assistant', content: fullReply });
              sendLog(`将 MCP 结果反馈给 AI，继续下一步...`, 'step');
              await handleAITurn(`[MCP工具调用结果]\n服务: ${mcpServer}\n工具: ${mcpTool}\n参数: ${argsJson}\n结果:\n\`\`\`\n${result}\n\`\`\`\n\n请基于此结果继续完成任务。`);
            } catch (err) {
              sendLog(`MCP 工具调用失败: ${err.message}`, 'error');
              aiHistory.push({ role: 'assistant', content: fullReply });
              await handleAITurn(`[MCP工具调用失败]\n服务: ${mcpServer}\n工具: ${mcpTool}\n错误: ${err.message}\n\n请尝试其他方法完成任务。`);
            }
            return;
          }
        }
      }

      if (textBuf.trim() && !inCmd && !inMcp && !textBuf.includes('<command') && !textBuf.includes('<mcp-call')) {
        send('ai_reply_chunk', { text: textBuf });
      }
      if (!actionEmitted) {
        // ── Fallback: extract command from markdown code blocks ──────────────
        const fallbackCmd = extractCommandFromText(fullReply);
        if (fallbackCmd) {
          send('ai_reply_end');
          const commandId = `cmd_${Date.now()}`;
          const risk = getRisk(fallbackCmd);
          const riskLabel = { low: '低风险', normal: '中风险', high: '⚠ 高风险' }[risk] || risk;
          sendLog(`从回复中提取命令 [${riskLabel}]: ${fallbackCmd}`, 'cmd');
          send('command_card', { commandId, command: fallbackCmd, risk });
          actionEmitted = true;

          if (shouldAutoApprove(fallbackCmd, risk)) {
            sendLog(`命令已自动批准 (白名单/低风险)，执行中...`, 'step');
            send('command_auto_approve', { commandId });
            const t0 = Date.now();
            const result = await executeAndCapture(fallbackCmd);
            const elapsed = Date.now() - t0;
            const exitOk = result.exitCode === 0;
            sendLog(
              `执行完成 | 耗时 ${elapsed}ms | 退出码 ${result.exitCode}` +
              (result.output ? ` | 输出 ${result.output.length} 字符` : ' | 无输出'),
              exitOk ? 'ok' : 'warn'
            );
            if (!exitOk) sendLog(`命令退出码非 0，AI 将分析错误`, 'warn');
            aiHistory.push({ role: 'assistant', content: fullReply });
            sendLog(`将执行结果反馈给 AI，继续下一步...`, 'step');
            await handleAITurn(`[命令已执行]\n命令: \`${fallbackCmd}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`);
          } else {
            sendLog(`等待用户确认...`, 'step');
            try {
              const decision = await waitForConfirm(commandId);
              aiHistory.push({ role: 'assistant', content: fullReply });
              if (decision.action === 'confirm') {
                const cmd = decision.command || fallbackCmd;
                sendLog(`用户已确认，执行命令: ${cmd}`, 'step');
                send('command_executing', { commandId });
                const t0 = Date.now();
                const result = await executeAndCapture(cmd);
                const elapsed = Date.now() - t0;
                send('command_done', { commandId, exitCode: result.exitCode });
                const exitOk = result.exitCode === 0;
                sendLog(
                  `执行完成 | 耗时 ${elapsed}ms | 退出码 ${result.exitCode}` +
                  (result.output ? ` | 输出 ${result.output.length} 字符` : ' | 无输出'),
                  exitOk ? 'ok' : 'warn'
                );
                if (!exitOk) sendLog(`命令退出码非 0，AI 将分析错误`, 'warn');
                sendLog(`将执行结果反馈给 AI，继续下一步...`, 'step');
                await handleAITurn(`[命令已执行]\n命令: \`${cmd}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`);
              } else {
                sendLog(`用户已拒绝执行，AI 将给出其他建议`, 'warn');
                await handleAITurn('[用户拒绝执行该命令，请给出其他建议或结束任务]');
              }
            } catch {
              sendLog(`等待用户确认超时`, 'warn');
              send('error', { message: '命令确认超时' });
            }
          }
          return;
        }
        // ── No command found at all — pure text reply ────────────────────────
        sendLog(`AI 回复完成 (纯文本，无命令)`, 'ok');
        send('ai_reply_end');
        aiHistory.push({ role: 'assistant', content: fullReply });
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) {
        sendLog('AI 已被用户中断', 'warn');
        send('ai_reply_end');
        return;
      }
      sendLog(`AI 接口错误: ${err.message}`, 'error');
      send('error', { message: `AI 错误: ${err.message}` });
      send('ai_reply_end');
    } finally {
      if (aiAbortController?.signal === signal) aiAbortController = null;
    }
  }

  function waitForConfirm(commandId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pendingConfirms.delete(commandId); reject(new Error('timeout')); }, 5 * 60 * 1000);
      pendingConfirms.set(commandId, {
        resolve: (d) => { clearTimeout(timer); pendingConfirms.delete(commandId); resolve(d); },
      });
    });
  }

  // ─── WebSocket message handler ─────────────────────────────────────────────

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { type, payload = {} } = msg;

    switch (type) {
      case 'connect': {
        const { host, port = 22, username, password, privateKey, hostId } = payload;
        sessionToken = generateToken();
        sessions.set(sessionToken, { sftp: null, ws });

        sshClient = new SSHClient();
        sshClient.on('ready', () => {
          sshClient.shell({ term: 'xterm-256color', rows: 24, cols: 210, modes: { ECHO: 0 } }, (err, stream) => {
            if (err) { send('error', { message: err.message }); return; }
            sshStream = stream;
            stream.on('data', onSshData);
            stream.stderr.on('data', onSshData);
            stream.on('close', () => { send('disconnected'); sshStream = null; });
            send('ssh_connected', { host, username, sessionToken });
          });

          sshClient.sftp((err, sftp) => {
            if (err) { console.error('SFTP error:', err.message); return; }
            sftpSession = sftp;
            const sess = sessions.get(sessionToken);
            if (sess) sess.sftp = sftp;
          });

          // Auto-update host lastConnectedAt
          if (hostId) {
            const hosts = readJSON('hosts.json', []);
            const idx = hosts.findIndex(h => h.id === hostId);
            if (idx !== -1) { hosts[idx].lastConnectedAt = new Date().toISOString(); writeJSON('hosts.json', hosts); }
          } else {
            const hosts = readJSON('hosts.json', []);
            const existing = hosts.find(h => h.host === host && h.port === parseInt(port) && h.username === username);
            if (existing) { existing.lastConnectedAt = new Date().toISOString(); }
            else {
              hosts.push({
                id: `host_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: payload.name || `${username}@${host}`,
                host, port: parseInt(port) || 22, username,
                password: password || '', privateKey: privateKey || '',
                group: '', createdAt: new Date().toISOString(), lastConnectedAt: new Date().toISOString(),
              });
            }
            writeJSON('hosts.json', hosts);
          }

          // Load MCP tools for this session
          loadSessionMcpTools().catch(() => {});
        });

        sshClient.on('error', (err) => { send('error', { message: `SSH 连接失败: ${err.message}` }); });

        const cfg = { host, port: parseInt(port), username };
        if (privateKey) cfg.privateKey = privateKey; else cfg.password = password;
        try { sshClient.connect(cfg); } catch (e) { send('error', { message: e.message }); }
        break;
      }

      case 'input': {
        if (!sshStream) { send('error', { message: '未连接到 SSH' }); return; }
        const { text } = payload;
        if (text === '') { sshStream.write('\r'); return; }
        const kind = classifyInput(text);
        if (kind === 'natural') {
          if (!isAIConfigured()) { send('ai_not_configured'); return; }
          sendLog(`自然语言模式 → 交由 AI 处理`, 'step');
          handleAITurn(text).catch(err => {
            sendLog(`handleAITurn 未捕获异常: ${err.message}`, 'error');
          });
        } else {
          sshStream.write(text + '\r');
        }
        break;
      }

      // Direct execution of saved commands (bypasses AI classifier for multi-line)
      case 'run_saved_command': {
        if (!sshStream) { send('error', { message: '未连接到 SSH' }); return; }
        const content = payload.content || '';
        if (!content.trim()) return;

        // Increment usage counter so the UI can surface frequently-used commands
        if (payload.commandId) {
          const cmds = readJSON('saved-commands.json', []);
          const idx = cmds.findIndex(c => c.id === payload.commandId);
          if (idx !== -1) {
            cmds[idx].usageCount = (cmds[idx].usageCount || 0) + 1;
            writeJSON('saved-commands.json', cmds);
          }
        }

        if (content.includes('\n')) {
          // Multi-line script: send each line directly to shell
          const lines = content.split('\n');
          for (const line of lines) {
            sshStream.write(line + '\r');
          }
        } else {
          // Single line: route through normal input handler (supports natural language)
          const kind = classifyInput(content.trim());
          if (kind === 'natural' && isAIConfigured()) {
            handleAITurn(content.trim()).catch(console.error);
          } else {
            sshStream.write(content + '\r');
          }
        }
        break;
      }

      case 'raw_input': { if (sshStream) sshStream.write(payload.data); break; }

      case 'command_confirm': {
        const p = pendingConfirms.get(payload.commandId);
        if (p) p.resolve({ action: 'confirm', command: payload.command });
        break;
      }

      case 'command_reject': {
        const p = pendingConfirms.get(payload.commandId);
        if (p) p.resolve({ action: 'reject' });
        break;
      }

      case 'resize': { if (sshStream) sshStream.setWindow(payload.rows, payload.cols); break; }

      case 'new_session': {
        aiHistory = [];
        aiTurnCount = 0;
        sessionMcpTools = [];
        loadSessionMcpTools().catch(() => {});
        send('session_cleared');
        break;
      }

      case 'update_ai_config': {
        aiSettings = readJSON('ai-settings.json', aiSettings);
        send('config_updated', { configured: isAIConfigured() });
        break;
      }

      case 'disconnect': { if (sshClient) sshClient.end(); break; }
      case 'ping': { send('pong'); break; }

      case 'ai_cancel': {
        if (aiAbortController) {
          aiAbortController.abort();
          aiAbortController = null;
        }
        // Also reject any pending command-confirm so the turn fully unblocks
        for (const [, entry] of pendingConfirms) {
          entry.resolve({ action: 'reject' });
        }
        pendingConfirms.clear();
        break;
      }

      // ─── SFTP messages ────────────────────────────────────────────────────

      case 'complete_request': {
        const { word, cwd: completeCwd } = payload;

        // ── Parse directory + prefix from the word being completed ──────────
        const lastSlash = word.lastIndexOf('/');
        let dir, prefix;
        if (lastSlash >= 0) {
          prefix = word.slice(lastSlash + 1);
          const rawDir = word.slice(0, lastSlash + 1) || '/';
          if (rawDir.startsWith('~') || rawDir.startsWith('/')) {
            dir = rawDir;
          } else {
            dir = (completeCwd || '~') + '/' + rawDir;
          }
        } else {
          prefix = word;
          dir = completeCwd || '~';
        }
        dir = dir.replace(/\/\/+/g, '/');

        const sendResult = (completions) => send('complete_result', { completions, word });

        // ── Sort helper ──────────────────────────────────────────────────────
        const sortItems = (items) => items.sort((a, b) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });

        // ── Approach B: exec-based via `ls -1ap` (no SFTP required) ─────────
        // Falls back to this when SFTP is unavailable or returns an error.
        const doExec = () => {
          if (!sshClient) { sendResult([]); return; }

          // Build `ls` invocation; handle absolute, home-relative, and relative dirs
          const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'"; // single-quote escape
          let lsCmd;
          if (dir.startsWith('/') || dir.startsWith('~')) {
            // Absolute or home-relative — the shell expands ~ for us
            lsCmd = `ls -1ap ${q(dir)} 2>/dev/null`;
          } else {
            // Relative — cd to cwd first
            lsCmd = `cd ${q(completeCwd || '~')} 2>/dev/null && ls -1ap ${q(dir)} 2>/dev/null`;
          }

          sshClient.exec(lsCmd, (err, stream) => {
            if (err) { sendResult([]); return; }
            let data = '';
            stream.on('data', chunk => { data += chunk.toString(); });
            stream.stderr.on('data', () => {}); // drain stderr
            stream.on('close', () => {
              const items = data.split('\n')
                .map(f => f.trim())
                .filter(f => f && f !== './' && f !== '../')
                .map(f => {
                  const isDir = f.endsWith('/');
                  const name = isDir ? f.slice(0, -1) : f;
                  return { name, isDir };
                })
                .filter(f => f.name && f.name.startsWith(prefix));
              sendResult(sortItems(items));
            });
          });
        };

        // ── Approach A: SFTP readdir (fast, preferred when available) ────────
        const doSftp = (resolvedDir) => {
          sftpSession.readdir(resolvedDir, (err, list) => {
            if (err) { doExec(); return; } // SFTP error → fall back to exec
            const items = list
              .filter(f => f.filename.startsWith(prefix) && f.filename !== '.' && f.filename !== '..')
              .map(f => ({
                name: f.filename,
                isDir: f.attrs.mode ? (f.attrs.mode & 0o170000) === 0o040000 : false,
              }));
            sendResult(sortItems(items));
          });
        };

        // ── Dispatch ─────────────────────────────────────────────────────────
        if (sftpSession) {
          if (dir.startsWith('~')) {
            sftpSession.realpath('.', (err, homePath) => {
              if (err) { doExec(); return; }
              const resolved = (dir === '~' || dir === '~/') ? homePath
                : (homePath + dir.slice(1)).replace(/\/\/+/g, '/');
              doSftp(resolved);
            });
          } else {
            doSftp(dir);
          }
        } else {
          doExec(); // SFTP not yet ready or not supported — use exec directly
        }
        break;
      }

      case 'sftp_ls': {
        const { path: dirPath } = payload;
        if (!sftpSession) { send('sftp_ls_result', { path: dirPath, files: [], error: 'SFTP 未就绪' }); return; }
        sftpSession.readdir(dirPath, (err, list) => {
          if (err) { send('sftp_ls_result', { path: dirPath, files: [], error: err.message }); return; }
          const files = list.map(item => {
            const isDir = item.attrs.mode ? (item.attrs.mode & 0o170000) === 0o040000 : false;
            const isLink = item.attrs.mode ? (item.attrs.mode & 0o170000) === 0o120000 : false;
            return {
              name: item.filename,
              path: dirPath.replace(/\/$/, '') + '/' + item.filename,
              type: isDir ? 'directory' : (isLink ? 'symlink' : 'file'),
              size: item.attrs.size || 0,
              modifyTime: (item.attrs.mtime || 0) * 1000,
              permissions: item.attrs.mode ? formatPermissions(item.attrs.mode) : '?????????',
              owner: item.longname ? item.longname.split(/\s+/)[2] : '',
            };
          }).sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
          });
          send('sftp_ls_result', { path: dirPath, files });
        });
        break;
      }

      case 'sftp_home': {
        if (!sftpSession) { send('sftp_home_result', { path: null, error: 'SFTP 未就绪' }); return; }
        sftpSession.realpath('.', (err, absPath) => {
          if (err) { send('sftp_home_result', { path: null, error: err.message }); return; }
          send('sftp_home_result', { path: absPath });
        });
        break;
      }

      case 'sftp_delete': {
        const { path: delPath } = payload;
        if (!sftpSession) { send('sftp_op_result', { success: false, error: 'SFTP 未就绪', op: 'delete' }); return; }
        sftpSession.unlink(delPath, (err) => {
          if (!err) { send('sftp_op_result', { success: true, op: 'delete' }); return; }
          sftpSession.rmdir(delPath, (err2) => {
            send('sftp_op_result', { success: !err2, error: err2 ? err2.message : null, op: 'delete' });
          });
        });
        break;
      }

      case 'sftp_mkdir': {
        const { path: mkPath } = payload;
        if (!sftpSession) { send('sftp_op_result', { success: false, error: 'SFTP 未就绪', op: 'mkdir' }); return; }
        sftpSession.mkdir(mkPath, (err) => { send('sftp_op_result', { success: !err, error: err?.message, op: 'mkdir' }); });
        break;
      }

      case 'sftp_rename': {
        const { oldPath, newPath } = payload;
        if (!sftpSession) { send('sftp_op_result', { success: false, error: 'SFTP 未就绪', op: 'rename' }); return; }
        sftpSession.rename(oldPath, newPath, (err) => { send('sftp_op_result', { success: !err, error: err?.message, op: 'rename' }); });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (outputTimer) { clearTimeout(outputTimer); outputTimer = null; outputBuf = ''; }
    if (sshClient) sshClient.end();
    if (sessionToken) sessions.delete(sessionToken);
    for (const [, p] of pendingConfirms) p.resolve({ action: 'reject' });
    pendingConfirms.clear();
  });

  ws.on('error', console.error);
});

server.listen(PORT, () => {
  console.log(`\n  SSH AI Shell → http://localhost:${PORT}`);
  console.log(`  AI configured → ${isAIConfigured() ? 'YES' : 'NO'}`);
  if (copilotState.githubToken) console.log(`  Copilot → @${copilotState.username}`);
  console.log();
});
