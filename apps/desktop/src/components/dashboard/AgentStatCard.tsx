import React from 'react';
import { formatTokens, estimateCost } from '@/utils/format';
import { Sparkline } from '@/components/charts/Sparkline';

interface AgentStatCardProps {
  agent: { id: string; name: string; color: string; status: string; role?: string; avatarUrl?: string };
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    totalTokensIn: number;
    totalTokensOut: number;
    averageResponseMs: number;
    streaks: { current: number };
  } | null;
  sparklineData?: number[];
  onClick: () => void;
}

export const AgentStatCard = React.memo(function AgentStatCard({ agent, stats, sparklineData, onClick }: AgentStatCardProps) {
  const totalTokens = stats ? stats.totalTokensIn + stats.totalTokensOut : 0;
  const cost = stats ? estimateCost(stats.totalTokensIn, stats.totalTokensOut) : 0;

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
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          {agent.avatarUrl ? (
            <img
              src={agent.avatarUrl.startsWith('/') ? `jam-local://${agent.avatarUrl}` : agent.avatarUrl}
              alt={agent.name}
              className="w-7 h-7 rounded-full object-cover shrink-0"
            />
          ) : (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ backgroundColor: `${agent.color}30`, color: agent.color }}
            >
              {agent.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <span className="text-sm font-bold text-white truncate block">{agent.name}</span>
            {agent.role && (
              <span className="text-[11px] text-zinc-500 truncate block">{agent.role}</span>
            )}
          </div>
        </div>
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

      {/* Stats Grid */}
      {stats ? (
        <div className="space-y-3">
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

          {/* Task activity sparkline (14-day trend) */}
          {sparklineData && sparklineData.length >= 2 && (
            <div className="pt-2 border-t border-zinc-700/50">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-zinc-500">14-day activity</span>
              </div>
              <Sparkline data={sparklineData} color={agent.color} fill height={28} />
            </div>
          )}

          {/* Token usage bar */}
          {totalTokens > 0 && (
            <div className="pt-2 border-t border-zinc-700/50">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">
                  {formatTokens(totalTokens)} tokens
                  <span className="text-zinc-600 ml-1">
                    ({formatTokens(stats.totalTokensIn)} in / {formatTokens(stats.totalTokensOut)} out)
                  </span>
                </span>
                <span className="text-emerald-400 font-medium">${cost.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-zinc-500 italic">No stats available</div>
      )}
    </div>
  );
});
