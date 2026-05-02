'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Client: SSHClient } = require('ssh2');
const { OpenAI } = require('openai');
const Busboy = require('busboy');
const { classifyInlineInput } = require('../shared/inputClassifier');

// ProxyAgent from undici (bundled with Node.js 18+)
let ProxyAgent;
try { ({ ProxyAgent } = require('undici')); } catch { /* Node <18 or unavailable */ }

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;

// ─── Data directory ───────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const COPILOT_OPENAI_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'ssh-ai-shell/1.0',
  'Editor-Version': 'vscode/1.85.0',
  'Editor-Plugin-Version': 'copilot-chat/0.11.1',
  'Copilot-Integration-Id': 'vscode-chat',
  'X-Requested-With': 'XMLHttpRequest',
};

function readJSON(file, defaultVal) {
  const p = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return defaultVal; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

const SETTINGS_EXPORT_FORMAT = 'ssh-ai-shell/encrypted-settings';
const SETTINGS_EXPORT_VERSION = 1;
const SETTINGS_EXPORT_ALGORITHM = 'aes-256-gcm';
const SETTINGS_EXPORT_SECRET = process.env.CONFIG_EXPORT_SECRET || 'ssh-ai-shell-config-export-v1';
const SETTINGS_EXPORT_KEY = crypto.createHash('sha256').update(SETTINGS_EXPORT_SECRET).digest();
const SETTINGS_EXPORT_PREFIX = 'ssh-ai-shell-settings-v1:';

function encryptSettingsPayload(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(SETTINGS_EXPORT_ALGORITHM, SETTINGS_EXPORT_KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return SETTINGS_EXPORT_PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function isEncryptedSettingsPayload(payload) {
  return !!payload && typeof payload === 'object' && payload.format === SETTINGS_EXPORT_FORMAT;
}

function decryptLegacySettingsPayload(payload) {
  if (payload.version !== SETTINGS_EXPORT_VERSION) {
    throw new Error(`不支持的配置文件版本：${payload.version}`);
  }

  if (payload.algorithm !== SETTINGS_EXPORT_ALGORITHM) {
    throw new Error(`不支持的加密算法：${payload.algorithm}`);
  }

  if (![payload.iv, payload.tag, payload.data].every(v => typeof v === 'string' && v.length > 0)) {
    throw new Error('配置文件缺少必要的加密字段');
  }

  try {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const encrypted = Buffer.from(payload.data, 'base64');
    const decipher = crypto.createDecipheriv(SETTINGS_EXPORT_ALGORITHM, SETTINGS_EXPORT_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  } catch {
    throw new Error('配置文件解密失败，请确认文件未损坏且来自 SSH AI Shell 导出的加密备份');
  }
}

function decryptOpaqueSettingsPayload(payload) {
  const raw = String(payload || '').trim();
  if (!raw) throw new Error('配置文件内容为空');
  if (!raw.startsWith(SETTINGS_EXPORT_PREFIX)) {
    throw new Error('配置文件解密失败，请确认文件未损坏且来自 SSH AI Shell 导出的加密备份');
  }

  try {
    const body = raw.slice(SETTINGS_EXPORT_PREFIX.length);
    const packed = Buffer.from(body, 'base64url');
    if (packed.length <= 28) throw new Error('invalid-length');

    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = crypto.createDecipheriv(SETTINGS_EXPORT_ALGORITHM, SETTINGS_EXPORT_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  } catch {
    throw new Error('配置文件解密失败，请确认文件未损坏且来自 SSH AI Shell 导出的加密备份');
  }
}

function parseImportedSettingsPayload(payload) {
  if (typeof payload === 'string') {
    const raw = payload.trim();
    if (!raw) throw new Error('配置文件内容为空');

    if (raw.startsWith('{') || raw.startsWith('[')) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('文件格式错误：不是有效的配置文件');
      }
      return parseImportedSettingsPayload(parsed);
    }

    return decryptOpaqueSettingsPayload(raw);
  }

  if (isEncryptedSettingsPayload(payload)) return decryptLegacySettingsPayload(payload);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  throw new Error('配置文件格式错误：解密后的内容不是有效配置');
}

// ─── In-memory session store ──────────────────────────────────────────────────
const sessions = new Map();

// ─── Settings ─────────────────────────────────────────────────────────────────

let aiSettings = readJSON('ai-settings.json', {
  providerId: 'custom',
  baseUrl: '', apiKey: '', model: '', configured: false,
  terminalModel: '', enabledModels: [],
});

// Default whitelist rules used when auto-approve.json doesn't exist yet
const DEFAULT_WHITELIST_RULES = [
  // File & directory
  { pattern: 'pwd',             desc: '当前目录' },
  { pattern: 'cd',              desc: '返回当前目录' },
  { pattern: 'cd *',            desc: '切换目录' },
  { pattern: 'ls',              desc: '列出文件' },
  { pattern: 'ls *',            desc: 'ls 带参数' },
  { pattern: 'll',              desc: '详细列表' },
  { pattern: 'la',              desc: '显示隐藏文件' },
  { pattern: 'cat *',           desc: '查看文件' },
  { pattern: 'head *',          desc: '文件头部' },
  { pattern: 'tail *',          desc: '文件尾部' },
  { pattern: 'wc *',            desc: '统计行数' },
  { pattern: 'stat *',          desc: '文件属性' },
  { pattern: 'du *',            desc: '目录大小' },
  { pattern: 'tree *',          desc: '目录树' },
  // System info
  { pattern: 'whoami',          desc: '当前用户' },
  { pattern: 'id',              desc: '用户 ID' },
  { pattern: 'uname *',         desc: '内核信息' },
  { pattern: 'hostname',        desc: '主机名' },
  { pattern: 'uptime',          desc: '运行时长' },
  { pattern: 'date',            desc: '当前时间' },
  { pattern: 'cal',             desc: '日历' },
  { pattern: 'env',             desc: '环境变量' },
  { pattern: 'printenv',        desc: '环境变量' },
  { pattern: 'printenv *',      desc: '指定环境变量' },
  { pattern: 'echo *',          desc: '输出文本' },
  { pattern: 'history',         desc: '历史命令' },
  // Resource monitoring
  { pattern: 'df',              desc: '磁盘空间' },
  { pattern: 'df *',            desc: 'df 带参数' },
  { pattern: 'free',            desc: '内存使用' },
  { pattern: 'free *',          desc: 'free 带参数' },
  { pattern: 'ps *',            desc: '进程列表' },
  { pattern: 'top',             desc: '实时进程' },
  { pattern: 'htop',            desc: '交互式进程' },
  { pattern: 'lsblk',           desc: '块设备列表' },
  { pattern: 'lsblk *',         desc: '块设备详情' },
  { pattern: 'blkid',           desc: '块设备 UUID' },
  { pattern: 'blkid *',         desc: '指定块设备 UUID' },
  // Search & find
  { pattern: 'grep *',          desc: '文本搜索' },
  { pattern: 'egrep *',         desc: '扩展文本搜索' },
  { pattern: 'find *',          desc: '查找文件' },
  { pattern: 'which *',         desc: '命令路径' },
  { pattern: 'locate *',        desc: '快速查找' },
  { pattern: 'less *',          desc: '分页查看文件' },
  { pattern: 'more *',          desc: '分页查看文件' },
  { pattern: 'sort *',          desc: '排序输出' },
  { pattern: 'uniq *',          desc: '去重输出' },
  { pattern: 'jq *',            desc: 'JSON 查询' },
  { pattern: 'yq *',            desc: 'YAML 查询' },
  // Network
  { pattern: 'ping *',          desc: '连通性测试' },
  { pattern: 'curl *',          desc: 'HTTP 请求' },
  { pattern: 'wget *',          desc: '下载文件' },
  { pattern: 'dig *',           desc: 'DNS 查询' },
  { pattern: 'nslookup *',      desc: 'DNS 解析' },
  { pattern: 'ss *',            desc: '网络连接' },
  { pattern: 'netstat *',       desc: '网络统计' },
  { pattern: 'ip *',            desc: '网络信息' },
  { pattern: 'ifconfig *',      desc: '网卡信息' },
  { pattern: 'route *',         desc: '路由信息' },
  // Git
  { pattern: 'git status',      desc: '工作区状态' },
  { pattern: 'git log',         desc: '提交历史' },
  { pattern: 'git log *',       desc: 'log 带参数' },
  { pattern: 'git diff',        desc: '差异对比' },
  { pattern: 'git diff *',      desc: 'diff 带参数' },
  { pattern: 'git branch',      desc: '分支列表' },
  { pattern: 'git branch *',    desc: '分支操作' },
  { pattern: 'git remote *',    desc: '远程仓库' },
  { pattern: 'git show *',      desc: '提交详情' },
  { pattern: 'git tag',         desc: '标签列表' },
  { pattern: 'git reflog',      desc: '引用日志' },
  { pattern: 'git reflog *',    desc: '引用日志' },
  { pattern: 'git describe *',  desc: '描述版本' },
  { pattern: 'git rev-parse *', desc: '解析引用' },
  { pattern: 'git ls-files *',  desc: '跟踪文件列表' },
  // Docker
  { pattern: 'docker ps',       desc: '容器列表' },
  { pattern: 'docker ps *',     desc: 'ps 带参数' },
  { pattern: 'docker images',   desc: '镜像列表' },
  { pattern: 'docker logs *',   desc: '容器日志' },
  { pattern: 'docker stats *',  desc: '容器统计' },
  { pattern: 'docker inspect *',desc: '容器详情' },
  { pattern: 'docker compose ps',     desc: 'Compose 容器列表' },
  { pattern: 'docker compose ps *',   desc: 'Compose 容器列表' },
  { pattern: 'docker compose logs *', desc: 'Compose 日志' },
  // Kubernetes
  { pattern: 'kubectl get *',      desc: '资源列表' },
  { pattern: 'kubectl describe *', desc: '资源详情' },
  { pattern: 'kubectl logs *',     desc: 'Pod 日志' },
  { pattern: 'kubectl top *',      desc: '资源监控' },
  { pattern: 'kubectl config *',   desc: '集群配置' },
  // Node / NPM
  { pattern: 'node -v',         desc: 'Node 版本' },
  { pattern: 'npm -v',          desc: 'npm 版本' },
  { pattern: 'npm list *',      desc: '依赖列表' },
  { pattern: 'npm outdated',    desc: '过期包' },
];

const DEFAULT_HIGH_RISK_RULES = [
  { pattern: 'sudo *',               desc: '提权执行' },
  { pattern: 'su',                   desc: '切换用户' },
  { pattern: 'su *',                 desc: '切换用户带参数' },
  { pattern: 'doas *',               desc: '提权执行' },
  { pattern: 'passwd *',             desc: '修改账户密码' },
  { pattern: 'userdel *',            desc: '删除用户' },
  { pattern: 'usermod *',            desc: '修改用户配置' },
  { pattern: 'groupdel *',           desc: '删除用户组' },
  { pattern: 'rm *',                 desc: '删除文件/目录' },
  { pattern: 'dd *',                 desc: '磁盘覆盖/复制' },
  { pattern: 'mkfs *',               desc: '格式化文件系统' },
  { pattern: 'wipefs *',             desc: '擦除文件系统签名' },
  { pattern: 'shred *',              desc: '安全擦除文件' },
  { pattern: 'fdisk *',              desc: '磁盘分区' },
  { pattern: 'parted *',             desc: '磁盘分区' },
  { pattern: 'cfdisk *',             desc: '磁盘分区' },
  { pattern: 'truncate *',           desc: '截断文件' },
  { pattern: 'chmod -R *',           desc: '递归修改权限' },
  { pattern: 'chown -R *',           desc: '递归修改属主' },
  { pattern: 'kill *',               desc: '终止进程' },
  { pattern: 'killall *',            desc: '终止同名进程' },
  { pattern: 'pkill *',              desc: '按模式终止进程' },
  { pattern: 'reboot',               desc: '重启系统' },
  { pattern: 'shutdown *',           desc: '关机/重启' },
  { pattern: 'halt',                 desc: '停止系统' },
  { pattern: 'poweroff',             desc: '关闭电源' },
  { pattern: '/^init\s*[016](\s|$)/', desc: '切换运行级别' },
  { pattern: 'systemctl stop *',     desc: '停止服务' },
  { pattern: 'systemctl disable *',  desc: '禁用服务' },
  { pattern: 'systemctl mask *',     desc: '屏蔽服务' },
  { pattern: 'systemctl kill *',     desc: '强制停止服务' },
  { pattern: 'iptables *',           desc: '修改防火墙规则' },
  { pattern: 'ufw disable',          desc: '关闭防火墙' },
  { pattern: 'ufw delete *',         desc: '删除防火墙规则' },
  { pattern: 'docker stop *',        desc: '停止容器' },
  { pattern: 'docker kill *',        desc: '强制终止容器' },
  { pattern: 'docker rm *',          desc: '删除容器' },
  { pattern: 'docker rmi *',         desc: '删除镜像' },
  { pattern: 'docker compose down *',desc: '停止并删除 Compose 资源' },
  { pattern: 'docker compose rm *',  desc: '删除 Compose 容器' },
  { pattern: 'kubectl delete *',     desc: '删除 Kubernetes 资源' },
  { pattern: 'kubectl scale *',      desc: '调整副本数量' },
  { pattern: 'helm uninstall *',     desc: '卸载 Helm 发布' },
  { pattern: 'crontab -r',           desc: '删除当前用户定时任务' },
  { pattern: '/^curl\\b.*\\|\\s*(bash|sh|zsh|fish)(\\s|$)/', desc: '管道执行脚本' },
  { pattern: '/^wget\\b.*\\|\\s*(bash|sh)(\\s|$)/',          desc: '管道执行脚本' },
];

function toRuleList(list, prefix = 'rule') {
  return Array.isArray(list)
    ? list
        .filter(item => item && typeof item.pattern === 'string' && item.pattern.trim())
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id.trim()
            ? item.id
            : `${prefix}_${index}_${item.pattern.replace(/[\s/*]/g, '_').slice(0, 24)}`,
          pattern: item.pattern.trim(),
          enabled: item.enabled !== false,
          description: typeof item.description === 'string'
            ? item.description.trim() || undefined
            : typeof item.desc === 'string'
              ? item.desc.trim() || undefined
              : undefined,
        }))
    : [];
}

