'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
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

// ─── In-memory session store (token → { sshClient, sftp }) ───────────────────
const sessions = new Map(); // sessionToken → { sshClient, sftp, sftpReady }

// ─── Load settings ─────────────────────────────────────────────────────────

let aiSettings = readJSON('ai-settings.json', {
  baseUrl: '', apiKey: '', model: '', configured: false,
  enableCommandExplain: true, enableAIAssistant: true, enableAutoComplete: true,
  agentExecMode: 'ask_each', commandWhitelist: ['ls', 'cat', 'which', 'pwd', 'll'],
});

let autoApproveSettings = readJSON('auto-approve.json', {
  globalAutoApprove: { low: true, normal: false, high: false },
  rules: [],
});

// ─── Helpers ───────────────────────────────────────────────────────────────

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
  const s = autoApproveSettings;
  if (s.globalAutoApprove && s.globalAutoApprove[risk]) return true;
  return (s.rules || []).some(r => r.enabled && matchesPattern(r.pattern, command));
}

function isAIConfigured() {
  return !!(aiSettings.baseUrl && aiSettings.apiKey && aiSettings.model);
}

function createAIClient() {
  if (!isAIConfigured()) return null;
  return new OpenAI({ apiKey: aiSettings.apiKey, baseURL: aiSettings.baseUrl });
}

