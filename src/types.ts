// Shared TypeScript types for client <-> server communication

// ─── Theme ────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light' | 'monokai' | 'nord' | 'solarized' | 'dracula';

export interface AppSettings {
  theme: Theme;
  showStatusBar: boolean;
  language: string;
  frequentCommandsCount: number;
}

export interface TerminalSettings {
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  boldFontWeight: string;
  letterSpacing: number;
  lineHeight: number;
  scrollback: number;
  selectToCopy: boolean;
  cursorBlink: boolean;
  cursorStyle: 'block' | 'underline' | 'bar';
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontSize: 13,
  fontFamily: 'JetBrains Mono',
  fontWeight: 'normal',
  boldFontWeight: 'bold',
  letterSpacing: 0,
  lineHeight: 1.45,
  scrollback: 1000,
  selectToCopy: false,
  cursorBlink: true,
  cursorStyle: 'block',
};

// ─── WebSocket message shapes ──────────────────────────────────────────────

export type Risk = 'low' | 'normal' | 'high';

export type ServerMsg =
  | { type: 'ssh_connected'; payload: { host: string; username: string; sessionToken?: string } }
  | { type: 'terminal_output'; payload: { data: string } }
  | { type: 'ai_task_start'; payload: Record<string, never> }
  | { type: 'ai_task_end'; payload: { cancelled?: boolean } }
  | { type: 'ai_thinking'; payload: { message?: string } }
  | { type: 'ai_reply_chunk'; payload: { text: string } }
  | { type: 'ai_reply_end'; payload: Record<string, never> }
  | { type: 'ai_log'; payload: { message: string; level: string } }
  | { type: 'ai_not_configured'; payload: Record<string, never> }
  | { type: 'command_card'; payload: { commandId: string; command: string; risk: Risk } }
  | { type: 'command_auto_approve'; payload: { commandId: string } }
  | { type: 'command_executing'; payload: { commandId: string } }
  | { type: 'command_done'; payload: { commandId: string; exitCode: number } }
  | { type: 'disconnected'; payload: Record<string, never> }
  | { type: 'session_cleared'; payload: Record<string, never> }
  | { type: 'config_updated'; payload: { configured: boolean } }
  | { type: 'pong'; payload: Record<string, never> }
  | { type: 'sftp_ls_result'; payload: { path: string; files: SFTPFile[]; error?: string } }
  | { type: 'sftp_op_result'; payload: { success: boolean; error?: string; op?: string } }
  | { type: 'complete_result'; payload: { completions: Array<{ name: string; isDir: boolean }>; word: string } }
  | { type: 'shell_cwd_result'; payload: { path: string } }
  | { type: 'error'; payload: { message: string } };

export type ClientMsg =
  | { type: 'connect'; payload: ConnectConfig }
  | { type: 'input'; payload: { text: string } }
  | { type: 'raw_input'; payload: { data: string; encoding?: 'text' | 'base64' } }
  | { type: 'set_charset'; payload: { charset: string } }
  | { type: 'set_raw_terminal_mode'; payload: { enabled: boolean } }
  | { type: 'command_confirm'; payload: { commandId: string; command: string } }
  | { type: 'command_reject'; payload: { commandId: string } }
  | { type: 'resize'; payload: { rows: number; cols: number } }
  | { type: 'new_session'; payload: Record<string, never> }
  | { type: 'update_ai_config'; payload: Record<string, never> }
  | { type: 'disconnect'; payload: Record<string, never> }
  | { type: 'sftp_ls'; payload: { path: string } }
  | { type: 'sftp_delete'; payload: { path: string } }
  | { type: 'sftp_mkdir'; payload: { path: string } }
  | { type: 'sftp_rename'; payload: { oldPath: string; newPath: string } }
  | { type: 'run_saved_command'; payload: { content: string } }
  | { type: 'complete_request'; payload: { word: string; cwd: string; mode: 'command' | 'path' } }
  | { type: 'ai_cancel'; payload: Record<string, never> };

// ─── SSH connection config ────────────────────────────────────────────────

export interface ConnectConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  charset?: string;
  name?: string;       // display name for the tab
  hostId?: string;     // optional – used to update lastConnectedAt
}

