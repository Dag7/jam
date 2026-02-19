import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store';
import { AppShell } from '@/components/layout/AppShell';
import { Sidebar, type SidebarTab } from '@/components/layout/Sidebar';
import { AgentPanelContainer } from '@/containers/AgentPanelContainer';
import { AgentStageContainer } from '@/containers/AgentStageContainer';
import { ChatContainer } from '@/containers/ChatContainer';
import { CommandBarContainer } from '@/containers/CommandBarContainer';
import { SettingsContainer } from '@/containers/SettingsContainer';
import { LogsContainer } from '@/containers/LogsContainer';
import { CompactViewContainer } from '@/containers/CompactViewContainer';
import type { AgentEntry } from '@/store/agentSlice';
import type { ChatMessage } from '@/store/chatSlice';

// --- TTS Audio Queue ---
// Prevents agents from talking over each other by playing responses sequentially.
// Supports interruption via custom 'jam:interrupt-tts' DOM event (fired when user starts speaking).
const ttsQueue: string[] = [];
let ttsPlaying = false;
let currentAudio: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;

function enqueueTTSAudio(audioData: string) {
  ttsQueue.push(audioData);
  if (!ttsPlaying) playNextTTS();
}

/** Stop current playback and discard all queued TTS audio */
function interruptTTS() {
  ttsQueue.length = 0;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio = null;
  }
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  ttsPlaying = false;
  useAppStore.getState().setVoiceState('idle');
  // Notify main process that TTS stopped — unblocks voice input
  window.jam.voice.notifyTTSState(false);
}

// Listen for interrupt signal from useVoice (user started speaking)
window.addEventListener('jam:interrupt-tts', interruptTTS);

