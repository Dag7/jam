import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export interface TaskEntry {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  source: string;
  createdBy: string;
  assignedTo?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  tags: string[];
  parentTaskId?: string;
}

export interface TaskSlice {
  tasks: Record<string, TaskEntry>;
  taskFilter: { status?: string; assignedTo?: string };

  setTasks: (tasks: TaskEntry[]) => void;
  addTask: (task: TaskEntry) => void;
  updateTask: (task: TaskEntry) => void;
  removeTask: (taskId: string) => void;
  setTaskFilter: (filter: { status?: string; assignedTo?: string }) => void;
}

export const createTaskSlice: StateCreator<
  AppStore,
  [],
  [],
  TaskSlice
> = (set) => ({
  tasks: {},
  taskFilter: {},

  setTasks: (tasks) =>
    set({
      tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    }),

  addTask: (task) =>
    set((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
    })),

  updateTask: (task) =>
    set((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
    })),

  removeTask: (taskId) =>
    set((state) => {
      const { [taskId]: _, ...rest } = state.tasks;
      return { tasks: rest };
    }),

  setTaskFilter: (filter) => set({ taskFilter: filter }),
});
