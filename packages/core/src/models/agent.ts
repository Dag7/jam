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

/** Maps a secret from the global vault to an env var in the agent's process. */
export interface SecretBinding {
  /** References a secret ID in AppStore (e.g., "github-token") */
  secretId: string;
  /** Env var name injected into the agent process (e.g., "GITHUB_TOKEN") */
  envVarName: string;
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
  /** Secrets bound to this agent, injected as env vars at spawn time */
  secretBindings?: SecretBinding[];
  /** System agents are bootstrapped by the app and cannot be deleted/edited */
  isSystem?: boolean;
}

export interface AgentState {
  profile: AgentProfile;
  status: AgentStatus;
  visualState: AgentVisualState;
  pid?: number;
  startedAt?: string;
  lastActivity?: string;
}
