export interface AgentStats {
  agentId: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalExecutionMs: number;
  averageResponseMs: number;
  /** Total seconds running */
  uptime: number;
  lastActive: string;
  streaks: { current: number; best: number };
}
