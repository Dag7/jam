import { ipcMain } from 'electron';
import type { ITaskStore, TaskFilter } from '@jam/core';

export interface TaskHandlerDeps {
  taskStore: ITaskStore;
}

export function registerTaskHandlers(deps: TaskHandlerDeps): void {
  const { taskStore } = deps;

  ipcMain.handle('tasks:list', async (_, filter?: TaskFilter) => {
    return taskStore.list(filter);
  });

  ipcMain.handle('tasks:get', async (_, taskId: string) => {
    return taskStore.get(taskId);
  });

  ipcMain.handle(
    'tasks:create',
    async (_, input: { title: string; description: string; priority?: string; assignedTo?: string; tags?: string[] }) => {
      try {
        const task = await taskStore.create({
          title: input.title,
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
}
