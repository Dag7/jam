import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import type { StatsEntry, RelationshipEntry } from '@/store/teamSlice';

export function useTeamStats() {
  const stats = useAppStore((s) => s.stats);
  const relationships = useAppStore((s) => s.relationships);
  const setStats = useAppStore((s) => s.setStats);
  const setRelationships = useAppStore((s) => s.setRelationships);
  const addRelationship = useAppStore((s) => s.addRelationship);
  const agents = useAppStore((s) => s.agents);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Fetch stats for all agents
    const agentIds = Object.keys(agents);
    const fetchAll = async () => {
      const allRels: RelationshipEntry[] = [];

      await Promise.all(
        agentIds.map(async (id) => {
          const agentStats = await window.jam.team.stats.get(id);
          if (agentStats) {
            setStats(id, agentStats as unknown as StatsEntry);
          }

          const rels = await window.jam.team.relationships.getAll(id);
          allRels.push(...(rels as unknown as RelationshipEntry[]));
        }),
      );

      setRelationships(allRels);
      setIsLoading(false);
    };

    fetchAll();

    const cleanupStats = window.jam.team.stats.onUpdated((data) => {
      setStats(data.agentId, data.stats as unknown as StatsEntry);
    });
    const cleanupTrust = window.jam.team.relationships.onTrustUpdated((data) => {
      addRelationship(data.relationship as unknown as RelationshipEntry);
    });

    return () => {
      cleanupStats();
      cleanupTrust();
    };
  }, [agents, setStats, setRelationships, addRelationship]);

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
