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
