import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Save, Cpu, ChevronDown, ExternalLink, CheckCircle2, AlertCircle,
  Shield, Download, Upload, Plus, Trash2, Settings, Monitor, Keyboard,
  Info, Eye, EyeOff, RefreshCw, Edit3, Check, FileText, Wifi, BookMarked,
  Github, Loader2, LogOut, Zap, Star, Server, Terminal as TerminalIcon,
  ChevronRight,
} from 'lucide-react';
import type { AISettings, AIProvider, AutoApproveSettings, AutoApproveRule, Theme, TerminalSettings, SavedCommand, MCPServer, Skill, ProviderConfig } from '../types';
import { DEFAULT_TERMINAL_SETTINGS } from '../types';

// ─── AI Provider presets ──────────────────────────────────────────────────

const AI_PROVIDERS: AIProvider[] = [
  { id: 'copilot', name: 'GitHub Copilot', baseUrl: 'https://api.githubcopilot.com',
    models: [], apiKeyHint: '', authType: 'oauth' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-11-20', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o1-preview', 'o3-mini'],
    apiKeyHint: 'sk-...', docsUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
    apiKeyHint: 'sk-ant-...', docsUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'], apiKeyHint: 'sk-...', docsUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'qwen', name: '通义千问 (Qwen)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-max-2025-01-25', 'qwen-plus', 'qwen-plus-2025-01-25', 'qwen-turbo', 'qwen-long', 'qwen2.5-72b-instruct', 'qwen2.5-7b-instruct'],
    apiKeyHint: 'sk-...', docsUrl: 'https://dashscope.console.aliyun.com/apiKey' },
  { id: 'moonshot', name: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'], apiKeyHint: 'sk-...', docsUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'zhipu', name: '智谱 AI (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-0520', 'glm-4', 'glm-4-air', 'glm-4-airx', 'glm-4-flash', 'glm-3-turbo'],
    apiKeyHint: '...', docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'baidu', name: '文心一言 (ERNIE)', baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop',
    models: ['ernie-4.0-8k', 'ernie-4.0-turbo-8k', 'ernie-3.5-8k', 'ernie-speed-128k', 'ernie-lite-8k'],
    apiKeyHint: '...', docsUrl: 'https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'deepseek/deepseek-chat', 'meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.0-flash-exp'],
    apiKeyHint: 'sk-or-...', docsUrl: 'https://openrouter.ai/keys' },
  { id: 'ollama', name: 'Ollama (本地)', baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.2', 'llama3.2:1b', 'llama3.1', 'qwen2.5', 'qwen2.5:7b', 'deepseek-r1', 'deepseek-coder-v2', 'mistral', 'codellama', 'gemma2'],
    apiKeyHint: 'ollama', docsUrl: 'https://ollama.ai' },
  { id: 'xcloud', name: 'Lenovo XCloud (XSpark)', baseUrl: 'https://xcloud.lenovo.com/xspark/api/v1',
    models: [], apiKeyHint: '...', docsUrl: 'https://xcloud.lenovo.com',
    apiFormats: ['openai', 'anthropic'] },
  { id: 'custom', name: '自定义 / 其他', baseUrl: '', models: [], apiKeyHint: '...' },
];

// ─── Copilot model metadata ────────────────────────────────────────────────

// Fallback list shown before /models response
const COPILOT_DEFAULT_MODELS = [
  // GPT-4o family
  'gpt-4o', 'gpt-4o-mini',
  // GPT-4.1 family
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  // GPT-4 legacy
  'gpt-4', 'gpt-3.5-turbo',
  // Claude family
  'claude-3.5-sonnet', 'claude-3.5-haiku', 'claude-3-opus',
  // Reasoning models
  'o1', 'o1-preview', 'o1-mini', 'o3-mini',
  // Gemini
  'gemini-2.0-flash', 'gemini-1.5-pro',
];

// badge label per model id (partial match, longest match wins)
const COPILOT_BADGES: Record<string, { label: string; color: 'blue' | 'purple' | 'green' | 'orange' }> = {
  'gpt-4o-mini':       { label: '快速', color: 'green' },
  'gpt-4.1-nano':      { label: '快速', color: 'green' },
  'gpt-4.1-mini':      { label: '快速', color: 'green' },
  'gpt-4.1':           { label: '推荐', color: 'blue' },
  'gpt-4o':            { label: '推荐', color: 'blue' },
  'claude-3.5-sonnet': { label: '推荐', color: 'blue' },
  'claude-3.5-haiku':  { label: '快速', color: 'green' },
  'claude-3-opus':     { label: '强力', color: 'orange' },
  'gemini-2.0-flash':  { label: '快速', color: 'green' },
  'o3-mini':           { label: '推理', color: 'purple' },
  'o1-mini':           { label: '推理', color: 'purple' },
  'o1-preview':        { label: '推理', color: 'purple' },
  'o1':                { label: '推理', color: 'purple' },
};

function getCopilotBadge(model: string) {
  // longest key that model contains wins
  const key = Object.keys(COPILOT_BADGES)
    .filter(k => model.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? COPILOT_BADGES[key] : null;
}

// ─── Default shortcuts ─────────────────────────────────────────────────────

const DEFAULT_SHORTCUTS = [
  { id: 'terminal.clear',       key: 'Ctrl+L',           desc: '清除终端',              type: '终端', enabled: true,  system: true },
  { id: 'terminal.newSession',  key: 'Ctrl+Shift+N',     desc: '开启新 AI 会话',        type: '终端', enabled: true,  system: false },
  { id: 'terminal.interrupt',   key: 'Ctrl+C',           desc: '中断当前命令',          type: '终端', enabled: true,  system: true },
  { id: 'terminal.historyUp',   key: 'ArrowUp / Ctrl+P', desc: '历史命令上一条',        type: '终端', enabled: true,  system: true },
  { id: 'terminal.historyDown', key: 'ArrowDown / Ctrl+N', desc: '历史命令下一条',      type: '终端', enabled: true,  system: true },
  { id: 'terminal.historySearch', key: 'Ctrl+R',         desc: '搜索历史命令',          type: '终端', enabled: true,  system: true },
  { id: 'terminal.tabComplete', key: 'Tab',              desc: 'Tab 补全',             type: '终端', enabled: true,  system: true },
  { id: 'terminal.cursorStart', key: 'Ctrl+A',           desc: '光标移到行首',          type: '终端', enabled: true,  system: true },
  { id: 'terminal.cursorEnd',   key: 'Ctrl+E',           desc: '光标移到行尾',          type: '终端', enabled: true,  system: true },
  { id: 'terminal.killLine',    key: 'Ctrl+K',           desc: '删除光标到行尾',        type: '终端', enabled: true,  system: true },
  { id: 'terminal.killLineStart', key: 'Ctrl+U',         desc: '删除光标到行首',        type: '终端', enabled: true,  system: true },
  { id: 'terminal.killWord',    key: 'Ctrl+W',           desc: '删除光标前一个单词',    type: '终端', enabled: true,  system: true },
  { id: 'panel.clipboard',      key: 'Alt+1',            desc: '历史记录面板',          type: '面板', enabled: true,  system: false },
  { id: 'panel.files',          key: 'Alt+2',            desc: '文件管理器',            type: '面板', enabled: true,  system: false },
  { id: 'panel.monitor',        key: 'Alt+3',            desc: '系统监控',              type: '面板', enabled: true,  system: false },
  { id: 'panel.settings',       key: 'Alt+,',            desc: '打开设置',              type: '应用', enabled: true,  system: false },
  { id: 'app.disconnect',       key: 'Ctrl+Shift+D',     desc: '断开连接',              type: '应用', enabled: true,  system: false },
];

type ShortcutDef = typeof DEFAULT_SHORTCUTS[number];

// ─── Safe command presets ──────────────────────────────────────────────────

const PRESET_GROUPS: { label: string; items: { cmd: string; desc: string }[] }[] = [
  {
    label: '文件 & 目录',
    items: [
      { cmd: 'pwd',    desc: '当前目录' },
      { cmd: 'cd',     desc: '返回当前目录' },
      { cmd: 'cd *',   desc: '切换目录' },
      { cmd: 'ls',     desc: '列出文件' },
      { cmd: 'ls *',   desc: 'ls 带参数' },
      { cmd: 'll',     desc: '详细列表' },
      { cmd: 'la',     desc: '显示隐藏文件' },
      { cmd: 'cat *',  desc: '查看文件' },
      { cmd: 'head *', desc: '文件头部' },
      { cmd: 'tail *', desc: '文件尾部' },
      { cmd: 'wc *',   desc: '统计行数' },
      { cmd: 'stat *', desc: '文件属性' },
      { cmd: 'du *',   desc: '目录大小' },
      { cmd: 'tree *', desc: '目录树' },
    ],
  },
  {
    label: '系统信息',
    items: [
      { cmd: 'whoami',   desc: '当前用户' },
      { cmd: 'id',       desc: '用户 ID' },
      { cmd: 'uname *',  desc: '内核信息' },
      { cmd: 'hostname', desc: '主机名' },
      { cmd: 'uptime',   desc: '运行时长' },
      { cmd: 'date',     desc: '当前时间' },
      { cmd: 'cal',      desc: '日历' },
      { cmd: 'env',      desc: '环境变量' },
      { cmd: 'printenv',   desc: '环境变量' },
      { cmd: 'printenv *', desc: '指定环境变量' },
      { cmd: 'echo *',   desc: '输出文本' },
      { cmd: 'history',  desc: '历史命令' },
    ],
  },
  {
    label: '资源监控',
    items: [
      { cmd: 'df',     desc: '磁盘空间' },
      { cmd: 'df *',   desc: 'df 带参数' },
      { cmd: 'free',   desc: '内存使用' },
      { cmd: 'free *', desc: 'free 带参数' },
      { cmd: 'ps *',   desc: '进程列表' },
      { cmd: 'top',    desc: '实时进程' },
      { cmd: 'htop',   desc: '交互式进程' },
      { cmd: 'lsblk',  desc: '块设备列表' },
      { cmd: 'lsblk *',desc: '块设备详情' },
      { cmd: 'blkid',  desc: '块设备 UUID' },
      { cmd: 'blkid *',desc: '指定块设备 UUID' },
    ],
  },
  {
    label: '搜索 & 查找',
    items: [
      { cmd: 'grep *',   desc: '文本搜索' },
      { cmd: 'egrep *',  desc: '扩展文本搜索' },
      { cmd: 'find *',   desc: '查找文件' },
      { cmd: 'which *',  desc: '命令路径' },
      { cmd: 'locate *', desc: '快速查找' },
      { cmd: 'less *',   desc: '分页查看文件' },
      { cmd: 'more *',   desc: '分页查看文件' },
      { cmd: 'sort *',   desc: '排序输出' },
      { cmd: 'uniq *',   desc: '去重输出' },
      { cmd: 'jq *',     desc: 'JSON 查询' },
      { cmd: 'yq *',     desc: 'YAML 查询' },
    ],
  },
  {
    label: '网络',
    items: [
      { cmd: 'ping *',     desc: '连通性测试' },
      { cmd: 'curl *',     desc: 'HTTP 请求' },
      { cmd: 'wget *',     desc: '下载文件' },
      { cmd: 'dig *',      desc: 'DNS 查询' },
      { cmd: 'nslookup *', desc: 'DNS 解析' },
      { cmd: 'ss *',       desc: '网络连接' },
      { cmd: 'netstat *',  desc: '网络统计' },
      { cmd: 'ip *',       desc: '网络信息' },
      { cmd: 'ifconfig *', desc: '网卡信息' },
      { cmd: 'route *',    desc: '路由信息' },
    ],
  },
  {
    label: 'Git',
    items: [
      { cmd: 'git status',   desc: '工作区状态' },
      { cmd: 'git log',      desc: '提交历史' },
      { cmd: 'git log *',    desc: 'log 带参数' },
      { cmd: 'git diff',     desc: '差异对比' },
      { cmd: 'git diff *',   desc: 'diff 带参数' },
      { cmd: 'git branch',   desc: '分支列表' },
      { cmd: 'git branch *', desc: '分支操作' },
      { cmd: 'git remote *', desc: '远程仓库' },
      { cmd: 'git show *',   desc: '提交详情' },
      { cmd: 'git tag',      desc: '标签列表' },
      { cmd: 'git reflog',   desc: '引用日志' },
      { cmd: 'git reflog *', desc: '引用日志' },
      { cmd: 'git describe *', desc: '描述版本' },
      { cmd: 'git rev-parse *', desc: '解析引用' },
      { cmd: 'git ls-files *',  desc: '跟踪文件列表' },
    ],
  },
  {
    label: 'Docker',
    items: [
      { cmd: 'docker ps',        desc: '容器列表' },
      { cmd: 'docker ps *',      desc: 'ps 带参数' },
      { cmd: 'docker images',    desc: '镜像列表' },
      { cmd: 'docker logs *',    desc: '容器日志' },
      { cmd: 'docker stats *',   desc: '容器统计' },
      { cmd: 'docker inspect *', desc: '容器详情' },
      { cmd: 'docker compose ps', desc: 'Compose 容器列表' },
      { cmd: 'docker compose ps *', desc: 'Compose 容器列表' },
      { cmd: 'docker compose logs *', desc: 'Compose 日志' },
    ],
  },
  {
    label: 'Kubernetes',
    items: [
      { cmd: 'kubectl get *',      desc: '资源列表' },
      { cmd: 'kubectl describe *', desc: '资源详情' },
      { cmd: 'kubectl logs *',     desc: 'Pod 日志' },
      { cmd: 'kubectl top *',      desc: '资源监控' },
      { cmd: 'kubectl config *',   desc: '集群配置' },
    ],
  },
  {
    label: 'Node / NPM',
    items: [
      { cmd: 'node -v',      desc: 'Node 版本' },
      { cmd: 'npm -v',       desc: 'npm 版本' },
      { cmd: 'npm list *',   desc: '依赖列表' },
      { cmd: 'npm outdated', desc: '过期包' },
    ],
  },
];

const HIGH_RISK_PRESET_GROUPS: { label: string; items: { cmd: string; desc: string }[] }[] = [
  {
    label: '提权与用户切换',
    items: [
      { cmd: 'sudo *', desc: '提权执行' },
      { cmd: 'su', desc: '切换用户' },
      { cmd: 'su *', desc: '切换用户带参数' },
      { cmd: 'doas *', desc: '提权执行' },
      { cmd: 'passwd *', desc: '修改账户密码' },
      { cmd: 'userdel *', desc: '删除用户' },
      { cmd: 'usermod *', desc: '修改用户配置' },
      { cmd: 'groupdel *', desc: '删除用户组' },
    ],
  },
  {
    label: '删除与覆盖',
    items: [
      { cmd: 'rm *', desc: '删除文件/目录' },
      { cmd: 'dd *', desc: '磁盘覆盖/复制' },
      { cmd: 'mkfs *', desc: '格式化文件系统' },
      { cmd: 'wipefs *', desc: '擦除文件系统签名' },
      { cmd: 'shred *', desc: '安全擦除文件' },
      { cmd: 'fdisk *', desc: '磁盘分区' },
      { cmd: 'parted *', desc: '磁盘分区' },
      { cmd: 'cfdisk *', desc: '磁盘分区' },
      { cmd: 'truncate *', desc: '截断文件' },
      { cmd: 'chmod -R *', desc: '递归修改权限' },
      { cmd: 'chown -R *', desc: '递归修改属主' },
    ],
  },
  {
    label: '进程与系统控制',
    items: [
      { cmd: 'kill *', desc: '终止进程' },
      { cmd: 'killall *', desc: '终止同名进程' },
      { cmd: 'pkill *', desc: '按模式终止进程' },
      { cmd: 'reboot', desc: '重启系统' },
      { cmd: 'shutdown *', desc: '关机/重启' },
      { cmd: 'halt', desc: '停止系统' },
      { cmd: 'poweroff', desc: '关闭电源' },
      { cmd: '/^init\s*[016](\s|$)/', desc: '切换运行级别' },
      { cmd: 'systemctl stop *', desc: '停止服务' },
      { cmd: 'systemctl disable *', desc: '禁用服务' },
      { cmd: 'systemctl mask *', desc: '屏蔽服务' },
      { cmd: 'systemctl kill *', desc: '强制停止服务' },
      { cmd: 'crontab -r', desc: '删除当前用户定时任务' },
    ],
  },
  {
    label: '网络与脚本执行',
    items: [
      { cmd: 'iptables *', desc: '修改防火墙规则' },
      { cmd: 'ufw disable', desc: '关闭防火墙' },
      { cmd: 'ufw delete *', desc: '删除防火墙规则' },
      { cmd: '/^curl\\b.*\\|\\s*(bash|sh|zsh|fish)(\\s|$)/', desc: '管道执行脚本' },
      { cmd: '/^wget\\b.*\\|\\s*(bash|sh)(\\s|$)/', desc: '管道执行脚本' },
    ],
  },
  {
    label: '容器与集群变更',
    items: [
      { cmd: 'docker stop *', desc: '停止容器' },
      { cmd: 'docker kill *', desc: '强制终止容器' },
      { cmd: 'docker rm *', desc: '删除容器' },
      { cmd: 'docker rmi *', desc: '删除镜像' },
      { cmd: 'docker compose down *', desc: '停止并删除 Compose 资源' },
      { cmd: 'docker compose rm *', desc: '删除 Compose 容器' },
      { cmd: 'kubectl delete *', desc: '删除 Kubernetes 资源' },
      { cmd: 'kubectl scale *', desc: '调整副本数量' },
      { cmd: 'helm uninstall *', desc: '卸载 Helm 发布' },
    ],
  },
];

const DEFAULT_HIGH_RISK_RULES: AutoApproveRule[] = HIGH_RISK_PRESET_GROUPS.flatMap((group, groupIdx) =>
  group.items.map((item, itemIdx) => ({
    id: `highrisk_default_${groupIdx}_${itemIdx}`,
    pattern: item.cmd,
    enabled: true,
    description: item.desc,
  }))
);

// ─── Types ────────────────────────────────────────────────────────────────

type Section = 'general' | 'terminal' | 'shortcuts' | 'ai' | 'mcp' | 'skills' | 'data' | 'about' | 'commands';
type AITab = 'providers' | 'api' | 'shell' | 'agent';

interface Props {
  onClose: () => void;
  onSaved?: () => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  initialSection?: Section;
}

// ─── Toggle ───────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full py-2 px-3 rounded-lg hover:bg-terminal-border/20 transition-colors">
      <div className="text-left">
        <div className="text-sm text-terminal-text">{label}</div>
        {description && <div className="text-xs text-terminal-muted mt-0.5">{description}</div>}
      </div>
      <div className={`relative rounded-full transition-colors flex-shrink-0 ml-4 ${checked ? 'bg-terminal-blue' : 'bg-terminal-border'}`}
        style={{ height: '20px', width: '36px' }}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[16px]' : 'translate-x-0.5'}`} />
      </div>
    </button>
  );
}

// ─── KeyRecorder ────────────────────────────────────────────────────────────

