export interface AgentRelationship {
  sourceAgentId: string;
  targetAgentId: string;
  /** 0.0 – 1.0, exponential moving average */
  trustScore: number;
  interactionCount: number;
  lastInteraction: string;
  delegationCount: number;
  delegationSuccessRate: number;
  /** Agent-generated observations */
  notes: string[];
}
