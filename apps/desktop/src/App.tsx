import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import { AppShell } from '@/components/layout/AppShell';
import { IconRail, type NavTab } from '@/components/layout/Sidebar';
import { AgentsOverviewContainer } from '@/containers/AgentsOverviewContainer';
import { AgentStageContainer } from '@/containers/AgentStageContainer';
import { ChatContainer } from '@/containers/ChatContainer';
import { CommandBarContainer } from '@/containers/CommandBarContainer';
import { SettingsContainer } from '@/containers/SettingsContainer';
import { DashboardContainer } from '@/containers/dashboard/DashboardContainer';
import { CompactViewContainer } from '@/containers/CompactViewContainer';
import { OnboardingContainer } from '@/containers/OnboardingContainer';
import { SetupBanner } from '@/components/SetupBanner';
import { ThreadDrawer } from '@/components/chat/ThreadDrawer';
import { LogsDrawer } from '@/components/LogsDrawer';
import { ServiceBar } from '@/components/ServiceBar';
import { useTTSQueue } from '@/hooks/useTTSQueue';
import { useIPCSubscriptions } from '@/hooks/useIPCSubscriptions';

export default function App() {
  const navExpanded = useAppStore((s) => s.settings.navExpanded);
  const setNavExpanded = useAppStore((s) => s.setNavExpanded);
  const logsDrawerOpen = useAppStore((s) => s.settings.logsDrawerOpen);
  const setLogsDrawerOpen = useAppStore((s) => s.setLogsDrawerOpen);
  const viewMode = useAppStore((s) => s.settings.viewMode);
  const threadAgentId = useAppStore((s) => s.threadAgentId);
  const setThreadAgent = useAppStore((s) => s.setThreadAgent);
  const [activeTab, setActiveTab] = useState<NavTab>('chat');

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

  const renderMainContent = () => {
    switch (activeTab) {
      case 'chat':
        return viewMode === 'chat' ? <ChatContainer /> : <AgentStageContainer />;
      case 'agents':
        return <AgentsOverviewContainer />;
      case 'dashboard':
        return <DashboardContainer />;
      case 'settings':
        return (
          <SettingsContainer
            onClose={() => setActiveTab('chat')}
            onRerunSetup={() => setShowOnboarding(true)}
          />
        );
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
      <IconRail
        expanded={navExpanded}
        activeTab={activeTab}
        logsOpen={logsDrawerOpen}
        onToggleExpanded={() => setNavExpanded(!navExpanded)}
        onTabChange={setActiveTab}
        onToggleLogs={() => setLogsDrawerOpen(!logsDrawerOpen)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <SetupBanner onOpenSettings={() => setActiveTab('settings')} />
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            {renderMainContent()}
          </div>

          {/* Thread drawer — right-side terminal panel (priority over logs) */}
          {threadAgentId && (
            <ThreadDrawer
              agentId={threadAgentId}
              onClose={() => setThreadAgent(null)}
            />
          )}

          {/* Logs drawer — right-side log panel */}
          {logsDrawerOpen && !threadAgentId && (
            <LogsDrawer onClose={() => setLogsDrawerOpen(false)} />
          )}
        </div>
        <ServiceBar />
        <CommandBarContainer />
      </div>
    </AppShell>
  );
}
