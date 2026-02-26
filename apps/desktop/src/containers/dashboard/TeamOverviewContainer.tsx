import { useEffect, useMemo } from 'react';
import { useAppStore } from '@/store';
import { useTeamStats } from '@/hooks/useTeamStats';
import { TeamOverview } from '@/components/dashboard/TeamOverview';
import { RelationshipGraph } from '@/components/dashboard/RelationshipGraph';
import type { SoulEntry } from '@/store/teamSlice';

interface TeamOverviewContainerProps {
  onSelectAgent: (agentId: string) => void;
}

export function TeamOverviewContainer({ onSelectAgent }: TeamOverviewContainerProps) {
  const agents = useAppStore((s) => s.agents);
  const souls = useAppStore((s) => s.souls);
  const { stats, relationships, isLoading } = useTeamStats();

  // Stable reference: only changes when agent IDs actually change
  const agentIds = useMemo(() => Object.keys(agents), [agents]);

  // Load souls for all agents to display role info
  // Use getState() inside callback to avoid re-running when setSoul reference changes
  useEffect(() => {
    const currentSouls = useAppStore.getState().souls;
    for (const id of agentIds) {
      if (!currentSouls[id]) {
        window.jam.team.soul.get(id).then((result) => {
          if (result) useAppStore.getState().setSoul(id, result as unknown as SoulEntry);
        });
      }
    }
  }, [agentIds]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500">
        Loading team data...
      </div>
    );
  }

  const agentList = Object.values(agents).map((a) => ({
    id: a.profile.id,
    name: a.profile.name,
    color: a.profile.color,
    status: a.status,
    role: souls[a.profile.id]?.role ?? undefined,
  }));

  return (
    <div className="space-y-6">
      <TeamOverview
        agents={agentList}
        stats={stats}
        onSelectAgent={onSelectAgent}
      />

      {agentList.length > 1 && (
        <div className="bg-zinc-800/50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">
            Relationship Graph
          </h3>
          <div className="flex justify-center">
            <RelationshipGraph
              agents={agentList}
              relationships={relationships}
              onSelectAgent={onSelectAgent}
            />
          </div>
        </div>
      )}
    </div>
  );
}