// ─── Saved host ──────────────────────────────────────────────────────────

export interface SavedHost {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  createdAt: string;
  lastConnectedAt?: string;
  /** Group path, e.g. "Production" or "Production/Web" (max 2 levels) */
  group?: string;
}

// ─── SFTP file entry ──────────────────────────────────────────────────────

export interface SFTPFile {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifyTime: number;
  permissions: string;
  owner?: string;
}

// ─── AI settings ──────────────────────────────────────────────────────────

/** Per-provider stored credentials */
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  terminalModel?: string;
  enabledModels?: string[];
}

export interface AISettings {
  providerId?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Model used for terminal AI commands (starred model in settings) */
  terminalModel?: string;
  /** Models enabled for use in AI chat panel */
  enabledModels?: string[];
  configured?: boolean;
  enableCommandExplain?: boolean;
  enableAIAssistant?: boolean;
  enableAutoComplete?: boolean;
  agentExecMode?: 'ask_each' | 'auto_approve_low' | 'auto_approve_all';
  commandWhitelist?: string[];
  /** Per-provider stored credentials, keyed by provider id */
  providerConfigs?: Record<string, ProviderConfig>;
  apiFormat?: 'openai' | 'anthropic';
}

// ─── Auto-approve rules ───────────────────────────────────────────────────

export interface AutoApproveRule {
  id: string;
  /** Prefix match, glob (with *), or /regex/ */
  pattern: string;
  enabled: boolean;
  description?: string;
}

export interface AutoApproveSettings {
  globalAutoApprove: {
    low: boolean;
    normal: boolean;
    high: boolean;
  };
  rules: AutoApproveRule[];
  rulesConfigured?: boolean;
  highRiskRules: AutoApproveRule[];
  highRiskRulesConfigured?: boolean;
}

// ─── AI Provider presets ─────────────────────────────────────────────────

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  apiKeyHint: string;
  docsUrl?: string;
  authType?: 'apikey' | 'oauth';
  apiFormats?: Array<'openai' | 'anthropic'>;
}

// ─── Terminal block model ─────────────────────────────────────────────────

export type CommandCardStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'done' | 'cancelled';

export type Block =
  | { id: string; type: 'terminal'; html: string }
  | { id: string; type: 'ai_thinking' }
  | { id: string; type: 'ai_reply'; text: string; complete: boolean }
  | {
      id: string;
      type: 'command_card';
      commandId: string;
      command: string;
      risk: Risk;
      status: CommandCardStatus;
    };

// ─── Saved commands ───────────────────────────────────────────────────────────

export interface SavedCommand {
  id: string;
  name: string;
  /** Command/script/natural-language text */
  content: string;
  /** 'shell' = shell command/script, 'natural' = natural language for AI */
  type: 'shell' | 'natural';
  description?: string;
  /** Shortcut string, e.g. "Ctrl+Shift+1" */
  shortcut?: string;
  /** Incremented every time the command is executed; used for frequency sorting */
  usageCount?: number;
  createdAt: string;
  updatedAt?: string;
}

// ─── Command history ──────────────────────────────────────────────────────────

export interface CommandHistoryEntry {
  id: string;
  command: string;
  /** "user@host" — identifies which SSH connection this belongs to */
  host: string;
  timestamp: string; // ISO 8601
}

export interface ClipboardHistoryEntry {
  text: string;
  timestamp: string; // ISO 8601
}

export interface MCPServer {
  id: string;
  name: string;
  /** stdio = child process; http = HTTP endpoint */
  transport: 'stdio' | 'http';
  /** For stdio: the executable command */
  command?: string;
  /** For stdio: arguments array */
  args?: string[];
  /** For stdio: extra environment variables */
  env?: Record<string, string>;
  /** For http: base URL */
  url?: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
}

// ─── Skills ───────────────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description?: string;
  /** Text appended to system prompt when skill is enabled */
  systemPromptAddition: string;
  /** Optional keywords that help identify when this skill applies */
  triggerKeywords?: string[];
  enabled: boolean;
  createdAt: string;
}
