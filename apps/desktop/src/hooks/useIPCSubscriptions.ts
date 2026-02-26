import { useEffect } from 'react';
import { useAppStore } from '@/store';
import type { AgentEntry } from '@/store/agentSlice';
import type { ChatMessage } from '@/store/chatSlice';
import type { SoulEntry } from '@/store/teamSlice';

/**
 * Subscribes to all IPC events from the main process and dispatches to Zustand store.
 * Extracted from App.tsx to keep it a pure layout component.
 *
 * Uses `useAppStore.getState()` inside callbacks to avoid dependency on store action
 * references — prevents re-subscription loops that cause 100% CPU.
 */
export function useIPCSubscriptions(enqueueTTS: (data: string) => void): void {
  useEffect(() => {
    const store = () => useAppStore.getState();

    // Load initial agent list, then load conversation history
    window.jam.agents.list().then((agents) => {
      store().setAgents(agents as AgentEntry[]);
      for (const agent of agents) {
        if (agent.status === 'running') {
          store().setAgentActive(agent.profile.id as string, true);
        }
      }

      const s = store();
      if (!s.historyLoaded) {
        s.setIsLoadingHistory(true);
        window.jam.chat.loadHistory({ limit: 50 }).then((result) => {
          if (result.messages.length > 0) {
            const chatMessages: ChatMessage[] = result.messages.map((m, i) => ({
              id: `history-${m.timestamp}-${m.agentId}-${m.role}-${i}`,
              role: m.role === 'user' ? 'user' as const : 'agent' as const,
              agentId: m.agentId,
              agentName: m.agentName,
              agentRuntime: m.agentRuntime,
              agentColor: m.agentColor,
              content: m.content,
              status: 'complete' as const,
              source: (m.source ?? 'voice') as 'text' | 'voice',
              timestamp: new Date(m.timestamp).getTime(),
            }));
            store().prependMessages(chatMessages);
          }
          store().setHasMoreHistory(result.hasMore);
          store().setIsLoadingHistory(false);
          store().setHistoryLoaded(true);
        }).catch(() => {
          store().setIsLoadingHistory(false);
          store().setHistoryLoaded(true);
        });
      }
    });

    // Subscribe to events from main process
    const unsubStatusChange = window.jam.agents.onStatusChange(
      ({ agentId, status }) => {
        store().updateAgentStatus(agentId, status);
        if (status === 'running' || status === 'starting') {
          store().setAgentActive(agentId, true);
        } else if (status === 'stopped' || status === 'error') {
          store().setAgentActive(agentId, false);
        }
      },
    );

    const unsubCreated = window.jam.agents.onCreated(({ profile }) => {
      store().addAgent({
        profile: profile as AgentEntry['profile'],
        status: 'stopped',
        visualState: 'offline',
      });
    });

    const unsubDeleted = window.jam.agents.onDeleted(({ agentId }) => {
      store().removeAgent(agentId);
    });

    const unsubUpdated = window.jam.agents.onUpdated(({ agentId, profile }) => {
      store().updateAgentProfile(agentId, profile as AgentEntry['profile']);
    });

    const unsubVisualState = window.jam.agents.onVisualStateChange(
      ({ agentId, visualState }) => {
        store().updateAgentVisualState(agentId, visualState as AgentEntry['visualState']);
      },
    );

    const unsubTerminalData = window.jam.terminal.onData(
      ({ agentId, output }) => {
        store().appendTerminalData(agentId, output);
      },
    );

    const unsubExecuteOutput = window.jam.terminal.onExecuteOutput(
      ({ agentId, output, clear }) => {
        store().appendExecuteOutput(agentId, output, clear);
      },
    );

    const unsubTranscription = window.jam.voice.onTranscription(
      ({ text, isFinal }) => {
        store().setTranscript({ text, isFinal });
        if (isFinal) {
          setTimeout(() => store().setTranscript(null), 2000);
        }
      },
    );

    const unsubVoiceState = window.jam.voice.onStateChange(
      ({ state }) => {
        const s = state as 'idle' | 'capturing' | 'processing' | 'speaking';
        store().setVoiceState(s);
      },
    );

    const unsubTTSAudio = window.jam.voice.onTTSAudio(
      ({ audioData }) => {
        if (!audioData) return;
        enqueueTTS(audioData);
      },
    );

    const unsubAcknowledged = window.jam.chat.onAgentAcknowledged(
      ({ agentId, agentName, agentRuntime, agentColor, ackText }) => {
        // Suppress ack messages from system agents — they use system notifications instead
        const agentEntry = store().agents[agentId];
        if (agentEntry?.profile.isSystem) return;

        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          agentId,
          agentName: agentName || null,
          agentRuntime: agentRuntime || null,
          agentColor: agentColor || null,
          content: ackText,
          status: 'complete',
          source: 'text',
          timestamp: Date.now(),
        };
        store().addMessage(msg);
        store().setIsProcessing(true, agentId);
      },
    );

    const unsubVoiceCommand = window.jam.chat.onVoiceCommand(
      ({ text, agentId, agentName }) => {
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          agentId,
          agentName: agentName || null,
          agentRuntime: null,
          agentColor: null,
          content: text,
          status: 'complete',
          source: 'voice',
          timestamp: Date.now(),
        };
        store().addMessage(msg);
      },
    );

    const unsubAgentResponse = window.jam.chat.onAgentResponse(
      ({ agentId, agentName, agentRuntime, agentColor, text, error }) => {
        // Suppress response messages from system agents — they use system notifications
        const agentEntry = store().agents[agentId];
        if (agentEntry?.profile.isSystem) return;

        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          agentId,
          agentName: agentName || null,
          agentRuntime: agentRuntime || null,
          agentColor: agentColor || null,
          content: text,
          status: error ? 'error' : 'complete',
          source: 'voice',
          timestamp: Date.now(),
          error,
        };
        store().addMessage(msg);
      },
    );

    const unsubAppError = window.jam.app.onError(({ message, details }) => {
      const errorText = details ? `${message}: ${details}` : message;
      store().addMessage({
        id: crypto.randomUUID(),
        role: 'agent',
        agentId: null,
        agentName: 'System',
        agentRuntime: null,
        agentColor: '#ef4444',
        content: errorText,
        status: 'error',
        source: 'text',
        timestamp: Date.now(),
        error: errorText,
      });
    });

    const unsubProgress = window.jam.chat.onAgentProgress(
      ({ agentId, agentName, agentRuntime, agentColor, summary }) => {
        // Suppress progress messages from system agents
        const agentEntry = store().agents[agentId];
        if (agentEntry?.profile.isSystem) return;

        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'system',
          agentId,
          agentName: agentName || null,
          agentRuntime: agentRuntime || null,
          agentColor: agentColor || null,
          content: `${agentName || 'Agent'}: ${summary}`,
          status: 'complete',
          source: 'voice',
          timestamp: Date.now(),
        };
        store().addMessage(msg);
      },
    );

    const unsubQueued = window.jam.chat.onMessageQueued(
      ({ agentName, queuePosition }) => {
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'system',
          agentId: null,
          agentName: null,
          agentRuntime: null,
          agentColor: null,
          content: `${agentName || 'Agent'} is busy — your message is queued (#${queuePosition}). It will run when the current task finishes.`,
          status: 'complete',
          source: 'text',
          timestamp: Date.now(),
        };
        store().addMessage(msg);
      },
    );

    const unsubSystemNotification = window.jam.chat.onSystemNotification(
      ({ taskId, agentId, title, success, summary }) => {
        const s = store();
        s.addNotification({
          id: crypto.randomUUID(),
          type: success ? 'task_completed' : 'task_failed',
          agentId,
          title,
          summary: summary ?? '',
          taskId,
          timestamp: Date.now(),
          read: false,
        });
        s.setIsProcessing(false);
      },
    );

    // Sandbox initialization progress
    const unsubSandboxProgress = window.jam.app.onSandboxProgress(
      ({ status, message }) => {
        store().setSandboxProgress(status as Parameters<ReturnType<typeof useAppStore.getState>['setSandboxProgress']>[0], message);
      },
    );

    // Soul evolved — global listener (clear reflecting state even when not viewing agent detail)
    const unsubSoulEvolved = window.jam.team.soul.onEvolved((data) => {
      store().setSoul(data.agentId, data.soul as unknown as SoulEntry);
      store().setReflecting(data.agentId, false);
    });

    // NOTE: Task, stats, relationship, and channel subscriptions are owned by
    // their dedicated hooks (useTasks, useTeamStats, useChannels) — not here.
    // This prevents double-handling IPC events.

    return () => {
      unsubStatusChange();
      unsubCreated();
      unsubDeleted();
      unsubUpdated();
      unsubVisualState();
      unsubTerminalData();
      unsubExecuteOutput();
      unsubTranscription();
      unsubVoiceState();
      unsubTTSAudio();
      unsubAcknowledged();
      unsubVoiceCommand();
      unsubAgentResponse();
      unsubAppError();
      unsubProgress();
      unsubQueued();
      unsubSystemNotification();
      unsubSandboxProgress();
      unsubSoulEvolved();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enqueueTTS]);
}
