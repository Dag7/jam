import type { AgentRelationship } from '../models/relationship.js';

export interface IRelationshipStore {
  get(sourceAgentId: string, targetAgentId: string): Promise<AgentRelationship | null>;
  set(relationship: AgentRelationship): Promise<void>;
  getAll(agentId: string): Promise<AgentRelationship[]>;
  updateTrust(
    sourceAgentId: string,
    targetAgentId: string,
    outcome: 'success' | 'failure',
    weight?: number,
  ): Promise<AgentRelationship>;
}
