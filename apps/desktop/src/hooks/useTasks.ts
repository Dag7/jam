import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store';
import type { TaskEntry } from '@/store/taskSlice';

export function useTasks() {
  const tasks = useAppStore((s) => s.tasks);
  const taskFilter = useAppStore((s) => s.taskFilter);
  const setTaskFilter = useAppStore((s) => s.setTaskFilter);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const store = () => useAppStore.getState();

    window.jam.tasks.list().then((result) => {
      store().setTasks(result as unknown as TaskEntry[]);
      setIsLoading(false);
    });

    const cleanupCreated = window.jam.tasks.onCreated((data) => {
      store().addTask(data.task as unknown as TaskEntry);
    });
    const cleanupUpdated = window.jam.tasks.onUpdated((data) => {
      store().updateTask(data.task as unknown as TaskEntry);
    });
    const cleanupCompleted = window.jam.tasks.onCompleted((data) => {
      store().updateTask(data.task as unknown as TaskEntry);
    });

    return () => {
      cleanupCreated();
      cleanupUpdated();
      cleanupCompleted();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredTasks = useMemo(() => {
    let result = Object.values(tasks);
    if (taskFilter.status) {
      result = result.filter((t) => t.status === taskFilter.status);
    }
    if (taskFilter.assignedTo) {
      result = result.filter((t) => t.assignedTo === taskFilter.assignedTo);
    }
    return result;
  }, [tasks, taskFilter]);

  const createTask = useCallback(
    async (input: { title: string; description: string; priority?: string; assignedTo?: string; tags?: string[] }) => {
      return window.jam.tasks.create(input);
    },
    [],
  );

  const updateTaskStatus = useCallback(
    async (taskId: string, updates: Record<string, unknown>) => {
      return window.jam.tasks.update(taskId, updates);
    },
    [],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      const result = await window.jam.tasks.delete(taskId);
      if (result.success) useAppStore.getState().removeTask(taskId);
      return result;
    },
    [],
  );

  const bulkDeleteTasks = useCallback(
    async (taskIds: string[]) => {
      await Promise.all(taskIds.map((id) => deleteTask(id)));
    },
    [deleteTask],
  );

  return {
    tasks: Object.values(tasks),
    filteredTasks,
    createTask,
    updateTask: updateTaskStatus,
    deleteTask,
    bulkDeleteTasks,
    setFilter: setTaskFilter,
    filter: taskFilter,
    isLoading,
  };
}
