import { useCallback } from 'react';
import { useAppStore } from '@/store';

export function useOrchestrator() {
  const activeAgentIds = useAppStore((s) => s.activeAgentIds);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const setSelectedAgent = useAppStore((s) => s.setSelectedAgent);

  const createAgent = useCallback(
    async (profile: Record<string, unknown>) => {
      return window.jam.agents.create(profile);
    },
    [],
  );

  const startAgent = useCallback(async (agentId: string) => {
    const result = await window.jam.agents.start(agentId);
    if (result.success) {
      useAppStore.getState().setAgentActive(agentId, true);
    }
    return result;
  }, []);

  const stopAgent = useCallback(async (agentId: string) => {
    const result = await window.jam.agents.stop(agentId);
    if (result.success) {
      useAppStore.getState().setAgentActive(agentId, false);
    }
    return result;
  }, []);

  const deleteAgent = useCallback(async (agentId: string) => {
    return window.jam.agents.delete(agentId);
  }, []);

  const sendTextCommand = useCallback(
    (text: string) => {
      const targetId = selectedAgentId;
      if (targetId) {
        window.jam.terminal.write(targetId, text + '\n');
      }
    },
    [selectedAgentId],
  );

  const selectAgent = useCallback(
    (agentId: string) => {
      setSelectedAgent(agentId);
    },
    [setSelectedAgent],
  );

  return {
    activeAgentIds,
    selectedAgentId,
    createAgent,
    startAgent,
    stopAgent,
    deleteAgent,
    sendTextCommand,
    selectAgent,
  };
}