function mergeRuleListWithDefaults(currentRules, defaultRules, prefix) {
  const current = toRuleList(currentRules, prefix);
  const defaults = toRuleList(defaultRules, `${prefix}_default`);
  const seenPatterns = new Set(current.map(rule => rule.pattern));
  const merged = [...current];

  for (const rule of defaults) {
    if (seenPatterns.has(rule.pattern)) continue;
    merged.push(rule);
  }

  return merged;
}

function normalizeAutoApproveSettings(raw = {}) {
  return {
    globalAutoApprove: {
      low: !!raw.globalAutoApprove?.low,
      normal: !!raw.globalAutoApprove?.normal,
      high: !!raw.globalAutoApprove?.high,
    },
    rules: toRuleList(raw.rules, 'whitelist'),
    rulesConfigured: raw.rulesConfigured === true,
    highRiskRules: toRuleList(raw.highRiskRules, 'highrisk'),
    highRiskRulesConfigured: raw.highRiskRulesConfigured === true,
  };
}

function ensureDefaultCommandRules(settings, options = {}) {
  const { backfillWhitelist = false, backfillHighRisk = false } = options;
  return {
    ...settings,
    rules: backfillWhitelist
      ? mergeRuleListWithDefaults(settings.rules, DEFAULT_WHITELIST_RULES, 'whitelist')
      : settings.rules,
    rulesConfigured: true,
    highRiskRules: backfillHighRisk
      ? mergeRuleListWithDefaults(settings.highRiskRules, DEFAULT_HIGH_RISK_RULES, 'highrisk')
      : settings.highRiskRules,
    highRiskRulesConfigured: true,
  };
}

const _autoApproveExists = fs.existsSync(path.join(DATA_DIR, 'auto-approve.json'));
const _rawAutoApproveSettings = readJSON('auto-approve.json', {
  globalAutoApprove: { low: true, normal: false, high: false },
  rules: [],
  highRiskRules: [],
});
let autoApproveSettings = normalizeAutoApproveSettings(_rawAutoApproveSettings);
if (!_autoApproveExists) {
  autoApproveSettings = ensureDefaultCommandRules(autoApproveSettings, {
    backfillWhitelist: true,
    backfillHighRisk: true,
  });
  writeJSON('auto-approve.json', autoApproveSettings);
  console.log(`[auto-approve] Initialized with ${autoApproveSettings.rules.length} default whitelist rules and ${autoApproveSettings.highRiskRules.length} high-risk rules`);
} else if (_rawAutoApproveSettings.rulesConfigured !== true || _rawAutoApproveSettings.highRiskRulesConfigured !== true) {
  autoApproveSettings = ensureDefaultCommandRules(autoApproveSettings, {
    backfillWhitelist: _rawAutoApproveSettings.rulesConfigured !== true,
    backfillHighRisk: _rawAutoApproveSettings.highRiskRulesConfigured !== true,
  });
  writeJSON('auto-approve.json', autoApproveSettings);
  console.log(`[auto-approve] Backfilled defaults for existing config: whitelist=${autoApproveSettings.rules.length}, highRisk=${autoApproveSettings.highRiskRules.length}`);
}

