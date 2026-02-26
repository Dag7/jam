import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import type { StatsEntry, RelationshipEntry } from '@/store/teamSlice';

export function useTeamStats() {
  const stats = useAppStore((s) => s.stats);
  const relationships = useAppStore((s) => s.relationships);
  // Only re-run when agent IDs change, not when any agent property changes
  const agentIds = useAppStore(
    (s) => Object.keys(s.agents),
    (a, b) => a.length === b.length && a.every((id, i) => id === b[i]),
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const store = () => useAppStore.getState();

    const fetchAll = async () => {
      const allRels: RelationshipEntry[] = [];

      await Promise.all(
        agentIds.map(async (id) => {
          const agentStats = await window.jam.team.stats.get(id);
          if (agentStats) {
            store().setStats(id, agentStats as unknown as StatsEntry);
          }

          const rels = await window.jam.team.relationships.getAll(id);
          allRels.push(...(rels as unknown as RelationshipEntry[]));
        }),
      );

      store().setRelationships(allRels);
      setIsLoading(false);
    };

    fetchAll();

    const cleanupStats = window.jam.team.stats.onUpdated((data) => {
      store().setStats(data.agentId, data.stats as unknown as StatsEntry);
    });
    const cleanupTrust = window.jam.team.relationships.onTrustUpdated((data) => {
      store().addRelationship(data.relationship as unknown as RelationshipEntry);
    });

    return () => {
      cleanupStats();
      cleanupTrust();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentIds]);

  return {
    stats,
    relationships,
    getAgentStats: (agentId: string) => stats[agentId] ?? null,
    getRelationshipsFor: (agentId: string) =>
      relationships.filter(
        (r) => r.sourceAgentId === agentId || r.targetAgentId === agentId,
      ),
    isLoading,
  };
}
