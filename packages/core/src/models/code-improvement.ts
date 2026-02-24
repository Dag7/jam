/**
 * Domain model for the self-improving code system.
 * Tracks each improvement attempt through the safety pipeline.
 */

export type ImprovementStatus =
  | 'pending'
  | 'branched'
  | 'executing'
  | 'testing'
  | 'merged'
  | 'failed'
  | 'rolled-back';

export interface CodeImprovement {
  id: string;
  title: string;
  description: string;
  /** Which agent proposed/executes this improvement */
  agentId: string;
  /** Linked task (if improvement originated from a task) */
  taskId?: string;
  /** Git branch name (e.g. 'jam/auto-improve') */
  branch: string;
  /** Commit SHA after agent work */
  commitHash?: string;
  /** Test suite result */
  testResult?: { passed: boolean; output: string };
  status: ImprovementStatus;
  error?: string;
  createdAt: string;
  completedAt?: string;
}
