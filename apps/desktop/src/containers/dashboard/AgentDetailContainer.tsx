import { useAppStore } from '@/store';
import { useAgentSoul } from '@/hooks/useAgentSoul';
import { useTeamStats } from '@/hooks/useTeamStats';
import { useTasks } from '@/hooks/useTasks';
import { AgentDetailView } from '@/components/dashboard/AgentDetailView';

interface AgentDetailContainerProps {
  agentId: string;
}

export function AgentDetailContainer({ agentId }: AgentDetailContainerProps) {
  const agents = useAppStore((s) => s.agents);
  const agent = agents[agentId];
  const { soul, triggerReflection } = useAgentSoul(agentId);
  const { stats, relationships } = useTeamStats();
  const { tasks } = useTasks();

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500">
        Agent not found
      </div>
    );
  }

  const agentStats = stats[agentId] ?? null;
  const agentTasks = tasks.filter(
    (t) => t.assignedTo === agentId || t.createdBy === agentId,
  );
  const agentRelationships = relationships
    .filter((r) => r.sourceAgentId === agentId)
    .map((r) => ({
      targetAgentId: r.targetAgentId,
      trustScore: r.trustScore,
      interactionCount: r.interactionCount,
    }));

  const agentMap = Object.fromEntries(
    Object.values(agents).map((a) => [
      a.profile.id,
      { name: a.profile.name, color: a.profile.color },
    ]),
  );

  return (
    <AgentDetailView
      agent={{
        id: agent.profile.id,
        name: agent.profile.name,
        color: agent.profile.color,
      }}
      soul={soul}
      stats={agentStats}
      tasks={agentTasks}
      relationships={agentRelationships}
      agents={agentMap}
      onTriggerReflection={triggerReflection}
    />
  );
}
