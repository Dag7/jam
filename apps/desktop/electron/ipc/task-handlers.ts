import { ipcMain } from 'electron';
import type { ITaskStore, TaskFilter } from '@jam/core';
import type { FileScheduleStore, SchedulePattern, TaskExecutor } from '@jam/team';

export interface TaskHandlerDeps {
  taskStore: ITaskStore;
  scheduleStore: FileScheduleStore;
  taskExecutor?: TaskExecutor;
}

export function registerTaskHandlers(deps: TaskHandlerDeps): void {
  const { taskStore, scheduleStore, taskExecutor } = deps;

  ipcMain.handle('tasks:list', async (_, filter?: TaskFilter) => {
    return taskStore.list(filter);
  });

  ipcMain.handle('tasks:get', async (_, taskId: string) => {
    return taskStore.get(taskId);
  });

  ipcMain.handle(
    'tasks:create',
    async (_, input: { title: string; description: string; priority?: string; assignedTo?: string; tags?: string[] }) => {
      if (!input.title || typeof input.title !== 'string' || !input.title.trim()) {
        return { success: false, error: 'Task title is required' };
      }
      try {
        const task = await taskStore.create({
          title: input.title.trim(),
          description: input.description || '',
          status: 'pending',
          priority: (input.priority as 'low' | 'normal' | 'high' | 'critical') ?? 'normal',
          source: 'user',
          createdBy: 'user',
          assignedTo: input.assignedTo,
          createdAt: new Date().toISOString(),
          tags: input.tags ?? [],
        });
        return { success: true, task };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'tasks:update',
    async (_, taskId: string, updates: Record<string, unknown>) => {
      try {
        const task = await taskStore.update(taskId, updates);
        return { success: true, task };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('tasks:delete', async (_, taskId: string) => {
    try {
      await taskStore.delete(taskId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'tasks:createRecurring',
    async (_, input: {
      title: string;
      description: string;
      pattern: { cron?: string; intervalMs?: number };
      priority?: string;
      assignedTo?: string;
      tags?: string[];
      source?: string;
      createdBy?: string;
    }) => {
      try {
        const schedule = await scheduleStore.create({
          name: input.title,
          pattern: input.pattern as SchedulePattern,
          taskTemplate: {
            title: input.title,
            description: input.description,
            priority: (input.priority as 'low' | 'normal' | 'high' | 'critical') ?? 'normal',
            source: (input.source as 'user' | 'agent') ?? 'user',
            createdBy: input.createdBy ?? 'user',
            assignedTo: input.assignedTo,
            tags: input.tags ?? [],
          },
          enabled: true,
          lastRun: null,
          source: input.source === 'agent' ? 'agent' : 'user',
        });
        return { success: true, schedule };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('tasks:cancel', async (_, taskId: string) => {
    if (!taskExecutor) return { success: false, error: 'Task executor not available' };
    return taskExecutor.cancelTask(taskId);
  });

  ipcMain.handle('tasks:getPaused', () => {
    return taskExecutor?.paused ?? false;
  });

  ipcMain.handle('tasks:setPaused', (_, paused: boolean) => {
    if (!taskExecutor) return { success: false, error: 'Task executor not available' };
    if (paused) {
      taskExecutor.pause();
    } else {
      taskExecutor.resume();
    }
    return { success: true };
  });

  // --- Task Dependencies ---

  ipcMain.handle('tasks:addDependency', async (_, taskId: string, dependsOnTaskId: string) => {
    try {
      const task = await taskStore.get(taskId);
      if (!task) return { success: false, error: 'Task not found' };
      const deps = task.dependsOn ?? [];
      if (deps.includes(dependsOnTaskId)) return { success: true, task };
      const updated = await taskStore.update(taskId, {
        dependsOn: [...deps, dependsOnTaskId],
      });
      return { success: true, task: updated };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('tasks:removeDependency', async (_, taskId: string, dependsOnTaskId: string) => {
    try {
      const task = await taskStore.get(taskId);
      if (!task) return { success: false, error: 'Task not found' };
      const deps = (task.dependsOn ?? []).filter((id: string) => id !== dependsOnTaskId);
      const updated = await taskStore.update(taskId, { dependsOn: deps });
      return { success: true, task: updated };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('tasks:getBlocked', async () => {
    return taskStore.list({ status: 'blocked' as TaskFilter['status'] });
  });
}
