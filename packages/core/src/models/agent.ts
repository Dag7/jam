export type AgentId = string;

export type AgentVisualState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'working'
  | 'error'
  | 'offline';

export type AgentStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error'
  | 'restarting';

export interface AgentVoiceConfig {
  ttsVoiceId: string;
  ttsProvider?: string;
  speed?: number;
}

export interface AgentProfile {
  id: AgentId;
  name: string;
  runtime: string;
  model?: string;
  systemPrompt?: string;
  color: string;
  avatarUrl?: string;
  voice: AgentVoiceConfig;
  autoStart?: boolean;
  /** Grant the agent full tool access (web search, file ops, etc.) without confirmation prompts */
  allowFullAccess?: boolean;
  /** Allow new commands to interrupt the agent's current running task */
  allowInterrupts?: boolean;
  cwd?: string;
  env?: Record<string, string>;
}

export interface AgentState {
  profile: AgentProfile;
  status: AgentStatus;
  visualState: AgentVisualState;
  pid?: number;
  startedAt?: string;
  lastActivity?: string;
}
