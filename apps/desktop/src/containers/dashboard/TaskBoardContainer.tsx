import { useAppStore } from '@/store';
import { useTasks } from '@/hooks/useTasks';
import { TaskBoard } from '@/components/dashboard/TaskBoard';

export function TaskBoardContainer() {
  const agents = useAppStore((s) => s.agents);
  const { tasks, updateTask, isLoading } = useTasks();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500">
        Loading tasks...
      </div>
    );
  }

  const agentMap = Object.fromEntries(
    Object.values(agents).map((a) => [
      a.profile.id,
      { name: a.profile.name, color: a.profile.color },
    ]),
  );

  const handleUpdateStatus = async (taskId: string, status: string) => {
    await updateTask(taskId, { status });
  };

  return (
    <TaskBoard
      tasks={tasks}
      agents={agentMap}
      onUpdateStatus={handleUpdateStatus}
    />
  );
}
