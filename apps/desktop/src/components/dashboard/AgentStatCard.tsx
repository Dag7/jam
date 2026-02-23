interface AgentStatCardProps {
  agent: { id: string; name: string; color: string; status: string };
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    averageResponseMs: number;
    streaks: { current: number };
  } | null;
  onClick: () => void;
}

export function AgentStatCard({ agent, stats, onClick }: AgentStatCardProps) {
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      role="button"
      tabIndex={0}
      className="bg-zinc-800 rounded-lg p-4 cursor-pointer hover:bg-zinc-750 transition-colors border-l-4"
      style={{ borderLeftColor: agent.color }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-white truncate">{agent.name}</span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            agent.status === 'running'
              ? 'bg-green-900/50 text-green-400'
              : agent.status === 'error'
                ? 'bg-red-900/50 text-red-400'
                : 'bg-zinc-700 text-zinc-400'
          }`}
        >
          {agent.status}
        </span>
      </div>

      {/* Stats 2x2 Grid */}
      {stats ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-lg font-semibold text-white">{stats.tasksCompleted}</div>
            <div className="text-xs text-zinc-400">Completed</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-red-400">{stats.tasksFailed}</div>
            <div className="text-xs text-zinc-400">Failed</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-white">
              {stats.averageResponseMs < 1000
                ? `${Math.round(stats.averageResponseMs)}ms`
                : `${(stats.averageResponseMs / 1000).toFixed(1)}s`}
            </div>
            <div className="text-xs text-zinc-400">Avg Response</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-amber-400">{stats.streaks.current}</div>
            <div className="text-xs text-zinc-400">Streak</div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-zinc-500 italic">No stats available</div>
      )}
    </div>
  );
}
