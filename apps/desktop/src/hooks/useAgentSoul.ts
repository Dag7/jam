import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store';
import type { SoulEntry } from '@/store/teamSlice';

export function useAgentSoul(agentId: string) {
  const soul = useAppStore((s) => s.souls[agentId]);
  const setSoul = useAppStore((s) => s.setSoul);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!agentId) return;

    window.jam.team.soul.get(agentId).then((result) => {
      setSoul(agentId, result as unknown as SoulEntry);
      setIsLoading(false);
    });

    const cleanup = window.jam.team.soul.onEvolved((data) => {
      if (data.agentId === agentId) {
        setSoul(agentId, data.soul as unknown as SoulEntry);
      }
    });

    return cleanup;
  }, [agentId, setSoul]);

  const triggerReflection = useCallback(async () => {
    return window.jam.team.soul.evolve(agentId);
  }, [agentId]);

  return {
    soul: soul ?? null,
    isLoading,
    triggerReflection,
  };
}