function KeyRecorder({ value, onChange, onCancel }: {
  value: string; onChange: (k: string) => void; onCancel: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [current, setCurrent] = useState(value);

  // Use document-level capture to intercept browser shortcuts (Ctrl+T, Ctrl+W, etc.)
  useEffect(() => {
    if (!recording) return;

    function handler(e: KeyboardEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();

      const key = e.key;
      if (key === 'Escape') {
        setRecording(false);
        onCancel();
        return;
      }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      const displayKey = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
      parts.push(displayKey);

      const combo = parts.join('+');
      setCurrent(combo);
      setRecording(false);
      onChange(combo);
    }

    // capture phase = true ensures we get the event before browser/other handlers
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [recording, onChange, onCancel]);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setRecording(r => !r)}
        className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors focus:outline-none ${
          recording
            ? 'border-terminal-blue bg-terminal-blue/20 text-terminal-blue animate-pulse'
            : 'border-terminal-border bg-terminal-surface text-terminal-text hover:border-terminal-blue'
        }`}
      >
        {recording ? '按下快捷键...' : current}
      </button>
      {recording && (
        <button type="button" onClick={() => { setRecording(false); onCancel(); }}
          className="text-terminal-muted hover:text-terminal-text" title="取消 (Esc)">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export default function SettingsPage({ onClose, onSaved, theme, onThemeChange, initialSection = 'general' }: Props) {
  const [section, setSection] = useState<Section>(initialSection);

  // Sync section when initialSection prop changes (e.g. deep-link from terminal sidebar)
  useEffect(() => { setSection(initialSection); }, [initialSection]);

  // ── General settings ───────────────────────────────────────────────────
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [proxy, setProxy] = useState('');
  const [frequentCommandsCount, setFrequentCommandsCount] = useState(10);
  const [generalSaving, setGeneralSaving] = useState(false);
  const [generalSuccess, setGeneralSuccess] = useState(false);

  // ── Terminal settings ─────────────────────────────────────────────────
  const [termSettings, setTermSettings] = useState<TerminalSettings>(() => {
    try { return { ...DEFAULT_TERMINAL_SETTINGS, ...JSON.parse(localStorage.getItem('terminal-settings') || '{}') }; }
    catch { return DEFAULT_TERMINAL_SETTINGS; }
  });
  const [termSaved, setTermSaved] = useState(false);

  // ── Shortcuts state ────────────────────────────────────────────────────
  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>(() => {
    try {
      const raw = localStorage.getItem('app-shortcuts');
      if (raw) {
        const saved = JSON.parse(raw);
        // Merge with defaults (in case new shortcuts were added)
        return DEFAULT_SHORTCUTS.map(def => {
          const override = saved.find((s: ShortcutDef) => s.id === def.id);
          return override ? { ...def, ...override } : def;
        });
      }
    } catch {}
    return DEFAULT_SHORTCUTS;
  });
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [shortcutsSaved, setShortcutsSaved] = useState(false);
  const [newShortcutDesc, setNewShortcutDesc] = useState('');
  const [newShortcutKey, setNewShortcutKey] = useState('');
  const [newShortcutType, setNewShortcutType] = useState<'终端' | '面板' | '应用'>('应用');
  const [showAddShortcut, setShowAddShortcut] = useState(false);

  // ── AI settings state ──────────────────────────────────────────────────
  const [aiTab, setAITab] = useState<AITab>('providers');
  const [aiSettings, setAISettings] = useState<AISettings>({
    providerId: 'custom',
    baseUrl: '', apiKey: '', model: '',
    enableCommandExplain: true, enableAIAssistant: true, enableAutoComplete: true,
    agentExecMode: 'ask_each', commandWhitelist: [],
  });
  const [aiLoading, setAILoading] = useState(true);
  const [aiSaving, setAISaving] = useState(false);
  const [aiError, setAIError] = useState('');
  const [aiSuccess, setAISuccess] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('custom');
  const [selectedApiFormat, setSelectedApiFormat] = useState<'openai' | 'anthropic'>('openai');
  const [activeProviderId, setActiveProviderId] = useState('custom');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  /** Per-provider stored credentials */
  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>({});
  /** Which provider card is expanded (e.g. 'copilot' for model selection, null = none) */
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  // ── Model management ───────────────────────────────────────────────────
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; models: string[]; error: string | null; modelTest: { ok: boolean; latencyMs: number } | null } | null>(null);
  const [testing, setTesting] = useState(false);
  const [newModelInput, setNewModelInput] = useState('');
  /** Which models are checked (enabled for AI chat panel) */
  const [modelEnabled, setModelEnabled] = useState<Record<string, boolean>>({});
  /** Which model is starred as the terminal AI model */
  const [terminalModelId, setTerminalModelId] = useState<string>('');

  // ── GitHub Copilot OAuth ──────────────────────────────────────────────
  const [copilotStatus, setCopilotStatus] = useState<{
    loggedIn: boolean; username?: string; model?: string; models?: string[];
  } | null>(null);
  const [copilotStatusLoading, setCopilotStatusLoading] = useState(false);
  const [copilotDeviceCode, setCopilotDeviceCode] = useState<{
    user_code: string; verification_uri: string; expires_in: number;
  } | null>(null);
  const [copilotStarting, setCopilotStarting] = useState(false);
  const [copilotPolling, setCopilotPolling] = useState(false);
  const copilotPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // AbortController for in-flight /api/copilot/status requests
  const copilotStatusAbortRef = useRef<AbortController | null>(null);
  const [modelTestResults, setModelTestResults] = useState<Record<string, {
    ok: boolean; latencyMs?: number; error?: string; testing?: boolean;
  }>>({});
  const [copilotModelEnabled, setCopilotModelEnabled] = useState<Record<string, boolean>>({});
  const [copilotTerminalModel, setCopilotTerminalModel] = useState<string>('gpt-4o');

  // ── Whitelist (command rules) state ───────────────────────────────────
  const [whitelistRules, setWhitelistRules] = useState<AutoApproveRule[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [highRiskRules, setHighRiskRules] = useState<AutoApproveRule[]>([]);
  const [newHighRiskPattern, setNewHighRiskPattern] = useState('');
  const [newHighRiskDesc, setNewHighRiskDesc] = useState('');
  const [approveSaving, setApproveSaving] = useState(false);
  const [approveSuccess, setApproveSuccess] = useState(false);
  const [approveError, setApproveError] = useState('');

  // ── Data management state ──────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importError, setImportError] = useState('');
  const [exportDone, setExportDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Saved commands state ───────────────────────────────────────────────
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);
  const [cmdLoading, setCmdLoading] = useState(false);
  const [editingCmd, setEditingCmd] = useState<SavedCommand | null>(null);
  const [showAddCmd, setShowAddCmd] = useState(false);
  const [newCmdName, setNewCmdName] = useState('');
  const [newCmdContent, setNewCmdContent] = useState('');
  const [newCmdType, setNewCmdType] = useState<'shell' | 'natural'>('shell');
  const [newCmdShortcut, setNewCmdShortcut] = useState('');
  const [newCmdDesc, setNewCmdDesc] = useState('');
  const [cmdSaving, setCmdSaving] = useState(false);
  const [cmdError, setCmdError] = useState('');

  // ── MCP servers state ──────────────────────────────────────────────────
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [editingMcp, setEditingMcp] = useState<MCPServer | null>(null);
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'stdio' | 'http'>('stdio');
  const [newMcpCommand, setNewMcpCommand] = useState('');
  const [newMcpArgs, setNewMcpArgs] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpDesc, setNewMcpDesc] = useState('');
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpError, setMcpError] = useState('');
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, { ok: boolean; error?: string; tools?: { name: string; description: string }[] }>>({});
  const [mcpTesting, setMcpTesting] = useState<string | null>(null);

  // ── Skills state ───────────────────────────────────────────────────────
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDesc, setNewSkillDesc] = useState('');
  const [newSkillPrompt, setNewSkillPrompt] = useState('');
  const [newSkillKeywords, setNewSkillKeywords] = useState('');
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillError, setSkillError] = useState('');

  function findProviderById(providerId?: string) {
    return AI_PROVIDERS.find(p => p.id === providerId) || AI_PROVIDERS[AI_PROVIDERS.length - 1];
  }

  function resolveInitialProviderId(data: Partial<AISettings> & { copilot?: { loggedIn?: boolean } }) {
    if (typeof data.providerId === 'string' && data.providerId.trim()) {
      return data.providerId;
    }
    const matched = AI_PROVIDERS.find(p => p.id !== 'custom' && p.id !== 'copilot' && p.baseUrl === data.baseUrl);
    if (matched) return matched.id;
    if (!(data.baseUrl || '').trim() && data.copilot?.loggedIn) return 'copilot';
    return 'custom';
  }

  function syncApiProviderModels(provider: AIProvider, data: Partial<AISettings>) {
    const mergedModels = Array.from(new Set([
      ...(provider.models || []),
      ...((data.enabledModels as string[] | undefined) || []),
      data.terminalModel || '',
      data.model || '',
    ].filter(Boolean)));

    setLocalModels(mergedModels);

    const enabled: Record<string, boolean> = {};
    for (const model of mergedModels) {
      enabled[model] = data.enabledModels?.length
        ? (data.enabledModels as string[]).includes(model)
        : true;
    }
    setModelEnabled(enabled);
    setTerminalModelId(data.terminalModel || data.model || mergedModels[0] || '');
  }

  // ── Load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/ai-settings').then(r => r.json()).then(data => {
      const providerId = resolveInitialProviderId(data);
      const provider = findProviderById(providerId);

      setAISettings(prev => ({ ...prev, ...data, providerId }));
      setSelectedProvider(providerId);
      setSelectedApiFormat((data.apiFormat as 'openai' | 'anthropic') || 'openai');
      setActiveProviderId(providerId);

      if (providerId === 'copilot') {
        setCopilotStatus(data.copilot);
        setLocalModels([]);
        setModelEnabled({});
        const savedTerminal = data.terminalModel || data.model || data.copilot?.model || 'gpt-4o';
        setTerminalModelId(savedTerminal);
        setCopilotTerminalModel(savedTerminal);
        // Hydrate copilotModelEnabled from persisted enabledModels
        const knownModels = data.copilot?.models?.length ? data.copilot.models : COPILOT_DEFAULT_MODELS;
        const savedEnabled: string[] = Array.isArray(data.enabledModels) && data.enabledModels.length > 1
          ? data.enabledModels
          : knownModels; // old format or empty → default-enable all
        const enabledMap: Record<string, boolean> = {};
        for (const m of knownModels) enabledMap[m] = savedEnabled.includes(m);
        setCopilotModelEnabled(enabledMap);
      } else {
        syncApiProviderModels(provider, data);
      }

      fetchCopilotStatus();

      // ── Load per-provider configs ──────────────────────────────────
      const configs: Record<string, ProviderConfig> = { ...(data.providerConfigs || {}) };
      // Backfill: if active non-copilot provider has credentials but not yet in providerConfigs
      if (providerId && providerId !== 'copilot' && data.apiKey && !configs[providerId]) {
        configs[providerId] = {
          apiKey: data.apiKey || '',
          baseUrl: data.baseUrl || '',
          model: data.model || '',
          terminalModel: data.terminalModel || '',
          enabledModels: data.enabledModels || [],
        };
      }
      setProviderConfigs(configs);

      setAILoading(false);
    }).catch(() => setAILoading(false));

    fetch('/api/auto-approve').then(r => r.json()).then(data => {
      setWhitelistRules(data.rules || []);
      setHighRiskRules(Array.isArray(data.highRiskRules) ? data.highRiskRules : DEFAULT_HIGH_RISK_RULES);
    }).catch(() => {});

    fetch('/api/app-settings').then(r => r.json()).then(s => {
      if (s.showStatusBar !== undefined) setShowStatusBar(s.showStatusBar);
      if (s.proxy !== undefined) setProxy(s.proxy || '');
      if (s.frequentCommandsCount !== undefined) setFrequentCommandsCount(s.frequentCommandsCount);
    }).catch(() => {});

    fetch('/api/saved-commands').then(r => r.json()).then(d => {
      setSavedCommands(Array.isArray(d) ? d : []);
    }).catch(() => {});

    fetch('/api/mcp-servers').then(r => r.json()).then(d => {
      setMcpServers(Array.isArray(d) ? d : []);
    }).catch(() => {});

    fetch('/api/skills').then(r => r.json()).then(d => {
      setSkills(Array.isArray(d) ? d : []);
    }).catch(() => {});

    return () => {
      if (copilotPollRef.current) clearInterval(copilotPollRef.current);
    };
  }, []);

  // ── Terminal settings auto-save ────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('terminal-settings', JSON.stringify(termSettings));
    window.dispatchEvent(new CustomEvent('terminal-settings-updated'));
  }, [termSettings]);

  // ── AI tab ─────────────────────────────────────────────────────────────

  // When copilotStatus updates (e.g. after refresh), merge any new models into
  // copilotModelEnabled defaulting new entries to enabled.
  useEffect(() => {
    if (!copilotStatus) return;
    const freshModels = copilotStatus.models?.length ? copilotStatus.models : COPILOT_DEFAULT_MODELS;
    setCopilotModelEnabled(prev => {
      const next = { ...prev };
      for (const m of freshModels) {
        if (!(m in next)) next[m] = true; // new model → default enabled
      }
      return next;
    });
  }, [copilotStatus]);

  const currentProvider = findProviderById(selectedProvider);

  /** Fetch copilot status, cancelling any previous in-flight request. Returns the parsed response. */
  function fetchCopilotStatus(): Promise<{ loggedIn: boolean; username?: string; model?: string; models?: string[] } | null> {
    if (copilotStatusAbortRef.current) copilotStatusAbortRef.current.abort();
    const ac = new AbortController();
    copilotStatusAbortRef.current = ac;
    setCopilotStatusLoading(true);
    return fetch('/api/copilot/status', { signal: ac.signal })
      .then(r => r.json())
      .then(d => { copilotStatusAbortRef.current = null; setCopilotStatusLoading(false); setCopilotStatus(d); return d; })
      .catch(() => { copilotStatusAbortRef.current = null; setCopilotStatusLoading(false); return null; });
  }

  function selectProvider(p: AIProvider) {
    const nextSettings: AISettings = {
      ...aiSettings,
      providerId: p.id,
    };

    if (p.id !== 'copilot' && p.id !== 'custom') {
      const nextModel = p.models.includes(aiSettings.model) ? aiSettings.model : (p.models[0] || '');
      nextSettings.baseUrl = p.baseUrl;
      nextSettings.model = nextModel;
      nextSettings.terminalModel = p.models.includes(aiSettings.terminalModel || '')
        ? aiSettings.terminalModel
        : nextModel;
      const enabledForProvider = (aiSettings.enabledModels || []).filter(model => p.models.includes(model));
      nextSettings.enabledModels = enabledForProvider.length ? enabledForProvider : [...p.models];
    }

    setSelectedProvider(p.id);
    setSelectedApiFormat(providerConfigs[p.id]?.apiFormat ?? 'openai');
    setAISettings(nextSettings);
    setTestResult(null);
    setAIError('');
    setAISuccess(false);

    if (p.id === 'copilot') {
      fetchCopilotStatus();
      setLocalModels([]);
      setModelEnabled({});
      setTerminalModelId(copilotStatus?.model || 'gpt-4o');
      return;
    }

    syncApiProviderModels(p, nextSettings);
  }

  function addLocalModel() {
    const m = newModelInput.trim();
    if (!m) return;
    if (!localModels.includes(m)) {
      setLocalModels(prev => [...prev, m]);
      setModelEnabled(prev => ({ ...prev, [m]: true }));
    }
    // Auto-star if no terminal model set
    setTerminalModelId(prev => prev || m);
    setAISettings(prev => ({ ...prev, model: m }));
    setNewModelInput('');
  }

  function removeLocalModel(m: string) {
    setLocalModels(prev => prev.filter(x => x !== m));
    setModelEnabled(prev => { const n = { ...prev }; delete n[m]; return n; });
    if (aiSettings.model === m) setAISettings(prev => ({ ...prev, model: '' }));
    if (terminalModelId === m) setTerminalModelId('');
  }

  async function fetchModelsFromAPI() {
    if (!aiSettings.baseUrl?.trim() || !aiSettings.apiKey?.trim()) {
      setAIError('请先填写 API Base URL 和 API Key 才能获取模型列表');
      return;
    }
    setFetchingModels(true); setAIError('');
    try {
      const res = await fetch('/api/test-ai-connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: aiSettings.baseUrl, apiKey: aiSettings.apiKey }),
      });
      const data = await res.json();
      if (data.models?.length > 0) {
        setLocalModels(prev => {
          const merged = [...prev];
          for (const m of data.models) { if (!merged.includes(m)) merged.push(m); }
          return merged;
        });
        // Enable newly fetched models
        setModelEnabled(prev => {
          const next = { ...prev };
          for (const m of data.models) { if (!(m in next)) next[m] = true; }
          return next;
        });
        if (!aiSettings.model && data.models[0]) {
          setAISettings(prev => ({ ...prev, model: data.models[0] }));
          setTerminalModelId(prev => prev || data.models[0]);
        }
      } else {
        setAIError(data.error ? `获取模型失败: ${data.error}` : '该服务不支持自动获取模型列表，请手动输入');
      }
    } catch (err: any) {
      setAIError(err.message === 'Failed to fetch' ? '无法连接到后端服务，请确认服务器是否启动' : `获取失败: ${err.message}`);
    } finally { setFetchingModels(false); }
  }

  async function testConnection() {
    if (!aiSettings.baseUrl?.trim() || !aiSettings.apiKey?.trim()) {
      setAIError('请先填写 API Base URL 和 API Key'); return;
    }
    setTesting(true); setAIError(''); setTestResult(null);
    try {
      const res = await fetch('/api/test-ai-connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: aiSettings.baseUrl, apiKey: aiSettings.apiKey, model: aiSettings.model }),
      });
      const data = await res.json();
      setTestResult(data);
      // Auto-merge fetched models into localModels on successful test
      if (data.ok && data.models?.length > 0) {
        setLocalModels(prev => {
          const merged = [...prev];
          for (const m of data.models) { if (!merged.includes(m)) merged.push(m); }
          return merged;
        });
        setModelEnabled(prev => {
          const next = { ...prev };
          for (const m of data.models) { if (!(m in next)) next[m] = true; }
          return next;
        });
        if (!aiSettings.model && data.models[0]) {
          setAISettings(prev => ({ ...prev, model: data.models[0] }));
          setTerminalModelId(prev => prev || data.models[0]);
        }
      }
    } catch (err: any) {
      setAIError(err.message === 'Failed to fetch' ? '无法连接到后端服务，请确认服务器是否启动' : `测试失败: ${err.message}`);
    } finally { setTesting(false); }
  }

  // ── Helper: readable fetch error ──────────────────────────────────────
  function fetchErrMsg(err: any): string {
    if (err.message === 'Failed to fetch' || err.message?.includes('fetch'))
      return '无法连接到后端服务，请确认 node server/index.js 已启动（端口 3000）';
    return err.message || '未知错误';
  }

  async function persistCopilotSelection(
    termModel: string,
    enabledModels?: string[],
    silent = false,
  ) {
    const payload = {
      providerId: 'copilot',
      model: termModel,
      terminalModel: termModel,
      enabledModels: enabledModels ?? [termModel],
    };

    const res = await fetch('/api/ai-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `服务器返回 ${res.status} ${res.statusText}`);
    }

    const saved = await res.json();
    setAISettings(prev => ({ ...prev, ...saved, providerId: 'copilot' }));
    setSelectedProvider('copilot');
    setActiveProviderId('copilot');
    setTerminalModelId(termModel);
    setCopilotTerminalModel(termModel);
    if (!silent) {
      setAISuccess(true);
      setTimeout(() => setAISuccess(false), 2000);
    }
    window.dispatchEvent(new CustomEvent('ai-settings-updated'));
    onSaved?.();
    return saved;
  }

  // ── GitHub Copilot handlers ────────────────────────────────────────────

  async function finishCopilotLogin() {
    if (copilotPollRef.current) {
      clearInterval(copilotPollRef.current);
      copilotPollRef.current = null;
    }
    setCopilotPolling(false);
    setCopilotDeviceCode(null);

            const sr = await fetch('/api/copilot/status', { signal: copilotStatusAbortRef.current?.signal });
    const sd = await sr.json();
    if (!sd.model) {
      const defaultModel = 'gpt-4o';
      await fetch('/api/copilot/model', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: defaultModel }),
      }).catch(() => {});
      sd.model = defaultModel;
    }

    setCopilotStatus(sd);
    setSelectedProvider('copilot');

    // Enable all available models after fresh login
    const allModels = sd.models?.length ? sd.models : COPILOT_DEFAULT_MODELS;
    const enabledMap: Record<string, boolean> = {};
    for (const m of allModels) enabledMap[m] = true;
    setCopilotModelEnabled(enabledMap);

    const termModel = sd.model || 'gpt-4o';
    await persistCopilotSelection(termModel, allModels);
  }

  async function startCopilotLogin() {
    setCopilotStarting(true); setAIError('');
    try {
      const res = await fetch('/api/copilot/device-start', { method: 'POST' });
      const data = await res.json();
      if (data.error) { setAIError(data.error); return; }
      setCopilotDeviceCode(data);
      setCopilotPolling(true);
      if (copilotPollRef.current) clearInterval(copilotPollRef.current);
      copilotPollRef.current = setInterval(async () => {
        try {
          const pr = await fetch('/api/copilot/device-poll');
          const pd = await pr.json();
          if (pd.status === 'success') {
            await finishCopilotLogin();
          } else if (pd.status === 'none') {
    const sr = await fetch('/api/copilot/status', { signal: copilotStatusAbortRef.current?.signal });
            const sd = await sr.json();
            if (sd.loggedIn) {
              await finishCopilotLogin();
            } else {
              if (copilotPollRef.current) {
                clearInterval(copilotPollRef.current);
                copilotPollRef.current = null;
              }
              setCopilotPolling(false);
              setCopilotDeviceCode(null);
              setAIError('授权状态已丢失，请重新发起登录');
            }
          } else if (pd.status === 'error') {
            clearInterval(copilotPollRef.current!);
            copilotPollRef.current = null;
            setCopilotPolling(false);
            setCopilotDeviceCode(null);
            setAIError(pd.error || '授权失败，请重试');
          }
        } catch (err: any) {
          if (copilotPollRef.current) {
            clearInterval(copilotPollRef.current);
            copilotPollRef.current = null;
          }
          setCopilotPolling(false);
          setAIError(fetchErrMsg(err));
        }
      }, 3000);
    } catch (err: any) {
      setAIError(fetchErrMsg(err));
    } finally { setCopilotStarting(false); }
  }

  async function handleCopilotLogout() {
    // Cancel any in-flight status requests so they can't overwrite the logged-out state
    if (copilotStatusAbortRef.current) { copilotStatusAbortRef.current.abort(); copilotStatusAbortRef.current = null; }
    if (copilotPollRef.current) { clearInterval(copilotPollRef.current); copilotPollRef.current = null; }
    setCopilotPolling(false); setCopilotDeviceCode(null);
    try { await fetch('/api/copilot/logout', { method: 'DELETE' }); } catch {}
    setCopilotStatus({ loggedIn: false });
    setModelTestResults({});
    setAISettings(prev => ({ ...prev, configured: prev.providerId === 'copilot' ? false : prev.configured }));
    onSaved?.();
  }

  async function testCopilotModel(model: string) {
    setModelTestResults(prev => ({
      ...prev,
      [model]: { ok: prev[model]?.ok ?? false, ...(prev[model] || {}), testing: true },
    }));
    try {
      const res = await fetch('/api/test-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, isCopilot: true }),
      });
      const data = await res.json();
      setModelTestResults(prev => ({ ...prev, [model]: { ok: data.ok, latencyMs: data.latencyMs, error: data.error, testing: false } }));
    } catch (err: any) {
      setModelTestResults(prev => ({ ...prev, [model]: { ok: false, error: err.message, testing: false } }));
    }
  }

  async function selectCopilotModel(model: string) {
    try {
      await fetch('/api/copilot/model', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      setCopilotStatus(prev => prev ? { ...prev, model } : prev);
      if (selectedProvider === 'copilot') {
        const allModels = copilotStatus?.models?.length ? copilotStatus.models : COPILOT_DEFAULT_MODELS;
        const enabled = allModels.filter(m => copilotModelEnabled[m] !== false);
        await persistCopilotSelection(model, enabled, true);
      }
    } catch {}
  }

  /** Toggle whether a Copilot model is available in the AI chat panel. */
  async function toggleCopilotModel(model: string) {
    const next = { ...copilotModelEnabled, [model]: !copilotModelEnabled[model] };
    setCopilotModelEnabled(next);
    if (selectedProvider === 'copilot') {
      const allModels = copilotStatus?.models?.length ? copilotStatus.models : COPILOT_DEFAULT_MODELS;
      const enabledList = allModels.filter(m => next[m] !== false);
      // If we just disabled the terminal model, fall back to first enabled
      const termModel = next[copilotTerminalModel] !== false
        ? copilotTerminalModel
        : (enabledList[0] || model);
      await persistCopilotSelection(termModel, enabledList, true).catch(() => {});
    }
  }

  /** Set the terminal/command-line model for Copilot. */
  async function selectCopilotTerminalModel(model: string) {
    setCopilotTerminalModel(model);
    setCopilotStatus(prev => prev ? { ...prev, model } : prev);
    try {
      await fetch('/api/copilot/model', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (selectedProvider === 'copilot') {
        const allModels = copilotStatus?.models?.length ? copilotStatus.models : COPILOT_DEFAULT_MODELS;
        const enabledList = allModels.filter(m => copilotModelEnabled[m] !== false);
        await persistCopilotSelection(model, enabledList, true);
      }
    } catch {}
  }

  async function testAllCopilotModels() {
    const models = copilotStatus?.models?.length ? copilotStatus.models : COPILOT_DEFAULT_MODELS;
    // Mark all as "testing"
    setModelTestResults(prev => {
      const next = { ...prev };
      for (const m of models) next[m] = { ok: next[m]?.ok ?? false, ...(next[m] || {}), testing: true };
      return next;
    });
    // Run all tests concurrently
    await Promise.all(models.map(m => testCopilotModel(m)));
  }

  // ── Saved commands CRUD ────────────────────────────────────────────────

  function notifyCommandsUpdated() {
    window.dispatchEvent(new CustomEvent('saved-commands-updated'));
  }

  async function addSavedCommand() {
    if (!newCmdName.trim() || !newCmdContent.trim()) { setCmdError('名称和内容不能为空'); return; }
    setCmdSaving(true); setCmdError('');
    try {
      const res = await fetch('/api/saved-commands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCmdName.trim(),
          content: newCmdContent.trim(),
          type: newCmdType,
          shortcut: newCmdShortcut.trim(),
          description: newCmdDesc.trim(),
        }),
      });
      if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
      const created: SavedCommand = await res.json();
      setSavedCommands(prev => [...prev, created]);
      setNewCmdName(''); setNewCmdContent(''); setNewCmdShortcut(''); setNewCmdDesc(''); setNewCmdType('shell');
      setShowAddCmd(false);
      notifyCommandsUpdated();
    } catch (err: any) {
      setCmdError(fetchErrMsg(err));
    } finally { setCmdSaving(false); }
  }

  async function updateSavedCommand(cmd: SavedCommand) {
    setCmdSaving(true); setCmdError('');
    try {
      const res = await fetch(`/api/saved-commands/${cmd.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cmd.name,
          content: cmd.content,
          type: cmd.type,
          shortcut: cmd.shortcut || '',
          description: cmd.description || '',
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
      const updated: SavedCommand = await res.json();
      setSavedCommands(prev => prev.map(c => c.id === updated.id ? updated : c));
      setEditingCmd(null);
      notifyCommandsUpdated();
    } catch (err: any) {
      setCmdError(fetchErrMsg(err));
    } finally { setCmdSaving(false); }
  }

  async function deleteSavedCommand(id: string) {
    try {
      await fetch(`/api/saved-commands/${id}`, { method: 'DELETE' });
      setSavedCommands(prev => prev.filter(c => c.id !== id));
      if (editingCmd?.id === id) setEditingCmd(null);
      notifyCommandsUpdated();
    } catch {}
  }

  // ── MCP servers CRUD ────────────────────────────────────────────────────

  function parseMcpArgs(raw: string): string[] {
    return raw.split('\n').map(s => s.trim()).filter(Boolean);
  }

  async function addMcpServer() {
    if (!newMcpName.trim()) { setMcpError('名称不能为空'); return; }
    if (newMcpTransport === 'stdio' && !newMcpCommand.trim()) { setMcpError('命令不能为空'); return; }
    if (newMcpTransport === 'http' && !newMcpUrl.trim()) { setMcpError('URL 不能为空'); return; }
    setMcpSaving(true); setMcpError('');
    try {
      const body: Record<string, unknown> = {
        name: newMcpName.trim(),
        transport: newMcpTransport,
        description: newMcpDesc.trim(),
        enabled: true,
      };
      if (newMcpTransport === 'stdio') {
        body.command = newMcpCommand.trim();
        body.args = parseMcpArgs(newMcpArgs);
      } else {
        body.url = newMcpUrl.trim();
      }
      const res = await fetch('/api/mcp-servers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
      const created: MCPServer = await res.json();
      setMcpServers(prev => [...prev, created]);
      setNewMcpName(''); setNewMcpCommand(''); setNewMcpArgs(''); setNewMcpUrl(''); setNewMcpDesc('');
      setShowAddMcp(false);
    } catch (err: any) {
      setMcpError(fetchErrMsg(err));
    } finally { setMcpSaving(false); }
  }

  async function updateMcpServer(s: MCPServer) {
    setMcpSaving(true); setMcpError('');
    try {
      const res = await fetch(`/api/mcp-servers/${s.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
      const updated: MCPServer = await res.json();
      setMcpServers(prev => prev.map(x => x.id === updated.id ? updated : x));
      setEditingMcp(null);
    } catch (err: any) {
      setMcpError(fetchErrMsg(err));
    } finally { setMcpSaving(false); }
  }

  async function deleteMcpServer(id: string) {
    try {
      await fetch(`/api/mcp-servers/${id}`, { method: 'DELETE' });
      setMcpServers(prev => prev.filter(s => s.id !== id));
      if (editingMcp?.id === id) setEditingMcp(null);
      setMcpTestResults(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch {}
  }

  async function toggleMcpServer(id: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/mcp-servers/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const updated: MCPServer = await res.json();
        setMcpServers(prev => prev.map(s => s.id === id ? updated : s));
      }
    } catch {}
  }

  async function testMcpServer(server: MCPServer) {
    setMcpTesting(server.id);
    setMcpTestResults(prev => ({ ...prev, [server.id]: { ok: false, error: '连接中...' } }));
    try {
      const res = await fetch(`/api/mcp-servers/${server.id}/test`, { method: 'POST' });
      const data = await res.json();
      setMcpTestResults(prev => ({ ...prev, [server.id]: data }));
    } catch (err: any) {
      setMcpTestResults(prev => ({ ...prev, [server.id]: { ok: false, error: err.message } }));
    } finally { setMcpTesting(null); }
  }

  // ── Skills CRUD ─────────────────────────────────────────────────────────

  async function addSkill() {
    if (!newSkillName.trim()) { setSkillError('名称不能为空'); return; }
    if (!newSkillPrompt.trim()) { setSkillError('系统提示词不能为空'); return; }
    setSkillSaving(true); setSkillError('');
    try {
      const res = await fetch('/api/skills', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSkillName.trim(),
          description: newSkillDesc.trim(),
          systemPromptAddition: newSkillPrompt.trim(),
          triggerKeywords: newSkillKeywords.split(',').map(k => k.trim()).filter(Boolean),
          enabled: true,
        }),
      });
      if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
      const created: Skill = await res.json();
      setSkills(prev => [...prev, created]);
      setNewSkillName(''); setNewSkillDesc(''); setNewSkillPrompt(''); setNewSkillKeywords('');
      setShowAddSkill(false);
    } catch (err: any) {
      setSkillError(fetchErrMsg(err));
    } finally { setSkillSaving(false); }
  }

  async function updateSkill(s: Skill) {
    setSkillSaving(true); setSkillError('');
    try {
      const res = await fetch(`/api/skills/${s.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
      const updated: Skill = await res.json();
      setSkills(prev => prev.map(x => x.id === updated.id ? updated : x));
      setEditingSkill(null);
    } catch (err: any) {
      setSkillError(fetchErrMsg(err));
    } finally { setSkillSaving(false); }
  }

  async function deleteSkill(id: string) {
    try {
      await fetch(`/api/skills/${id}`, { method: 'DELETE' });
      setSkills(prev => prev.filter(s => s.id !== id));
      if (editingSkill?.id === id) setEditingSkill(null);
    } catch {}
  }

  async function toggleSkill(id: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/skills/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const updated: Skill = await res.json();
        setSkills(prev => prev.map(s => s.id === id ? updated : s));
      }
    } catch {}
  }

  async function handleSaveAI() {
    if (selectedProvider === 'copilot') {
      if (!copilotStatus?.loggedIn) { setAIError('请先完成 GitHub Copilot 登录'); return; }
      const termModel = copilotTerminalModel || copilotStatus.model || 'gpt-4o';
      const allModels = copilotStatus.models?.length ? copilotStatus.models : COPILOT_DEFAULT_MODELS;
      const enabledList = allModels.filter(m => copilotModelEnabled[m] !== false);
      setAISaving(true); setAIError(''); setAISuccess(false);
      try {
        await persistCopilotSelection(termModel, enabledList);
        setShowResetConfirm(false);
      } catch (err: any) {
        setAIError(fetchErrMsg(err));
      } finally { setAISaving(false); }
      return;
    }

    if (!aiSettings.baseUrl?.trim()) { setAIError('请输入 API Base URL'); return; }
    if (!aiSettings.apiKey?.trim()) { setAIError('请输入 API Key'); return; }
    // Compute enabled models list
    const enabledList = localModels.filter(m => modelEnabled[m]);
    // Auto-pick terminal model: prefer explicitly set, else first enabled, else first in list
    const effectiveTerminal = terminalModelId
      || enabledList[0]
      || localModels[0]
      || '';
    if (!effectiveTerminal) { setAIError('请先添加至少一个模型'); return; }
    // Auto-update terminalModelId in state so UI reflects it
    if (!terminalModelId) setTerminalModelId(effectiveTerminal);
    // Must pass connection test before saving
    if (!testResult) { setAIError('请先点击"测试连接"验证配置，通过后才能保存'); return; }
    if (!testResult.ok) { setAIError(`测试连接未通过，请修复后重新测试再保存。${testResult.error ? '原因：' + testResult.error : ''}`); return; }
    setAISaving(true); setAIError(''); setAISuccess(false);
    try {
      const enabledList = localModels.filter(m => modelEnabled[m]);
      // Save this provider's credentials into providerConfigs
      const newProviderConfig: ProviderConfig = {
        apiKey: aiSettings.apiKey,
        baseUrl: aiSettings.baseUrl,
        model: effectiveTerminal,
        terminalModel: effectiveTerminal,
        enabledModels: enabledList,
        apiFormat: selectedApiFormat,
      };
      const updatedConfigs = { ...providerConfigs, [selectedProvider]: newProviderConfig };
      const payload = {
        ...aiSettings,
        providerId: selectedProvider,
        model: effectiveTerminal,
        terminalModel: effectiveTerminal,
        enabledModels: enabledList,
        providerConfigs: updatedConfigs,
        apiFormat: selectedApiFormat,
      };
      const res = await fetch('/api/ai-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `服务器返回 ${res.status} ${res.statusText}`);
      }
      const saved = await res.json();
      setAISettings(prev => ({ ...prev, ...saved, providerId: selectedProvider }));
      setActiveProviderId(selectedProvider);
      setProviderConfigs(updatedConfigs);
      setShowResetConfirm(false);
      setAISuccess(true);
      window.dispatchEvent(new CustomEvent('ai-settings-updated'));
      onSaved?.();
      setTimeout(() => setAISuccess(false), 2000);
    } catch (err: any) {
      setAIError(fetchErrMsg(err));
    } finally { setAISaving(false); }
  }

  // ── Switch to a configured provider instantly ──────────────────────────

  async function switchToProvider(id: string) {
    if (id === 'copilot') {
      if (!copilotStatus?.loggedIn) return;
      await persistCopilotSelection(copilotStatus.model || 'gpt-4o');
      return;
    }
    const config = providerConfigs[id];
    if (!config) return;
    const provider = findProviderById(id);
    setAISaving(true); setAIError('');
    try {
      const res = await fetch('/api/ai-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: id,
          baseUrl: config.baseUrl || provider.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          terminalModel: config.terminalModel || config.model,
          enabledModels: config.enabledModels || [config.model],
          providerConfigs,
        }),
      });
      if (!res.ok) throw new Error('切换失败');
      const saved = await res.json();
      setAISettings(prev => ({ ...prev, ...saved, providerId: id }));
      setActiveProviderId(id);
      setSelectedProvider(id);
      syncApiProviderModels(provider, { ...config, baseUrl: config.baseUrl || provider.baseUrl });
      window.dispatchEvent(new CustomEvent('ai-settings-updated'));
      onSaved?.();
    } catch (err: any) {
      setAIError(fetchErrMsg(err));
    } finally { setAISaving(false); }
  }

  // ── Remove a configured provider ──────────────────────────────────────

  async function removeProvider(id: string) {
    const newConfigs = { ...providerConfigs };
    delete newConfigs[id];
    setProviderConfigs(newConfigs);
    if (expandedProvider === id) setExpandedProvider(null);
    try {
      if (activeProviderId === id) {
        const next = AI_PROVIDERS.find(p =>
          p.id !== id && (p.id === 'copilot' ? !!copilotStatus?.loggedIn : !!newConfigs[p.id]?.apiKey)
        );
        if (next) {
          await fetch('/api/ai-settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerConfigs: newConfigs }),
          });
          await switchToProvider(next.id);
        } else {
          // No remaining providers — clear credentials from server to prevent AI from still working
          await fetch('/api/ai-settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              providerConfigs: newConfigs,
              baseUrl: '',
              apiKey: '',
              model: '',
              terminalModel: '',
              enabledModels: [],
              providerId: 'custom',
            }),
          });
          setActiveProviderId('custom');
          setSelectedProvider('custom');
          setLocalModels([]);
          setModelEnabled({});
          setTerminalModelId('');
          setAISettings(prev => ({
            ...prev,
            configured: false,
            baseUrl: '',
            apiKey: '',
            model: '',
            terminalModel: '',
            enabledModels: [],
            providerId: 'custom',
          }));
          window.dispatchEvent(new CustomEvent('ai-settings-updated'));
          onSaved?.();
        }
      } else {
        // Removing an inactive provider — only update providerConfigs
        await fetch('/api/ai-settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ providerConfigs: newConfigs }),
        });
      }
    } catch { /* silently ignore */ }
  }

  async function handleSaveShellAgent() {
    setAISaving(true); setAIError(''); setAISuccess(false);
    try {
      const res = await fetch('/api/ai-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enableCommandExplain: aiSettings.enableCommandExplain,
          enableAIAssistant: aiSettings.enableAIAssistant,
          enableAutoComplete: aiSettings.enableAutoComplete,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `服务器返回 ${res.status} ${res.statusText}`);
      }
      setAISuccess(true);
      onSaved?.();
      setTimeout(() => setAISuccess(false), 2000);
    } catch (err: any) {
      setAIError(fetchErrMsg(err));
    } finally { setAISaving(false); }
  }

  // Clear all AI credentials and reset provider to "custom" (keeps behaviour prefs)
  async function handleResetAI() {
    try {
      await fetch('/api/ai-settings', { method: 'DELETE' });
      setAISettings(prev => ({
        ...prev,
        providerId: 'custom',
        baseUrl: '',
        apiKey: '',
        model: '',
        terminalModel: '',
        enabledModels: [],
        configured: false,
      }));
      setSelectedProvider('custom');
      setActiveProviderId('custom');
      setLocalModels([]);
      setModelEnabled({});
      setTerminalModelId('');
      setTestResult(null);
      setAIError('');
      setShowResetConfirm(false);
      window.dispatchEvent(new CustomEvent('ai-settings-updated'));
      onSaved?.();
    } catch (err: any) {
      setAIError(fetchErrMsg(err));
      setShowResetConfirm(false);
    }
  }

  // ── General settings save ──────────────────────────────────────────────

  async function handleSaveGeneral() {
    setGeneralSaving(true);
    try {
      await fetch('/api/app-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showStatusBar, proxy, frequentCommandsCount }),
      });
      window.dispatchEvent(new CustomEvent('app-settings-updated', { detail: { showStatusBar, proxy, frequentCommandsCount } }));
      setGeneralSuccess(true);
      setTimeout(() => setGeneralSuccess(false), 2000);
      onSaved?.();
    } catch {}
    finally { setGeneralSaving(false); }
  }

  // ── Terminal settings save ─────────────────────────────────────────────

  function handleSaveTerminal() {
    localStorage.setItem('terminal-settings', JSON.stringify(termSettings));
    window.dispatchEvent(new CustomEvent('terminal-settings-updated'));
    setTermSaved(true);
    setTimeout(() => setTermSaved(false), 2000);
  }

  // ── Shortcuts ─────────────────────────────────────────────────────────

  function saveShortcuts() {
    localStorage.setItem('app-shortcuts', JSON.stringify(shortcuts));
    window.dispatchEvent(new CustomEvent('shortcuts-updated', { detail: shortcuts }));
    setShortcutsSaved(true);
    setTimeout(() => setShortcutsSaved(false), 2000);
  }

  function updateShortcut(id: string, patch: Partial<ShortcutDef>) {
    setShortcuts(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  function addNewShortcut() {
    if (!newShortcutDesc.trim() || !newShortcutKey.trim()) return;
    const newS: ShortcutDef = {
      id: `custom.${Date.now()}`,
      key: newShortcutKey,
      desc: newShortcutDesc,
      type: newShortcutType,
      enabled: true,
      system: false,
    };
    setShortcuts(prev => [...prev, newS]);
    setNewShortcutDesc(''); setNewShortcutKey(''); setShowAddShortcut(false);
  }

  function deleteShortcut(id: string) {
    setShortcuts(prev => prev.filter(s => s.id !== id));
  }

  // ── Whitelist (command rules) ──────────────────────────────────────────

  function appendRule(
    setRules: React.Dispatch<React.SetStateAction<AutoApproveRule[]>>,
    pattern: string,
    description?: string,
  ) {
    const rule: AutoApproveRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      pattern: pattern.trim(),
      enabled: true,
      description: description?.trim() || undefined,
    };
    setRules(prev => [...prev, rule]);
  }

  function addRule() {
    if (!newPattern.trim()) return;
    appendRule(setWhitelistRules, newPattern, newDesc);
    setNewPattern(''); setNewDesc('');
  }

  function addHighRiskRule() {
    if (!newHighRiskPattern.trim()) return;
    appendRule(setHighRiskRules, newHighRiskPattern, newHighRiskDesc);
    setNewHighRiskPattern(''); setNewHighRiskDesc('');
  }

  function addPresetCmd(
    rules: AutoApproveRule[],
    setRules: React.Dispatch<React.SetStateAction<AutoApproveRule[]>>,
    cmd: string,
    desc?: string,
  ) {
    if (rules.some(r => r.pattern === cmd)) return;
    appendRule(setRules, cmd, desc);
  }

  async function saveAgentSettings() {
    setApproveSaving(true); setApproveError(''); setApproveSuccess(false);
    try {
      // Save agent exec mode
      const r1 = await fetch('/api/ai-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentExecMode: aiSettings.agentExecMode }),
      });
      if (!r1.ok) {
        const b = await r1.json().catch(() => ({}));
        throw new Error(b.error || `保存执行模式失败 (${r1.status})`);
      }
      // Save whitelist rules
      const res = await fetch('/api/auto-approve', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalAutoApprove: { low: false, normal: false, high: false },
          rules: whitelistRules,
          highRiskRules,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `保存白名单失败 (${res.status})`);
      }
      setApproveSuccess(true);
      onSaved?.();
      setTimeout(() => setApproveSuccess(false), 2000);
    } catch (err: any) {
      setApproveError(fetchErrMsg(err));
    } finally { setApproveSaving(false); }
  }

  // ── Data management ────────────────────────────────────────────────────

  async function handleExport() {
    try {
      const res = await fetch('/api/export-settings');
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setImportError(b.error || `导出失败 (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `ssh-ai-shell-${today}.enc`; a.click();
      URL.revokeObjectURL(url);
      setExportDone(true);
      setTimeout(() => setExportDone(false), 3000);
    } catch (err: any) {
      setImportError(err.message === 'Failed to fetch'
        ? '无法连接到后端服务，请确认 node server/index.js 已启动'
        : `导出失败: ${err.message}`);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setImporting(true); setImportError(''); setImportSuccess(false);
    try {
      const raw = await file.text();
      const res = await fetch('/api/import-settings', {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: raw,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `导入失败，服务器返回 ${res.status} ${res.statusText}`);
      }
      // Reload local state
      const [aiData, approveData, appData] = await Promise.all([
        fetch('/api/ai-settings').then(r => r.json()),
        fetch('/api/auto-approve').then(r => r.json()),
        fetch('/api/app-settings').then(r => r.json()),
      ]);
      setAISettings(prev => ({ ...prev, ...aiData }));
      setWhitelistRules(approveData.rules || []);
      setHighRiskRules(Array.isArray(approveData.highRiskRules) ? approveData.highRiskRules : DEFAULT_HIGH_RISK_RULES);
      if (appData.showStatusBar !== undefined) setShowStatusBar(appData.showStatusBar);
      if (appData.proxy !== undefined) setProxy(appData.proxy || '');
      if (appData.frequentCommandsCount !== undefined) setFrequentCommandsCount(appData.frequentCommandsCount);
      window.dispatchEvent(new CustomEvent('hosts-updated'));
      setImportSuccess(true);
      onSaved?.();
    } catch (err: any) {
      setImportError(err.message === 'Failed to fetch'
        ? '无法连接到后端服务，请确认 node server/index.js 已启动'
        : (err.message || '导入失败，请检查文件格式'));
    } finally { setImporting(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  }

  // ─── Nav items ─────────────────────────────────────────────────────────

  const NAV: { id: Section; label: string; icon: React.ElementType }[] = [
    { id: 'general',   label: '通用设置', icon: Settings },
    { id: 'terminal',  label: '终端设置', icon: Monitor },
    { id: 'shortcuts', label: '快捷键',   icon: Keyboard },
    { id: 'commands',  label: '常用命令', icon: BookMarked },
    { id: 'ai',        label: 'AI 设置',  icon: Cpu },
    { id: 'mcp',       label: 'MCP 服务', icon: Server },
    { id: 'skills',    label: 'Skills',   icon: Zap },
    { id: 'data',      label: '数据管理', icon: Download },
    { id: 'about',     label: '关于',     icon: Info },
  ];

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-terminal-bg border border-terminal-border rounded-2xl shadow-2xl w-full max-w-4xl mx-4 animate-slide-up flex overflow-hidden" style={{ height: '85vh' }}>

        {/* ── Left nav ────────────────────────────────────────────────── */}
        <div className="w-48 bg-terminal-surface border-r border-terminal-border flex flex-col flex-shrink-0">
          <div className="flex items-center gap-2 px-4 py-4 border-b border-terminal-border">
            <Settings className="w-4 h-4 text-terminal-blue" />
            <span className="text-sm font-semibold text-terminal-text">设置</span>
          </div>
          <nav className="flex-1 py-2 overflow-y-auto">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setSection(id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left ${
                  section === id
                    ? 'bg-terminal-blue/10 text-terminal-blue border-r-2 border-terminal-blue'
                    : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border/20'
                }`}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </button>
            ))}
          </nav>
          <div className="px-4 py-3 border-t border-terminal-border">
            <p className="text-[10px] text-terminal-muted/40">SSH AI Shell v1.0</p>
          </div>
        </div>

        {/* ── Right content ────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-terminal-border flex-shrink-0">
            <h2 className="text-base font-semibold text-terminal-text">
              {NAV.find(n => n.id === section)?.label}
            </h2>
            <button onClick={onClose} className="text-terminal-muted hover:text-terminal-text transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* ── 通用设置 ──────────────────────────────────────────────── */}
            {section === 'general' && (
              <>
                <div>
                  <h3 className="text-sm font-semibold text-terminal-text mb-1">颜色主题</h3>
                  <p className="text-xs text-terminal-muted mb-3">选择工作台的颜色主题</p>
                  <div className="grid grid-cols-3 gap-3">
                    {/* Dark theme card */}
                    <button onClick={() => onThemeChange('dark')}
                      className={`relative rounded-xl border-2 overflow-hidden transition-all ${
                        theme === 'dark' ? 'border-terminal-blue' : 'border-terminal-border hover:border-terminal-muted'
                      }`}>
                      <div className="bg-[#0d1117] p-3 h-24 flex flex-col gap-1.5">
                        <div className="flex gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-full bg-[#f85149]" />
                          <div className="w-2 h-2 rounded-full bg-[#d29922]" />
                          <div className="w-2 h-2 rounded-full bg-[#3fb950]" />
                        </div>
                        <div className="h-1.5 bg-[#30363d] rounded w-3/4" />
                        <div className="h-1.5 bg-[#30363d] rounded w-1/2" />
                        <div className="h-1.5 bg-[#58a6ff]/40 rounded w-2/3" />
                        <div className="h-1.5 bg-[#30363d] rounded w-4/5" />
                      </div>
                      <div className="bg-[#161b22] border-t border-[#30363d] px-3 py-1.5 flex items-center justify-between">
                        <span className="text-xs text-[#e6edf3]">暗色</span>
                        {theme === 'dark' && (
                          <span className="text-[10px] bg-[#58a6ff] text-black px-1.5 py-0.5 rounded font-semibold">当前</span>
                        )}
                      </div>
                    </button>

                    {/* Light theme card */}
                    <button onClick={() => onThemeChange('light')}
                      className={`relative rounded-xl border-2 overflow-hidden transition-all ${
                        theme === 'light' ? 'border-terminal-blue' : 'border-terminal-border hover:border-terminal-muted'
                      }`}>
                      <div className="bg-white p-3 h-24 flex flex-col gap-1.5">
                        <div className="flex gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-full bg-[#cf222e]" />
                          <div className="w-2 h-2 rounded-full bg-[#9a6700]" />
                          <div className="w-2 h-2 rounded-full bg-[#1a7f37]" />
                        </div>
                        <div className="h-1.5 bg-[#d0d7de] rounded w-3/4" />
                        <div className="h-1.5 bg-[#d0d7de] rounded w-1/2" />
                        <div className="h-1.5 bg-[#0969da]/30 rounded w-2/3" />
                        <div className="h-1.5 bg-[#d0d7de] rounded w-4/5" />
                      </div>
                      <div className="bg-[#f6f8fa] border-t border-[#d0d7de] px-3 py-1.5 flex items-center justify-between">
                        <span className="text-xs text-[#1f2328]">亮色</span>
                        {theme === 'light' && (
                          <span className="text-[10px] bg-[#0969da] text-white px-1.5 py-0.5 rounded font-semibold">当前</span>
                        )}
                      </div>
                    </button>

                    {/* Monokai theme card */}
                    <button onClick={() => onThemeChange('monokai')}
                      className={`relative rounded-xl border-2 overflow-hidden transition-all ${
                        theme === 'monokai' ? 'border-terminal-blue' : 'border-terminal-border hover:border-terminal-muted'
                      }`}>
                      <div className="bg-[#272822] p-3 h-24 flex flex-col gap-1.5">
                        <div className="flex gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-full bg-[#f92672]" />
                          <div className="w-2 h-2 rounded-full bg-[#e6db74]" />
                          <div className="w-2 h-2 rounded-full bg-[#a6e22e]" />
                        </div>
                        <div className="h-1.5 bg-[#49483e] rounded w-3/4" />
                        <div className="h-1.5 bg-[#49483e] rounded w-1/2" />
                        <div className="h-1.5 bg-[#66d9ef]/40 rounded w-2/3" />
                        <div className="h-1.5 bg-[#49483e] rounded w-4/5" />
                      </div>
                      <div className="bg-[#32332b] border-t border-[#49483e] px-3 py-1.5 flex items-center justify-between">
                        <span className="text-xs text-[#f8f8f2]">Monokai</span>
                        {theme === 'monokai' && (
                          <span className="text-[10px] bg-[#a6e22e] text-black px-1.5 py-0.5 rounded font-semibold">当前</span>
                        )}
                      </div>
                    </button>

                    {/* Nord theme card */}
                    <button onClick={() => onThemeChange('nord')}
                      className={`relative rounded-xl border-2 overflow-hidden transition-all ${
                        theme === 'nord' ? 'border-terminal-blue' : 'border-terminal-border hover:border-terminal-muted'
                      }`}>
                      <div className="bg-[#2e3440] p-3 h-24 flex flex-col gap-1.5">
                        <div className="flex gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-full bg-[#bf616a]" />
                          <div className="w-2 h-2 rounded-full bg-[#ebcb8b]" />
                          <div className="w-2 h-2 rounded-full bg-[#a3be8c]" />
                        </div>
                        <div className="h-1.5 bg-[#4c566a] rounded w-3/4" />
                        <div className="h-1.5 bg-[#4c566a] rounded w-1/2" />
                        <div className="h-1.5 bg-[#88c0d0]/40 rounded w-2/3" />
                        <div className="h-1.5 bg-[#4c566a] rounded w-4/5" />
                      </div>
                      <div className="bg-[#3b4252] border-t border-[#4c566a] px-3 py-1.5 flex items-center justify-between">
                        <span className="text-xs text-[#eceff4]">Nord</span>
                        {theme === 'nord' && (
                          <span className="text-[10px] bg-[#88c0d0] text-black px-1.5 py-0.5 rounded font-semibold">当前</span>
                        )}
                      </div>
                    </button>

                    {/* Solarized theme card */}
                    <button onClick={() => onThemeChange('solarized')}
                      className={`relative rounded-xl border-2 overflow-hidden transition-all ${
                        theme === 'solarized' ? 'border-terminal-blue' : 'border-terminal-border hover:border-terminal-muted'
                      }`}>
                      <div className="bg-[#002b36] p-3 h-24 flex flex-col gap-1.5">
                        <div className="flex gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-full bg-[#dc322f]" />
                          <div className="w-2 h-2 rounded-full bg-[#b58900]" />
                          <div className="w-2 h-2 rounded-full bg-[#859900]" />
                        </div>
                        <div className="h-1.5 bg-[#073642] rounded w-3/4" />
                        <div className="h-1.5 bg-[#073642] rounded w-1/2" />
                        <div className="h-1.5 bg-[#268bd2]/40 rounded w-2/3" />
                        <div className="h-1.5 bg-[#073642] rounded w-4/5" />
                      </div>
                      <div className="bg-[#073642] border-t border-[#268bd2]/40 px-3 py-1.5 flex items-center justify-between">
                        <span className="text-xs text-[#839496]">Solarized</span>
                        {theme === 'solarized' && (
                          <span className="text-[10px] bg-[#268bd2] text-white px-1.5 py-0.5 rounded font-semibold">当前</span>
                        )}
                      </div>
                    </button>

                    {/* Dracula theme card */}
                    <button onClick={() => onThemeChange('dracula')}
                      className={`relative rounded-xl border-2 overflow-hidden transition-all ${
                        theme === 'dracula' ? 'border-terminal-blue' : 'border-terminal-border hover:border-terminal-muted'
                      }`}>
                      <div className="bg-[#282a36] p-3 h-24 flex flex-col gap-1.5">
                        <div className="flex gap-1.5 mb-1">
                          <div className="w-2 h-2 rounded-full bg-[#ff5555]" />
                          <div className="w-2 h-2 rounded-full bg-[#f1fa8c]" />
                          <div className="w-2 h-2 rounded-full bg-[#50fa7b]" />
                        </div>
                        <div className="h-1.5 bg-[#6272a4] rounded w-3/4" />
                        <div className="h-1.5 bg-[#6272a4] rounded w-1/2" />
                        <div className="h-1.5 bg-[#8be9fd]/40 rounded w-2/3" />
                        <div className="h-1.5 bg-[#6272a4] rounded w-4/5" />
                      </div>
                      <div className="bg-[#44475a] border-t border-[#6272a4] px-3 py-1.5 flex items-center justify-between">
                        <span className="text-xs text-[#f8f8f2]">Dracula</span>
                        {theme === 'dracula' && (
                          <span className="text-[10px] bg-[#bd93f9] text-black px-1.5 py-0.5 rounded font-semibold">当前</span>
                        )}
                      </div>
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-terminal-text mb-1">状态栏可见性</h3>
                  <p className="text-xs text-terminal-muted mb-3">控制底部状态栏的显示</p>
                  <div className="bg-terminal-surface border border-terminal-border rounded-lg">
                    <Toggle checked={showStatusBar} onChange={setShowStatusBar}
                      label="显示状态栏" description="在终端底部显示连接状态、延迟等信息" />
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-terminal-text mb-1">悬浮栏常用指令数量</h3>
                  <p className="text-xs text-terminal-muted mb-3">鼠标悬停终端时右上角显示的常用指令按钮数量</p>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={frequentCommandsCount}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v >= 1 && v <= 30) setFrequentCommandsCount(v);
                    }}
                    className="w-24 bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue"
                  />
                  <p className="text-xs text-terminal-muted mt-1.5">范围 1–30，默认 10</p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-terminal-text mb-1">网络代理</h3>
                  <p className="text-xs text-terminal-muted mb-3">用于访问 GitHub Copilot 等需要代理的服务，留空表示直连</p>
                  <input
                    type="text"
                    value={proxy}
                    onChange={e => setProxy(e.target.value)}
                    placeholder="http://127.0.0.1:7890"
                    className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted focus:outline-none focus:border-terminal-blue"
                  />
                  <p className="text-xs text-terminal-muted mt-1.5">支持 http:// 和 socks5:// 协议，例如 http://127.0.0.1:7890</p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-terminal-text mb-1">语言偏好</h3>
                  <p className="text-xs text-terminal-muted mb-3">界面显示语言</p>
                  <div className="relative w-48">
                    <select className="w-full appearance-none bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue pr-8">
                      <option>简体中文</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted pointer-events-none" />
                  </div>
                </div>

                {generalSuccess && (
                  <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />设置已保存
                  </div>
                )}
                <button onClick={handleSaveGeneral} disabled={generalSaving}
                  className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50">
                  <Save className="w-4 h-4" />{generalSaving ? '保存中...' : '保存设置'}
                </button>
              </>
            )}

            {/* ── 终端设置 ──────────────────────────────────────────────── */}
            {section === 'terminal' && (
              <div className="flex gap-6">
                <div className="flex-1 space-y-4">
                  {/* Font */}
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1.5">字体</label>
                    <div className="relative">
                      <select value={termSettings.fontFamily}
                        onChange={e => setTermSettings(p => ({ ...p, fontFamily: e.target.value }))}
                        className="w-full appearance-none bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue pr-8">
                        <option>JetBrains Mono</option>
                        <option>Fira Code</option>
                        <option>Cascadia Code</option>
                        <option>Consolas</option>
                        <option>monospace</option>
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted pointer-events-none" />
                    </div>
                  </div>
                  {/* Font size */}
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1.5">字体大小</label>
                    <input type="number" value={termSettings.fontSize} min={10} max={24}
                      onChange={e => setTermSettings(p => ({ ...p, fontSize: parseInt(e.target.value) || 13 }))}
                      className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue" />
                  </div>
                  {/* Font weight */}
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1.5">字体粗细</label>
                    <div className="relative">
                      <select value={termSettings.fontWeight}
                        onChange={e => setTermSettings(p => ({ ...p, fontWeight: e.target.value }))}
                        className="w-full appearance-none bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue pr-8">
                        <option value="normal">normal</option>
                        <option value="bold">bold</option>
                        <option value="lighter">lighter</option>
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-terminal-muted pointer-events-none" />
                    </div>
                  </div>
                  {/* Letter spacing */}
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1.5">字符间距</label>
                    <input type="number" value={termSettings.letterSpacing} min={-2} max={8} step={0.5}
                      onChange={e => setTermSettings(p => ({ ...p, letterSpacing: parseFloat(e.target.value) || 0 }))}
                      className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue" />
                  </div>
                  {/* Line height */}
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1.5">行高</label>
                    <input type="number" value={termSettings.lineHeight} min={1} max={3} step={0.1}
                      onChange={e => setTermSettings(p => ({ ...p, lineHeight: parseFloat(e.target.value) || 1.45 }))}
                      className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue" />
                  </div>
                  {/* Scrollback */}
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1.5">回滚缓冲区大小</label>
                    <input type="number" value={termSettings.scrollback} min={100} max={10000} step={100}
                      onChange={e => setTermSettings(p => ({ ...p, scrollback: parseInt(e.target.value) || 1000 }))}
                      className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-sm text-terminal-text focus:outline-none focus:border-terminal-blue" />
                  </div>
                  {/* Toggles */}
                  <div className="bg-terminal-surface border border-terminal-border rounded-lg divide-y divide-terminal-border/50">
                    <Toggle checked={termSettings.selectToCopy} onChange={v => setTermSettings(p => ({ ...p, selectToCopy: v }))}
                      label="选择时复制" description="选中文本后自动复制到剪贴板" />
                    <Toggle checked={termSettings.cursorBlink} onChange={v => setTermSettings(p => ({ ...p, cursorBlink: v }))}
                      label="光标闪烁" description="终端光标是否闪烁" />
                  </div>
                  {/* Cursor style */}
                  <div>
                    <label className="block text-xs text-terminal-muted mb-2">光标样式</label>
                    <div className="flex gap-2">
                      {(['block', 'underline', 'bar'] as const).map(s => (
                        <button key={s} onClick={() => setTermSettings(p => ({ ...p, cursorStyle: s }))}
                          className={`flex items-center justify-center w-12 h-10 rounded-lg border text-sm font-mono transition-colors ${
                            termSettings.cursorStyle === s
                              ? 'border-terminal-blue bg-terminal-blue/15 text-terminal-blue'
                              : 'border-terminal-border text-terminal-muted hover:text-terminal-text'
                          }`}>
                          {s === 'block' ? '█' : s === 'underline' ? '▁' : '|'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {termSaved && (
                    <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2">
                      <CheckCircle2 className="w-3.5 h-3.5" />设置已保存并实时生效
                    </div>
                  )}
                  <button onClick={handleSaveTerminal}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors">
                    <Save className="w-4 h-4" />保存设置
                  </button>
                </div>

                {/* Preview */}
                <div className="w-64 flex-shrink-0">
                  <label className="block text-xs text-terminal-muted mb-1.5">预览</label>
                  <div className="bg-terminal-bg rounded-lg p-3 border border-terminal-border font-mono overflow-hidden"
                    style={{ fontSize: `${termSettings.fontSize}px`, fontFamily: termSettings.fontFamily,
                      lineHeight: termSettings.lineHeight, letterSpacing: `${termSettings.letterSpacing}px`,
                      fontWeight: termSettings.fontWeight }}>
                    <div style={{ color: 'rgb(var(--tw-c-green))' }}>root@server:~$<span style={{ color: 'rgb(var(--tw-c-term-fg))' }}> ls -la</span></div>
                    <div style={{ color: 'rgb(var(--tw-c-term-fg))' }}>total 48</div>
                    <div style={{ color: 'rgb(var(--tw-c-term-fg))' }}>drwxr-xr-x 1 root root  <span style={{ color: 'rgb(var(--tw-c-blue))' }}>Document</span></div>
                    <div style={{ color: 'rgb(var(--tw-c-term-fg))' }}>drwxr-xr-x 1 root root  <span style={{ color: 'rgb(var(--tw-c-blue))' }}>Downloads</span></div>
                    <div style={{ color: 'rgb(var(--tw-c-term-fg))' }}>-rw-r--r-- 1 root root  <span style={{ color: 'rgb(var(--tw-c-yellow))' }}>.bashrc</span></div>
                    <div style={{ color: 'rgb(var(--tw-c-green))' }}>root@server:~$ <span style={{ color: 'rgb(var(--tw-c-term-fg))' }}>
                      {termSettings.cursorStyle === 'block' ? '█' : termSettings.cursorStyle === 'underline' ? '▁' : '|'}
                    </span></div>
                  </div>
                  <p className="text-[10px] text-terminal-muted mt-2">修改后实时预览，保存后应用到终端</p>
                </div>
              </div>
            )}

            {/* ── 快捷键 ────────────────────────────────────────────────── */}
            {section === 'shortcuts' && (
              <>
                <div className="bg-terminal-blue/10 border border-terminal-blue/20 rounded-lg px-4 py-3 text-xs text-terminal-blue leading-relaxed">
                  <p className="font-medium mb-1">快捷键说明</p>
                  <p>1. 标记为"系统"的快捷键由终端/浏览器直接处理，无法修改绑定键</p>
                  <p>2. 其他快捷键可点击键名修改绑定，点击启用开关切换状态</p>
                  <p>3. 修改后需点击"保存快捷键"才能生效</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-terminal-border">
                        <th className="text-left py-2 px-2 text-terminal-muted font-medium w-8"></th>
                        <th className="text-left py-2 px-2 text-terminal-muted font-medium">快捷键</th>
                        <th className="text-left py-2 px-2 text-terminal-muted font-medium">描述</th>
                        <th className="text-left py-2 px-2 text-terminal-muted font-medium">类型</th>
                        <th className="text-center py-2 px-2 text-terminal-muted font-medium">启用</th>
                        <th className="text-center py-2 px-2 text-terminal-muted font-medium w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {shortcuts.map(s => (
                        <tr key={s.id} className="border-b border-terminal-border/30 hover:bg-terminal-border/10 group">
                          <td className="py-2 px-2">
                            {s.system && (
                              <span className="text-[9px] text-terminal-muted/60 border border-terminal-border/40 rounded px-1">系统</span>
                            )}
                          </td>
                          <td className="py-2 px-2">
                            {s.system ? (
                              <span className="px-1.5 py-0.5 bg-terminal-surface border border-terminal-border rounded text-terminal-text font-mono">
                                {s.key}
                              </span>
                            ) : (
                              editingShortcutId === s.id ? (
                                <KeyRecorder
                                  value={s.key}
                                  onChange={k => { updateShortcut(s.id, { key: k }); setEditingShortcutId(null); }}
                                  onCancel={() => setEditingShortcutId(null)}
                                />
                              ) : (
                                <button
                                  onClick={() => setEditingShortcutId(s.id)}
                                  className="px-1.5 py-0.5 bg-terminal-surface border border-terminal-border rounded text-terminal-text font-mono hover:border-terminal-blue transition-colors group-hover:border-terminal-muted"
                                  title="点击修改"
                                >
                                  {s.key}
                                  <Edit3 className="w-2.5 h-2.5 inline ml-1 opacity-0 group-hover:opacity-60" />
                                </button>
                              )
                            )}
                          </td>
                          <td className="py-2 px-2 text-terminal-text">{s.desc}</td>
                          <td className="py-2 px-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              s.type === '终端' ? 'text-terminal-green border-terminal-green/30 bg-terminal-green/10' :
                              s.type === '面板' ? 'text-terminal-blue border-terminal-blue/30 bg-terminal-blue/10' :
                              'text-terminal-yellow border-terminal-yellow/30 bg-terminal-yellow/10'
                            }`}>{s.type}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              onClick={() => updateShortcut(s.id, { enabled: !s.enabled })}
                              className={`w-8 h-4 rounded-full transition-colors relative ${s.enabled ? 'bg-terminal-blue' : 'bg-terminal-border'}`}
                            >
                              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${s.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                            </button>
                          </td>
                          <td className="py-2 px-2 text-center">
                            {!s.system && (
                              <button
                                onClick={() => deleteShortcut(s.id)}
                                className="opacity-0 group-hover:opacity-100 text-terminal-muted hover:text-terminal-red transition-opacity"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add new shortcut */}
                {showAddShortcut ? (
                  <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4 space-y-3">
                    <p className="text-xs font-semibold text-terminal-text">添加自定义快捷键</p>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-[10px] text-terminal-muted mb-1">描述</label>
                        <input type="text" value={newShortcutDesc} onChange={e => setNewShortcutDesc(e.target.value)}
                          placeholder="如：打开命令面板"
                          className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue" />
                      </div>
                      <div className="w-40">
                        <label className="block text-[10px] text-terminal-muted mb-1">快捷键（点击录入）</label>
                        <KeyRecorder
                          value={newShortcutKey || '点击录入'}
                          onChange={k => setNewShortcutKey(k)}
                          onCancel={() => {}}
                        />
                      </div>
                      <div className="w-20">
                        <label className="block text-[10px] text-terminal-muted mb-1">类型</label>
                        <select value={newShortcutType} onChange={e => setNewShortcutType(e.target.value as any)}
                          className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue">
                          <option>终端</option>
                          <option>面板</option>
                          <option>应用</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addNewShortcut} disabled={!newShortcutDesc.trim() || !newShortcutKey.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-terminal-blue text-white font-medium transition-colors disabled:opacity-40">
                        <Plus className="w-3 h-3" />添加
                      </button>
                      <button onClick={() => setShowAddShortcut(false)}
                        className="px-3 py-1.5 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setShowAddShortcut(true)}
                    className="flex items-center gap-2 text-xs text-terminal-muted hover:text-terminal-blue transition-colors">
                    <Plus className="w-3.5 h-3.5" />添加自定义快捷键
                  </button>
                )}

                {shortcutsSaved && (
                  <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />快捷键已保存
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={saveShortcuts}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors">
                    <Save className="w-4 h-4" />保存快捷键
                  </button>
                  <button onClick={() => {
                    setShortcuts(DEFAULT_SHORTCUTS);
                    localStorage.setItem('app-shortcuts', JSON.stringify(DEFAULT_SHORTCUTS));
                    window.dispatchEvent(new CustomEvent('shortcuts-updated', { detail: DEFAULT_SHORTCUTS }));
                    setShortcutsSaved(true);
                    setTimeout(() => setShortcutsSaved(false), 2000);
                  }}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text hover:border-terminal-muted transition-colors">
                    <RefreshCw className="w-4 h-4" />恢复默认
                  </button>
                </div>
              </>
            )}

            {/* ── 常用命令 ──────────────────────────────────────────────── */}
            {section === 'commands' && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <h3 className="text-sm font-semibold text-terminal-text">常用命令</h3>
                      <p className="text-xs text-terminal-muted mt-0.5">
                        保存常用命令、脚本或自然语言指令，在侧边栏一键执行，或绑定快捷键直接触发。
                      </p>
                    </div>
                    <button
                      onClick={() => { setShowAddCmd(true); setEditingCmd(null); }}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-terminal-blue/20 hover:bg-terminal-blue/30 text-terminal-blue border border-terminal-blue/30 transition-colors"
                    >
                      <Plus className="w-3 h-3" />添加命令
                    </button>
                  </div>
                </div>

                {cmdError && (
                  <div className="flex items-center gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5" />{cmdError}
                  </div>
                )}

                {/* Add command form */}
                {showAddCmd && (
                  <div className="bg-terminal-surface border border-terminal-blue/30 rounded-xl p-4 space-y-3">
                    <div className="text-xs font-medium text-terminal-blue mb-1">新建常用命令</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-terminal-muted mb-1">名称 <span className="text-terminal-red">*</span></label>
                        <input
                          type="text"
                          value={newCmdName}
                          onChange={e => setNewCmdName(e.target.value)}
                          placeholder="例：查看磁盘使用"
                          className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-terminal-muted mb-1">类型</label>
                        <div className="flex gap-2">
                          {(['shell', 'natural'] as const).map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setNewCmdType(t)}
                              className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${
                                newCmdType === t
                                  ? 'bg-terminal-blue/20 border-terminal-blue/50 text-terminal-blue'
                                  : 'bg-terminal-bg border-terminal-border text-terminal-muted hover:border-terminal-blue/40'
                              }`}
                            >
                              {t === 'shell' ? 'Shell 命令' : 'AI 自然语言'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-terminal-muted mb-1">
                        {newCmdType === 'shell' ? '命令内容（支持多行脚本）' : '自然语言描述'} <span className="text-terminal-red">*</span>
                      </label>
                      <textarea
                        value={newCmdContent}
                        onChange={e => setNewCmdContent(e.target.value)}
                        rows={3}
                        placeholder={newCmdType === 'shell' ? 'df -h\nfree -h\nuptime' : '帮我查看磁盘使用情况并找出大文件'}
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue font-mono resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-terminal-muted mb-1">快捷键（可选）</label>
                        <KeyRecorder
                          value={newCmdShortcut || '（未设置）'}
                          onChange={k => setNewCmdShortcut(k === '（未设置）' ? '' : k)}
                          onCancel={() => {}}
                        />
                        {newCmdShortcut && (
                          <button
                            type="button"
                            onClick={() => setNewCmdShortcut('')}
                            className="mt-1 text-[10px] text-terminal-muted hover:text-terminal-red transition-colors"
                          >
                            清除快捷键
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] text-terminal-muted mb-1">备注说明（可选）</label>
                        <input
                          type="text"
                          value={newCmdDesc}
                          onChange={e => setNewCmdDesc(e.target.value)}
                          placeholder="简短说明用途"
                          className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={addSavedCommand}
                        disabled={cmdSaving || !newCmdName.trim() || !newCmdContent.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />{cmdSaving ? '保存中...' : '保存'}
                      </button>
                      <button
                        onClick={() => { setShowAddCmd(false); setCmdError(''); }}
                        className="px-4 py-2 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* Commands list */}
                {savedCommands.length === 0 && !showAddCmd ? (
                  <div className="flex flex-col items-center justify-center py-12 text-terminal-muted gap-2">
                    <BookMarked className="w-8 h-8 opacity-20" />
                    <p className="text-sm">暂无常用命令</p>
                    <p className="text-xs opacity-60">点击「添加命令」创建第一个常用命令</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {savedCommands.map(cmd => (
                      <div
                        key={cmd.id}
                        className="bg-terminal-surface border border-terminal-border rounded-xl p-3 group"
                      >
                        {editingCmd?.id === cmd.id ? (
                          /* Edit form */
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[10px] text-terminal-muted mb-1">名称</label>
                                <input
                                  type="text"
                                  value={editingCmd.name}
                                  onChange={e => setEditingCmd(prev => prev ? { ...prev, name: e.target.value } : null)}
                                  className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-terminal-muted mb-1">类型</label>
                                <div className="flex gap-1.5">
                                  {(['shell', 'natural'] as const).map(t => (
                                    <button
                                      key={t}
                                      type="button"
                                      onClick={() => setEditingCmd(prev => prev ? { ...prev, type: t } : null)}
                                      className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                                        editingCmd.type === t
                                          ? 'bg-terminal-blue/20 border-terminal-blue/50 text-terminal-blue'
                                          : 'bg-terminal-bg border-terminal-border text-terminal-muted'
                                      }`}
                                    >
                                      {t === 'shell' ? 'Shell' : 'AI'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div>
                              <label className="block text-[10px] text-terminal-muted mb-1">内容</label>
                              <textarea
                                value={editingCmd.content}
                                onChange={e => setEditingCmd(prev => prev ? { ...prev, content: e.target.value } : null)}
                                rows={3}
                                className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue font-mono resize-none"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[10px] text-terminal-muted mb-1">快捷键</label>
                                <KeyRecorder
                                  value={editingCmd.shortcut || '（未设置）'}
                                  onChange={k => setEditingCmd(prev => prev ? { ...prev, shortcut: k === '（未设置）' ? '' : k } : null)}
                                  onCancel={() => {}}
                                />
                                {editingCmd.shortcut && (
                                  <button
                                    type="button"
                                    onClick={() => setEditingCmd(prev => prev ? { ...prev, shortcut: '' } : null)}
                                    className="mt-1 text-[10px] text-terminal-muted hover:text-terminal-red transition-colors"
                                  >
                                    清除快捷键
                                  </button>
                                )}
                              </div>
                              <div>
                                <label className="block text-[10px] text-terminal-muted mb-1">备注</label>
                                <input
                                  type="text"
                                  value={editingCmd.description || ''}
                                  onChange={e => setEditingCmd(prev => prev ? { ...prev, description: e.target.value } : null)}
                                  className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => updateSavedCommand(editingCmd)}
                                disabled={cmdSaving}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white transition-colors disabled:opacity-50"
                              >
                                <Save className="w-3 h-3" />{cmdSaving ? '保存中...' : '保存'}
                              </button>
                              <button
                                onClick={() => { setEditingCmd(null); setCmdError(''); }}
                                className="px-3 py-1.5 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* View mode */
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-medium text-terminal-text">{cmd.name}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                                  cmd.type === 'natural'
                                    ? 'bg-terminal-cyan/10 border-terminal-cyan/30 text-terminal-cyan'
                                    : 'bg-terminal-green/10 border-terminal-green/30 text-terminal-green'
                                }`}>
                                  {cmd.type === 'natural' ? 'AI' : 'Shell'}
                                </span>
                                {cmd.shortcut && (
                                  <span className="text-[9px] font-mono bg-terminal-bg border border-terminal-border text-terminal-muted px-1.5 py-0.5 rounded">
                                    {cmd.shortcut}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs font-mono text-terminal-muted truncate max-w-md">
                                {cmd.content}
                              </div>
                              {cmd.description && (
                                <div className="text-[10px] text-terminal-muted/60 mt-0.5">{cmd.description}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <button
                                onClick={() => { setEditingCmd({ ...cmd }); setShowAddCmd(false); setCmdError(''); }}
                                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors"
                                title="编辑"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteSavedCommand(cmd.id)}
                                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-red/10 text-terminal-muted hover:text-terminal-red transition-colors"
                                title="删除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs text-terminal-muted bg-terminal-surface rounded-lg border border-terminal-border px-3 py-2.5">
                  <span className="font-medium text-terminal-text">提示：</span>
                  侧边栏点击命令直接在终端执行，设置快捷键后在终端输入框也可直接触发。Shell 类型命令直接在 SSH 执行，AI 类型命令将发送给 AI 助手处理。
                </div>
              </div>
            )}

            {/* ── AI 设置 ───────────────────────────────────────────────── */}
            {section === 'ai' && (
              <>
                {/* AI sub-tabs */}
                <div className="flex border-b border-terminal-border -mt-2 mb-4">
                  {([
                    { id: 'providers', label: '供应商' },
                    { id: 'api', label: 'API 配置' },
                    { id: 'shell', label: 'Shell' },
                    { id: 'agent', label: 'Agent / 命令规则' },
                  ] as const).map(t => (
                    <button key={t.id} onClick={() => setAITab(t.id)}
                      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                        aiTab === t.id
                          ? 'border-terminal-blue text-terminal-blue'
                          : 'border-transparent text-terminal-muted hover:text-terminal-text'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* 供应商 tab */}
                {aiTab === 'providers' && (
                  aiLoading ? <div className="text-center text-terminal-muted py-8">加载中...</div> : (() => {
                    const configuredProviders = AI_PROVIDERS.filter(p =>
                      p.id === 'copilot' ? !!copilotStatus?.loggedIn : !!providerConfigs[p.id]?.apiKey
                    );
                    const unconfiguredProviders = AI_PROVIDERS.filter(p =>
                      !configuredProviders.some(c => c.id === p.id)
                    );
                    return (
                    <div className="space-y-5">
                      {/* 代理提示 */}
                      <div className="flex items-center gap-2 text-xs bg-terminal-blue/8 border border-terminal-blue/20 rounded-lg px-3 py-2.5">
                        <span className="text-terminal-muted flex-1">如果无法连接供应商，可能需要配置网络代理。</span>
                        <button
                          type="button"
                          onClick={() => setSection('general')}
                          className="flex-shrink-0 text-terminal-blue hover:text-terminal-blue/80 font-medium underline underline-offset-2 transition-colors"
                        >
                          前往代理设置
                        </button>
                      </div>


                      {/* ── 已配置供应商 ───────────────────────────────────── */}
                      {configuredProviders.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <h4 className="text-sm font-semibold text-terminal-text">已配置</h4>
                            <span className="text-xs text-terminal-muted bg-terminal-surface border border-terminal-border/60 rounded-full px-2 py-0.5">{configuredProviders.length}</span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {configuredProviders.map(p => {
                              const isActive = activeProviderId === p.id && !!aiSettings.configured;
                              const isCopilot = p.id === 'copilot';
                              const config = providerConfigs[p.id];
                              const modelLabel = isCopilot
                                ? (copilotStatus?.model || 'gpt-4o')
                                : (config?.model || '');
                              return (
                                <div key={p.id} className={`rounded-xl border transition-all ${
                                  isActive
                                    ? 'border-terminal-blue/40 bg-terminal-blue/5'
                                    : 'border-terminal-border bg-terminal-surface'
                                }`}>
                                  <div className="p-4">
                                    <div className="flex items-start gap-2.5">
                                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                                        isCopilot
                                          ? 'bg-[#24292f] text-white'
                                          : isActive
                                          ? 'bg-terminal-blue/15 text-terminal-blue border border-terminal-blue/25'
                                          : 'bg-terminal-bg border border-terminal-border text-terminal-muted'
                                      }`}>
                                        {isCopilot ? <Github className="w-4 h-4" /> : p.name.slice(0, 1)}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="text-sm font-semibold text-terminal-text truncate">{p.name}</span>
                                          <div className="flex items-center gap-0.5 flex-shrink-0">
                                            <button
                                              onClick={() => {
                                                selectProvider(p);
                                                setAITab('api');
                                              }}
                                              title="编辑配置"
                                              className="p-1.5 rounded-md text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 transition-colors"
                                            >
                                              <Edit3 className="w-3 h-3" />
                                            </button>
                                            <button
                                              onClick={() => isCopilot ? handleCopilotLogout() : removeProvider(p.id)}
                                              title={isCopilot ? '退出登录' : '删除配置'}
                                              className="p-1.5 rounded-md text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 transition-colors"
                                            >
                                              {isCopilot ? <LogOut className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                                            </button>
                                          </div>
                                        </div>
                                        {isCopilot && copilotStatus?.username
                                          ? <div className="text-[11px] text-terminal-muted mt-0.5">@{copilotStatus.username}</div>
                                          : !isCopilot && config?.baseUrl
                                          ? <div className="text-[10px] text-terminal-muted/70 font-mono truncate mt-0.5">{config.baseUrl}</div>
                                          : null
                                        }
                                      </div>
                                    </div>
                                    <div className="mt-2 flex items-center gap-1.5 min-w-0">
                                      <Cpu className="w-3 h-3 text-terminal-muted flex-shrink-0" />
                                      <span className={`text-[11px] font-mono truncate ${modelLabel ? 'text-terminal-text/70' : 'text-terminal-muted/50 italic'}`}>
                                        {modelLabel || '暂无模型'}
                                      </span>
                                    </div>
                                    <div className="mt-2.5">
                                      {isActive ? (
                                        <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-terminal-green/8 border border-terminal-green/20 text-xs text-terminal-green font-medium">
                                          <span className="w-1.5 h-1.5 rounded-full bg-terminal-green" />
                                          当前使用中
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => switchToProvider(p.id)}
                                          disabled={aiSaving}
                                          className="w-full py-1.5 rounded-lg text-xs font-medium border border-terminal-blue/25 text-terminal-blue bg-transparent hover:bg-terminal-blue hover:text-white hover:border-terminal-blue transition-all disabled:opacity-40"
                                        >
                                          {aiSaving ? '切换中...' : '切换使用'}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {copilotDeviceCode && copilotPolling && (
                        <div className="border border-terminal-yellow/40 bg-terminal-yellow/5 rounded-xl p-4 space-y-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-terminal-yellow">
                            <Loader2 className="w-4 h-4 animate-spin" />等待 GitHub 授权中...
                          </div>
                          <div>
                            <p className="text-xs text-terminal-muted mb-2 text-center">在 GitHub 页面中输入以下授权码</p>
                            <div className="text-center py-3 px-4 bg-terminal-bg border-2 border-terminal-yellow/40 rounded-xl font-mono text-2xl font-bold tracking-[0.3em] text-terminal-text select-all cursor-text">
                              {copilotDeviceCode.user_code}
                            </div>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <a href={copilotDeviceCode.verification_uri} target="_blank" rel="noopener noreferrer"
                              className="flex-1 min-w-[180px] flex items-center justify-center gap-1.5 py-2 rounded-lg bg-terminal-blue text-white text-xs font-medium hover:bg-terminal-blue/80 transition-colors">
                              <ExternalLink className="w-3.5 h-3.5" />在 GitHub 打开授权页
                            </a>
                            <button onClick={() => navigator.clipboard?.writeText(copilotDeviceCode.user_code)}
                              className="px-3 py-2 rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text text-xs transition-colors">
                              复制授权码
                            </button>
                          </div>
                          <p className="text-[10px] text-terminal-muted/60 text-center">
                            授权码将在 {Math.round((copilotDeviceCode.expires_in || 900) / 60)} 分钟后过期 · 本页面自动轮询等待
                          </p>
                        </div>
                      )}

                      {aiError && (
                        <div className="flex items-start gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /><span>{aiError}</span>
                        </div>
                      )}

                      {/* ── 添加供应商 ──────────────────────────────────────── */}
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <h4 className="text-sm font-semibold text-terminal-text">
                            {configuredProviders.length === 0 ? '选择供应商开始使用' : '添加供应商'}
                          </h4>
                          {configuredProviders.length === 0 && (
                            <span className="text-xs text-terminal-muted">配置后可在此快速切换</span>
                          )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {unconfiguredProviders.map(p => {
                            const isCopilot = p.id === 'copilot';
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  selectProvider(p);
                                  if (isCopilot) {
                                    startCopilotLogin();
                                  } else {
                                    setAITab('api');
                                  }
                                }}
                                className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-terminal-border bg-terminal-bg hover:border-terminal-blue/30 hover:bg-terminal-blue/5 transition-all text-left group"
                              >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 border transition-colors ${
                                  isCopilot
                                    ? 'bg-[#24292f] text-white border-white/10'
                                    : 'bg-terminal-surface border-terminal-border text-terminal-muted group-hover:text-terminal-blue group-hover:border-terminal-blue/30'
                                }`}>
                                  {isCopilot ? <Github className="w-4 h-4" /> : p.name.slice(0, 1)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium text-terminal-text truncate">{p.name}</div>
                                  <div className="text-[10px] text-terminal-muted mt-0.5 truncate">
                                    {isCopilot ? 'OAuth 登录' : (p.baseUrl || '自定义接口')}
                                  </div>
                                </div>
                                <Plus className="w-3.5 h-3.5 text-terminal-muted/50 group-hover:text-terminal-blue transition-colors flex-shrink-0" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    );
                  })()
                )}
                {/* API配置 tab */}
                {aiTab === 'api' && (
                  aiLoading ? <div className="text-center text-terminal-muted py-8">加载中...</div> : (
                    <div className="space-y-4">
                      {selectedProvider !== 'copilot' ? (
                        <>
                          {/* Base URL */}
                          <div>
                            <label className="block text-xs text-terminal-muted mb-1.5">API Base URL</label>
                            <input type="text" value={aiSettings.baseUrl || ''}
                              onChange={e => { setAISettings(p => ({ ...p, baseUrl: e.target.value })); setTestResult(null); }}
                              placeholder="https://api.openai.com/v1"
                              className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2.5 text-sm text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue font-mono" />
                          </div>

                          {/* API Key */}
                          <div>
                            <label className="block text-xs text-terminal-muted mb-1.5">API Key</label>
                            <div className="relative">
                              <input type={showApiKey ? 'text' : 'password'} value={aiSettings.apiKey || ''}
                                onChange={e => { setAISettings(p => ({ ...p, apiKey: e.target.value })); setTestResult(null); }}
                                placeholder={currentProvider.apiKeyHint || 'sk-...'}
                                className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 pr-10 py-2.5 text-sm text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue font-mono" />
                              <button type="button" onClick={() => setShowApiKey(p => !p)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-terminal-muted hover:text-terminal-text">
                                {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                        {/* API 格式 — only shown for providers supporting multiple formats */}
                        {currentProvider.apiFormats && currentProvider.apiFormats.length > 1 && (
                          <div>
                            <label className="block text-xs text-terminal-muted mb-1.5">API 格式</label>
                            <div className="flex gap-4">
                              {currentProvider.apiFormats.map(fmt => (
                                <label key={fmt} className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="radio"
                                    name="apiFormat"
                                    value={fmt}
                                    checked={selectedApiFormat === fmt}
                                    onChange={() => { setSelectedApiFormat(fmt); setTestResult(null); }}
                                    className="accent-terminal-blue"
                                  />
                                  <span className="text-xs text-terminal-text">
                                    {fmt === 'openai' ? 'OpenAI 兼容 (/chat/completions)' : 'Anthropic 兼容 (/messages)'}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Model management */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs text-terminal-muted">模型 <span className="text-terminal-red">*</span></label>
                              <button type="button" onClick={fetchModelsFromAPI} disabled={fetchingModels}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-terminal-border text-terminal-muted hover:text-terminal-blue hover:border-terminal-blue transition-colors disabled:opacity-40">
                                <RefreshCw className={`w-2.5 h-2.5 ${fetchingModels ? 'animate-spin' : ''}`} />
                                {fetchingModels ? '获取中…' : '从 API 获取'}
                              </button>
                            </div>

                            {/* Model list */}
                            {localModels.length > 0 ? (
                              <div className="rounded-lg border border-terminal-border/50 overflow-hidden mb-2 divide-y divide-terminal-border/30">
                                {localModels.map((m, idx) => {
                                  const isEnabled = !!modelEnabled[m];
                                  const isTerminal = terminalModelId === m;
                                  return (
                                    <div key={m} className={`flex items-center gap-2 px-3 py-2 transition-colors hover:bg-terminal-bg/50 ${isTerminal ? 'bg-terminal-blue/5' : ''}`}>
                                      <button
                                        type="button"
                                        title={isEnabled ? '已启用（AI对话）' : '已禁用（AI对话）'}
                                        onClick={() => setModelEnabled(prev => ({ ...prev, [m]: !prev[m] }))}
                                        className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${isEnabled ? 'bg-terminal-blue border-terminal-blue' : 'border-terminal-border hover:border-terminal-blue/50'}`}
                                      >
                                        {isEnabled && <Check className="w-2.5 h-2.5 text-white" />}
                                      </button>
                                      <span className={`flex-1 text-xs font-mono truncate ${isTerminal ? 'text-terminal-blue font-medium' : 'text-terminal-text'}`}>{m}</span>
                                      {isTerminal && <span className="text-[9px] text-terminal-blue/60 flex-shrink-0 font-medium">终端</span>}
                                      <button
                                        type="button"
                                        title={isTerminal ? '当前命令行模型' : '设为命令行模型'}
                                        onClick={() => { setTerminalModelId(m); setAISettings(p => ({ ...p, model: m })); }}
                                        className={`flex-shrink-0 p-1 rounded transition-colors ${isTerminal ? 'text-terminal-blue' : 'text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10'}`}
                                      >
                                        <TerminalIcon className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        title="移除"
                                        onClick={() => removeLocalModel(m)}
                                        className="flex-shrink-0 p-1 rounded text-terminal-muted hover:text-terminal-red hover:bg-terminal-red/10 transition-colors"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center py-5 rounded-lg border border-dashed border-terminal-border/50 mb-2 gap-2">
                                <Server className="w-5 h-5 text-terminal-muted/40" />
                                <span className="text-[11px] text-terminal-muted">暂无模型</span>
                                <button type="button" onClick={fetchModelsFromAPI} disabled={fetchingModels}
                                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-terminal-blue/10 hover:bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/25 transition-colors disabled:opacity-40">
                                  <RefreshCw className={`w-3 h-3 ${fetchingModels ? 'animate-spin' : ''}`} />
                                  从 API 获取模型
                                </button>
                              </div>
                            )}

                            {/* Add custom model */}
                            <div className="flex gap-1.5 mb-2">
                              <input type="text" value={newModelInput}
                                onChange={e => setNewModelInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addLocalModel()}
                                placeholder="手动输入模型名…"
                                className="flex-1 bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue font-mono" />
                              <button type="button" onClick={addLocalModel} disabled={!newModelInput.trim()}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-terminal-blue/10 hover:bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/30 transition-colors disabled:opacity-40">
                                <Plus className="w-3 h-3" />添加
                              </button>
                            </div>

                            {/* Status summary */}
                            {localModels.length > 0 && (
                              <div className="flex items-center gap-3 text-[10px] text-terminal-muted">
                                <span className="flex items-center gap-1">
                                  <TerminalIcon className="w-2.5 h-2.5" />
                                  <span className={`font-mono ${terminalModelId ? 'text-terminal-blue' : 'text-terminal-red/70'}`}>
                                    {terminalModelId || '未设置'}
                                  </span>
                                </span>
                                <span>AI对话: {localModels.filter(m => modelEnabled[m]).length}/{localModels.length}</span>
                              </div>
                            )}
                          </div>


                          {/* Test connection */}
                          <div className="border border-terminal-border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-terminal-text">测试连接</span>
                              <button type="button" onClick={testConnection} disabled={testing}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-terminal-surface border border-terminal-border hover:border-terminal-blue text-terminal-muted hover:text-terminal-text transition-colors disabled:opacity-50">
                                <Wifi className="w-3 h-3" />
                                {testing ? '测试中...' : '测试连接'}
                              </button>
                            </div>
                            {testResult && (
                              <div className={`rounded-lg p-2.5 text-xs font-mono space-y-1 ${testResult.ok ? 'bg-terminal-green/10 border border-terminal-green/20' : 'bg-terminal-red/10 border border-terminal-red/20'}`}>
                                <div className={`font-semibold ${testResult.ok ? 'text-terminal-green' : 'text-terminal-red'}`}>
                                  {testResult.ok ? '✓ 连接成功' : '✗ 连接失败'}
                                </div>
                                {testResult.error && <div className="text-terminal-red/80 break-all">{testResult.error}</div>}
                                {testResult.modelTest && (
                                  <div className="text-terminal-muted">
                                    模型响应: {testResult.modelTest.ok ? `✓ 正常 (${testResult.modelTest.latencyMs}ms)` : '✗ 无响应'}
                                  </div>
                                )}
                                {testResult.models?.length > 0 && (
                                  <div className="text-terminal-muted">
                                    可用模型 ({testResult.models.length}): {testResult.models.slice(0, 8).join(', ')}{testResult.models.length > 8 ? ` ... +${testResult.models.length - 8}` : ''}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Save gate: must pass connection test */}
                          {!testResult && !aiSuccess && (
                            <div className="flex items-center gap-2 text-xs text-terminal-yellow bg-terminal-yellow/10 border border-terminal-yellow/20 rounded-lg px-3 py-2">
                              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                              请先点击"测试连接"验证配置，通过后才能保存
                            </div>
                          )}
                          {testResult && !testResult.ok && (
                            <div className="flex items-start gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                              <span>测试连接失败，无法保存。{testResult.error ? `原因：${testResult.error}` : '请检查 Base URL 与 API Key。'}</span>
                            </div>
                          )}

                          {aiError && (
                            <div className="flex items-start gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /><span>{aiError}</span>
                            </div>
                          )}
                          {aiSuccess && (
                            <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2">
                              <CheckCircle2 className="w-3.5 h-3.5" />保存成功，AI 功能已启用
                            </div>
                          )}

                          <div className="flex items-center gap-2 flex-wrap">
                            <button onClick={handleSaveAI} disabled={aiSaving || !testResult?.ok}
                              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg text-white font-medium transition-colors ${testResult?.ok ? 'bg-terminal-blue hover:bg-terminal-blue/80' : 'bg-terminal-border cursor-not-allowed opacity-60'}`}>
                              <Save className="w-4 h-4" />
                              {aiSaving ? '保存中...' : '保存 AI 配置'}
                            </button>

                            {aiSettings.configured && (!showResetConfirm ? (
                              <button
                                onClick={() => setShowResetConfirm(true)}
                                className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                                移除当前 AI 配置
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => setShowResetConfirm(false)}
                                  className="px-4 py-2 text-sm rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={handleResetAI}
                                  className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-terminal-red hover:bg-terminal-red/80 text-white font-medium transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  确认移除
                                </button>
                              </>
                            ))}
                          </div>
                        </>
                      ) : (
                        /* ── Copilot API tab ── */
                        <div className="space-y-4">

                          {/* Login status banner */}
                          {copilotStatus?.loggedIn ? (
                            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-terminal-green/25 bg-terminal-green/5 text-xs">
                              <span className="w-2 h-2 rounded-full bg-terminal-green flex-shrink-0" />
                              <span className="text-terminal-text flex-1">
                                已登录为 <span className="font-semibold">@{copilotStatus.username || 'GitHub 用户'}</span>
                              </span>
                              <button type="button" onClick={() => setAITab('providers')}
                                className="flex-shrink-0 text-terminal-muted hover:text-terminal-blue transition-colors underline underline-offset-2">
                                供应商管理
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-terminal-yellow/30 bg-terminal-yellow/5 text-xs">
                              <AlertCircle className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0" />
                              <span className="text-terminal-muted flex-1">尚未登录 GitHub Copilot</span>
                              <button type="button" onClick={() => { setAITab('providers'); startCopilotLogin(); }}
                                className="flex-shrink-0 text-terminal-blue hover:text-terminal-blue/80 font-medium transition-colors">
                                立即登录
                              </button>
                            </div>
                          )}

                          {/* Model list — same design as API-key providers */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs text-terminal-muted">模型</label>
                              <button type="button"
                                onClick={async () => {
                                  const d = await fetchCopilotStatus();
                                  if (!d) return;
                                  const freshModels: string[] = d.models?.length ? d.models : COPILOT_DEFAULT_MODELS;
                                  setModelTestResults(prev => {
                                    const next = { ...prev };
                                    for (const m of freshModels) next[m] = { ok: next[m]?.ok ?? false, ...(next[m] || {}), testing: true };
                                    return next;
                                  });
                                  await Promise.all(freshModels.map(m => testCopilotModel(m)));
                                }}
                                disabled={copilotStatusLoading}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-terminal-border text-terminal-muted hover:text-terminal-blue hover:border-terminal-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                <RefreshCw className={`w-2.5 h-2.5 ${copilotStatusLoading ? 'animate-spin' : ''}`} />刷新列表
                              </button>
                            </div>

                            {(() => {
                              const copilotModels = copilotStatus?.models?.length
                                ? copilotStatus.models
                                : COPILOT_DEFAULT_MODELS;
                              return (
                                <div className="rounded-lg border border-terminal-border/50 overflow-hidden mb-2 divide-y divide-terminal-border/30">
                                  {copilotModels.map(m => {
                                    const isEnabled = copilotModelEnabled[m] !== false;
                                    const isTerminal = copilotTerminalModel === m;
                                    const badge = getCopilotBadge(m);
                                    const tr = modelTestResults[m];
                                    const isTesting = !!tr?.testing;
                                    const isOk = tr?.ok === true && !isTesting;
                                    const isFailed = tr?.ok === false && !isTesting;
                                    return (
                                      <div key={m} className={`flex items-center gap-2 px-3 py-2 transition-colors hover:bg-terminal-bg/50 ${isTerminal ? 'bg-terminal-blue/5' : ''} ${!isEnabled && !isTerminal ? 'opacity-50' : ''}`}>
                                        {/* AI chat checkbox */}
                                        <button
                                          type="button"
                                          title={isEnabled ? '已启用（AI对话）' : '已禁用（AI对话）'}
                                          onClick={() => toggleCopilotModel(m)}
                                          className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${isEnabled ? 'bg-terminal-blue border-terminal-blue' : 'border-terminal-border hover:border-terminal-blue/50'}`}
                                        >
                                          {isEnabled && <Check className="w-2.5 h-2.5 text-white" />}
                                        </button>
                                        {/* Model name + badge + latency */}
                                        <span className={`flex-1 text-xs font-mono truncate ${isTerminal ? 'text-terminal-blue font-medium' : 'text-terminal-text'}`}>{m}</span>
                                        {badge && (
                                          <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 font-medium ${badge.color === 'blue' ? 'bg-terminal-blue/15 text-terminal-blue' : badge.color === 'purple' ? 'bg-purple-500/15 text-purple-400' : badge.color === 'orange' ? 'bg-orange-500/15 text-orange-400' : 'bg-terminal-green/15 text-terminal-green'}`}>{badge.label}</span>
                                        )}
                                        {isOk && tr?.latencyMs && (
                                          <span className="text-[10px] font-mono text-terminal-green/80 flex-shrink-0">{tr.latencyMs}ms</span>
                                        )}
                                        {isTerminal && <span className="text-[9px] text-terminal-blue/70 flex-shrink-0 font-medium">终端</span>}
                                        {/* Terminal model selector */}
                                        <button
                                          type="button"
                                          title={isTerminal ? '当前命令行模型' : '设为命令行模型'}
                                          onClick={() => selectCopilotTerminalModel(m)}
                                          className={`flex-shrink-0 p-1 rounded transition-colors ${isTerminal ? 'text-terminal-blue' : 'text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10'}`}
                                        >
                                          <TerminalIcon className="w-3 h-3" />
                                        </button>
                                        {/* Test button */}
                                        <button
                                          type="button"
                                          title={isTesting ? '测试中…' : isOk ? `通过 ${tr?.latencyMs ?? ''}ms` : isFailed ? (tr?.error || '失败') : '测试连接'}
                                          onClick={() => testCopilotModel(m)}
                                          disabled={isTesting}
                                          className={`flex-shrink-0 p-1 rounded transition-colors disabled:opacity-40 ${isOk ? 'text-terminal-green' : isFailed ? 'text-terminal-red' : 'text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10'}`}
                                        >
                                          {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : isOk ? <CheckCircle2 className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}

                            {/* Status summary */}
                            {(() => {
                              const copilotModels = copilotStatus?.models?.length ? copilotStatus.models : COPILOT_DEFAULT_MODELS;
                              const enabledCount = copilotModels.filter(m => copilotModelEnabled[m] !== false).length;
                              return (
                                <div className="flex items-center gap-3 text-[10px] text-terminal-muted">
                                  <span className="flex items-center gap-1">
                                    <TerminalIcon className="w-2.5 h-2.5" />
                                    <span className={`font-mono ${copilotTerminalModel ? 'text-terminal-blue' : 'text-terminal-red/70'}`}>
                                      {copilotTerminalModel || '未设置'}
                                    </span>
                                  </span>
                                  <span>AI对话: {enabledCount}/{copilotModels.length}</span>
                                </div>
                              );
                            })()}
                          </div>

                          {aiError && (
                            <div className="flex items-start gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /><span>{aiError}</span>
                            </div>
                          )}
                          {aiSuccess && (
                            <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2">
                              <CheckCircle2 className="w-3.5 h-3.5" />保存成功，AI 功能已启用
                            </div>
                          )}

                          <div className="flex items-center gap-2 flex-wrap">
                            <button onClick={handleSaveAI} disabled={aiSaving || !copilotStatus?.loggedIn}
                              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg text-white font-medium transition-colors ${copilotStatus?.loggedIn ? 'bg-terminal-blue hover:bg-terminal-blue/80' : 'bg-terminal-border cursor-not-allowed opacity-60'}`}>
                              <Save className="w-4 h-4" />
                              {aiSaving ? '保存中...' : '保存配置'}
                            </button>

                            {aiSettings.configured && (!showResetConfirm ? (
                              <button
                                onClick={() => setShowResetConfirm(true)}
                                className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-terminal-red/30 text-terminal-red hover:bg-terminal-red/10 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                                移除当前 AI 配置
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => setShowResetConfirm(false)}
                                  className="px-4 py-2 text-sm rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={handleResetAI}
                                  className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-terminal-red hover:bg-terminal-red/80 text-white font-medium transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  确认移除
                                </button>
                              </>
                             ))}
                           </div>
                         </div>
                       )}
                     </div>
                   )
                 )}
                {/* Shell tab */}
                {aiTab === 'shell' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-terminal-text mb-1">启用 AI 命令解释</h3>
                      <p className="text-xs text-terminal-muted mb-3">AI 会在终端中显示命令解释提示，帮助理解每个命令的作用</p>
                      <div className="bg-terminal-surface border border-terminal-border rounded-lg">
                        <Toggle checked={aiSettings.enableCommandExplain ?? true}
                          onChange={v => setAISettings(p => ({ ...p, enableCommandExplain: v }))}
                          label="启用命令解释" description="在执行命令后显示 AI 分析" />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-terminal-text mb-1">启用 AI 命令助手</h3>
                      <p className="text-xs text-terminal-muted mb-3">提供智能命令建议和帮助，输入自然语言即可获得命令建议</p>
                      <div className="bg-terminal-surface border border-terminal-border rounded-lg">
                        <Toggle checked={aiSettings.enableAIAssistant ?? true}
                          onChange={v => setAISettings(p => ({ ...p, enableAIAssistant: v }))}
                          label="启用 AI 助手" description="输入自然语言触发 AI 响应" />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-terminal-text mb-1">启用命令补全</h3>
                      <p className="text-xs text-terminal-muted mb-3">为您的终端命令提供智能补全和建议（Tab 键触发）</p>
                      <div className="bg-terminal-surface border border-terminal-border rounded-lg">
                        <Toggle checked={aiSettings.enableAutoComplete ?? true}
                          onChange={v => setAISettings(p => ({ ...p, enableAutoComplete: v }))}
                          label="启用智能补全" description="通过历史记录预测下一条命令" />
                      </div>
                    </div>
                    {aiSuccess && (
                      <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2">
                        <CheckCircle2 className="w-3.5 h-3.5" />设置已保存
                      </div>
                    )}
                    {aiError && (
                      <div className="flex items-center gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                        <AlertCircle className="w-3.5 h-3.5" />{aiError}
                      </div>
                    )}
                    <button onClick={handleSaveShellAgent} disabled={aiSaving}
                      className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50">
                      <Save className="w-4 h-4" />{aiSaving ? '保存中...' : '保存设置'}
                    </button>
                  </div>
                )}

                {/* Agent / 命令规则 tab */}
                {aiTab === 'agent' && (
                  <div className="space-y-6">
                    {whitelistRules.length === 0 && (
                      <div className="bg-terminal-yellow/10 border border-terminal-yellow/20 rounded-lg px-3 py-2.5 flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-terminal-yellow flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-terminal-yellow/80">
                          当前白名单为空。建议点击下方"添加常用安全命令"快速填充默认规则，或手动添加。
                           <button onClick={() => {
                            const rules = PRESET_GROUPS.flatMap(g => g.items).map(({ cmd, desc }) => ({
                              id: `rule_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                              pattern: cmd, enabled: true, description: desc,
                            }));
                            setWhitelistRules(rules);
                          }} className="ml-2 underline hover:text-terminal-yellow cursor-pointer">立即添加默认规则</button>
                        </div>
                      </div>
                    )}

                    {/* Execution mode */}
                    <div>
                      <h3 className="text-sm font-semibold text-terminal-text mb-1">执行模式</h3>
                      <p className="text-xs text-terminal-muted mb-3">选择 Agent 运行命令时的确认方式</p>
                      <div className="space-y-2">
                        {[
                          { value: 'ask_each', label: '每条命令询问', desc: '每条命令都需要手动确认才能执行（最安全）', color: 'terminal-green' },
                          { value: 'auto_approve_low', label: '白名单自动执行', desc: '仅白名单中的命令自动执行，其他命令需手动确认（推荐）', color: 'terminal-blue' },
                          { value: 'auto_approve_all', label: '全部自动执行', desc: '⚠ 所有命令直接执行，无需确认（高风险）', color: 'terminal-red' },
                        ].map(opt => (
                          <button key={opt.value}
                            onClick={() => setAISettings(p => ({ ...p, agentExecMode: opt.value as any }))}
                            className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                              aiSettings.agentExecMode === opt.value
                                ? 'border-terminal-blue bg-terminal-blue/5'
                                : 'border-terminal-border hover:border-terminal-blue/40'
                            }`}>
                            <div className={`w-4 h-4 rounded-full border-2 mt-0.5 flex-shrink-0 flex items-center justify-center transition-colors ${
                              aiSettings.agentExecMode === opt.value ? 'border-terminal-blue bg-terminal-blue' : 'border-terminal-border'
                            }`}>
                              {aiSettings.agentExecMode === opt.value && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                            </div>
                            <div>
                              <div className={`text-sm font-medium ${aiSettings.agentExecMode === opt.value ? 'text-terminal-text' : 'text-terminal-muted'}`}>{opt.label}</div>
                              <div className="text-xs text-terminal-muted mt-0.5">{opt.desc}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Command whitelist */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-semibold text-terminal-text flex items-center gap-2">
                          <Shield className="w-4 h-4 text-terminal-blue" />
                          命令白名单
                        </h3>
                        <span className="text-[10px] text-terminal-muted bg-terminal-surface px-2 py-0.5 rounded border border-terminal-border">
                          {whitelistRules.filter(r => r.enabled).length} 条已启用 / {whitelistRules.length} 条
                        </span>
                      </div>
                      <p className="text-xs text-terminal-muted mb-3">
                        白名单模式下，以下命令将自动执行无需确认。支持前缀匹配（<code className="font-mono bg-terminal-surface px-1 rounded text-terminal-text">git</code>）、通配符（<code className="font-mono bg-terminal-surface px-1 rounded text-terminal-text">git *</code>）、正则（<code className="font-mono bg-terminal-surface px-1 rounded text-terminal-text">/^npm /</code>）。
                      </p>

                      {/* Whitelist tags */}
                      <div className="flex flex-wrap gap-1.5 mb-3 p-3 bg-terminal-bg border border-terminal-border rounded-lg min-h-[52px]">
                        {whitelistRules.length === 0 && (
                          <span className="text-xs text-terminal-muted/50 self-center">暂无白名单，所有命令均需确认</span>
                        )}
                        {whitelistRules.map(rule => (
                          <div key={rule.id}
                            className={`group flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
                              rule.enabled
                                ? 'bg-terminal-blue/10 border-terminal-blue/30 text-terminal-blue hover:bg-terminal-blue/20'
                                : 'bg-terminal-surface border-terminal-border text-terminal-muted line-through hover:bg-terminal-border/20'
                            }`}
                            onClick={() => setWhitelistRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))}
                            title={rule.enabled ? '点击禁用' : '点击启用'}
                          >
                            <span className="font-mono">{rule.pattern}</span>
                            {rule.description && <span className="text-[9px] opacity-60">({rule.description})</span>}
                            <button
                              onClick={e => { e.stopPropagation(); setWhitelistRules(prev => prev.filter(r => r.id !== rule.id)); }}
                              className="opacity-0 group-hover:opacity-100 ml-0.5 hover:text-terminal-red transition-opacity"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Add new rule */}
                      <div className="flex gap-2 mb-3">
                        <input type="text" value={newPattern} onChange={e => setNewPattern(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addRule()}
                          placeholder="命令前缀 (git, npm run, /^docker /...)"
                          className="flex-1 bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue font-mono" />
                        <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addRule()}
                          placeholder="备注"
                          className="w-24 bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue" />
                        <button onClick={addRule} disabled={!newPattern.trim()}
                          className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg bg-terminal-blue/20 hover:bg-terminal-blue/30 text-terminal-blue border border-terminal-blue/30 transition-colors disabled:opacity-40">
                          <Plus className="w-3 h-3" />添加
                        </button>
                      </div>

                      {/* Presets */}
                      <div className="space-y-2">
                        <p className="text-[10px] text-terminal-muted">快速添加常用安全命令：</p>
                        {PRESET_GROUPS.map(group => (
                          <div key={group.label}>
                            <p className="text-[10px] text-terminal-muted/60 mb-1">{group.label}</p>
                            <div className="flex flex-wrap gap-1">
                              {group.items.map(({ cmd, desc }) => {
                                const exists = whitelistRules.some(r => r.pattern === cmd);
                                return (
                                  <button key={cmd} onClick={() => addPresetCmd(whitelistRules, setWhitelistRules, cmd, desc)} disabled={exists}
                                    title={desc}
                                    className={`px-2 py-0.5 text-[10px] rounded border font-mono transition-colors ${
                                      exists
                                        ? 'border-terminal-border text-terminal-muted/30 cursor-not-allowed bg-terminal-surface'
                                        : 'border-terminal-border text-terminal-muted hover:border-terminal-blue hover:text-terminal-blue hover:bg-terminal-blue/5 cursor-pointer'
                                    }`}>
                                    {exists ? <Check className="w-2.5 h-2.5 inline mr-0.5" /> : null}{cmd}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* High-risk command rules */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-semibold text-terminal-text flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-terminal-red" />
                          高危命令配置
                        </h3>
                        <span className="text-[10px] text-terminal-muted bg-terminal-surface px-2 py-0.5 rounded border border-terminal-border">
                          {highRiskRules.filter(r => r.enabled).length} 条已启用 / {highRiskRules.length} 条
                        </span>
                      </div>
                      <p className="text-xs text-terminal-muted mb-3">
                        命中以下规则的命令将强制按高风险处理，始终需要用户确认，不受白名单和自动执行模式影响。支持前缀匹配、通配符和正则。
                      </p>

                      <div className="flex flex-wrap gap-1.5 mb-3 p-3 bg-terminal-bg border border-terminal-border rounded-lg min-h-[52px]">
                        {highRiskRules.length === 0 && (
                          <span className="text-xs text-terminal-muted/50 self-center">暂无高危规则，当前项目将不再额外触发高危二次确认</span>
                        )}
                        {highRiskRules.map(rule => (
                          <div key={rule.id}
                            className={`group flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
                              rule.enabled
                                ? 'bg-terminal-red/10 border-terminal-red/30 text-terminal-red hover:bg-terminal-red/20'
                                : 'bg-terminal-surface border-terminal-border text-terminal-muted line-through hover:bg-terminal-border/20'
                            }`}
                            onClick={() => setHighRiskRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))}
                            title={rule.enabled ? '点击禁用' : '点击启用'}
                          >
                            <span className="font-mono">{rule.pattern}</span>
                            {rule.description && <span className="text-[9px] opacity-60">({rule.description})</span>}
                            <button
                              onClick={e => { e.stopPropagation(); setHighRiskRules(prev => prev.filter(r => r.id !== rule.id)); }}
                              className="opacity-0 group-hover:opacity-100 ml-0.5 hover:text-terminal-red transition-opacity"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2 mb-3">
                        <input type="text" value={newHighRiskPattern} onChange={e => setNewHighRiskPattern(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addHighRiskRule()}
                          placeholder="高危命令模式 (sudo, rm *, /^curl .*\| bash/...)"
                          className="flex-1 bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-red font-mono" />
                        <input type="text" value={newHighRiskDesc} onChange={e => setNewHighRiskDesc(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addHighRiskRule()}
                          placeholder="备注"
                          className="w-24 bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-red" />
                        <button onClick={addHighRiskRule} disabled={!newHighRiskPattern.trim()}
                          className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg bg-terminal-red/20 hover:bg-terminal-red/30 text-terminal-red border border-terminal-red/30 transition-colors disabled:opacity-40">
                          <Plus className="w-3 h-3" />添加
                        </button>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[10px] text-terminal-muted">快速添加常见高危命令：</p>
                        {HIGH_RISK_PRESET_GROUPS.map(group => (
                          <div key={group.label}>
                            <p className="text-[10px] text-terminal-muted/60 mb-1">{group.label}</p>
                            <div className="flex flex-wrap gap-1">
                              {group.items.map(({ cmd, desc }) => {
                                const exists = highRiskRules.some(r => r.pattern === cmd);
                                return (
                                  <button key={cmd} onClick={() => addPresetCmd(highRiskRules, setHighRiskRules, cmd, desc)} disabled={exists}
                                    title={desc}
                                    className={`px-2 py-0.5 text-[10px] rounded border font-mono transition-colors ${
                                      exists
                                        ? 'border-terminal-border text-terminal-muted/30 cursor-not-allowed bg-terminal-surface'
                                        : 'border-terminal-border text-terminal-muted hover:border-terminal-red hover:text-terminal-red hover:bg-terminal-red/5 cursor-pointer'
                                    }`}>
                                    {exists ? <Check className="w-2.5 h-2.5 inline mr-0.5" /> : null}{cmd}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {approveError && (
                      <div className="flex items-start gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /><span>{approveError}</span>
                      </div>
                    )}
                    {approveSuccess && (
                      <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2">
                        <CheckCircle2 className="w-3.5 h-3.5" />设置已保存
                      </div>
                    )}

                    <button onClick={saveAgentSettings} disabled={aiSaving || approveSaving}
                      className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50">
                      <Save className="w-4 h-4" />
                      {approveSaving ? '保存中...' : '保存 Agent 设置'}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── MCP 服务器 ────────────────────────────────────────────── */}
            {section === 'mcp' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <h3 className="text-sm font-semibold text-terminal-text">MCP 服务器</h3>
                    <p className="text-xs text-terminal-muted mt-0.5">
                      连接 Model Context Protocol 服务，为 AI 提供外部工具能力（文件系统、数据库、浏览器等）
                    </p>
                  </div>
                  <button
                    onClick={() => { setShowAddMcp(true); setEditingMcp(null); setMcpError(''); }}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-terminal-blue/20 hover:bg-terminal-blue/30 text-terminal-blue border border-terminal-blue/30 transition-colors flex-shrink-0"
                  >
                    <Plus className="w-3 h-3" />添加服务器
                  </button>
                </div>

                {mcpError && (
                  <div className="flex items-center gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5" />{mcpError}
                  </div>
                )}

                {/* Add form */}
                {showAddMcp && (
                  <div className="bg-terminal-surface border border-terminal-blue/30 rounded-xl p-4 space-y-3">
                    <div className="text-xs font-medium text-terminal-blue mb-1">新建 MCP 服务器</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-terminal-muted mb-1">名称 <span className="text-terminal-red">*</span></label>
                        <input
                          value={newMcpName} onChange={e => setNewMcpName(e.target.value)}
                          placeholder="例：文件系统服务"
                          className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-terminal-muted mb-1">传输方式</label>
                        <div className="flex gap-2">
                          {(['stdio', 'http'] as const).map(t => (
                            <button key={t} type="button" onClick={() => setNewMcpTransport(t)}
                              className={`flex-1 py-2 text-xs rounded-lg border transition-colors ${
                                newMcpTransport === t
                                  ? 'bg-terminal-blue/20 border-terminal-blue/50 text-terminal-blue'
                                  : 'bg-terminal-bg border-terminal-border text-terminal-muted hover:border-terminal-blue/40'
                              }`}>
                              {t === 'stdio' ? '本地进程' : 'HTTP'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {newMcpTransport === 'stdio' ? (
                      <>
                        <div>
                          <label className="block text-[10px] text-terminal-muted mb-1">命令 <span className="text-terminal-red">*</span></label>
                          <input
                            value={newMcpCommand} onChange={e => setNewMcpCommand(e.target.value)}
                            placeholder="例：npx"
                            className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text font-mono placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-terminal-muted mb-1">参数（每行一个）</label>
                          <textarea
                            value={newMcpArgs} onChange={e => setNewMcpArgs(e.target.value)}
                            rows={3} placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"}
                            className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text font-mono placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue resize-none"
                          />
                        </div>
                      </>
                    ) : (
                      <div>
                        <label className="block text-[10px] text-terminal-muted mb-1">URL <span className="text-terminal-red">*</span></label>
                        <input
                          value={newMcpUrl} onChange={e => setNewMcpUrl(e.target.value)}
                          placeholder="例：http://localhost:8080/mcp"
                          className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text font-mono placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-[10px] text-terminal-muted mb-1">描述（可选）</label>
                      <input
                        value={newMcpDesc} onChange={e => setNewMcpDesc(e.target.value)}
                        placeholder="简短描述该 MCP 服务的功能"
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={addMcpServer}
                        disabled={mcpSaving || !newMcpName.trim() || (newMcpTransport === 'stdio' ? !newMcpCommand.trim() : !newMcpUrl.trim())}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />{mcpSaving ? '保存中...' : '保存'}
                      </button>
                      <button onClick={() => { setShowAddMcp(false); setMcpError(''); }}
                        className="px-4 py-2 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* Server list */}
                {mcpServers.length === 0 && !showAddMcp ? (
                  <div className="flex flex-col items-center justify-center py-12 text-terminal-muted gap-2">
                    <Server className="w-8 h-8 opacity-20" />
                    <p className="text-sm">暂无 MCP 服务器</p>
                    <p className="text-xs opacity-60">添加后 AI 可调用外部工具（文件系统、数据库、Web 搜索等）</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {mcpServers.map(server => (
                      <div key={server.id} className="bg-terminal-surface border border-terminal-border rounded-xl p-3 group">
                        {editingMcp?.id === server.id ? (
                          /* Edit form */
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[10px] text-terminal-muted mb-1">名称</label>
                                <input value={editingMcp.name} onChange={e => setEditingMcp(p => p ? { ...p, name: e.target.value } : null)}
                                  className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue" />
                              </div>
                              <div>
                                <label className="block text-[10px] text-terminal-muted mb-1">传输方式</label>
                                <div className="flex gap-2">
                                  {(['stdio', 'http'] as const).map(t => (
                                    <button key={t} type="button" onClick={() => setEditingMcp(p => p ? { ...p, transport: t } : null)}
                                      className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                                        editingMcp.transport === t
                                          ? 'bg-terminal-blue/20 border-terminal-blue/50 text-terminal-blue'
                                          : 'bg-terminal-bg border-terminal-border text-terminal-muted'
                                      }`}>
                                      {t === 'stdio' ? '本地进程' : 'HTTP'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            {editingMcp.transport === 'stdio' ? (
                              <>
                                <div>
                                  <label className="block text-[10px] text-terminal-muted mb-1">命令</label>
                                  <input value={editingMcp.command || ''} onChange={e => setEditingMcp(p => p ? { ...p, command: e.target.value } : null)}
                                    className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-blue" />
                                </div>
                                <div>
                                  <label className="block text-[10px] text-terminal-muted mb-1">参数（每行一个）</label>
                                  <textarea
                                    value={(editingMcp.args || []).join('\n')}
                                    onChange={e => setEditingMcp(p => p ? { ...p, args: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } : null)}
                                    rows={2}
                                    className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-blue resize-none" />
                                </div>
                              </>
                            ) : (
                              <div>
                                <label className="block text-[10px] text-terminal-muted mb-1">URL</label>
                                <input value={editingMcp.url || ''} onChange={e => setEditingMcp(p => p ? { ...p, url: e.target.value } : null)}
                                  className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-blue" />
                              </div>
                            )}
                            <div>
                              <label className="block text-[10px] text-terminal-muted mb-1">描述</label>
                              <input value={editingMcp.description || ''} onChange={e => setEditingMcp(p => p ? { ...p, description: e.target.value } : null)}
                                className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => updateMcpServer(editingMcp)} disabled={mcpSaving}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white transition-colors disabled:opacity-50">
                                <Save className="w-3 h-3" />{mcpSaving ? '保存中...' : '保存'}
                              </button>
                              <button onClick={() => { setEditingMcp(null); setMcpError(''); }}
                                className="px-3 py-1.5 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* View mode */
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                  <span className="text-sm font-medium text-terminal-text">{server.name}</span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                                    server.transport === 'http'
                                      ? 'bg-terminal-blue/10 border-terminal-blue/30 text-terminal-blue'
                                      : 'bg-terminal-cyan/10 border-terminal-cyan/30 text-terminal-cyan'
                                  }`}>
                                    {server.transport === 'http' ? 'HTTP' : 'stdio'}
                                  </span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                                    server.enabled
                                      ? 'bg-terminal-green/10 border-terminal-green/30 text-terminal-green'
                                      : 'bg-terminal-border/20 border-terminal-border text-terminal-muted'
                                  }`}>
                                    {server.enabled ? '已启用' : '已禁用'}
                                  </span>
                                </div>
                                <div className="text-xs font-mono text-terminal-muted truncate">
                                  {server.transport === 'stdio'
                                    ? [server.command, ...(server.args || [])].join(' ')
                                    : server.url}
                                </div>
                                {server.description && (
                                  <div className="text-[10px] text-terminal-muted/60 mt-0.5">{server.description}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={() => toggleMcpServer(server.id, !server.enabled)}
                                  title={server.enabled ? '禁用' : '启用'}
                                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                                    server.enabled ? 'text-terminal-green hover:bg-terminal-border/40' : 'text-terminal-muted hover:bg-terminal-border/40'
                                  }`}>
                                  {server.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={() => testMcpServer(server)}
                                  disabled={mcpTesting === server.id}
                                  title="测试连接"
                                  className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-cyan transition-colors disabled:opacity-40">
                                  <RefreshCw className={`w-3.5 h-3.5 ${mcpTesting === server.id ? 'animate-spin' : ''}`} />
                                </button>
                                <button
                                  onClick={() => { setEditingMcp({ ...server }); setShowAddMcp(false); setMcpError(''); }}
                                  title="编辑"
                                  className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors">
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteMcpServer(server.id)}
                                  title="删除"
                                  className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-red transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            {/* Test result */}
                            {mcpTestResults[server.id] && (
                              <div className={`mt-2 px-3 py-2 rounded-lg text-xs border ${
                                mcpTestResults[server.id].ok
                                  ? 'bg-terminal-green/10 border-terminal-green/20'
                                  : 'bg-terminal-red/10 border-terminal-red/20'
                              }`}>
                                {mcpTestResults[server.id].ok ? (
                                  <>
                                    <div className="text-terminal-green font-medium mb-1.5">
                                      连接成功 · {mcpTestResults[server.id].tools?.length ?? 0} 个工具可用
                                    </div>
                                    {(mcpTestResults[server.id].tools?.length ?? 0) > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {mcpTestResults[server.id].tools!.map(t => (
                                          <span key={t.name} title={t.description}
                                            className="px-1.5 py-0.5 bg-terminal-surface border border-terminal-border rounded text-terminal-muted font-mono text-[10px]">
                                            {t.name}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-terminal-red">{mcpTestResults[server.id].error || '连接失败'}</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Tips */}
                <div className="text-xs text-terminal-muted bg-terminal-surface border border-terminal-border rounded-lg px-3 py-2.5 space-y-1">
                  <p className="font-medium text-terminal-text">常用 MCP 服务示例</p>
                  <p>· 文件系统: <span className="font-mono text-terminal-cyan">npx -y @modelcontextprotocol/server-filesystem /path</span></p>
                  <p>· 内存数据库: <span className="font-mono text-terminal-cyan">npx -y @modelcontextprotocol/server-memory</span></p>
                  <p>· GitHub: <span className="font-mono text-terminal-cyan">npx -y @modelcontextprotocol/server-github</span></p>
                </div>
              </div>
            )}

            {/* ── Skills 技能 ────────────────────────────────────────────── */}
            {section === 'skills' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <h3 className="text-sm font-semibold text-terminal-text">Skills 技能</h3>
                    <p className="text-xs text-terminal-muted mt-0.5">
                      定义 AI 技能片段，启用后追加到 AI 系统提示，增强特定领域的能力
                    </p>
                  </div>
                  <button
                    onClick={() => { setShowAddSkill(true); setEditingSkill(null); setSkillError(''); }}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-terminal-blue/20 hover:bg-terminal-blue/30 text-terminal-blue border border-terminal-blue/30 transition-colors flex-shrink-0"
                  >
                    <Plus className="w-3 h-3" />添加技能
                  </button>
                </div>

                {skillError && (
                  <div className="flex items-center gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5" />{skillError}
                  </div>
                )}

                {/* Add form */}
                {showAddSkill && (
                  <div className="bg-terminal-surface border border-terminal-blue/30 rounded-xl p-4 space-y-3">
                    <div className="text-xs font-medium text-terminal-blue mb-1">新建技能</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-terminal-muted mb-1">名称 <span className="text-terminal-red">*</span></label>
                        <input
                          value={newSkillName} onChange={e => setNewSkillName(e.target.value)}
                          placeholder="例：Docker 专家"
                          className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-terminal-muted mb-1">触发关键词（逗号分隔，可选）</label>
                        <input
                          value={newSkillKeywords} onChange={e => setNewSkillKeywords(e.target.value)}
                          placeholder="例：docker, 容器, 镜像"
                          className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-terminal-muted mb-1">描述（可选）</label>
                      <input
                        value={newSkillDesc} onChange={e => setNewSkillDesc(e.target.value)}
                        placeholder="简短描述该技能的用途"
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-terminal-muted mb-1">
                        系统提示词补充 <span className="text-terminal-red">*</span>
                        <span className="text-terminal-muted/60 ml-1">（启用时追加到 AI 系统提示末尾）</span>
                      </label>
                      <textarea
                        value={newSkillPrompt} onChange={e => setNewSkillPrompt(e.target.value)}
                        rows={5}
                        placeholder={"例：当用户提到 Docker 相关操作时：\n- 优先使用 docker compose 而非 docker run\n- 构建镜像时始终添加 --no-cache\n- 容器名称使用 kebab-case"}
                        className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text placeholder-terminal-muted/40 focus:outline-none focus:border-terminal-blue font-mono resize-none"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={addSkill}
                        disabled={skillSaving || !newSkillName.trim() || !newSkillPrompt.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white font-medium transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />{skillSaving ? '保存中...' : '保存'}
                      </button>
                      <button onClick={() => { setShowAddSkill(false); setSkillError(''); }}
                        className="px-4 py-2 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {/* Skills list */}
                {skills.length === 0 && !showAddSkill ? (
                  <div className="flex flex-col items-center justify-center py-12 text-terminal-muted gap-2">
                    <Zap className="w-8 h-8 opacity-20" />
                    <p className="text-sm">暂无技能</p>
                    <p className="text-xs opacity-60">添加技能后，AI 将在对应场景下具备更强的专业能力</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {skills.map(skill => (
                      <div key={skill.id} className="bg-terminal-surface border border-terminal-border rounded-xl p-3 group">
                        {editingSkill?.id === skill.id ? (
                          /* Edit form */
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[10px] text-terminal-muted mb-1">名称</label>
                                <input value={editingSkill.name} onChange={e => setEditingSkill(p => p ? { ...p, name: e.target.value } : null)}
                                  className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue" />
                              </div>
                              <div>
                                <label className="block text-[10px] text-terminal-muted mb-1">触发关键词</label>
                                <input
                                  value={(editingSkill.triggerKeywords || []).join(', ')}
                                  onChange={e => setEditingSkill(p => p ? { ...p, triggerKeywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean) } : null)}
                                  className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue" />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[10px] text-terminal-muted mb-1">描述</label>
                              <input value={editingSkill.description || ''} onChange={e => setEditingSkill(p => p ? { ...p, description: e.target.value } : null)}
                                className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-1.5 text-xs text-terminal-text focus:outline-none focus:border-terminal-blue" />
                            </div>
                            <div>
                              <label className="block text-[10px] text-terminal-muted mb-1">系统提示词补充</label>
                              <textarea
                                value={editingSkill.systemPromptAddition}
                                onChange={e => setEditingSkill(p => p ? { ...p, systemPromptAddition: e.target.value } : null)}
                                rows={5}
                                className="w-full bg-terminal-bg border border-terminal-border rounded-lg px-3 py-2 text-xs text-terminal-text font-mono focus:outline-none focus:border-terminal-blue resize-none" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => updateSkill(editingSkill)} disabled={skillSaving}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-terminal-blue hover:bg-terminal-blue/80 text-white transition-colors disabled:opacity-50">
                                <Save className="w-3 h-3" />{skillSaving ? '保存中...' : '保存'}
                              </button>
                              <button onClick={() => { setEditingSkill(null); setSkillError(''); }}
                                className="px-3 py-1.5 text-xs rounded-lg border border-terminal-border text-terminal-muted hover:text-terminal-text transition-colors">
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* View mode */
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="text-sm font-medium text-terminal-text">{skill.name}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                                  skill.enabled
                                    ? 'bg-terminal-green/10 border-terminal-green/30 text-terminal-green'
                                    : 'bg-terminal-border/20 border-terminal-border text-terminal-muted'
                                }`}>
                                  {skill.enabled ? '已启用' : '已禁用'}
                                </span>
                                {(skill.triggerKeywords || []).slice(0, 3).map(kw => (
                                  <span key={kw} className="text-[9px] px-1.5 py-0.5 rounded bg-terminal-blue/10 border border-terminal-blue/20 text-terminal-blue font-mono">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                              {skill.description && (
                                <div className="text-[10px] text-terminal-muted mt-0.5">{skill.description}</div>
                              )}
                              <div className="text-[10px] font-mono text-terminal-muted/50 mt-1 truncate">
                                {skill.systemPromptAddition.slice(0, 80)}{skill.systemPromptAddition.length > 80 ? '…' : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <button
                                onClick={() => toggleSkill(skill.id, !skill.enabled)}
                                title={skill.enabled ? '禁用' : '启用'}
                                className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                                  skill.enabled ? 'text-terminal-green hover:bg-terminal-border/40' : 'text-terminal-muted hover:bg-terminal-border/40'
                                }`}>
                                {skill.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                onClick={() => { setEditingSkill({ ...skill }); setShowAddSkill(false); setSkillError(''); }}
                                title="编辑"
                                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-text transition-colors">
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteSkill(skill.id)}
                                title="删除"
                                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-terminal-border/40 text-terminal-muted hover:text-terminal-red transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* How it works */}
                <div className="text-xs text-terminal-muted bg-terminal-surface border border-terminal-border rounded-lg px-3 py-2.5 space-y-1">
                  <p className="font-medium text-terminal-text">技能工作原理</p>
                  <p>· 启用的技能内容会追加到 AI <span className="text-terminal-text">系统提示</span>末尾</p>
                  <p>· 每个 AI 会话开始时自动加载所有已启用的技能</p>
                  <p>· 可通过设置触发关键词帮助 AI 更精准地应用该技能</p>
                </div>
              </div>
            )}

            {/* ── 数据管理 ──────────────────────────────────────────────── */}
            {section === 'data' && (
              <div className="space-y-4">
                <div className="bg-terminal-blue/10 border border-terminal-blue/20 rounded-lg px-4 py-3 text-xs text-terminal-blue">
                  <p className="font-medium mb-1">配置文件说明</p>
                  <p>配置文件包含：主机列表、AI 设置、命令白名单、高危命令配置、应用设置、已保存命令、MCP 服务器、技能等所有配置。</p>
                </div>

                {/* Export */}
                <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-terminal-green/10 border border-terminal-green/20 flex items-center justify-center flex-shrink-0">
                      <Download className="w-4 h-4 text-terminal-green" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-terminal-text">导出配置</div>
                      <div className="text-xs text-terminal-muted mt-0.5">将所有配置导出为加密 JSON 备份，可用于备份或在其他设备上恢复</div>
                    </div>
                  </div>
                  {exportDone && (
                    <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2 mb-2">
                      <CheckCircle2 className="w-3.5 h-3.5" />文件下载已开始
                    </div>
                  )}
                  <button onClick={handleExport}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-lg bg-terminal-green/10 hover:bg-terminal-green/20 text-terminal-green border border-terminal-green/20 transition-colors font-medium">
                    <Download className="w-4 h-4" />下载配置文件
                  </button>
                </div>

                {/* Import */}
                <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-terminal-blue/10 border border-terminal-blue/20 flex items-center justify-center flex-shrink-0">
                      <Upload className="w-4 h-4 text-terminal-blue" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-terminal-text">导入配置</div>
                      <div className="text-xs text-terminal-muted mt-0.5">从加密 JSON 备份恢复全部配置；若解密失败会提示错误并中止导入</div>
                    </div>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".enc,.json,text/plain,application/json" onChange={handleImport} className="hidden" />

                  {/* Drop zone */}
                  <div
                    className="border-2 border-dashed border-terminal-border rounded-lg p-6 text-center mb-3 cursor-pointer hover:border-terminal-blue/50 hover:bg-terminal-blue/5 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      const file = e.dataTransfer.files[0];
                      if (file && fileInputRef.current) {
                        const dt = new DataTransfer();
                        dt.items.add(file);
                        fileInputRef.current.files = dt.files;
                        fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                      }
                    }}
                  >
                    <FileText className="w-8 h-8 mx-auto text-terminal-muted/40 mb-2" />
                    <p className="text-sm text-terminal-muted">点击选择文件，或拖拽加密备份文件到此处</p>
                    <p className="text-[10px] text-terminal-muted/50 mt-1">支持 .enc，也兼容旧版 .json 备份</p>
                  </div>

                  <button onClick={() => fileInputRef.current?.click()} disabled={importing}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-lg bg-terminal-blue/10 hover:bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/20 transition-colors font-medium disabled:opacity-50">
                    <Upload className="w-4 h-4" />{importing ? '导入中...' : '选择配置文件'}
                  </button>
                  {importError && (
                    <div className="flex items-center gap-2 text-xs text-terminal-red bg-terminal-red/10 border border-terminal-red/20 rounded-lg px-3 py-2 mt-2">
                      <AlertCircle className="w-3.5 h-3.5" />{importError}
                    </div>
                  )}
                  {importSuccess && (
                    <div className="flex items-center gap-2 text-xs text-terminal-green bg-terminal-green/10 border border-terminal-green/20 rounded-lg px-3 py-2 mt-2">
                      <CheckCircle2 className="w-3.5 h-3.5" />导入成功！所有配置已更新
                    </div>
                  )}
                </div>

                <div className="text-xs text-terminal-muted bg-terminal-surface rounded-lg border border-terminal-border px-3 py-2.5">
                  配置文件存储在服务器 <span className="font-mono text-terminal-text">data/</span> 目录下，挂载为 Docker volume 可持久化数据。
                </div>
              </div>
            )}

            {/* ── 关于 ─────────────────────────────────────────────────── */}
            {section === 'about' && (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-terminal-blue/20 rounded-2xl flex items-center justify-center border border-terminal-blue/30">
                    <Cpu className="w-7 h-7 text-terminal-blue" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-terminal-text font-mono">SSH AI Shell</h2>
                    <p className="text-sm text-terminal-muted">AI 增强的 Web 终端</p>
                    <p className="text-xs text-terminal-muted/60 mt-0.5">版本 v1.0.0</p>
                  </div>
                </div>
                <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4 space-y-3 text-sm text-terminal-text">
                  <p>SSH AI Shell 是一个基于 Web 的 SSH 客户端，集成了 AI 能力，让您可以通过自然语言控制服务器。</p>
                  <p className="text-terminal-muted text-xs">主要特性：</p>
                  <ul className="text-xs text-terminal-muted space-y-1 ml-4 list-disc">
                    <li>自然语言 → Shell 命令转换</li>
                    <li>AI 命令风险评估与审批</li>
                    <li>SFTP 文件管理</li>
                    <li>多主机管理（支持分组）</li>
                    <li>支持密码和 SSH 密钥认证</li>
                    <li>支持多种 AI 服务商</li>
                  </ul>
                </div>
                <div className="text-xs text-terminal-muted">技术栈: React + TypeScript + Node.js + ssh2 + OpenAI SDK</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
