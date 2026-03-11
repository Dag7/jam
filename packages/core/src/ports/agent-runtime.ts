import type { AgentProfile } from '../models/agent.js';

export interface SpawnConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentOutput {
  type: 'text' | 'tool-use' | 'thinking' | 'complete';
  content: string;
  raw: string;
}

export interface InputContext {
  previousOutput?: string;
  sharedContext?: string;
}

/** Token usage from a single execution */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Result from executing a one-shot command (voice, API, etc.) */
export interface ExecutionResult {
  success: boolean;
  text: string;
  sessionId?: string;
  error?: string;
  /** Token usage reported by the runtime (if available) */
  usage?: TokenUsage;
}

/** Progress event emitted during long-running execution */
export interface ExecutionProgress {
  type: 'tool-use' | 'thinking' | 'text';
  summary: string;
}

/** Options for one-shot execution */
export interface ExecutionOptions {
  sessionId?: string;
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** Called with progress updates during execution (tool use, thinking, etc.) */
  onProgress?: (event: ExecutionProgress) => void;
  /** Called with terminal-friendly output chunks during execution for real-time display */
  onOutput?: (data: string) => void;
}

/** Model option available for a runtime */
export interface RuntimeModel {
  id: string;
  label: string;
  group: string;
}

/** How a runtime authenticates: OAuth flow, API key env var, or local config file */
export type RuntimeAuthType = 'oauth' | 'api-key' | 'config';

/** Self-describing metadata for a runtime — used by UI, onboarding, and setup detection */
export interface RuntimeMetadata {
  id: string;
  displayName: string;
  cliCommand: string;
  installHint: string;
  models: RuntimeModel[];
  supportsFullAccess?: boolean;
  nodeVersionRequired?: number;
  detectAuth(homedir: string): boolean;
  getAuthHint(): string;
  /** Primary auth method: 'oauth' (browser login), 'api-key' (env var), 'config' (local file) */
  authType: RuntimeAuthType;
  /** Env var name for API key auth (e.g. 'OPENAI_API_KEY'). Runtimes that accept an API key
   *  should set this even if authType is 'oauth' (as an alternative auth path). */
  authEnvVar?: string;
  /** CLI args for interactive login (e.g. ['auth', 'login']). Appended to cliCommand. */
  authCommand?: string[];
}

/** Serializable subset of RuntimeMetadata (no functions) for IPC transport */
export interface SerializedRuntimeMetadata {
  id: string;
  displayName: string;
  cliCommand: string;
  installHint: string;
  models: RuntimeModel[];
  supportsFullAccess?: boolean;
  nodeVersionRequired?: number;
  authHint: string;
  authType: RuntimeAuthType;
  authEnvVar?: string;
  authCommand?: string[];
}

export interface IAgentRuntime {
  readonly runtimeId: string;
  readonly metadata: RuntimeMetadata;

  /** Build config for spawning an interactive PTY session */
  buildSpawnConfig(profile: AgentProfile): SpawnConfig;
  /** Parse raw PTY output into structured output */
  parseOutput(raw: string): AgentOutput;
  /** Format user input before sending to the agent */
  formatInput(text: string, context?: InputContext): string;

  /** Execute a one-shot command (e.g. voice query).
   *  Spawns a child process, pipes text via stdin, waits for exit.
   *  Each runtime encapsulates its own CLI flags, parsing, and timeouts. */
  execute(profile: AgentProfile, text: string, options?: ExecutionOptions): Promise<ExecutionResult>;
}
