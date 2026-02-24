import { useEffect } from 'react';
import { useAppStore } from '@/store';
import type { AgentEntry } from '@/store/agentSlice';
import type { ChatMessage } from '@/store/chatSlice';
import type { TaskEntry } from '@/store/taskSlice';
import type { StatsEntry, RelationshipEntry, SoulEntry, ChannelEntry, ChannelMessageEntry } from '@/store/teamSlice';

/**
 * Subscribes to all IPC events from the main process and dispatches to Zustand store.
 * Extracted from App.tsx to keep it a pure layout component.
 */
export function useIPCSubscriptions(enqueueTTS: (data: string) => void): void {
  const setAgents = useAppStore((s) => s.setAgents);
  const addAgent = useAppStore((s) => s.addAgent);
  const removeAgent = useAppStore((s) => s.removeAgent);
  const updateAgentStatus = useAppStore((s) => s.updateAgentStatus);
  const updateAgentProfile = useAppStore((s) => s.updateAgentProfile);
  const updateAgentVisualState = useAppStore((s) => s.updateAgentVisualState);
  const appendTerminalData = useAppStore((s) => s.appendTerminalData);
  const appendExecuteOutput = useAppStore((s) => s.appendExecuteOutput);
  const setTranscript = useAppStore((s) => s.setTranscript);
  const setAgentActive = useAppStore((s) => s.setAgentActive);
  const addMessage = useAppStore((s) => s.addMessage);

  // Team system store actions
  const addTask = useAppStore((s) => s.addTask);
  const updateTask = useAppStore((s) => s.updateTask);
  const setStats = useAppStore((s) => s.setStats);
  const addRelationship = useAppStore((s) => s.addRelationship);
  const setSoul = useAppStore((s) => s.setSoul);
  const setChannels = useAppStore((s) => s.setChannels);
  const addChannelMessage = useAppStore((s) => s.addChannelMessage);

  useEffect(() => {
    // Load initial agent list, then load conversation history
    window.jam.agents.list().then((agents) => {
      setAgents(agents as AgentEntry[]);
      for (const agent of agents) {
        if (agent.status === 'running') {
          setAgentActive(agent.profile.id as string, true);
        }
      }

      const store = useAppStore.getState();
      if (!store.historyLoaded) {
        store.setIsLoadingHistory(true);
        window.jam.chat.loadHistory({ limit: 50 }).then((result) => {
          if (result.messages.length > 0) {
            const chatMessages: ChatMessage[] = result.messages.map((m) => ({
              id: `history-${m.timestamp}-${m.agentId}-${m.role}`,
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
            useAppStore.getState().prependMessages(chatMessages);
          }
          useAppStore.getState().setHasMoreHistory(result.hasMore);
          useAppStore.getState().setIsLoadingHistory(false);
          useAppStore.getState().setHistoryLoaded(true);
        }).catch(() => {
          useAppStore.getState().setIsLoadingHistory(false);
          useAppStore.getState().setHistoryLoaded(true);
        });
      }
    });

    // Subscribe to events from main process
    const unsubStatusChange = window.jam.agents.onStatusChange(
      ({ agentId, status }) => {
        updateAgentStatus(agentId, status);
        if (status === 'running') {
          setAgentActive(agentId, true);
        } else if (status === 'stopped' || status === 'error') {
          setAgentActive(agentId, false);
        }
      },
    );

    const unsubCreated = window.jam.agents.onCreated(({ profile }) => {
      addAgent({
        profile: profile as AgentEntry['profile'],
        status: 'stopped',
        visualState: 'offline',
      });
    });

    const unsubDeleted = window.jam.agents.onDeleted(({ agentId }) => {
      removeAgent(agentId);
    });

    const unsubUpdated = window.jam.agents.onUpdated(({ agentId, profile }) => {
      updateAgentProfile(agentId, profile as AgentEntry['profile']);
    });

    const unsubVisualState = window.jam.agents.onVisualStateChange(
      ({ agentId, visualState }) => {
        updateAgentVisualState(agentId, visualState as AgentEntry['visualState']);
      },
    );

    const unsubTerminalData = window.jam.terminal.onData(
      ({ agentId, output }) => {
        appendTerminalData(agentId, output);
      },
    );

    const unsubExecuteOutput = window.jam.terminal.onExecuteOutput(
      ({ agentId, output, clear }) => {
        appendExecuteOutput(agentId, output, clear);
      },
    );

    const unsubTranscription = window.jam.voice.onTranscription(
      ({ text, isFinal }) => {
        setTranscript({ text, isFinal });
        if (isFinal) {
          setTimeout(() => setTranscript(null), 2000);
        }
      },
    );

    const unsubVoiceState = window.jam.voice.onStateChange(
      ({ state }) => {
        const s = state as 'idle' | 'capturing' | 'processing' | 'speaking';
        useAppStore.getState().setVoiceState(s);
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
        const agentEntry = useAppStore.getState().agents[agentId];
        if (agentEntry?.profile.isSystem) return;

        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          agentId,
          agentName,
          agentRuntime,
          agentColor,
          content: ackText,
          status: 'complete',
          source: 'text',
          timestamp: Date.now(),
        };
        const store = useAppStore.getState();
        store.addMessage(msg);
        store.setIsProcessing(true, agentId);
      },
    );

    const unsubVoiceCommand = window.jam.chat.onVoiceCommand(
      ({ text, agentId, agentName }) => {
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          agentId,
          agentName,
          agentRuntime: null,
          agentColor: null,
          content: text,
          status: 'complete',
          source: 'voice',
          timestamp: Date.now(),
        };
        useAppStore.getState().addMessage(msg);
      },
    );

    const unsubAgentResponse = window.jam.chat.onAgentResponse(
      ({ agentId, agentName, agentRuntime, agentColor, text, error }) => {
        // Suppress response messages from system agents — they use system notifications
        const agentEntry = useAppStore.getState().agents[agentId];
        if (agentEntry?.profile.isSystem) return;

        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          agentId,
          agentName,
          agentRuntime,
          agentColor,
          content: text,
          status: error ? 'error' : 'complete',
          source: 'voice',
          timestamp: Date.now(),
          error,
        };
        useAppStore.getState().addMessage(msg);
      },
    );

    const unsubAppError = window.jam.app.onError(({ message, details }) => {
      const errorText = details ? `${message}: ${details}` : message;
      useAppStore.getState().addMessage({
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
        const agentEntry = useAppStore.getState().agents[agentId];
        if (agentEntry?.profile.isSystem) return;

        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'system',
          agentId,
          agentName,
          agentRuntime,
          agentColor,
          content: `${agentName}: ${summary}`,
          status: 'complete',
          source: 'voice',
          timestamp: Date.now(),
        };
        useAppStore.getState().addMessage(msg);
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
          content: `${agentName} is busy — your message is queued (#${queuePosition}). It will run when the current task finishes.`,
          status: 'complete',
          source: 'text',
          timestamp: Date.now(),
        };
        useAppStore.getState().addMessage(msg);
      },
    );

    const unsubSystemNotification = window.jam.chat.onSystemNotification(
      ({ taskId, agentId, title, success, summary }) => {
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'system',
          agentId,
          agentName: 'JAM',
          agentRuntime: null,
          agentColor: '#8b5cf6',
          content: success ? `Completed: ${title}` : `Failed: ${title}`,
          status: success ? 'complete' : 'error',
          source: 'text',
          timestamp: Date.now(),
          taskResult: { taskId, title, success, summary },
        };
        const store = useAppStore.getState();
        store.addMessage(msg);
        store.setIsProcessing(false);
      },
    );

    // --- Team system event subscriptions ---

    // Load initial team data
    window.jam.team.channels.list().then((result: unknown) => {
      setChannels(result as ChannelEntry[]);
    });

    const unsubTaskCreated = window.jam.tasks.onCreated((data) => {
      addTask(data.task as unknown as TaskEntry);
    });

    const unsubTaskUpdated = window.jam.tasks.onUpdated((data) => {
      updateTask(data.task as unknown as TaskEntry);
    });

    const unsubTaskCompleted = window.jam.tasks.onCompleted((data) => {
      updateTask(data.task as unknown as TaskEntry);
    });

    const unsubStatsUpdated = window.jam.team.stats.onUpdated((data) => {
      setStats(data.agentId, data.stats as unknown as StatsEntry);
    });

    const unsubTrustUpdated = window.jam.team.relationships.onTrustUpdated((data) => {
      addRelationship(data.relationship as unknown as RelationshipEntry);
    });

    const unsubSoulEvolved = window.jam.team.soul.onEvolved((data) => {
      setSoul(data.agentId, data.soul as unknown as SoulEntry);
      // Clear reflecting state globally (persists across tab switches)
      useAppStore.getState().setReflecting(data.agentId, false);
    });

    const unsubChannelMessage = window.jam.team.channels.onMessageReceived((data) => {
      addChannelMessage(
        (data.channel as unknown as ChannelEntry).id,
        data.message as unknown as ChannelMessageEntry,
      );
    });

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
      unsubTaskCreated();
      unsubTaskUpdated();
      unsubTaskCompleted();
      unsubStatsUpdated();
      unsubTrustUpdated();
      unsubSoulEvolved();
      unsubChannelMessage();
    };
  }, [
    setAgents,
    addAgent,
    removeAgent,
    updateAgentStatus,
    updateAgentProfile,
    updateAgentVisualState,
    appendTerminalData,
    appendExecuteOutput,
    setTranscript,
    setAgentActive,
    addMessage,
    enqueueTTS,
    addTask,
    updateTask,
    setStats,
    addRelationship,
    setSoul,
    setChannels,
    addChannelMessage,
  ]);
}
