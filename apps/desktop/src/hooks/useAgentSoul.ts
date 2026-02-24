import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store';
import type { SoulEntry } from '@/store/teamSlice';

export function useAgentSoul(agentId: string) {
  const soul = useAppStore((s) => s.souls[agentId]);
  const setSoul = useAppStore((s) => s.setSoul);
  const isReflecting = useAppStore((s) => s.reflectingAgents.has(agentId));
  const setReflecting = useAppStore((s) => s.setReflecting);
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
        setReflecting(agentId, false);
      }
    });

    return cleanup;
  }, [agentId, setSoul, setReflecting]);

  const triggerReflection = useCallback(async () => {
    setReflecting(agentId, true);
    try {
      const result = await window.jam.team.soul.evolve(agentId);
      if (!result.success) setReflecting(agentId, false);
      return result;
    } catch {
      setReflecting(agentId, false);
    }
  }, [agentId, setReflecting]);

  return {
    soul: soul ?? null,
    isLoading,
    isReflecting,
    triggerReflection,
  };
}
