'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Client: SSHClient } = require('ssh2');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;
let AI_BASE_URL = process.env.AI_BASE_URL || 'http://8.213.234.60:4141';
let AI_API_KEY = process.env.AI_API_KEY || 'dummy';
let AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-4.6';

// ─── Data directory (JSON file storage, no database needed) ──────────────────

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, defaultVal) {
  const p = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return defaultVal; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// Load saved AI settings on startup
const savedAI = readJSON('ai-settings.json', null);
if (savedAI) {
  AI_BASE_URL = savedAI.baseUrl || AI_BASE_URL;
  AI_API_KEY = savedAI.apiKey || AI_API_KEY;
  AI_MODEL = savedAI.model || AI_MODEL;
}

// ─── Express middleware ──────────────────────────────────────────────────────

app.use(express.json());

// Health check
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
    createdAt: new Date().toISOString(),
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

// ─── AI Settings ─────────────────────────────────────────────────────────────

app.get('/api/ai-settings', (_, res) => {
  res.json({ baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL });
});

app.put('/api/ai-settings', (req, res) => {
  const { baseUrl, apiKey, model } = req.body;
  if (baseUrl !== undefined) AI_BASE_URL = baseUrl;
  if (apiKey !== undefined) AI_API_KEY = apiKey;
  if (model !== undefined) AI_MODEL = model;
  writeJSON('ai-settings.json', { baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL });
  res.json({ baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL });
});

// Serve built frontend if dist exists (production mode)
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

  // Chinese characters → always natural language
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(t)) return 'natural';

  // Starts with ./ ../ / ~ → shell
  if (/^[./~]/.test(t)) return 'shell';

  // Contains shell operators → shell
  if (/[|>&;`$()]/.test(t)) return 'shell';

  // Variable assignment FOO=bar
  if (/^\w+=/.test(t)) return 'shell';

  // Known shell commands (first word)
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
    'screen','tmux','nohup','watch','time','timeout','xargs',
    'mysql','psql','redis-cli','mongo','sqlite3',
    'nginx','apache2','httpd','php','perl','ruby','rake','bundle',
  ]);

  const firstWord = t.split(/\s+/)[0].toLowerCase().replace(/^.*\//, '');
  if (knownCmds.has(firstWord)) return 'shell';

  // Single word with no spaces that looks like a binary → shell
  if (/^\S+$/.test(t) && /^[a-zA-Z0-9_.-]+$/.test(t)) return 'shell';

  // Multi-word English sentence that doesn't look like a command → natural
  if (/^[A-Z]/.test(t)) return 'natural'; // starts with capital
  if (t.split(/\s+/).length >= 4) return 'natural'; // 4+ words

  return 'shell'; // default to shell for ambiguous single/double word English
}

// ─── Risk classifier ──────────────────────────────────────────────────────────

function getRisk(cmd) {
  const c = cmd.trim();
  const HIGH = [
    /\bsudo\b/, /\bsu\s/, /\bsu$/, /\bdoas\b/,
    /\brm\b.*-[rRfF]*r[rRfF]*/,  // rm -rf style
    /\brm\b.*\/(?!tmp\/[^/]+$)/,  // rm involving deep paths (not /tmp/x)
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
    />(\/etc\/|\/boot\/|\/sys\/|\/proc\/)/, // redirect into system dirs
    /\bchmod\b.*-[rR]/,
    /\bchown\b.*-[rR]/,
    /\btruncate\b/,
    /\bsystemctl\s+daemon-reload/,
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
    /^find\s(?!.*-exec\s.*rm)/, // find without -exec rm
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

// ─── Strip ANSI codes (inline, no dep needed for Node 18+) ────────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[()][AB012]/g, '')
            .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, '');
}

// ─── AI Streaming ─────────────────────────────────────────────────────────────

function createAnthropicClient() {
  return new Anthropic({
    apiKey: AI_API_KEY,
    baseURL: AI_BASE_URL,
  });
}

async function* streamAI(client, systemPrompt, messages) {
  const stream = client.messages.stream({
    model: AI_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

// ─── WebSocket handler ────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  let sshClient = null;
  let sshStream = null;
  let aiClient = createAnthropicClient();

  // AI conversation history for current session
  let aiHistory = [];

  // Current shell context (updated by watching SSH output)
  let shellCtx = { user: '', host: '', cwd: '~', os: 'Linux' };

  // Pending confirmations: commandId → { resolve, command }
  const pendingConfirms = new Map();

  // Command capture mode for AI result analysis
  let captureState = null; // { marker, buffer, resolve }

  // Send helper
  function send(type, payload = {}) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  // Update shell context from SSH output line
  function updateCtx(line) {
    // Patterns: [user@host dir]$ or user@host:dir$
    const m1 = line.match(/\[([^@\]]+)@([^\s\]]+)\s+([^\]]+)\][\$#]/);
    if (m1) {
      shellCtx.user = m1[1];
      shellCtx.host = m1[2];
      shellCtx.cwd = m1[3];
      return;
    }
    const m2 = line.match(/([^@]+)@([^:]+):([^\$#]+)[\$#]/);
    if (m2) {
      shellCtx.user = m2[1];
      shellCtx.host = m2[2];
      shellCtx.cwd = m2[3];
    }
  }

  // Handle incoming SSH data
  function onSshData(data) {
    const text = data.toString();
    // Update shell context
    for (const line of text.split('\n')) updateCtx(line);

    if (captureState) {
      captureState.buffer += text;
      // FIX: Check buffer (not text) for marker, handles split across chunks
      if (captureState.buffer.includes(captureState.marker)) {
        const fullBuf = captureState.buffer;
        const { marker, resolve } = captureState;
        captureState = null;

        // Parse exit code
        const exitMatch = fullBuf.match(new RegExp(marker + ':(\\d+)'));
        const exitCode = exitMatch ? parseInt(exitMatch[1]) : 0;

        // Extract output between command echo and marker
        const stripped = stripAnsi(fullBuf);
        const lines = stripped.split('\n');
        const outputLines = [];
        let recording = false;
        for (const line of lines) {
          const plain = line.replace(/\r/g, '');
          if (!recording && plain.includes(marker.slice(0, 8))) {
            // skip marker line
            continue;
          }
          if (!recording) {
            recording = true;
            continue; // skip command echo line
          }
          if (plain.includes(marker)) break; // stop at marker
          outputLines.push(plain);
        }
        resolve({ output: outputLines.join('\n').trim(), exitCode });

        // Filter marker from what we send to client
        const cleanText = text
          .split('\n')
          .filter(l => !l.includes(marker) && !l.includes(marker.slice(0, 12)))
          .join('\n');
        if (cleanText.trim()) send('terminal_output', { data: cleanText });
        return;
      }

      // Filter partial marker lines
      const cleanText = text
        .split('\n')
        .filter(l => !l.includes(captureState?.marker || ''))
        .join('\n');
      if (cleanText) send('terminal_output', { data: cleanText });
      return;
    }

    send('terminal_output', { data: text });
  }

  // Execute an SSH command and capture its output for AI (with timeout)
  function executeAndCapture(command) {
    return new Promise((resolve) => {
      const marker = `SSHAI_${Date.now()}_END`;
      const wrapped = `(${command}); echo "${marker}:$?"`;
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          captureState = null;
          resolve({ output: '(命令执行超时)', exitCode: -1 });
        }
      }, 30000);

      captureState = {
        marker,
        buffer: '',
        resolve: (result) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(result);
          }
        },
      };
      sshStream.write(wrapped + '\r');
    });
  }

  // Build system prompt for AI
  function buildSystemPrompt() {
    return `你是一个 Linux 运维 AI 助手，直接嵌入在用户的 SSH 终端中。

当前终端环境：
- 用户: ${shellCtx.user || 'unknown'}
- 主机: ${shellCtx.host || 'unknown'}
- 当前目录: ${shellCtx.cwd || '~'}
- 操作系统: Linux

你的职责：
1. 理解用户的自然语言指令，给出简洁的中文分析说明
2. 将意图转化为可执行的 shell 命令
3. 分析命令执行结果并决定下一步行动
4. 任务完成后给出简洁的总结

重要规则：
- 每次只输出 **一条** 命令，等待执行结果后再规划下一步
- 先给出说明文字，再给出命令标签
- 命令标签格式（必须严格遵守）：
  <command risk="low">命令内容</command>
  <command risk="normal">命令内容</command>
  <command risk="high">命令内容</command>

risk 等级说明：
- low：只读操作，无副作用（ls, cat, pwd, df, ps, git status 等）
- normal：有副作用但可逆（mkdir, touch, cp, git clone, npm install 等）
- high：可能不可逆或影响系统（rm, sudo, kill, 操作系统目录, reboot 等）

多步任务规则（非常重要）：
- 如果用户的请求包含多个步骤或多个操作，你必须逐步完成所有步骤
- 每次收到命令执行结果后，检查用户的原始请求是否还有未完成的步骤
- 如果还有未完成的步骤，必须继续输出下一条命令，不要停止
- 只有当用户请求中的所有步骤都完成后，才给出最终总结
- 例如：用户说"创建文件夹A，然后删除文件夹B"，你需要先执行创建，再执行删除，两步都完成后才总结

删除文件夹注意事项：
- 删除空文件夹使用 rmdir
- 删除非空文件夹使用 rm -rf（注意标记为 high 风险）
- 如果不确定文件夹是否为空，先用 ls 查看

如果不需要执行命令（只是回答问题），直接用文字回复即可，不需要 command 标签。`;
  }

  // Main AI conversation handler (recursive for multi-step tasks)
  async function handleAITurn(userMessage) {
    aiHistory.push({ role: 'user', content: userMessage });

    send('ai_thinking');

    let fullReply = '';
    let textBuf = '';
    let inCmd = false;
    let cmdBuf = '';
    let cmdRisk = 'normal';
    let commandEmitted = false;
    let replyStarted = false;

    try {
      for await (const chunk of streamAI(aiClient, buildSystemPrompt(), aiHistory)) {
        if (commandEmitted) break;
        fullReply += chunk;
        textBuf += chunk;

        // Parse text vs command tags from buffer
        while (true) {
          if (!inCmd) {
            const cmdStart = textBuf.indexOf('<command');
            if (cmdStart === -1) {
              // No command tag yet — flush everything except last 20 chars
              // (in case tag spans chunks)
              const safeLen = Math.max(0, textBuf.length - 20);
              if (safeLen > 0) {
                const toSend = textBuf.slice(0, safeLen);
                send('ai_reply_chunk', { text: toSend });
                replyStarted = true;
                textBuf = textBuf.slice(safeLen);
              }
              break;
            } else {
              // Flush text before command tag
              const before = textBuf.slice(0, cmdStart);
              if (before) {
                send('ai_reply_chunk', { text: before });
                replyStarted = true;
              }
              textBuf = textBuf.slice(cmdStart);
              // Look for end of opening tag
              const tagEnd = textBuf.indexOf('>');
              if (tagEnd === -1) break; // incomplete, wait for more chunks
              const openTag = textBuf.slice(0, tagEnd + 1);
              const riskM = openTag.match(/risk="(low|normal|high)"/);
              cmdRisk = riskM ? riskM[1] : 'normal';
              inCmd = true;
              textBuf = textBuf.slice(tagEnd + 1);
            }
          } else {
            // Inside command tag
            const closeTag = textBuf.indexOf('</command>');
            if (closeTag === -1) {
              cmdBuf += textBuf;
              textBuf = '';
              break;
            }
            cmdBuf += textBuf.slice(0, closeTag);
            textBuf = textBuf.slice(closeTag + 10); // '</command>'.length === 10
            inCmd = false;

            const commandId = `cmd_${Date.now()}`;
            const command = cmdBuf.trim();
            cmdBuf = '';

            // Flush any remaining text after command tag
            if (textBuf.trim()) {
              send('ai_reply_chunk', { text: textBuf });
              textBuf = '';
            }

            // Emit command card
            send('command_card', { commandId, command, risk: cmdRisk });
            commandEmitted = true;

            // Auto-approve low-risk commands
            if (cmdRisk === 'low') {
              send('command_auto_approve', { commandId });
              send('ai_reply_end');
              // Execute immediately
              const result = await executeAndCapture(command);
              aiHistory.push({ role: 'assistant', content: fullReply });
              // Feed result back to AI for next step (with continuation reminder)
              await handleAITurn(
                `[命令已执行]\n命令: \`${command}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查用户的原始请求是否还有未完成的步骤，如果有请继续执行下一步。`
              );
            } else {
              // Wait for user confirmation
              send('ai_reply_end');
              try {
                const decision = await waitForConfirm(commandId);
                aiHistory.push({ role: 'assistant', content: fullReply });
                if (decision.action === 'confirm') {
                  const cmd = decision.command || command;
                  send('command_executing', { commandId });
                  const result = await executeAndCapture(cmd);
                  send('command_done', { commandId, exitCode: result.exitCode });
                  // Continue AI with result (with continuation reminder)
                  await handleAITurn(
                    `[命令已执行]\n命令: \`${cmd}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查用户的原始请求是否还有未完成的步骤，如果有请继续执行下一步。`
                  );
                } else {
                  // User rejected
                  await handleAITurn('[用户拒绝执行该命令，请给出其他建议或结束任务]');
                }
              } catch (e) {
                // Timeout or error
                send('error', { message: '命令确认超时' });
              }
            }
            return; // This turn is done; continuation handled above recursively
          }
        }
      }

      // Flush remaining text buffer
      if (textBuf.trim()) {
        send('ai_reply_chunk', { text: textBuf });
      }
      if (!commandEmitted) {
        send('ai_reply_end');
        aiHistory.push({ role: 'assistant', content: fullReply });
      }
    } catch (err) {
      console.error('AI stream error:', err);
      send('error', { message: `AI 错误: ${err.message}` });
      send('ai_reply_end');
    }
  }

  // Promise-based confirmation wait (5 min timeout)
  function waitForConfirm(commandId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingConfirms.delete(commandId);
        reject(new Error('timeout'));
      }, 5 * 60 * 1000);

      pendingConfirms.set(commandId, {
        resolve: (decision) => {
          clearTimeout(timer);
          pendingConfirms.delete(commandId);
          resolve(decision);
        },
      });
    });
  }

  // ─── WebSocket message handler ─────────────────────────────────────────────

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { type, payload = {} } = msg;

    switch (type) {
      // ── SSH Connect ──────────────────────────────────────────────────────
      case 'connect': {
        const { host, port = 22, username, password, privateKey } = payload;
        sshClient = new SSHClient();

        sshClient.on('ready', () => {
          sshClient.shell({ term: 'xterm-256color', rows: 24, cols: 210 }, (err, stream) => {
            if (err) { send('error', { message: err.message }); return; }
            sshStream = stream;
            stream.on('data', onSshData);
            stream.stderr.on('data', onSshData);
            stream.on('close', () => {
              send('disconnected');
              sshStream = null;
            });
            send('ssh_connected', { host, username });
          });
        });

        sshClient.on('error', (err) => {
          send('error', { message: `SSH 连接失败: ${err.message}` });
        });

        const connectCfg = { host, port: parseInt(port), username };
        if (privateKey) {
          connectCfg.privateKey = privateKey;
        } else {
          connectCfg.password = password;
        }
        try {
          sshClient.connect(connectCfg);
        } catch (e) {
          send('error', { message: e.message });
        }
        break;
      }

      // ── User input (command or natural language) ─────────────────────────
      case 'input': {
        if (!sshStream) { send('error', { message: '未连接到 SSH' }); return; }
        const { text } = payload;
        if (text === '') {
          sshStream.write('\r');
          return;
        }
        const kind = classifyInput(text);
        if (kind === 'natural') {
          handleAITurn(text).catch(console.error);
        } else {
          // Direct shell command
          sshStream.write(text + '\r');
        }
        break;
      }

      // ── Raw key input (for interactive programs) ─────────────────────────
      case 'raw_input': {
        if (sshStream) sshStream.write(payload.data);
        break;
      }

      // ── Command confirm ───────────────────────────────────────────────────
      case 'command_confirm': {
        const { commandId, command } = payload;
        const p = pendingConfirms.get(commandId);
        if (p) p.resolve({ action: 'confirm', command });
        break;
      }

      // ── Command reject ────────────────────────────────────────────────────
      case 'command_reject': {
        const { commandId } = payload;
        const p = pendingConfirms.get(commandId);
        if (p) p.resolve({ action: 'reject' });
        break;
      }

      // ── Terminal resize ───────────────────────────────────────────────────
      case 'resize': {
        const { rows, cols } = payload;
        if (sshStream) sshStream.setWindow(rows, cols);
        break;
      }

      // ── New AI session ────────────────────────────────────────────────────
      case 'new_session': {
        aiHistory = [];
        send('session_cleared');
        break;
      }

      // ── Update AI config (from settings dialog) ────────────────────────
      case 'update_ai_config': {
        aiClient = createAnthropicClient();
        send('config_updated');
        break;
      }

      // ── Disconnect ────────────────────────────────────────────────────────
      case 'disconnect': {
        if (sshClient) sshClient.end();
        break;
      }

      // ── Ping / pong (latency measurement) ────────────────────────────────
      case 'ping': {
        send('pong');
        break;
      }
    }
  });

  ws.on('close', () => {
    if (sshClient) sshClient.end();
    for (const [, p] of pendingConfirms) p.resolve({ action: 'reject' });
    pendingConfirms.clear();
  });

  ws.on('error', console.error);
});

server.listen(PORT, () => {
  console.log(`\n  SSH AI Shell server → http://localhost:${PORT}`);
  console.log(`  AI endpoint         → ${AI_BASE_URL}`);
  console.log(`  AI model            → ${AI_MODEL}\n`);
});
