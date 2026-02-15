import type { AgentId } from '../models/agent.js';
import type { AgentMemory, SessionEntry } from '../models/memory.js';

export interface IMemoryStore {
  load(agentId: AgentId): Promise<AgentMemory | null>;
  save(agentId: AgentId, memory: AgentMemory): Promise<void>;
  appendSession(agentId: AgentId, entry: SessionEntry): Promise<void>;
  getSessionHistory(agentId: AgentId, limit?: number): Promise<SessionEntry[]>;
}
