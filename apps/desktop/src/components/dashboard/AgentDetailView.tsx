import { useState } from 'react';
import { SoulView } from '@/components/dashboard/SoulView';

interface AgentDetailViewProps {
  agent: { id: string; name: string; color: string };
  soul: {
    persona: string;
    traits: Record<string, number>;
    goals: string[];
    strengths: string[];
    weaknesses: string[];
    learnings: string[];
    version: number;
  } | null;
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    totalTokensIn: number;
    totalTokensOut: number;
    averageResponseMs: number;
    streaks: { current: number; best: number };
  } | null;
  tasks: Array<{ id: string; title: string; status: string; priority: string }>;
  relationships: Array<{
    targetAgentId: string;
    trustScore: number;
    interactionCount: number;
  }>;
  agents: Record<string, { name: string; color: string }>;
  onTriggerReflection: () => void;
}

const tabs = ['Soul', 'Stats', 'Tasks', 'Relationships'] as const;
type Tab = (typeof tabs)[number];

export function AgentDetailView({
  agent,
  soul,
  stats,
  tasks,
  relationships,
  agents,
  onTriggerReflection,
}: AgentDetailViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Soul');

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-zinc-700">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold text-white"
          style={{ backgroundColor: agent.color }}
        >
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <h2 className="text-lg font-semibold text-white">{agent.name}</h2>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-700">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'text-white border-b-2 border-blue-500'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'Soul' && (
          <div>
            {soul ? (
              <SoulView soul={soul} />
            ) : (
              <p className="text-sm text-zinc-500 italic">No soul data available.</p>
            )}
            <button
              onClick={onTriggerReflection}
              className="mt-4 px-4 py-2 bg-zinc-800 text-sm text-zinc-300 rounded-lg border border-zinc-700 hover:bg-zinc-700 hover:text-white transition-colors"
            >
              Trigger Reflection
            </button>
          </div>
        )}

        {activeTab === 'Stats' && (
          <div>
            {stats ? (
              <div className="grid grid-cols-2 gap-4">
                <StatBlock label="Tasks Completed" value={stats.tasksCompleted} />
                <StatBlock label="Tasks Failed" value={stats.tasksFailed} color="text-red-400" />
                <StatBlock label="Tokens In" value={stats.totalTokensIn.toLocaleString()} />
                <StatBlock label="Tokens Out" value={stats.totalTokensOut.toLocaleString()} />
                <StatBlock
                  label="Avg Response"
                  value={
                    stats.averageResponseMs < 1000
                      ? `${Math.round(stats.averageResponseMs)}ms`
                      : `${(stats.averageResponseMs / 1000).toFixed(1)}s`
                  }
                />
                <StatBlock label="Current Streak" value={stats.streaks.current} color="text-amber-400" />
                <StatBlock label="Best Streak" value={stats.streaks.best} color="text-amber-400" />
              </div>
            ) : (
              <p className="text-sm text-zinc-500 italic">No stats available.</p>
            )}
          </div>
        )}

        {activeTab === 'Tasks' && (
          <div className="space-y-2">
            {tasks.length === 0 && (
              <p className="text-sm text-zinc-500 italic">No tasks assigned.</p>
            )}
            {tasks.map((task) => (
              <div
                key={task.id}
                className="bg-zinc-800 rounded-lg p-3 border border-zinc-700"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white font-medium">{task.title}</span>
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
            ))}
          </div>
        )}

        {activeTab === 'Relationships' && (
          <div className="space-y-2">
            {relationships.length === 0 && (
              <p className="text-sm text-zinc-500 italic">No relationships yet.</p>
            )}
            {relationships.map((rel) => {
              const target = agents[rel.targetAgentId];
              return (
                <div
                  key={rel.targetAgentId}
                  className="bg-zinc-800 rounded-lg p-3 border border-zinc-700 flex items-center gap-3"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ backgroundColor: target?.color ?? '#6b7280' }}
                  >
                    {(target?.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">
                      {target?.name ?? rel.targetAgentId}
                    </div>
                    <div className="text-xs text-zinc-400">
                      {rel.interactionCount} interactions
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm font-semibold ${
                        rel.trustScore > 0.7
                          ? 'text-green-400'
                          : rel.trustScore >= 0.4
                            ? 'text-yellow-400'
                            : 'text-red-400'
                      }`}
                    >
                      {Math.round(rel.trustScore * 100)}%
                    </div>
                    <div className="text-xs text-zinc-500">Trust</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBlock({
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