function generateToken() {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function formatPermissions(mode) {
  const oct = (mode & 0o777).toString(8).padStart(3, '0');
  const types = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  return types[parseInt(oct[0])] + types[parseInt(oct[1])] + types[parseInt(oct[2])];
}

// ─── Express middleware ──────────────────────────────────────────────────────

app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
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

// Update lastConnectedAt (called when SSH connects)
app.post('/api/hosts/:id/connected', (req, res) => {
  const hosts = readJSON('hosts.json', []);
  const idx = hosts.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  hosts[idx].lastConnectedAt = new Date().toISOString();
  writeJSON('hosts.json', hosts);
  res.json(hosts[idx]);
});

// Auto-save host on connect (upsert by host+port+username)
app.post('/api/hosts/upsert', (req, res) => {
  const { host, port, username, password, privateKey, name, group } = req.body;
  if (!host || !username) return res.status(400).json({ error: 'host and username required' });
  
  const hosts = readJSON('hosts.json', []);
  const existing = hosts.find(h => h.host === host && h.port === (port || 22) && h.username === username);
  
  if (existing) {
    existing.lastConnectedAt = new Date().toISOString();
    if (name && name !== existing.name) existing.name = name;
    if (password !== undefined) existing.password = password;
    if (privateKey !== undefined) existing.privateKey = privateKey;
    if (group !== undefined) existing.group = group;
    writeJSON('hosts.json', hosts);
    return res.json(existing);
  }
  
  const newHost = {
    id: `host_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name || `${username}@${host}`,
    host, port: port || 22, username,
    password: password || '',
    privateKey: privateKey || '',
    group: group || '',
    createdAt: new Date().toISOString(),
    lastConnectedAt: new Date().toISOString(),
  };
  hosts.push(newHost);
  writeJSON('hosts.json', hosts);
  res.json(newHost);
});

// ─── AI Settings ─────────────────────────────────────────────────────────────

app.get('/api/ai-settings', (_, res) => {
  res.json({ ...aiSettings, configured: isAIConfigured() });
});

app.put('/api/ai-settings', (req, res) => {
  const updatable = ['baseUrl', 'apiKey', 'model', 'enableCommandExplain', 
    'enableAIAssistant', 'enableAutoComplete', 'agentExecMode', 'commandWhitelist'];
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

// ─── App Settings ──────────────────────────────────────────────────────────

app.get('/api/app-settings', (_, res) => {
  res.json(readJSON('app-settings.json', { theme: 'dark', showStatusBar: true, language: 'zh-CN' }));
});

app.put('/api/app-settings', (req, res) => {
  const current = readJSON('app-settings.json', { theme: 'dark', showStatusBar: true, language: 'zh-CN' });
  const updated = { ...current, ...req.body };
  writeJSON('app-settings.json', updated);
  res.json(updated);
});

// ─── Export / Import ──────────────────────────────────────────────────────────

app.get('/api/export-settings', (_, res) => {
  const data = {
    exportedAt: new Date().toISOString(),
    hosts: readJSON('hosts.json', []),
    aiSettings: readJSON('ai-settings.json', {}),
    autoApprove: readJSON('auto-approve.json', {}),
  };
  const filename = `ssh-ai-shell-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(data);
});

app.post('/api/import-settings', (req, res) => {
  try {
    const { hosts, aiSettings: importedAI, autoApprove } = req.body;
    if (Array.isArray(hosts)) writeJSON('hosts.json', hosts);
    if (importedAI && typeof importedAI === 'object') {
      writeJSON('ai-settings.json', importedAI);
      Object.assign(aiSettings, importedAI);
    }
    if (autoApprove && typeof autoApprove === 'object') {
      writeJSON('auto-approve.json', autoApprove);
      autoApproveSettings = autoApprove;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── SFTP HTTP endpoints ──────────────────────────────────────────────────────

// Download file
app.get('/api/sftp/download', (req, res) => {
  const { token, path: filePath } = req.query;
  if (!token || !filePath) return res.status(400).json({ error: 'Missing token or path' });
  
  const session = sessions.get(token);
  if (!session || !session.sftp) return res.status(401).json({ error: 'Session not found or SFTP not ready' });
  
  const filename = path.basename(filePath);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  
  session.sftp.createReadStream(filePath, (err, stream) => {
    if (err) {
      // Try alternate API
      try {
        const readStream = session.sftp.createReadStream(filePath);
        readStream.on('error', (e) => res.status(500).json({ error: e.message }));
        readStream.pipe(res);
      } catch(e2) {
        res.status(500).json({ error: err.message });
      }
      return;
    }
    stream.on('error', (e) => res.status(500).json({ error: e.message }));
    stream.pipe(res);
  });
});

// Upload file - use multer for multipart
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

app.post('/api/sftp/upload', upload.single('file'), (req, res) => {
  const { token, path: uploadPath } = req.query;
  if (!token || !uploadPath) return res.status(400).json({ error: 'Missing token or path' });
  
  const session = sessions.get(token);
  if (!session || !session.sftp) return res.status(401).json({ error: 'Session not found' });
  
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  const targetPath = uploadPath.endsWith('/')
    ? uploadPath + req.file.originalname
    : uploadPath + '/' + req.file.originalname;
  
  const writeStream = session.sftp.createWriteStream(targetPath);
  writeStream.on('close', () => res.json({ ok: true, path: targetPath }));
  writeStream.on('error', (e) => res.status(500).json({ error: e.message }));
  writeStream.end(req.file.buffer);
});

// Serve built frontend
const distDir = path.join(__dirname, '../dist');
const serveStatic = fs.existsSync(path.join(distDir, 'index.html'));
if (serveStatic) {
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
    /\brm\b.*-[rRfF]*r[rRfF]*/,
    /\brm\b.*\/(?!tmp\/[^/]+$)/,
    /\bdd\b.*\bof=\/dev/, /\bdd\b.*\bof=\/[a-z]/,
    /\bmkfs\b/, /\bwipefs\b/, /\bshred\b/,
    /\bfdisk\b/, /\bparted\b/, /\bcfdisk\b/,
    /\bkill\b/, /\bkillall\b/, /\bpkill\b/,
    /\breboot\b/, /\bshutdown\b/, /\bhalt\b/, /\bpoweroff\b/, /\binit\s*[016]/,
    /\bsystemctl\b.*(stop|disable|mask|kill)/,
    /\biptables\b.*-[FXZ]/,
    /\bufw\b.*(disable|delete)/,
    /\bcurl\b.*\|\s*(bash|sh|zsh|fish)/,
    /\bwget\b.*\|\s*(bash|sh)/,
    />(\/etc\/|\/boot\/|\/sys\/|\/proc\/)/,
    /\bchmod\b.*-[rR]/,
    /\bchown\b.*-[rR]/,
    /\btruncate\b/,
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
    /^env(\s|$)/, /^printenv(\s|$)/,
    /^echo(\s|$)/,
    /^grep(\s|$)/, /^egrep(\s|$)/,
    /^find\s(?!.*-exec\s.*rm)/,
    /^which(\s|$)/, /^whereis(\s|$)/, /^type(\s|$)/,
    /^head(\s|$)/, /^tail\s(?!.*-f.*>)/, /^less(\s|$)/, /^more(\s|$)/,
    /^wc(\s|$)/, /^sort(\s|$)/, /^uniq(\s|$)/,
    /^git\s(log|status|diff|show|branch|tag|remote\s+-v|describe)/,
    /^docker\s(ps|images|logs|inspect|stats)/,
    /^kubectl\s(get|describe|logs)/,
    /^ping(\s|$)/, /^dig(\s|$)/, /^nslookup(\s|$)/,
    /^ss(\s|$)/, /^netstat(\s|$)/,
    /^jq(\s|$)/, /^yq(\s|$)/,
    /^lsblk(\s|$)/, /^blkid(\s|$)/,
    /^history(\s|$)/,
  ];
  if (LOW.some(p => p.test(c))) return 'low';

  return 'normal';
}

// ─── Strip ANSI codes ─────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[()][AB012]/g, '')
            .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '');
}

// ─── AI Streaming ─────────────────────────────────────────────────────────────

async function* streamAI(systemPrompt, messages) {
  const client = createAIClient();
  if (!client) throw new Error('AI 未配置');

  const stream = await client.chat.completions.create({
    model: aiSettings.model,
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
          if (!recording && plain.includes(marker.slice(0, 8))) continue;
          if (!recording) { recording = true; continue; }
          if (plain.includes(marker)) break;
          outputLines.push(plain);
        }
        resolve({ output: outputLines.join('\n').trim(), exitCode });

        const cleanText = text.split('\n')
          .filter(l => !l.includes(marker) && !l.includes(marker.slice(0, 12)))
          .join('\n');
        if (cleanText.trim()) send('terminal_output', { data: cleanText });
        return;
      }

      const cleanText = text.split('\n')
        .filter(l => !l.includes(captureState?.marker || ''))
        .join('\n');
      if (cleanText) send('terminal_output', { data: cleanText });
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
        resolve: (result) => {
          if (!resolved) { resolved = true; clearTimeout(timer); resolve(result); }
        },
      };
      sshStream.write(wrapped + '\r');
    });
  }

  function buildSystemPrompt() {
    return `你是一个 Linux 运维 AI 助手，直接嵌入在用户的 SSH 终端中。

当前终端环境：
- 用户: ${shellCtx.user || 'unknown'}
- 主机: ${shellCtx.host || 'unknown'}
- 当前目录: ${shellCtx.cwd || '~'}
- 操作系统: Linux

你的职责：理解用户自然语言指令，给出简洁中文分析，转化为可执行 shell 命令，分析执行结果。

命令标签格式（必须严格遵守）：
  <command risk="low">命令内容</command>
  <command risk="normal">命令内容</command>
  <command risk="high">命令内容</command>

risk 等级：low（只读）, normal（可逆操作）, high（危险/不可逆）

规则：每次只输出一条命令，等待结果后再继续。如果任务有多步骤，逐步完成，不要提前停止。`;
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
    let commandEmitted = false;

    try {
      sendLog(`使用模型: ${aiSettings.model}`);

      for await (const chunk of streamAI(buildSystemPrompt(), aiHistory)) {
        if (commandEmitted) break;
        fullReply += chunk;
        textBuf += chunk;

        while (true) {
          if (!inCmd) {
            const cmdStart = textBuf.indexOf('<command');
            if (cmdStart === -1) {
              const safeLen = Math.max(0, textBuf.length - 20);
              if (safeLen > 0) { send('ai_reply_chunk', { text: textBuf.slice(0, safeLen) }); textBuf = textBuf.slice(safeLen); }
              break;
            } else {
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
            }
          } else {
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
            commandEmitted = true;

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
              } catch {
                send('error', { message: '命令确认超时' });
              }
            }
            return;
          }
        }
      }

      if (textBuf.trim()) send('ai_reply_chunk', { text: textBuf });
      if (!commandEmitted) {
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
        resolve: (decision) => { clearTimeout(timer); pendingConfirms.delete(commandId); resolve(decision); },
      });
    });
  }

  // ─── Message handler ────────────────────────────────────────────────────────

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
          // Open shell
          sshClient.shell({ term: 'xterm-256color', rows: 24, cols: 210 }, (err, stream) => {
            if (err) { send('error', { message: err.message }); return; }
            sshStream = stream;
            stream.on('data', onSshData);
            stream.stderr.on('data', onSshData);
            stream.on('close', () => { send('disconnected'); sshStream = null; });
            send('ssh_connected', { host, username, sessionToken });
          });

          // Open SFTP session in parallel
          sshClient.sftp((err, sftp) => {
            if (err) { console.error('SFTP open error:', err.message); return; }
            sftpSession = sftp;
            const sess = sessions.get(sessionToken);
            if (sess) sess.sftp = sftp;
          });

          // Update lastConnectedAt if hostId provided
          if (hostId) {
            const hosts = readJSON('hosts.json', []);
            const idx = hosts.findIndex(h => h.id === hostId);
            if (idx !== -1) {
              hosts[idx].lastConnectedAt = new Date().toISOString();
              writeJSON('hosts.json', hosts);
            }
          } else {
            // Auto-upsert: save host and update lastConnectedAt
            const hosts = readJSON('hosts.json', []);
            const existing = hosts.find(h => h.host === host && h.port === (parseInt(port) || 22) && h.username === username);
            if (existing) {
              existing.lastConnectedAt = new Date().toISOString();
            } else {
              hosts.push({
                id: `host_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: payload.name || `${username}@${host}`,
                host, port: parseInt(port) || 22, username,
                password: password || '',
                privateKey: privateKey || '',
                group: '',
                createdAt: new Date().toISOString(),
                lastConnectedAt: new Date().toISOString(),
              });
            }
            writeJSON('hosts.json', hosts);
          }
        });

        sshClient.on('error', (err) => { send('error', { message: `SSH 连接失败: ${err.message}` }); });

        const connectCfg = { host, port: parseInt(port), username };
        if (privateKey) connectCfg.privateKey = privateKey;
        else connectCfg.password = password;

        try { sshClient.connect(connectCfg); } catch (e) { send('error', { message: e.message }); }
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

      case 'raw_input': { if (sshStream) sshStream.write(payload.data); break; }

      case 'command_confirm': {
        const { commandId, command } = payload;
        const p = pendingConfirms.get(commandId);
        if (p) p.resolve({ action: 'confirm', command });
        break;
      }

      case 'command_reject': {
        const p = pendingConfirms.get(payload.commandId);
        if (p) p.resolve({ action: 'reject' });
        break;
      }

      case 'resize': {
        if (sshStream) sshStream.setWindow(payload.rows, payload.cols);
        break;
      }

      case 'new_session': { aiHistory = []; send('session_cleared'); break; }

      case 'update_ai_config': {
        aiSettings = readJSON('ai-settings.json', aiSettings);
        send('config_updated', { configured: isAIConfigured() });
        break;
      }

      case 'disconnect': { if (sshClient) sshClient.end(); break; }

      case 'ping': { send('pong'); break; }

      // ─── SFTP messages ─────────────────────────────────────────────────────

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

        // Try unlink first (file), then rmdir (empty dir)
        sftpSession.unlink(delPath, (err) => {
          if (!err) { send('sftp_op_result', { success: true, op: 'delete' }); return; }
          sftpSession.rmdir(delPath, (err2) => {
            if (!err2) { send('sftp_op_result', { success: true, op: 'delete' }); }
            else { send('sftp_op_result', { success: false, error: err.message, op: 'delete' }); }
          });
        });
        break;
      }

      case 'sftp_mkdir': {
        const { path: mkPath } = payload;
        if (!sftpSession) { send('sftp_op_result', { success: false, error: 'SFTP 未就绪', op: 'mkdir' }); return; }
        sftpSession.mkdir(mkPath, (err) => {
          send('sftp_op_result', { success: !err, error: err?.message, op: 'mkdir' });
        });
        break;
      }

      case 'sftp_rename': {
        const { oldPath, newPath } = payload;
        if (!sftpSession) { send('sftp_op_result', { success: false, error: 'SFTP 未就绪', op: 'rename' }); return; }
        sftpSession.rename(oldPath, newPath, (err) => {
          send('sftp_op_result', { success: !err, error: err?.message, op: 'rename' });
        });
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
  console.log();
});
