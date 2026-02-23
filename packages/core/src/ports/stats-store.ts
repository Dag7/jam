import type { AgentStats } from '../models/agent-stats.js';

export interface IStatsStore {
  get(agentId: string): Promise<AgentStats | null>;
  update(agentId: string, delta: Partial<AgentStats>): Promise<AgentStats>;
  incrementTokens(agentId: string, tokensIn: number, tokensOut: number): Promise<void>;
  recordExecution(agentId: string, durationMs: number, success: boolean): Promise<void>;
}
