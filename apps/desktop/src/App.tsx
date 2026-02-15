import { useEffect } from 'react';
import { useAppStore } from '@/store';
import { AppShell } from '@/components/layout/AppShell';
import { Sidebar } from '@/components/layout/Sidebar';
import { AgentPanelContainer } from '@/containers/AgentPanelContainer';
import { AgentStageContainer } from '@/containers/AgentStageContainer';
import { CommandBarContainer } from '@/containers/CommandBarContainer';
import type { AgentEntry } from '@/store/agentSlice';

export default function App() {
  const sidebarCollapsed = useAppStore((s) => s.settings.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const setAgents = useAppStore((s) => s.setAgents);
  const addAgent = useAppStore((s) => s.addAgent);
  const removeAgent = useAppStore((s) => s.removeAgent);
  const updateAgentStatus = useAppStore((s) => s.updateAgentStatus);
  const updateAgentVisualState = useAppStore((s) => s.updateAgentVisualState);
  const appendTerminalData = useAppStore((s) => s.appendTerminalData);
  const setTranscript = useAppStore((s) => s.setTranscript);
  const setAgentActive = useAppStore((s) => s.setAgentActive);

  // Initialize: load agents from main process and set up event listeners
  useEffect(() => {
    // Load initial agent list
    window.jam.agents.list().then((agents) => {
      setAgents(agents as AgentEntry[]);
      // Mark running agents as active
      for (const agent of agents) {
        if (agent.status === 'running') {
          setAgentActive(agent.profile.id as string, true);
        }
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

    return () => {
      unsubStatusChange();
      unsubCreated();
      unsubDeleted();
      unsubVisualState();
      unsubTerminalData();
      unsubTranscription();
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
  ]);

  return (
    <AppShell>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        <AgentPanelContainer />
      </Sidebar>

      <div className="flex-1 flex flex-col min-w-0">
        <AgentStageContainer />
        <CommandBarContainer />
      </div>
    </AppShell>
  );
}
