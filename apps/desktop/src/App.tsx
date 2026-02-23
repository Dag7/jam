import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import { AppShell } from '@/components/layout/AppShell';
import { Sidebar, type SidebarTab } from '@/components/layout/Sidebar';
import { AgentPanelContainer } from '@/containers/AgentPanelContainer';
import { AgentStageContainer } from '@/containers/AgentStageContainer';
import { ChatContainer } from '@/containers/ChatContainer';
import { CommandBarContainer } from '@/containers/CommandBarContainer';
import { SettingsContainer } from '@/containers/SettingsContainer';
import { LogsContainer } from '@/containers/LogsContainer';
import { DashboardContainer } from '@/containers/dashboard/DashboardContainer';
import { CompactViewContainer } from '@/containers/CompactViewContainer';
import { OnboardingContainer } from '@/containers/OnboardingContainer';
import { SetupBanner } from '@/components/SetupBanner';
import { ThreadDrawer } from '@/components/chat/ThreadDrawer';
import { ServiceBar } from '@/components/ServiceBar';
import { useTTSQueue } from '@/hooks/useTTSQueue';
import { useIPCSubscriptions } from '@/hooks/useIPCSubscriptions';

export default function App() {
  const sidebarCollapsed = useAppStore((s) => s.settings.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const viewMode = useAppStore((s) => s.settings.viewMode);
  const threadAgentId = useAppStore((s) => s.threadAgentId);
  const setThreadAgent = useAppStore((s) => s.setThreadAgent);
  const [activeTab, setActiveTab] = useState<SidebarTab>('agents');

  // Onboarding gate
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    window.jam.setup.getOnboardingStatus().then((complete) => {
      setShowOnboarding(!complete);
      setOnboardingChecked(true);
    });
  }, []);

  // TTS audio queue (sequential playback, interrupt support)
  const { enqueueTTS } = useTTSQueue();

  // IPC event subscriptions (agents, terminal, voice, chat, errors)
  useIPCSubscriptions(enqueueTTS);

  // Resize the Electron window when entering/leaving compact mode
  useEffect(() => {
    window.jam.window.setCompact(viewMode === 'compact');
  }, [viewMode]);

  // Show nothing until onboarding check completes
  if (!onboardingChecked) {
    return <div className="h-screen bg-zinc-950" />;
  }

  // Show onboarding wizard for first-time users
  if (showOnboarding) {
    return <OnboardingContainer onComplete={() => setShowOnboarding(false)} />;
  }

  const renderPanel = () => {
    switch (activeTab) {
      case 'agents':
        return <AgentPanelContainer />;
      case 'dashboard':
        return <DashboardContainer />;
      case 'settings':
        return (
          <SettingsContainer
            onClose={() => setActiveTab('agents')}
            onRerunSetup={() => setShowOnboarding(true)}
          />
        );
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
        <SetupBanner onOpenSettings={() => setActiveTab('settings')} />
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            {viewMode === 'chat' ? <ChatContainer /> : <AgentStageContainer />}
          </div>

          {/* Thread drawer — right-side terminal panel */}
          {threadAgentId && (
            <ThreadDrawer
              agentId={threadAgentId}
              onClose={() => setThreadAgent(null)}
            />
          )}
        </div>
        <ServiceBar />
        <CommandBarContainer />
      </div>
    </AppShell>
  );
}
