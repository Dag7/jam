import { useMemo, useCallback, useState, useEffect } from 'react';
import { useAppStore } from '@/store';
import { useTasks } from '@/hooks/useTasks';
import { TaskBoard } from '@/components/dashboard/TaskBoard';

export function TaskBoardContainer() {
  const agents = useAppStore((s) => s.agents);
  const { tasks, updateTask, deleteTask, bulkDeleteTasks, isLoading } = useTasks();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    window.jam.tasks.getPaused().then(setPaused);
  }, []);

  const agentMap = useMemo(
    () => Object.fromEntries(
      Object.values(agents).map((a) => [
        a.profile.id,
        { name: a.profile.name, color: a.profile.color },
      ]),
    ),
    [agents],
  );

  const handleUpdateStatus = useCallback(async (taskId: string, status: string) => {
    await updateTask(taskId, { status });
  }, [updateTask]);

  const handleAssign = useCallback(async (taskId: string, agentId: string) => {
    await updateTask(taskId, { assignedTo: agentId, status: 'assigned' });
  }, [updateTask]);

  const handleCancelTask = useCallback(async (taskId: string) => {
    await window.jam.tasks.cancel(taskId);
  }, []);

  const handleTogglePaused = useCallback(async () => {
    const next = !paused;
    const result = await window.jam.tasks.setPaused(next);
    if (result.success) setPaused(next);
  }, [paused]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500">
        Loading tasks...
      </div>
    );
  }

  return (
    <TaskBoard
      tasks={tasks}
      agents={agentMap}
      paused={paused}
      onTogglePaused={handleTogglePaused}
      onUpdateStatus={handleUpdateStatus}
      onAssign={handleAssign}
      onDelete={deleteTask}
      onBulkDelete={bulkDeleteTasks}
      onCancel={handleCancelTask}
    />
  );
}
