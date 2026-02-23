export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export type TaskSource = 'user' | 'agent' | 'system' | 'schedule';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  source: TaskSource;
  /** agentId or 'user' */
  createdBy: string;
  assignedTo?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  tags: string[];
  /** For subtask chains */
  parentTaskId?: string;
}

export interface TaskMetrics {
  totalCompleted: number;
  totalFailed: number;
  averageDurationMs: number;
  successRate: number;
  tokenUsage: { input: number; output: number };
}
