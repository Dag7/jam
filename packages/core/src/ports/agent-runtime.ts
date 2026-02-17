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

/** Result from executing a one-shot command (voice, API, etc.) */
export interface ExecutionResult {
  success: boolean;
  text: string;
  sessionId?: string;
  error?: string;
}

/** Options for one-shot execution */
export interface ExecutionOptions {
  sessionId?: string;
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface IAgentRuntime {
  readonly runtimeId: string;

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
