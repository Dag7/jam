import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store';
import type { TaskEntry } from '@/store/taskSlice';

export function useTasks() {
  const tasks = useAppStore((s) => s.tasks);
  const taskFilter = useAppStore((s) => s.taskFilter);
  const setTasks = useAppStore((s) => s.setTasks);
  const addTask = useAppStore((s) => s.addTask);
  const updateTask = useAppStore((s) => s.updateTask);
  const setTaskFilter = useAppStore((s) => s.setTaskFilter);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    window.jam.tasks.list().then((result) => {
      setTasks(result as unknown as TaskEntry[]);
      setIsLoading(false);
    });

    const cleanupCreated = window.jam.tasks.onCreated((data) => {
      addTask(data.task as unknown as TaskEntry);
    });
    const cleanupUpdated = window.jam.tasks.onUpdated((data) => {
      updateTask(data.task as unknown as TaskEntry);
    });
    const cleanupCompleted = window.jam.tasks.onCompleted((data) => {
      updateTask(data.task as unknown as TaskEntry);
    });

    return () => {
      cleanupCreated();
      cleanupUpdated();
      cleanupCompleted();
    };
  }, [setTasks, addTask, updateTask]);

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

  const removeTask = useAppStore((s) => s.removeTask);

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
      if (result.success) removeTask(taskId);
      return result;
    },
    [removeTask],
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
