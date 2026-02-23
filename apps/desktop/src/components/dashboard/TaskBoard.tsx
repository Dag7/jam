import { TaskCard } from '@/components/dashboard/TaskCard';

interface TaskBoardProps {
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    assignedTo?: string;
    createdAt: string;
    tags: string[];
  }>;
  agents: Record<string, { name: string; color: string }>;
  onUpdateStatus: (taskId: string, status: string) => void;
}

const columns = [
  { key: 'pending', label: 'Pending' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
] as const;

function getColumn(status: string): string {
  if (status === 'completed' || status === 'failed') return 'done';
  return status;
}

export function TaskBoard({ tasks, agents, onUpdateStatus: _onUpdateStatus }: TaskBoardProps) {
  const grouped = tasks.reduce<Record<string, typeof tasks>>((acc, task) => {
    const col = getColumn(task.status);
    if (!acc[col]) acc[col] = [];
    acc[col].push(task);
    return acc;
  }, {});

  return (
    <div className="p-4 h-full flex flex-col">
      <h2 className="text-lg font-semibold text-white mb-4">Task Board</h2>
      <div className="flex-1 grid grid-cols-4 gap-4 min-h-0">
        {columns.map((col) => {
          const columnTasks = grouped[col.key] ?? [];
          return (
            <div key={col.key} className="flex flex-col min-h-0">
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-zinc-300">{col.label}</h3>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-400">
                  {columnTasks.length}
                </span>
              </div>

              {/* Column body */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {columnTasks.map((task) => {
                  const agent = task.assignedTo ? agents[task.assignedTo] : undefined;
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agentName={agent?.name}
                      agentColor={agent?.color}
                    />
                  );
                })}
                {columnTasks.length === 0 && (
                  <div className="text-xs text-zinc-600 text-center py-8 border border-dashed border-zinc-700 rounded-lg">
                    No tasks
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
