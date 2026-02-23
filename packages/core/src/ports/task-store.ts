import type { Task, TaskStatus, TaskSource } from '../models/task.js';

export interface TaskFilter {
  status?: TaskStatus;
  assignedTo?: string;
  createdBy?: string;
  source?: TaskSource;
}

export interface ITaskStore {
  create(task: Omit<Task, 'id'>): Promise<Task>;
  get(taskId: string): Promise<Task | null>;
  update(taskId: string, updates: Partial<Task>): Promise<Task>;
  list(filter?: TaskFilter): Promise<Task[]>;
  delete(taskId: string): Promise<void>;
}
