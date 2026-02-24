import { useState, useEffect } from 'react';

interface TaskCardProps {
  task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    assignedTo?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    tags: string[];
  };
  agentName?: string;
  agentColor?: string;
  onDelete?: (taskId: string) => void;
  onCancel?: (taskId: string) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

const priorityStyles: Record<string, string> = {
  critical: 'bg-red-900/50 text-red-400',
  high: 'bg-orange-900/50 text-orange-400',
  normal: 'bg-blue-900/50 text-blue-400',
  low: 'bg-zinc-700 text-zinc-400',
};

const statusStyles: Record<string, string> = {
  completed: 'bg-green-900/50 text-green-400',
  failed: 'bg-red-900/50 text-red-400',
  cancelled: 'bg-zinc-700 text-zinc-400',
};

export function TaskCard({ task, agentName, agentColor, onDelete, onCancel }: TaskCardProps) {
  const isRunning = task.status === 'running';
  const [, setTick] = useState(0);

  // Re-render every second while running to update elapsed time
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  return (
    <div className={`group bg-zinc-800 rounded-lg p-3 border transition-colors relative ${
      isRunning ? 'border-blue-700/50' : 'border-zinc-700 hover:border-zinc-600'
    }`}>
      {/* Delete button — visible on hover, hidden for running tasks */}
      {onDelete && !isRunning && (
        <button
          onClick={() => onDelete(task.id)}
          className="absolute top-2 right-2 p-1 rounded text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title="Delete task"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}

      {/* Title */}
      <div className="text-sm font-medium text-white mb-2 leading-snug pr-5">{task.title}</div>

      {/* Priority + status badges */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-xs px-1.5 py-0.5 rounded font-medium ${
            priorityStyles[task.priority] ?? priorityStyles.normal
          }`}
        >
          {task.priority}
        </span>
        {(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              statusStyles[task.status] ?? statusStyles.failed
            }`}
          >
            {task.status}
          </span>
        )}
      </div>

      {/* Assignee */}
      {agentName && (
        <div className="flex items-center gap-1.5 mb-2">
          <div
            className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
            style={{ backgroundColor: agentColor ?? '#6b7280' }}
          >
            {agentName.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs text-zinc-400">{agentName}</span>
        </div>
      )}

      {/* Tags */}
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Running: elapsed time + stop button */}
      {isRunning && task.startedAt && (
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-700/50">
          <div className="flex items-center gap-1.5 text-xs text-blue-400">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Running {formatElapsed(task.startedAt)}
          </div>
          {onCancel && (
            <button
              onClick={() => onCancel(task.id)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Stop this task"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop
            </button>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div className="text-[10px] text-zinc-600 space-y-0.5 mt-1">
        <div>Created {formatTime(task.createdAt)}</div>
        {task.completedAt && (
          <div>
            {task.status === 'failed' ? 'Failed' : task.status === 'cancelled' ? 'Cancelled' : 'Done'} {formatTime(task.completedAt)}
          </div>
        )}
      </div>
    </div>
  );
}
