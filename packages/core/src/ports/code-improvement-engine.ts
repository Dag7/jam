import type { CodeImprovement, ImprovementStatus } from '../models/code-improvement.js';

export interface ImprovementFilter {
  status?: ImprovementStatus;
  agentId?: string;
}

export interface ImprovementHealth {
  healthy: boolean;
  lastCheck: string;
  issues: string[];
}

/**
 * Port interface for the self-improving code system.
 * Manages the full lifecycle: propose → execute → test → merge/rollback.
 */
export interface ICodeImprovementEngine {
  propose(agentId: string, title: string, description: string): Promise<CodeImprovement>;
  execute(improvementId: string): Promise<CodeImprovement>;
  rollback(improvementId: string): Promise<void>;
  list(filter?: ImprovementFilter): Promise<CodeImprovement[]>;
  getHealth(): Promise<ImprovementHealth>;
}
