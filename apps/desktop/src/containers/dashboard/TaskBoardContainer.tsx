import { useMemo, useCallback } from 'react';
import { useAppStore } from '@/store';
import { useTasks } from '@/hooks/useTasks';
import { TaskBoard } from '@/components/dashboard/TaskBoard';

export function TaskBoardContainer() {
  const agents = useAppStore((s) => s.agents);
  const { tasks, updateTask, deleteTask, bulkDeleteTasks, isLoading } = useTasks();

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
      onUpdateStatus={handleUpdateStatus}
      onAssign={handleAssign}
      onDelete={deleteTask}
      onBulkDelete={bulkDeleteTasks}
      onCancel={handleCancelTask}
    />
  );
}
