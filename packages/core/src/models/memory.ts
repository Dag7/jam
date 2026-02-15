import type { AgentId } from './agent.js';

export interface AgentMemory {
  persona: string;
  facts: string[];
  preferences: Record<string, string>;
  lastUpdated: string;
}

export interface SessionEntry {
  timestamp: string;
  type: 'user-voice' | 'user-text' | 'agent-response' | 'system';
  content: string;
  agentId: AgentId;
}
