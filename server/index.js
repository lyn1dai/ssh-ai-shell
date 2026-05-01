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
  return !!(aiSettings.baseUrl && aiSettings.apiKey && aiSettings.model);
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
  return aiSettings.model;
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
  const updatable = ['baseUrl', 'apiKey', 'model', 'enableCommandExplain', 'enableAIAssistant', 'enableAutoComplete', 'agentExecMode', 'commandWhitelist'];
  for (const k of updatable) {
    if (req.body[k] !== undefined) aiSettings[k] = req.body[k];
  }
  writeJSON('ai-settings.json', aiSettings);
  res.json({ ...aiSettings, configured: isAIConfigured() });
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
  res.setHeader('Content-Disposition', `attachment; filename="ssh-ai-shell-${new Date().toISOString().slice(0, 10)}.json"`);
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
  const targetPath = uploadPath.endsWith('/') ? uploadPath + req.file.originalname : uploadPath + '/' + req.file.originalname;
  const ws = session.sftp.createWriteStream(targetPath);
  ws.on('close', () => res.json({ ok: true, path: targetPath }));
  ws.on('error', (e) => res.status(500).json({ error: e.message }));
  ws.end(req.file.buffer);
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

  const firstWord = t.split(/\s+/)[0].toLowerCase().replace(/^.*\//, '');
  if (knownCmds.has(firstWord)) return 'shell';
  if (/^\S+$/.test(t) && /^[a-zA-Z0-9_.-]+$/.test(t)) return 'shell';
  if (/^[A-Z]/.test(t)) return 'natural';
  if (t.split(/\s+/).length >= 4) return 'natural';
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

// ─── Strip ANSI ───────────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[()][AB012]/g, '')
            .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '');
}

// ─── AI Streaming ─────────────────────────────────────────────────────────────

async function* streamAI(systemPrompt, messages) {
  const client = await createAIClientAsync();
  if (!client) throw new Error('AI 未配置，请先在设置中配置 AI 服务');

  const model = getActiveModel();
  const stream = await client.chat.completions.create({
    model,
    max_tokens: 2048,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream: true,
  });

  for await (const chunk of stream) {
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

  // MCP tools available for this session
  let sessionMcpTools = [];

  function send(type, payload = {}) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, payload }));
  }

  function sendLog(message, level = 'info') {
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
    send('terminal_output', { data: text });
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

Shell 命令标签格式（必须严格遵守）：
  <command risk="low">命令内容</command>
  <command risk="normal">命令内容</command>
  <command risk="high">命令内容</command>

risk 等级：low（只读）, normal（可逆）, high（危险/不可逆）
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

  async function handleAITurn(userMessage) {
    aiHistory.push({ role: 'user', content: userMessage });
    send('ai_thinking');
    sendLog('AI 正在分析请求...');

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
      sendLog(`模型: ${getActiveModel()}`);

      for await (const chunk of streamAI(buildSystemPrompt(), aiHistory)) {
        if (actionEmitted) break;
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
            sendLog(`AI 生成命令 [${cmdRisk}]: ${command}`);
            send('command_card', { commandId, command, risk: cmdRisk });
            actionEmitted = true;

            if (shouldAutoApprove(command, cmdRisk)) {
              send('command_auto_approve', { commandId });
              send('ai_reply_end');
              const result = await executeAndCapture(command);
              aiHistory.push({ role: 'assistant', content: fullReply });
              await handleAITurn(`[命令已执行]\n命令: \`${command}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`);
            } else {
              send('ai_reply_end');
              try {
                const decision = await waitForConfirm(commandId);
                aiHistory.push({ role: 'assistant', content: fullReply });
                if (decision.action === 'confirm') {
                  const cmd = decision.command || command;
                  send('command_executing', { commandId });
                  const result = await executeAndCapture(cmd);
                  send('command_done', { commandId, exitCode: result.exitCode });
                  await handleAITurn(`[命令已执行]\n命令: \`${cmd}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`);
                } else {
                  await handleAITurn('[用户拒绝执行该命令，请给出其他建议或结束任务]');
                }
              } catch { send('error', { message: '命令确认超时' }); }
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

            sendLog(`调用 MCP 工具: ${mcpServer}.${mcpTool}`);
            try {
              const result = await executeMCPTool(mcpServer, mcpTool, argsJson);
              sendLog(`MCP 工具调用成功`);
              aiHistory.push({ role: 'assistant', content: fullReply });
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

      if (textBuf.trim()) send('ai_reply_chunk', { text: textBuf });
      if (!actionEmitted) {
        send('ai_reply_end');
        aiHistory.push({ role: 'assistant', content: fullReply });
      }
    } catch (err) {
      send('error', { message: `AI 错误: ${err.message}` });
      send('ai_reply_end');
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
        sessions.set(sessionToken, { sftp: null });

        sshClient = new SSHClient();
        sshClient.on('ready', () => {
          sshClient.shell({ term: 'xterm-256color', rows: 24, cols: 210 }, (err, stream) => {
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
          handleAITurn(text).catch(console.error);
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

      // ─── SFTP messages ────────────────────────────────────────────────────

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

      case 'sftp_delete': {
        const { path: delPath } = payload;
        if (!sftpSession) { send('sftp_op_result', { success: false, error: 'SFTP 未就绪', op: 'delete' }); return; }
        sftpSession.unlink(delPath, (err) => {
          if (!err) { send('sftp_op_result', { success: true, op: 'delete' }); return; }
          sftpSession.rmdir(delPath, (err2) => {
            send('sftp_op_result', { success: !err2, error: err2 ? err.message : null, op: 'delete' });
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
