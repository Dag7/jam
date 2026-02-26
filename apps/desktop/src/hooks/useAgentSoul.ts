import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store';
import type { SoulEntry } from '@/store/teamSlice';

export function useAgentSoul(agentId: string) {
  const soul = useAppStore((s) => s.souls[agentId]);
  const isReflecting = useAppStore((s) => s.reflectingAgents.has(agentId));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!agentId) return;
    const store = () => useAppStore.getState();

    window.jam.team.soul.get(agentId).then((result) => {
      store().setSoul(agentId, result as unknown as SoulEntry);
      setIsLoading(false);
    });

    const cleanup = window.jam.team.soul.onEvolved((data) => {
      if (data.agentId === agentId) {
        store().setSoul(agentId, data.soul as unknown as SoulEntry);
        store().setReflecting(agentId, false);
      }
    });

    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const triggerReflection = useCallback(async () => {
    useAppStore.getState().setReflecting(agentId, true);
    try {
      const result = await window.jam.team.soul.evolve(agentId);
      if (!result.success) useAppStore.getState().setReflecting(agentId, false);
      return result;
    } catch {
      useAppStore.getState().setReflecting(agentId, false);
    }
  }, [agentId]);

  return {
    soul: soul ?? null,
    isLoading,
    isReflecting,
    triggerReflection,
  };
}
