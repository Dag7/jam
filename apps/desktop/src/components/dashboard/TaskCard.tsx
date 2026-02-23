interface TaskCardProps {
  task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    assignedTo?: string;
    tags: string[];
  };
  agentName?: string;
  agentColor?: string;
}

const priorityStyles: Record<string, string> = {
  critical: 'bg-red-900/50 text-red-400',
  high: 'bg-orange-900/50 text-orange-400',
  normal: 'bg-blue-900/50 text-blue-400',
  low: 'bg-zinc-700 text-zinc-400',
};

export function TaskCard({ task, agentName, agentColor }: TaskCardProps) {
  return (
    <div className="bg-zinc-800 rounded-lg p-3 border border-zinc-700 hover:border-zinc-600 transition-colors">
      {/* Title */}
      <div className="text-sm font-medium text-white mb-2 leading-snug">{task.title}</div>

      {/* Priority badge */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-xs px-1.5 py-0.5 rounded font-medium ${
            priorityStyles[task.priority] ?? priorityStyles.normal
          }`}
        >
          {task.priority}
        </span>
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
        <div className="flex flex-wrap gap-1">
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
    </div>
  );
}
