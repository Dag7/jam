import { useCallback } from 'react';
import { useAppStore } from '@/store';
import type { ChatMessage } from '@/store/chatSlice';

export function useOrchestrator() {
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
    const { addMessage, setIsProcessing } = useAppStore.getState();

    // Add user message to chat
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
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

    // No placeholder needed — the agent:acknowledged event provides
    // immediate feedback (ack message + TTS) before execute() starts.
    setIsProcessing(true);

    try {
      const result = await window.jam.chat.sendCommand(text);

      // Add full agent response (ack message was already shown via event)
      if (result.success) {
        addMessage({
          id: crypto.randomUUID(),
          role: 'agent',
          agentId: result.agentId ?? null,
          agentName: result.agentName ?? null,
          agentRuntime: result.agentRuntime ?? null,
          agentColor: result.agentColor ?? null,
          content: result.text ?? '',
          status: 'complete',
          source: 'text',
          timestamp: Date.now(),
        });
      } else {
        addMessage({
          id: crypto.randomUUID(),
          role: 'agent',
          agentId: null,
          agentName: null,
          agentRuntime: null,
          agentColor: null,
          content: result.error ?? 'Command failed',
          status: 'error',
          source: 'text',
          timestamp: Date.now(),
          error: result.error,
        });
      }
    } catch (err) {
      addMessage({
        id: crypto.randomUUID(),
        role: 'agent',
        agentId: null,
        agentName: null,
        agentRuntime: null,
        agentColor: null,
        content: String(err),
        status: 'error',
        source: 'text',
        timestamp: Date.now(),
        error: String(err),
      });
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const interruptAgent = useCallback(async (agentId: string) => {
    const { addMessage, setIsProcessing } = useAppStore.getState();
    const result = await window.jam.chat.interruptAgent(agentId);
    if (result.success) {
      addMessage({
        id: crypto.randomUUID(),
        role: 'system',
        agentId: null,
        agentName: null,
        agentRuntime: null,
        agentColor: null,
        content: result.text ?? 'Task cancelled.',
        status: 'complete',
        source: 'text',
        timestamp: Date.now(),
      });
      setIsProcessing(false);
    }
    return result;
  }, []);

  const clearChat = useCallback(() => {
    useAppStore.getState().clearMessages();
  }, []);

  const selectAgent = useCallback(
    (agentId: string | null) => {
      setSelectedAgent(agentId);
    },
    [setSelectedAgent],
  );

  return {
    createAgent,
    updateAgent,
    startAgent,
    stopAgent,
    deleteAgent,
    sendTextCommand,
    interruptAgent,
    clearChat,
    selectAgent,
  };
}
