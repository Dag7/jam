import { useCallback } from 'react';
import { useAppStore } from '@/store';
import type { ChatMessage } from '@/store/chatSlice';

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

  const updateAgent = useCallback(async (agentId: string, updates: Record<string, unknown>) => {
    return window.jam.agents.update(agentId, updates);
  }, []);

  const sendTextCommand = useCallback(async (text: string) => {
    const { addMessage, updateMessage, setIsProcessing } = useAppStore.getState();

    // Add user message to chat
    const userMsgId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      agentId: null,
      agentName: null,
      agentRuntime: null,
      agentColor: null,
      content: text,
      status: 'complete',
      source: 'text',
      timestamp: Date.now(),
    };
    addMessage(userMsg);

    // Add placeholder agent response
    const agentMsgId = crypto.randomUUID();
    const agentMsg: ChatMessage = {
      id: agentMsgId,
      role: 'agent',
      agentId: null,
      agentName: null,
      agentRuntime: null,
      agentColor: null,
      content: '',
      status: 'sending',
      source: 'text',
      timestamp: Date.now(),
    };
    addMessage(agentMsg);

    setIsProcessing(true);

    try {
      const result = await window.jam.chat.sendCommand(text);

      if (result.success) {
        updateMessage(agentMsgId, {
          agentId: result.agentId ?? null,
          agentName: result.agentName ?? null,
          agentRuntime: result.agentRuntime ?? null,
          agentColor: result.agentColor ?? null,
          content: result.text ?? '',
          status: 'complete',
        });
      } else {
        updateMessage(agentMsgId, {
          content: result.error ?? 'Command failed',
          status: 'error',
          error: result.error,
        });
      }
    } catch (err) {
      updateMessage(agentMsgId, {
        content: String(err),
        status: 'error',
        error: String(err),
      });
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const clearChat = useCallback(() => {
    useAppStore.getState().clearMessages();
  }, []);

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
    updateAgent,
    startAgent,
    stopAgent,
    deleteAgent,
    sendTextCommand,
    clearChat,
    selectAgent,
  };
}
