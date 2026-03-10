import { useElapsedTime } from '@/hooks/useElapsedTime';

interface TaskListProps {
  tasks: Array<{ id: string; title: string; status: string; priority: string; startedAt?: string }>;
  onCancelTask: (taskId: string) => void;
}

export function AgentTaskList({ tasks, onCancelTask }: TaskListProps) {
  const hasRunning = tasks.some(t => t.status === 'running');

  // Re-render every second while any task is running (rAF-based, no setInterval)
  useElapsedTime(hasRunning);

  if (tasks.length === 0) {
    return <p className="text-sm text-zinc-500 italic">No tasks assigned.</p>;
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => {
        const isRunning = task.status === 'running';
        return (
          <div
            key={task.id}
            className={`bg-zinc-800 rounded-lg p-3 border ${isRunning ? 'border-blue-700/50' : 'border-zinc-700'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-white font-medium">{task.title}</span>
              <div className="flex items-center gap-2">
                {isRunning && task.startedAt && (
                  <span className="text-xs text-blue-400 flex items-center gap-1">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {formatElapsed(task.startedAt)}
                  </span>
                )}
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    task.status === 'completed'
                      ? 'bg-green-900/50 text-green-400'
                      : task.status === 'failed'
                        ? 'bg-red-900/50 text-red-400'
                        : task.status === 'running'
                          ? 'bg-blue-900/50 text-blue-400'
                          : 'bg-zinc-700 text-zinc-400'
                  }`}
                >
                  {task.status}
                </span>
                {isRunning && (
                  <button
                    onClick={() => onCancelTask(task.id)}
                    className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Stop task"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1">
              <span
                className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  task.priority === 'critical'
                    ? 'bg-red-900/50 text-red-400'
                    : task.priority === 'high'
                      ? 'bg-orange-900/50 text-orange-400'
                      : task.priority === 'normal'
                        ? 'bg-blue-900/50 text-blue-400'
                        : 'bg-zinc-700 text-zinc-400'
                }`}
              >
                {task.priority}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StatBlock({
  label,
  value,
  color = 'text-white',
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700">
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-zinc-400 mt-1">{label}</div>
    </div>
  );
}

function formatElapsed(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
