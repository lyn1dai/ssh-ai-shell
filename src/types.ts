// Shared TypeScript types for client <-> server communication

// ─── WebSocket message shapes ──────────────────────────────────────────────

export type Risk = 'low' | 'normal' | 'high';

export type ServerMsg =
  | { type: 'ssh_connected'; payload: { host: string; username: string } }
  | { type: 'terminal_output'; payload: { data: string } }
  | { type: 'ai_thinking'; payload: Record<string, never> }
  | { type: 'ai_reply_chunk'; payload: { text: string } }
  | { type: 'ai_reply_end'; payload: Record<string, never> }
  | { type: 'command_card'; payload: { commandId: string; command: string; risk: Risk } }
  | { type: 'command_auto_approve'; payload: { commandId: string } }
  | { type: 'command_executing'; payload: { commandId: string } }
  | { type: 'command_done'; payload: { commandId: string; exitCode: number } }
  | { type: 'disconnected'; payload: Record<string, never> }
  | { type: 'session_cleared'; payload: Record<string, never> }
  | { type: 'pong'; payload: Record<string, never> }
  | { type: 'error'; payload: { message: string } };

export type ClientMsg =
  | { type: 'connect'; payload: ConnectConfig }
  | { type: 'input'; payload: { text: string } }
  | { type: 'raw_input'; payload: { data: string } }
  | { type: 'command_confirm'; payload: { commandId: string; command: string } }
  | { type: 'command_reject'; payload: { commandId: string } }
  | { type: 'resize'; payload: { rows: number; cols: number } }
  | { type: 'new_session'; payload: Record<string, never> }
  | { type: 'disconnect'; payload: Record<string, never> };

// ─── SSH connection config ────────────────────────────────────────────────

export interface ConnectConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

// ─── Terminal block model ─────────────────────────────────────────────────

export type CommandCardStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'done';

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
