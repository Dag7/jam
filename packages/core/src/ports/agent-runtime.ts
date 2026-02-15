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

export interface IAgentRuntime {
  readonly runtimeId: string;

  buildSpawnConfig(profile: AgentProfile): SpawnConfig;
  parseOutput(raw: string): AgentOutput;
  formatInput(text: string, context?: InputContext): string;
  detectResponseComplete(buffer: string): boolean;
}