function playNextTTS() {
  if (ttsQueue.length === 0) {
    ttsPlaying = false;
    currentAudio = null;
    currentBlobUrl = null;
    useAppStore.getState().setVoiceState('idle');
    // Notify main process TTS finished — unblocks voice input
    window.jam.voice.notifyTTSState(false);
    return;
  }

  ttsPlaying = true;
  const audioData = ttsQueue.shift()!;

  try {
    const match = audioData.match(/^data:([^;]+);base64,(.+)$/);
    let audioSrc: string;

    if (match) {
      const mimeType = match[1];
      const base64Data = match[2];
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      currentBlobUrl = URL.createObjectURL(blob);
      audioSrc = currentBlobUrl;
    } else {
      currentBlobUrl = null;
      audioSrc = audioData;
    }

    const audio = new Audio(audioSrc);
    currentAudio = audio;
    useAppStore.getState().setVoiceState('speaking');
    // Notify main process TTS is playing — suppresses mic feedback
    window.jam.voice.notifyTTSState(true);

    audio.play().catch((err) => {
      console.error('[TTS] Failed to play audio:', err);
      if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
      currentAudio = null;
      playNextTTS();
    });

    audio.onended = () => {
      if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
      currentAudio = null;
      playNextTTS();
    };

    audio.onerror = (err) => {
      console.error('[TTS] Audio error:', err);
      if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
      currentAudio = null;
      playNextTTS();
    };
  } catch (err) {
    console.error('[TTS] Audio setup error:', err);
    currentAudio = null;
    currentBlobUrl = null;
    playNextTTS();
  }
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sidebarCollapsed = useAppStore((s) => s.settings.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const viewMode = useAppStore((s) => s.settings.viewMode);
  const [activeTab, setActiveTab] = useState<SidebarTab>('agents');
  const setAgents = useAppStore((s) => s.setAgents);
  const addAgent = useAppStore((s) => s.addAgent);
  const removeAgent = useAppStore((s) => s.removeAgent);
  const updateAgentStatus = useAppStore((s) => s.updateAgentStatus);
  const updateAgentVisualState = useAppStore((s) => s.updateAgentVisualState);
  const appendTerminalData = useAppStore((s) => s.appendTerminalData);
  const setTranscript = useAppStore((s) => s.setTranscript);
  const setAgentActive = useAppStore((s) => s.setAgentActive);
  const addMessage = useAppStore((s) => s.addMessage);

  // Initialize: load agents from main process and set up event listeners
  useEffect(() => {
    // Load initial agent list, then load conversation history
    window.jam.agents.list().then((agents) => {
      setAgents(agents as AgentEntry[]);
      // Mark running agents as active
      for (const agent of agents) {
        if (agent.status === 'running') {
          setAgentActive(agent.profile.id as string, true);
        }
      }

      // Load conversation history from JSONL files (runs regardless of viewMode)
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
              source: 'voice' as const,
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

    const unsubVisualState = window.jam.agents.onVisualStateChange(
      ({ agentId, visualState }) => {
        updateAgentVisualState(agentId, visualState as AgentEntry['visualState']);
      },
    );

    // Terminal data — needed for stage view
    const unsubTerminalData = window.jam.terminal.onData(
      ({ agentId, output }) => {
        appendTerminalData(agentId, output);
      },
    );

    const unsubTranscription = window.jam.voice.onTranscription(
      ({ text, isFinal }) => {
        setTranscript({ text, isFinal });
        if (isFinal) {
          // Clear transcript after a short delay
          setTimeout(() => setTranscript(null), 2000);
        }
      },
    );

    // Sync voice state from main process (fixes stuck "processing" mic)
    const unsubVoiceState = window.jam.voice.onStateChange(
      ({ state }) => {
        const s = state as 'idle' | 'capturing' | 'processing' | 'speaking';
        useAppStore.getState().setVoiceState(s);
      },
    );

    // TTS audio playback — queue responses so agents don't talk over each other
    const unsubTTSAudio = window.jam.voice.onTTSAudio(
      ({ audioData }) => {
        if (!audioData) return;
        enqueueTTSAudio(audioData);
      },
    );

    // Chat: agent acknowledged — immediate feedback before execute() starts
    const unsubAcknowledged = window.jam.chat.onAgentAcknowledged(
      ({ agentId, agentName, agentRuntime, agentColor, ackText }) => {
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
        useAppStore.getState().addMessage(msg);
      },
    );

    // Chat: voice command user messages (from main process voice handler)
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

    // Chat: agent responses from voice commands (async via event, not invoke return)
    const unsubAgentResponse = window.jam.chat.onAgentResponse(
      ({ agentId, agentName, agentRuntime, agentColor, text }) => {
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          agentId,
          agentName,
          agentRuntime,
          agentColor,
          content: text,
          status: 'complete',
          source: 'voice',
          timestamp: Date.now(),
        };
        useAppStore.getState().addMessage(msg);
      },
    );

    // Chat: progress updates during long-running tasks
    const unsubProgress = window.jam.chat.onAgentProgress(
      ({ agentId, agentName, agentRuntime, agentColor, summary }) => {
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

    return () => {
      unsubStatusChange();
      unsubCreated();
      unsubDeleted();
      unsubVisualState();
      unsubTerminalData();
      unsubTranscription();
      unsubVoiceState();
      unsubTTSAudio();
      unsubAcknowledged();
      unsubVoiceCommand();
      unsubAgentResponse();
      unsubProgress();
      // Stop any playing audio on cleanup
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [
    setAgents,
    addAgent,
    removeAgent,
    updateAgentStatus,
    updateAgentVisualState,
    appendTerminalData,
    setTranscript,
    setAgentActive,
    addMessage,
  ]);

  // Resize the Electron window when entering/leaving compact mode
  useEffect(() => {
    window.jam.window.setCompact(viewMode === 'compact');
  }, [viewMode]);

  const renderPanel = () => {
    switch (activeTab) {
      case 'agents':
        return <AgentPanelContainer />;
      case 'settings':
        return <SettingsContainer onClose={() => setActiveTab('agents')} />;
      case 'logs':
        return <LogsContainer />;
    }
  };

  if (viewMode === 'compact') {
    return (
      <AppShell>
        <CompactViewContainer />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Sidebar
        collapsed={sidebarCollapsed}
        activeTab={activeTab}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onTabChange={setActiveTab}
      >
        {renderPanel()}
      </Sidebar>

      <div className="flex-1 flex flex-col min-w-0">
        {viewMode === 'chat' ? <ChatContainer /> : <AgentStageContainer />}
        <CommandBarContainer />
      </div>
    </AppShell>
  );
}
