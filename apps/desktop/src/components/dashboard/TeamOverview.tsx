import { AgentStatCard } from '@/components/dashboard/AgentStatCard';

interface TeamOverviewProps {
  agents: Array<{ id: string; name: string; color: string; status: string }>;
  stats: Record<
    string,
    {
      tasksCompleted: number;
      tasksFailed: number;
      averageResponseMs: number;
      streaks: { current: number };
    }
  >;
  onSelectAgent: (agentId: string) => void;
}

export function TeamOverview({ agents, stats, onSelectAgent }: TeamOverviewProps) {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold text-white mb-4">Team Overview</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {agents.map((agent) => (
          <AgentStatCard
            key={agent.id}
            agent={agent}
            stats={stats[agent.id] ?? null}
            onClick={() => onSelectAgent(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