let appSettings = readJSON('app-settings.json', {
  showStatusBar: true,
  language: 'zh-CN',
  proxy: '',
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
  const t = command.trim();
  if (p.startsWith('/') && p.endsWith('/') && p.length > 2) {
    try { return new RegExp(p.slice(1, -1)).test(t); } catch { return false; }
  }
  if (p.includes('*')) {
    const re = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${re}$`).test(t);
  }
  if (p === t) return true;
  return t.startsWith(p) && /\s/.test(t.charAt(p.length));
}

function isForcedHighRisk(command) {
  return (autoApproveSettings.highRiskRules || []).some(r => r.enabled && matchesPattern(r.pattern, command));
}

function getEffectiveRisk(command, suggestedRisk = 'normal') {
  if (isForcedHighRisk(command)) return 'high';
  return suggestedRisk;
}

function shouldAutoApprove(command, risk) {
  // High-risk commands always require explicit user confirmation — no mode can bypass this.
  if (risk === 'high') return false;
  const execMode = aiSettings.agentExecMode;
  // Full auto mode: approve everything (except high, already handled above)
  if (execMode === 'auto_approve_all') return true;
  // Ask each: never auto-approve
  if (execMode === 'ask_each') return false;
  // Whitelist mode (default): check rules only — no risk-level toggles
  const s = autoApproveSettings;
  if (s.globalAutoApprove && s.globalAutoApprove[risk]) return true;
  return (s.rules || []).some(r => r.enabled && matchesPattern(r.pattern, command));
}

function getSelectedProviderId() {
  return typeof aiSettings.providerId === 'string' && aiSettings.providerId.trim()
    ? aiSettings.providerId.trim()
    : 'custom';
}

function hasCustomAIConfig(settings = aiSettings) {
  return !!(
    (settings.baseUrl || '').trim() &&
    (settings.apiKey || '').trim() &&
    (settings.model || '').trim()
  );
}

function isAIConfigured() {
  if (getSelectedProviderId() === 'copilot') {
    return !!copilotState.githubToken;
  }
  return hasCustomAIConfig();
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

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '01ab8ac9400c4e429b23';

function normalizeHeaderObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function parseJSONSafe(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function shouldUsePowerShellNetworkFallback(url, error) {
  if (process.platform !== 'win32') return false;
  if (!/^https:\/\/(github\.com|api\.github\.com|api\.githubcopilot\.com)\//i.test(url)) return false;

  const message = String(error?.message || '').toLowerCase();
  const causeCode = String(error?.cause?.code || error?.code || '').toUpperCase();
  return message.includes('fetch failed')
    || message.includes('timeout')
    || message.includes('connect')
    || causeCode.startsWith('UND_ERR_');
}

/** Normalise a proxy URL string: add http:// scheme when omitted. */
function normaliseProxyUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  // Already has a supported scheme
  if (/^https?:\/\//i.test(s) || /^socks5?:\/\//i.test(s)) return s;
  // host:port or host — assume http
  return 'http://' + s;
}

/** Returns a ProxyAgent instance if a proxy URL is configured, otherwise undefined. */
function getProxyDispatcher() {
  const raw = (appSettings.proxy || '').trim();
  if (!raw || !ProxyAgent) return undefined;
  const url = normaliseProxyUrl(raw);
  try { return new ProxyAgent(url); } catch (e) {
    console.warn('[proxy] Invalid proxy URL:', url, e.message);
    return undefined;
  }
}

function runPowerShellScript(script) {
  return new Promise((resolve, reject) => {
    const candidates = process.platform === 'win32' ? ['pwsh', 'powershell'] : [];

    function tryNext(index, lastError) {
      if (index >= candidates.length) {
        reject(lastError || new Error('No PowerShell runtime available'));
        return;
      }

      const child = spawn(candidates[index], ['-NoProfile', '-NonInteractive', '-Command', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });

      child.on('error', err => {
        if (settled) return;
        settled = true;
        if (err.code === 'ENOENT') {
          tryNext(index + 1, err);
          return;
        }
        reject(err);
      });

      child.on('close', code => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }
        reject(new Error(stderr.trim() || stdout.trim() || `PowerShell exited with code ${code}`));
      });

      child.stdin.end(script);
    }

    tryNext(0, null);
  });
}

async function requestTextViaPowerShell(url, options = {}) {
  const request = {
    url,
    method: options.method || 'GET',
    headers: normalizeHeaderObject(options.headers),
    body: typeof options.body === 'string' ? options.body : (options.body == null ? '' : String(options.body)),
    timeoutSec: 30,
    proxy: normaliseProxyUrl(appSettings.proxy || ''),
  };

  const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
  const script = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 } catch {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
}
$raw = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}'))
$req = $raw | ConvertFrom-Json
$headers = @{}
if ($req.headers) {
  $req.headers.PSObject.Properties | ForEach-Object {
    $headers[$_.Name] = [string]$_.Value
  }
}
$params = @{
  Uri = [string]$req.url
  Method = [string]$req.method
  Headers = $headers
  TimeoutSec = [int]$req.timeoutSec
  UseBasicParsing = $true
}
if ($req.body -ne '') {
  $params.Body = [string]$req.body
}
if ($req.proxy -ne '') {
  $params.Proxy = [string]$req.proxy
}
try {
  $resp = Invoke-WebRequest @params -ErrorAction Stop
  [pscustomobject]@{
    ok = $true
    status = [int]$resp.StatusCode
    body = [string]$resp.Content
    error = $null
  } | ConvertTo-Json -Compress -Depth 8
} catch {
  $resp = $_.Exception.Response
  $status = 0
  $body = ''
  if ($resp) {
    try { $status = [int]$resp.StatusCode } catch {}
    try {
      $sr = [System.IO.StreamReader]::new($resp.GetResponseStream())
      $body = $sr.ReadToEnd()
      $sr.Close()
    } catch {
      try { $body = [string]$resp.Content } catch {}
    }
  }
  $msg = $_.ErrorDetails.Message
  if (-not $msg) { $msg = $_.Exception.Message }
  [pscustomobject]@{
    ok = $false
    status = $status
    body = [string]$body
    error = [string]$msg
  } | ConvertTo-Json -Compress -Depth 8
}
`;

  const output = await runPowerShellScript(script);
  const parsed = parseJSONSafe(output);
  if (!parsed || typeof parsed !== 'object') {
    const preview = (output || '').slice(0, 500);
    console.warn(`[copilot] PowerShell fallback raw output for ${url}:`, preview || '<empty>');
    throw new Error(`PowerShell fallback returned invalid response for ${url}`);
  }

  return {
    ok: !!parsed.ok,
    status: Number(parsed.status) || 0,
    text: String(parsed.body || ''),
    error: parsed.error ? String(parsed.error) : null,
    via: 'powershell',
  };
}

async function requestTextWithWindowsFallback(url, options = {}) {
  try {
    const dispatcher = getProxyDispatcher();
    const res = await fetch(url, dispatcher ? { ...options, dispatcher } : options);
    return {
      ok: res.ok,
      status: res.status,
      text: await res.text(),
      error: null,
      via: 'fetch',
    };
  } catch (error) {
    if (!shouldUsePowerShellNetworkFallback(url, error)) throw error;
    console.warn(`[copilot] fetch failed for ${url}, retrying with PowerShell:`, error?.cause?.code || error?.message || error);
    return requestTextViaPowerShell(url, options);
  }
}

async function requestJSONWithWindowsFallback(url, options = {}) {
  const result = await requestTextWithWindowsFallback(url, options);
  return {
    ...result,
    data: parseJSONSafe(result.text),
  };
}

async function refreshCopilotTokenIfNeeded() {
  if (!copilotState.githubToken) return null;
  const now = Date.now();
  if (copilotState.copilotToken && copilotState.copilotTokenExpiry > now + 60_000) {
    return copilotState.copilotToken;
  }
  try {
    const res = await requestJSONWithWindowsFallback('https://api.github.com/copilot_internal/v2/token', {
      headers: {
        Authorization: `token ${copilotState.githubToken}`,
        Accept: 'application/json',
        'Copilot-Integration-Id': 'vscode-chat',
        'Editor-Version': 'vscode/1.85.0',
        'Editor-Plugin-Version': 'copilot-chat/0.11.1',
        'User-Agent': 'GitHubCopilotChat/0.11.1',
      },
    });
    if (!res.ok) {
      console.warn('Copilot token refresh failed:', res.status, res.text || res.error || '<empty body>');
      return null;
    }
    const data = res.data;
    if (!data?.token) {
      console.warn('Copilot token refresh returned invalid payload:', res.text || '<empty body>');
      return null;
    }
    copilotState.copilotToken = data.token;
    copilotState.copilotTokenExpiry = (data.expires_at ?? (now / 1000 + 1800)) * 1000;
    writeJSON('copilot-auth.json', copilotState);
    return copilotState.copilotToken;
  } catch (e) {
    console.warn('Copilot token refresh error:', e.message);
    return null;
  }
}

function createCopilotClient(token) {
  const dispatcher = getProxyDispatcher();
  return new OpenAI({
    apiKey: token,
    baseURL: 'https://api.githubcopilot.com',
    defaultHeaders: COPILOT_OPENAI_HEADERS,
    // Route all OpenAI SDK requests through the proxy when configured
    ...(dispatcher ? {
      fetch: (url, opts) => fetch(url, { ...opts, dispatcher }),
    } : {}),
  });
}

function shouldRetryWithMaxCompletionTokens(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('max_tokens')
    || message.includes('max_completion_tokens')
    || message.includes('unsupported_parameter')
    || message.includes('unsupported parameter');
}

async function createChatCompletionWithFallback(client, options) {
  try {
    return await client.chat.completions.create(options);
  } catch (error) {
    if (!shouldRetryWithMaxCompletionTokens(error) || options.max_completion_tokens !== undefined) {
      throw error;
    }

    const retryOptions = { ...options };
    if (retryOptions.max_tokens !== undefined) {
      retryOptions.max_completion_tokens = retryOptions.max_tokens;
      delete retryOptions.max_tokens;
    }
    return client.chat.completions.create(retryOptions);
  }
}

// ─── AI Client factory ────────────────────────────────────────────────────────

async function createAIClientAsync() {
  if (getSelectedProviderId() === 'copilot') {
    if (!copilotState.githubToken) return null;
    const token = await refreshCopilotTokenIfNeeded();
    if (token) {
      return createCopilotClient(token);
    }
    return null;
  }
  if (!aiSettings.baseUrl || !aiSettings.apiKey || !aiSettings.model) return null;
  const dispatcher = getProxyDispatcher();
  return new OpenAI({
    apiKey: aiSettings.apiKey,
    baseURL: aiSettings.baseUrl,
    ...(dispatcher ? { fetch: (url, opts) => fetch(url, { ...opts, dispatcher }) } : {}),
  });
}

function getActiveModel() {
  if (getSelectedProviderId() === 'copilot') return copilotState.model || 'gpt-4o';
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
  const updatable = ['providerId', 'baseUrl', 'apiKey', 'model', 'terminalModel', 'enabledModels', 'enableCommandExplain', 'enableAIAssistant', 'enableAutoComplete', 'agentExecMode', 'commandWhitelist', 'providerConfigs'];
  for (const k of updatable) {
    if (req.body[k] !== undefined) aiSettings[k] = req.body[k];
  }
  aiSettings.configured = getSelectedProviderId() === 'copilot'
    ? !!copilotState.githubToken
    : hasCustomAIConfig(aiSettings);
  writeJSON('ai-settings.json', aiSettings);
  res.json({ ...aiSettings, configured: isAIConfigured() });
});

// Reset AI credentials — clears provider/key/models but keeps behaviour prefs
app.delete('/api/ai-settings', (req, res) => {
  aiSettings = {
    providerId: 'custom',
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
    const stream = await createChatCompletionWithFallback(client, {
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
  autoApproveSettings = ensureDefaultCommandRules(normalizeAutoApproveSettings({
    globalAutoApprove: req.body.globalAutoApprove || autoApproveSettings.globalAutoApprove,
    rules: req.body.rules !== undefined ? req.body.rules : autoApproveSettings.rules,
    rulesConfigured: true,
    highRiskRules: req.body.highRiskRules !== undefined ? req.body.highRiskRules : autoApproveSettings.highRiskRules,
    highRiskRulesConfigured: true,
  }));
  writeJSON('auto-approve.json', autoApproveSettings);
  res.json(autoApproveSettings);
});

// ─── App Settings ──────────────────────────────────────────────────────────────

app.get('/api/app-settings', (_, res) => res.json(appSettings));

app.put('/api/app-settings', (req, res) => {
  const allowedKeys = ['showStatusBar', 'language', 'proxy'];
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
      const resp = await createChatCompletionWithFallback(client, {
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
      client = createCopilotClient(token);
    } else {
      if (!baseUrl || !apiKey) return res.status(400).json({ error: 'missing params' });
      client = new OpenAI({ apiKey, baseURL: baseUrl });
    }
    const t0 = Date.now();
    const resp = await createChatCompletionWithFallback(client, {
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
  const loggedInAtStart = !!(copilotState.githubToken);
  let models = [];
  if (loggedInAtStart) {
    try {
      const token = await refreshCopilotTokenIfNeeded();
      if (token) {
        const r = await requestJSONWithWindowsFallback('https://api.githubcopilot.com/models', {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Copilot-Integration-Id': 'vscode-chat',
            'Editor-Version': 'vscode/1.85.0',
            'Editor-Plugin-Version': 'copilot-chat/0.11.1',
            'User-Agent': 'GitHubCopilotChat/0.11.1',
          },
        });
        if (r.ok) {
          const d = r.data || {};
          models = (d.data || d.models || []).map(m => m.id || m.name).filter(Boolean);
        } else {
          console.warn('[copilot] models API returned', r.status, (r.text || '').slice(0, 200));
        }
      }
    } catch (e) {
      console.warn('[copilot] failed to fetch models:', e.message);
    }
  }
  // Re-evaluate loggedIn at response time — user may have logged out while async ops were in flight
  res.json({ loggedIn: !!(copilotState.githubToken), username: copilotState.username, model: copilotState.model, models });
});

app.post('/api/copilot/device-start', async (_, res) => {
  try {
    // Cancel any existing flow
    if (copilotDeviceFlow?.pollTimer) clearTimeout(copilotDeviceFlow.pollTimer);
    copilotDeviceFlow = null;

    const r = await requestJSONWithWindowsFallback('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID }).toString(),
    });
    if (!r.ok) throw new Error(r.text || r.error || `GitHub API error: ${r.status}`);
    const data = r.data;
    if (!data?.device_code || !data?.user_code || !data?.verification_uri) {
      throw new Error('GitHub 返回了无效的设备授权响应');
    }

    copilotDeviceFlow = {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires: Date.now() + (data.expires_in || 900) * 1000,
      interval: (data.interval || 5) * 1000,
      status: 'waiting',
      pollTimer: null,
    };

    // Start polling using recursive setTimeout so the interval can be dynamically
    // updated (e.g. when GitHub returns slow_down).
    function scheduleCopilotPoll() {
      if (!copilotDeviceFlow) return;
      copilotDeviceFlow.pollTimer = setTimeout(async () => {
        if (!copilotDeviceFlow || Date.now() > copilotDeviceFlow.expires) {
          copilotDeviceFlow = null;
          return;
        }
        try {
          const pr = await requestJSONWithWindowsFallback('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: GITHUB_CLIENT_ID,
              device_code: copilotDeviceFlow.device_code,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }).toString(),
          });
          const pd = pr.data || {};
          if (pd.access_token) {
            copilotState.githubToken = pd.access_token;
            // Fetch username
            const uRes = await requestJSONWithWindowsFallback('https://api.github.com/user', {
              headers: { Authorization: `Bearer ${pd.access_token}`, Accept: 'application/json' },
            });
            if (uRes.ok) {
              const u = uRes.data || {};
              copilotState.username = u.login;
            }
            copilotState.copilotToken = null; // force refresh
            copilotState.copilotTokenExpiry = 0;
            copilotState.model = copilotState.model || 'gpt-4o';
            writeJSON('copilot-auth.json', copilotState);
            copilotDeviceFlow.status = 'success';
            copilotDeviceFlow.error = null;
            // Do NOT reschedule — flow is complete.
          } else if (pd.error === 'slow_down') {
            // GitHub asks us to poll less frequently; honour the new interval by
            // rescheduling (recursive setTimeout picks up the updated value).
            copilotDeviceFlow.interval = Math.max(copilotDeviceFlow.interval + 5000, 10000);
            scheduleCopilotPoll();
          } else if (pd.error && pd.error !== 'authorization_pending') {
            copilotDeviceFlow.status = 'error';
            copilotDeviceFlow.error = pd.error_description || pd.error;
            // Do NOT reschedule — flow is in a terminal error state.
          } else if (!pr.ok && !pd.error) {
            // Non-JSON / proxy error response — treat as transient, keep polling
            // but log so it's visible in server output.
            console.warn(`[copilot] device-poll HTTP ${pr.status}: ${(pr.text || '').slice(0, 200)}`);
            scheduleCopilotPoll();
          } else {
            // authorization_pending — normal, reschedule and keep waiting.
            scheduleCopilotPoll();
          }
        } catch (e) {
          if (copilotDeviceFlow) {
            copilotDeviceFlow.status = 'error';
            copilotDeviceFlow.error = e.message || '轮询 GitHub 授权状态失败';
          }
        }
      }, copilotDeviceFlow.interval);
    }
    scheduleCopilotPoll();

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
  if (!copilotDeviceFlow) {
    if (copilotState.githubToken) {
      return res.json({ status: 'success', username: copilotState.username });
    }
    return res.json({ status: 'none' });
  }
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
  if (copilotDeviceFlow?.pollTimer) clearTimeout(copilotDeviceFlow.pollTimer);
  copilotDeviceFlow = null;
  copilotState = { githubToken: null, username: null, copilotToken: null, copilotTokenExpiry: 0, model: 'gpt-4o' };
  writeJSON('copilot-auth.json', copilotState);
  if (getSelectedProviderId() === 'copilot') {
    aiSettings.configured = false;
    writeJSON('ai-settings.json', aiSettings);
  }
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
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(encryptSettingsPayload(data));
});

app.post('/api/import-settings', express.text({ type: ['text/plain', 'application/octet-stream'], limit: '10mb' }), (req, res) => {
  try {
    const imported = parseImportedSettingsPayload(req.body);
    if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
      throw new Error('配置文件格式错误：解密后的内容不是有效配置');
    }

    const { hosts, aiSettings: ai, autoApprove, appSettings: appS, savedCommands, mcpServers, skills } = imported;
    if (Array.isArray(hosts)) writeJSON('hosts.json', hosts);
    if (ai && typeof ai === 'object') { writeJSON('ai-settings.json', ai); Object.assign(aiSettings, ai); }
    if (autoApprove) {
      autoApproveSettings = ensureDefaultCommandRules(
        normalizeAutoApproveSettings(autoApprove),
        {
          backfillWhitelist: autoApprove.rulesConfigured !== true,
          backfillHighRisk: autoApprove.highRiskRulesConfigured !== true,
        },
      );
      writeJSON('auto-approve.json', autoApproveSettings);
    }
    if (appS && typeof appS === 'object') { writeJSON('app-settings.json', appS); Object.assign(appSettings, appS); }
    if (Array.isArray(savedCommands)) writeJSON('saved-commands.json', savedCommands);
    if (Array.isArray(mcpServers)) writeJSON('mcp-servers.json', mcpServers);
    if (Array.isArray(skills)) writeJSON('skills.json', skills);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── SFTP HTTP endpoints ──────────────────────────────────────────────────────

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

app.post('/api/sftp/upload', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const uploadPath = typeof req.query.path === 'string' ? req.query.path : '';
  const uploadId = typeof req.query.uploadId === 'string' ? req.query.uploadId : '';
  if (!token || !uploadPath) return res.status(400).json({ error: 'Missing params' });

  const session = sessions.get(token);
  if (!session?.sftp) return res.status(401).json({ error: 'Session not found' });

  const headerSize = Number.parseInt(String(req.headers['x-file-size'] || ''), 10);
  const total = Number.isFinite(headerSize) && headerSize >= 0 ? headerSize : 0;
  const sessionWs = session.ws;
  let responded = false;
  let fileHandled = false;
  let writeStream = null;
  let targetPath = '';
  let filename = '';
  let uploadedBytes = 0;
  let uploadCompleted = false;

  function cleanupPartialUpload() {
    if (!targetPath || uploadedBytes <= 0 || uploadCompleted) return;
    session.sftp.unlink(targetPath, () => {});
  }

  function sendProgress(bytes, done = false) {
    if (sessionWs?.readyState === 1 /* OPEN */) {
      sessionWs.send(JSON.stringify({
        type: 'sftp_upload_progress',
        payload: {
          uploadId,
          percent: done
            ? 100
            : total > 0
              ? Math.min(99, Math.round((bytes / total) * 100))
              : 0,
          bytes,
          total,
          filename,
          done,
        },
      }));
    }
  }

  function replyError(status, error) {
    if (responded) return;
    responded = true;
    if (writeStream) writeStream.destroy();
    cleanupPartialUpload();
    res.status(status).json({ error });
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: { files: 1, fileSize: 500 * 1024 * 1024 },
  });

  busboy.on('file', (_field, file, info) => {
    if (fileHandled) {
      file.resume();
      return;
    }

    fileHandled = true;
    filename = info?.filename || 'upload.bin';
    targetPath = uploadPath.endsWith('/')
      ? uploadPath + filename
      : uploadPath + '/' + filename;
    writeStream = session.sftp.createWriteStream(targetPath);

    file.on('limit', () => replyError(413, '文件过大'));
    file.on('error', (e) => replyError(500, e.message));
    file.on('data', (chunk) => {
      uploadedBytes += chunk.length;
      sendProgress(uploadedBytes);
    });

    writeStream.on('close', () => {
      if (responded) return;
      responded = true;
      uploadCompleted = true;
      sendProgress(total > 0 ? total : uploadedBytes, true);
      res.json({ ok: true, path: targetPath, uploadId });
    });
    writeStream.on('error', (e) => replyError(500, e.message));

    file.pipe(writeStream);
  });

  busboy.on('filesLimit', () => replyError(400, '一次只能上传一个文件'));
  busboy.on('error', (e) => replyError(400, e.message));
  busboy.on('finish', () => {
    if (!fileHandled) replyError(400, 'No file');
  });

  req.on('aborted', () => replyError(499, '上传已中断'));
  req.pipe(busboy);
});

// ─── Static frontend ──────────────────────────────────────────────────────────

const distDir = path.join(__dirname, '../dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  app.get('*', (_, res) => res.sendFile(path.join(distDir, 'index.html')));
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
  // Keep this conservative: only accept a single trailing line that does not
  // contain CJK text, otherwise summaries like "nginx 容器已成功启动..." get
  // mistaken for a command.
  const lastNonEmptyLine = [...lines].reverse().find(line => line.trim());
  if (lastNonEmptyLine && !/[\u4e00-\u9fff]/.test(lastNonEmptyLine)) {
    const tailCmd = normalizeExtractedCommand(lastNonEmptyLine);
    if (tailCmd) return tailCmd;
  }

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
  const stream = await createChatCompletionWithFallback(client, {
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
  let activeAITask = null;
  let aiTaskSeq = 0;
  let suppressCancelEchoUntil = 0; // suppress ^C echo after cancelActiveAITask sends \x03

  // Buffer for batching rapid SSH data chunks → fewer React renders
  let outputBuf = '';
  let outputTimer = null;
  let rawTerminalMode = false;
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

  function createAITask() {
    return { id: `ai_task_${++aiTaskSeq}`, cancelled: false };
  }

  function isAITaskCancelled(task, signal) {
    return Boolean(task?.cancelled || signal?.aborted);
  }

  function cancelActiveAITask() {
    if (activeAITask) activeAITask.cancelled = true;

    if (aiAbortController) {
      aiAbortController.abort();
      aiAbortController = null;
    }

    if (captureState) {
      const state = captureState;
      captureState = null;
      const visibleText = drainVisibleCaptureText(state, '', true);
      if (visibleText) send('terminal_output', { data: visibleText });
      try { if (sshStream) { sshStream.write('\x03'); suppressCancelEchoUntil = Date.now() + 500; } } catch {}
      state.resolve({ output: '(已中断)', exitCode: 130, interrupted: true });
    }

    for (const [, entry] of pendingConfirms) {
      entry.resolve({ action: 'cancel' });
    }
    pendingConfirms.clear();
  }

  function updateCtx(line) {
    const m1 = line.match(/\[([^@\]]+)@([^\s\]]+)\s+([^\]]+)\][\$#]/);
    if (m1) { shellCtx.user = m1[1]; shellCtx.host = m1[2]; shellCtx.cwd = m1[3]; return; }
    const m2 = line.match(/([^@]+)@([^:]+):([^\$#]+)[\$#]/);
    if (m2) { shellCtx.user = m2[1]; shellCtx.host = m2[2]; shellCtx.cwd = m2[3]; }
  }

  // Regex to detect any line that contains our capture markers (all start with SSHAI_)
  const MARKER_RE = /SSHAI_\d+_END(?::\d+)?/;

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function parseCaptureCompletion(state) {
    const stripped = stripAnsi(state.buffer || '');
    const doneRe = new RegExp(`(?:^|[\\r\\n])${escapeRegExp(state.marker)}:(\\d+)(?=$|[\\r\\n])`);
    const match = stripped.match(doneRe);
    if (!match) return null;

    const exitCode = parseInt(match[1], 10);
    const output = stripped
      .replace(/\r/g, '')
      .split('\n')
      .filter(line => !MARKER_RE.test(line))
      .join('\n')
      .trim();

    return { output, exitCode };
  }

  function drainVisibleCaptureText(state, text = '', flush = false) {
    state.forwardBuffer = (state.forwardBuffer || '') + text;
    const source = state.forwardBuffer;
    let output = '';
    let cursor = 0;

    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch !== '\n' && ch !== '\r') continue;

      let end = i + 1;
      if (ch === '\r' && source[i + 1] === '\n') {
        end = i + 2;
        i++;
      }

      const segment = source.slice(cursor, end);
      const plain = stripAnsi(segment).replace(/[\r\n]+$/g, '');
      if (!MARKER_RE.test(plain)) output += segment;
      cursor = end;
    }

    const remainder = source.slice(cursor);
    if (flush) {
      const plain = stripAnsi(remainder).replace(/[\r\n]+$/g, '');
      if (remainder && !MARKER_RE.test(plain)) output += remainder;
      state.forwardBuffer = '';
    } else {
      state.forwardBuffer = remainder;
    }

    return output;
  }

  function onSshData(data) {
    let text = data.toString();
    for (const line of text.split('\n')) updateCtx(line);

    if (captureState) {
      // Flush any pending buffered output first so ordering is preserved
      if (outputBuf) { clearTimeout(outputTimer); flushOutput(); }
      captureState.buffer += text;
      const completed = parseCaptureCompletion(captureState);
      if (completed) {
        const state = captureState;
        const { resolve } = state;
        const visibleText = drainVisibleCaptureText(state, text, true);
        captureState = null;
        resolve(completed);
        if (visibleText) send('terminal_output', { data: visibleText });
        return;
      }
      const visibleText = drainVisibleCaptureText(captureState, text);
      if (visibleText) send('terminal_output', { data: visibleText });
      return;
    }

    // Normal path: buffer for 16 ms so rapid successive chunks are merged into
    // a single WebSocket message → single React render → snappier feel
    if (suppressCancelEchoUntil > Date.now()) {
      // Strip ^C echo that the shell sends back after we write \x03 to cancel
      text = text.replace(/\^C/g, '');
      if (!text.replace(/[\r\n]/g, '')) return; // skip if nothing left after stripping
    }

    if (rawTerminalMode) {
      if (outputBuf) {
        clearTimeout(outputTimer);
        flushOutput();
      }
      send('terminal_output', { data: text });
      return;
    }

    outputBuf += text;
    if (!outputTimer) outputTimer = setTimeout(flushOutput, 16);
  }

  // Detect commands that need a real interactive TTY and cannot be captured.
  // These are written directly to the SSH stream so the user's terminal takes over.
  function isInteractiveCommand(command) {
    const cmd = command.trim();
    // docker exec/run with -i or -t flags (e.g. -it, -ti, -i -t)
    if (/^docker\s+(exec|run)\s+/.test(cmd) && /-[a-zA-Z]*[it]/.test(cmd)) return true;
    // ssh / mosh connections
    if (/^(ssh|mosh)\s/.test(cmd)) return true;
    // su (switch user)
    if (/^su(\s|$)/.test(cmd)) return true;
    // sudo dropping into a shell (sudo -s, sudo -i, sudo bash, sudo sh …)
    if (/^sudo\s+/.test(cmd) && /(\s(-s|-i)(\s|$)|\s(bash|sh|zsh|fish|dash|csh|tcsh|ksh)(\s|$))/.test(cmd)) return true;
    if (/^sudo\s+(-[a-zA-Z]+\s+)*(-s|-i)\s*$/.test(cmd)) return true;
    // bare shell invocations with no script file (bash, sh, zsh …)
    if (/^(bash|sh|zsh|fish|dash|csh|tcsh|ksh)(\s+-[a-zA-Z]+)*\s*$/.test(cmd)) return true;
    // interactive interpreters without a script argument
    if (/^(python[23]?|ipython3?|bpython|node|nodejs|irb|pry)\s*$/.test(cmd)) return true;
    // database / service CLIs
    if (/^(mysql|psql|redis-cli|mongo|mongosh|sqlite3|clickhouse-client)\b/.test(cmd)) return true;
    // terminal multiplexers
    if (/^(screen|tmux)\b/.test(cmd)) return true;
    // full-screen editors
    if (/^(vim|vi|nvim|nano|emacs|pico|joe|micro)\b/.test(cmd)) return true;
    // interactive monitoring / file-manager tools
    if (/^(top|htop|btop|iotop|atop|nmon|ncdu|mc|ranger)\s*$/.test(cmd)) return true;
    return false;
  }

  // Inject a fake "prompt + command" line into the terminal so the user can see
  // what command the AI is executing (executeAndCapture suppresses the shell's
  // own echo because the wrapped command contains the SSHAI marker).
  function sendCommandEcho(command) {
    const u = shellCtx.user || 'user';
    const h = shellCtx.host || 'host';
    const d = shellCtx.cwd || '~';
    const ch = u === 'root' ? '#' : '$';
    send('terminal_output', { data: '\r\n[' + u + '@' + h + ' ' + d + ']' + ch + ' ' + command + '\r\n' });
  }

  function executeAndCapture(command) {
    return new Promise((resolve) => {
      const marker = `SSHAI_${Date.now()}_END`;
      // Disable interactive pagers so AI-executed commands never block on pagination
      const noPager = 'PAGER=cat MANPAGER=cat GIT_PAGER=cat';
      const wrapped = `(${noPager} sh -c ${JSON.stringify(command)}); echo "${marker}:$?"`;
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; captureState = null; resolve({ output: '(超时)', exitCode: -1 }); }
      }, 30000);
      captureState = {
        marker, buffer: '',
        forwardBuffer: '',
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

每次只输出一条命令，等待结果后再继续。多步任务逐步完成，不要提前停止。

【禁止创建临时文件】严禁创建任何临时脚本文件（如 .sh、.py、.tmp 等）来辅助执行任务。需要多步操作时，必须使用分号或 && 将命令链接在一行内，或拆分为多个独立命令依次执行，不得写入磁盘再执行。

【交互式命令说明】docker exec -it、ssh、su、vim、htop 等需要终端交互的命令可以正常输出，系统会直接写入终端让用户接管，不会捕获输出。`;

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

  function getThinkingStatusMessage(userMessage, turnCount) {
    if (turnCount <= 1) return '正在分析你的请求...';
    if (userMessage.startsWith('[命令已执行]')) return '正在分析命令执行结果...';
    if (userMessage.startsWith('[MCP工具调用结果]')) return '正在分析工具返回结果...';
    if (userMessage.startsWith('[MCP工具调用失败]')) return '正在分析工具调用失败原因...';
    if (userMessage.startsWith('[用户拒绝执行')) return '正在调整执行方案...';
    return '正在继续处理...';
  }

  async function handleAITurn(userMessage, task = null) {
    const aiTask = task || createAITask();
    const isRootTurn = !task;

    if (isRootTurn) {
      activeAITask = aiTask;
      send('ai_task_start');
    }
    if (aiTask.cancelled) return;

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
    send('ai_thinking', { message: getThinkingStatusMessage(userMessage, aiTurnCount) });

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
        if (isAITaskCancelled(aiTask, signal) || actionEmitted) break;
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

            const effectiveRisk = getEffectiveRisk(command, cmdRisk);
            const riskLabel = { low: '低风险', normal: '中风险', high: '⚠ 高风险' }[effectiveRisk] || effectiveRisk;
            sendLog(`生成命令 [${riskLabel}]: ${command}`, 'cmd');
            send('command_card', { commandId, command, risk: effectiveRisk });
            actionEmitted = true;

            if (shouldAutoApprove(command, effectiveRisk)) {
              sendLog(`命令已自动批准 (白名单/低风险)，执行中...`, 'step');
              send('command_auto_approve', { commandId });
              send('command_executing', { commandId });
              if (isInteractiveCommand(command)) {
                sendLog('检测到交互式命令，直接写入终端，AI 分析结束', 'ok');
                sshStream.write(command + '\r');
                send('command_done', { commandId, exitCode: 0 });
                aiHistory.push({ role: 'assistant', content: fullReply });
                return;
              }
              sendCommandEcho(command);
              const t0 = Date.now();
              const result = await executeAndCapture(command);
              if (isAITaskCancelled(aiTask, signal) || result?.interrupted) return;
              const elapsed = Date.now() - t0;
              send('command_done', { commandId, exitCode: result.exitCode });
              send('ai_thinking', { message: '正在分析执行结果...' });
              const exitOk = result.exitCode === 0;
              sendLog(
                `执行完成 | 耗时 ${elapsed}ms | 退出码 ${result.exitCode}` +
                (result.output ? ` | 输出 ${result.output.length} 字符` : ' | 无输出'),
                exitOk ? 'ok' : 'warn'
              );
              if (!exitOk) sendLog(`命令退出码非 0，AI 将分析错误`, 'warn');
              aiHistory.push({ role: 'assistant', content: fullReply });
              sendLog(`将执行结果反馈给 AI，继续下一步...`, 'step');
              await handleAITurn(`[命令已执行]\n命令: \`${command}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`, aiTask);
            } else {
              sendLog(`等待用户确认...`, 'step');
              try {
                const decision = await waitForConfirm(commandId);
                if (decision.action === 'cancel' || isAITaskCancelled(aiTask, signal)) return;
                aiHistory.push({ role: 'assistant', content: fullReply });
                if (decision.action === 'confirm') {
                  const cmd = decision.command || command;
                  sendLog(`用户已确认，执行命令: ${cmd}`, 'step');
                  send('command_executing', { commandId });
                  if (isInteractiveCommand(cmd)) {
                    sendLog('检测到交互式命令，直接写入终端，AI 分析结束', 'ok');
                    sshStream.write(cmd + '\r');
                    send('command_done', { commandId, exitCode: 0 });
                    aiHistory.push({ role: 'assistant', content: fullReply });
                    return;
                  }
                  sendCommandEcho(cmd);
                  const t0 = Date.now();
                  const result = await executeAndCapture(cmd);
                  if (isAITaskCancelled(aiTask, signal) || result?.interrupted) return;
                  const elapsed = Date.now() - t0;
                  send('command_done', { commandId, exitCode: result.exitCode });
                  send('ai_thinking', { message: '正在分析执行结果...' });
                  const exitOk = result.exitCode === 0;
                  sendLog(
                    `执行完成 | 耗时 ${elapsed}ms | 退出码 ${result.exitCode}` +
                    (result.output ? ` | 输出 ${result.output.length} 字符` : ' | 无输出'),
                    exitOk ? 'ok' : 'warn'
                  );
                  if (!exitOk) sendLog(`命令退出码非 0，AI 将分析错误`, 'warn');
                  sendLog(`将执行结果反馈给 AI，继续下一步...`, 'step');
                  await handleAITurn(`[命令已执行]\n命令: \`${cmd}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`, aiTask);
                } else {
                  sendLog(`用户已拒绝执行，AI 将给出其他建议`, 'warn');
                  await handleAITurn('[用户拒绝执行该命令，请给出其他建议或结束任务]', aiTask);
                }
              } catch {
                if (isAITaskCancelled(aiTask, signal)) return;
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
              if (isAITaskCancelled(aiTask, signal)) return;
              sendLog(`MCP 工具调用成功，结果 ${result.length} 字符`, 'ok');
              aiHistory.push({ role: 'assistant', content: fullReply });
              send('ai_thinking', { message: '正在分析工具返回结果...' });
              sendLog(`将 MCP 结果反馈给 AI，继续下一步...`, 'step');
              await handleAITurn(`[MCP工具调用结果]\n服务: ${mcpServer}\n工具: ${mcpTool}\n参数: ${argsJson}\n结果:\n\`\`\`\n${result}\n\`\`\`\n\n请基于此结果继续完成任务。`, aiTask);
            } catch (err) {
              if (isAITaskCancelled(aiTask, signal)) return;
              sendLog(`MCP 工具调用失败: ${err.message}`, 'error');
              aiHistory.push({ role: 'assistant', content: fullReply });
              send('ai_thinking', { message: '正在分析工具调用失败原因...' });
              await handleAITurn(`[MCP工具调用失败]\n服务: ${mcpServer}\n工具: ${mcpTool}\n错误: ${err.message}\n\n请尝试其他方法完成任务。`, aiTask);
            }
            return;
          }
        }
      }

      if (isAITaskCancelled(aiTask, signal)) {
        send('ai_reply_end');
        return;
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
          const risk = getEffectiveRisk(fallbackCmd, getRisk(fallbackCmd));
          const riskLabel = { low: '低风险', normal: '中风险', high: '⚠ 高风险' }[risk] || risk;
          sendLog(`从回复中提取命令 [${riskLabel}]: ${fallbackCmd}`, 'cmd');
          send('command_card', { commandId, command: fallbackCmd, risk });
          actionEmitted = true;

          if (shouldAutoApprove(fallbackCmd, risk)) {
            sendLog(`命令已自动批准 (白名单/低风险)，执行中...`, 'step');
            send('command_auto_approve', { commandId });
            send('command_executing', { commandId });
            if (isInteractiveCommand(fallbackCmd)) {
              sendLog('检测到交互式命令，直接写入终端，AI 分析结束', 'ok');
              sshStream.write(fallbackCmd + '\r');
              send('command_done', { commandId, exitCode: 0 });
              aiHistory.push({ role: 'assistant', content: fullReply });
              return;
            }
            sendCommandEcho(fallbackCmd);
            const t0 = Date.now();
            const result = await executeAndCapture(fallbackCmd);
            if (isAITaskCancelled(aiTask, signal) || result?.interrupted) return;
            const elapsed = Date.now() - t0;
            send('command_done', { commandId, exitCode: result.exitCode });
            send('ai_thinking', { message: '正在分析执行结果...' });
            const exitOk = result.exitCode === 0;
            sendLog(
              `执行完成 | 耗时 ${elapsed}ms | 退出码 ${result.exitCode}` +
              (result.output ? ` | 输出 ${result.output.length} 字符` : ' | 无输出'),
              exitOk ? 'ok' : 'warn'
            );
            if (!exitOk) sendLog(`命令退出码非 0，AI 将分析错误`, 'warn');
            aiHistory.push({ role: 'assistant', content: fullReply });
            sendLog(`将执行结果反馈给 AI，继续下一步...`, 'step');
            await handleAITurn(`[命令已执行]\n命令: \`${fallbackCmd}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`, aiTask);
          } else {
            sendLog(`等待用户确认...`, 'step');
            try {
              const decision = await waitForConfirm(commandId);
              if (decision.action === 'cancel' || isAITaskCancelled(aiTask, signal)) return;
              aiHistory.push({ role: 'assistant', content: fullReply });
              if (decision.action === 'confirm') {
                const cmd = decision.command || fallbackCmd;
                sendLog(`用户已确认，执行命令: ${cmd}`, 'step');
                send('command_executing', { commandId });
                if (isInteractiveCommand(cmd)) {
                  sendLog('检测到交互式命令，直接写入终端，AI 分析结束', 'ok');
                  sshStream.write(cmd + '\r');
                  send('command_done', { commandId, exitCode: 0 });
                  aiHistory.push({ role: 'assistant', content: fullReply });
                  return;
                }
                sendCommandEcho(cmd);
                const t0 = Date.now();
                const result = await executeAndCapture(cmd);
                if (isAITaskCancelled(aiTask, signal) || result?.interrupted) return;
                const elapsed = Date.now() - t0;
                send('command_done', { commandId, exitCode: result.exitCode });
                send('ai_thinking', { message: '正在分析执行结果...' });
                const exitOk = result.exitCode === 0;
                sendLog(
                  `执行完成 | 耗时 ${elapsed}ms | 退出码 ${result.exitCode}` +
                  (result.output ? ` | 输出 ${result.output.length} 字符` : ' | 无输出'),
                  exitOk ? 'ok' : 'warn'
                );
                if (!exitOk) sendLog(`命令退出码非 0，AI 将分析错误`, 'warn');
                sendLog(`将执行结果反馈给 AI，继续下一步...`, 'step');
                await handleAITurn(`[命令已执行]\n命令: \`${cmd}\`\n退出码: ${result.exitCode}\n输出:\n\`\`\`\n${result.output || '(无输出)'}\n\`\`\`\n\n请检查是否还有未完成的步骤，如果有请继续。`, aiTask);
              } else {
                sendLog(`用户已拒绝执行，AI 将给出其他建议`, 'warn');
                await handleAITurn('[用户拒绝执行该命令，请给出其他建议或结束任务]', aiTask);
              }
            } catch {
              if (isAITaskCancelled(aiTask, signal)) return;
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
      if (err.name === 'AbortError' || signal?.aborted || aiTask.cancelled) {
        sendLog('AI 已被用户中断', 'warn');
        send('ai_reply_end');
        return;
      }
      sendLog(`AI 接口错误: ${err.message}`, 'error');
      send('error', { message: `AI 错误: ${err.message}` });
      send('ai_reply_end');
    } finally {
      if (aiAbortController?.signal === signal) aiAbortController = null;
      if (isRootTurn) {
        if (activeAITask === aiTask) activeAITask = null;
        send('ai_task_end', { cancelled: aiTask.cancelled });
      }
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
        const charset = (typeof payload.charset === 'string' && payload.charset.trim())
          ? payload.charset.trim()
          : 'en_US.UTF-8';
        sessionToken = generateToken();
        sessions.set(sessionToken, { sftp: null, ws });

        sshClient = new SSHClient();
        sshClient.on('ready', () => {
          try { sshClient.setNoDelay(true); } catch {}

          sshClient.shell(
            { term: 'xterm-256color', rows: 24, cols: 210, modes: { ECHO: 0 } },
            {
              env: {
                LANG: charset,
                LC_ALL: charset,
                LC_CTYPE: charset,
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
              },
            },
            (err, stream) => {
            if (err) { send('error', { message: err.message }); return; }
            sshStream = stream;
            stream.on('data', onSshData);
            stream.stderr.on('data', onSshData);
            stream.on('close', () => { send('disconnected'); sshStream = null; });
            send('ssh_connected', { host, username, sessionToken });
            }
          );

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
        const { text, forceKind } = payload;
        if (text === '') { sshStream.write('\r'); return; }
        const kind = forceKind === 'natural' || forceKind === 'shell'
          ? forceKind
          : classifyInlineInput(text);
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
          const kind = classifyInlineInput(content.trim());
          if (kind === 'natural' && isAIConfigured()) {
            handleAITurn(content.trim()).catch(console.error);
          } else {
            sshStream.write(content + '\r');
          }
        }
        break;
      }

      case 'raw_input': { if (sshStream) sshStream.write(payload.data); break; }

      case 'set_raw_terminal_mode': {
        rawTerminalMode = !!payload.enabled;
        if (rawTerminalMode && outputBuf) {
          clearTimeout(outputTimer);
          flushOutput();
        }
        break;
      }

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
        cancelActiveAITask();
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

      // Return the interactive shell's real cwd (not just what the prompt shows).
      // Fast path: shellCtx.cwd is already absolute → return immediately.
      // Slow path (basename-only prompts like CentOS \W): run a shell script via
      // exec that reads /proc/<sibling_pid>/cwd on Linux.
      case 'get_shell_cwd': {
        const knownCwd = shellCtx.cwd || '';
        const shellQuote = (value = '') => `'${String(value).replace(/'/g, `'\\''`)}'`;
        const knownLeaf = (!knownCwd.startsWith('/') && knownCwd !== '~' && !knownCwd.startsWith('~/'))
          ? path.posix.basename(knownCwd.replace(/\/+$/, ''))
          : '';
        // Fast path — already have an absolute path
        if (knownCwd.startsWith('/')) {
          send('shell_cwd_result', { path: knownCwd });
          break;
        }
        // Need to resolve via /proc (Linux) or fall back to shellCtx.cwd
        if (!sshClient) {
          send('shell_cwd_result', { path: knownCwd || '~' });
          break;
        }
        // Script: find sibling process (same parent sshd) and read its cwd.
        // Prefer an interactive shell process over other sibling services like
        // sftp-server so the file manager follows the live shell directory.
        // Works silently on non-Linux (outputs empty string).
        const cwdScript = [
          `known_leaf=${shellQuote(knownLeaf)}`,
          'ppid=$PPID',
          'best=""',
          'best_score=-1',
          'for f in /proc/[0-9]*/status; do',
          '  pid="${f%/status}"; pid="${pid##*/}"',
          '  [ "$pid" = "$$" ] && continue',
          '  pp=$(grep "^PPid:" "$f" 2>/dev/null | awk \'{print $2}\')',
          '  [ "$pp" = "$ppid" ] || continue',
          '  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)',
          '  [ -n "$cwd" ] || continue',
          '  comm=$(cat "/proc/$pid/comm" 2>/dev/null)',
          '  score=0',
          '  case "$comm" in',
          '    bash|sh|zsh|fish|ksh|dash|ash|tcsh|csh) score=100 ;;',
          '  esac',
          '  if [ -n "$known_leaf" ] && [ "${cwd##*/}" = "$known_leaf" ]; then',
          '    score=$((score + 10))',
          '  fi',
          '  if [ "$score" -gt "$best_score" ]; then',
          '    best="$cwd"',
          '    best_score=$score',
          '  fi',
          'done',
          '[ -n "$best" ] && printf "%s" "$best"',
        ].join('\n');

        sshClient.exec(cwdScript, (err, stream) => {
          if (err) { send('shell_cwd_result', { path: knownCwd || '~' }); return; }
          let data = '';
          stream.on('data', chunk => { data += chunk.toString(); });
          stream.stderr.on('data', () => {}); // drain stderr
          stream.on('close', () => {
            const resolved = data.trim();
            // Only use if it looks like a real absolute path
            send('shell_cwd_result', {
              path: (resolved && resolved.startsWith('/')) ? resolved : (knownCwd || '~'),
            });
          });
        });
        break;
      }

      case 'ai_cancel': {
        cancelActiveAITask();
        break;
      }

      // ─── SFTP messages ────────────────────────────────────────────────────

      case 'complete_request': {
        const { word, cwd: completeCwd, mode = 'path' } = payload;

        const sendResult = (completions) => send('complete_result', { completions, word });

        // ── Command completion: query executables/builtins from remote shell ─
        if (mode === 'command') {
          if (!sshClient) { sendResult([]); break; }

          const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
          const commandPrefix = String(word || '');
          const cmd = [
            `PREFIX=${q(commandPrefix)}`,
            'export PREFIX',
            "if command -v bash >/dev/null 2>&1; then",
            "  bash -lc 'compgen -c -- \"$PREFIX\"' 2>/dev/null",
            'else',
            "  IFS=':'",
            '  for d in $PATH; do',
            '    [ -d "$d" ] || continue',
            '    for f in "$d"/"$PREFIX"*; do',
            '      [ -f "$f" ] && [ -x "$f" ] && basename "$f"',
            '    done',
            '  done | sort -u',
            'fi',
          ].join('; ');

          sshClient.exec(cmd, (err, stream) => {
            if (err) { sendResult([]); return; }
            let data = '';
            stream.on('data', chunk => { data += chunk.toString(); });
            stream.stderr.on('data', () => {});
            stream.on('close', () => {
              const seen = new Set();
              const items = data
                .split(/\r?\n/)
                .map(name => name.trim())
                .filter(name => name && name.startsWith(commandPrefix) && !seen.has(name) && seen.add(name))
                .map(name => ({ name, isDir: false }))
                .sort((a, b) => a.name.localeCompare(b.name));
              sendResult(items);
            });
          });
          break;
        }

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
    cancelActiveAITask();
    if (sshClient) sshClient.end();
    if (sessionToken) sessions.delete(sessionToken);
  });

  ws.on('error', console.error);
});

let startPromise = null;

function logServerReady(port) {
  console.log(`\n  SSH AI Shell → http://localhost:${port}`);
  console.log(`  AI configured → ${isAIConfigured() ? 'YES' : 'NO'}`);
  if (copilotState.githubToken) console.log(`  Copilot → @${copilotState.username}`);
  const rawProxy = (appSettings.proxy || '').trim();
  if (rawProxy) {
    const normProxy = normaliseProxyUrl(rawProxy);
    let proxyOk = false;
    try { new URL(normProxy); proxyOk = true; } catch {}
    console.log(`  Proxy   → ${normProxy}${proxyOk ? '' : ' ⚠ (invalid URL)'}`);
  }
  console.log();
}

function startServer(port = PORT) {
  if (server.listening) {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    return Promise.resolve({ app, server, port: actualPort });
  }

  if (startPromise) return startPromise;

  startPromise = new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      startPromise = null;
      reject(error);
    };

    server.once('error', onError);
    server.listen(port, () => {
      server.off('error', onError);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      const result = { app, server, port: actualPort };
      logServerReady(actualPort);
      startPromise = Promise.resolve(result);
      resolve(result);
    });
  });

  return startPromise;
}

function stopServer() {
  if (!server.listening) {
    startPromise = null;
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      startPromise = null;
      if (error) reject(error);
      else resolve();
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  app,
  server,
  startServer,
  stopServer,
};
