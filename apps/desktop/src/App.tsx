import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { AppShell } from '@/components/layout/AppShell';
import { HeaderBar } from '@/components/layout/TitleBar';
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
import { UpdateBanner } from '@/components/UpdateBanner';
import { ThreadDrawer } from '@/components/chat/ThreadDrawer';
import { LogsDrawer } from '@/components/LogsDrawer';
import { useTTSQueue } from '@/hooks/useTTSQueue';
import { useIPCSubscriptions } from '@/hooks/useIPCSubscriptions';
import { NotificationPanel } from '@/components/NotificationPanel';
import { NotificationToast } from '@/components/common/NotificationToast';
import { SandboxLoadingOverlay } from '@/components/SandboxLoadingOverlay';

// Named selector — returns primitive (number). No array allocation.
// Zustand's Object.is comparison prevents re-renders unless count changes.
const selectUnreadCount = (s: ReturnType<typeof useAppStore.getState>) => {
  let count = 0;
  for (const n of s.notifications) if (!n.read) count++;
  return count;
};

// Select unread error/warning/info notifications for toast display (max 3)
const selectToastNotifications = (s: ReturnType<typeof useAppStore.getState>) => {
  const toasts: Array<{ id: string; level: 'info' | 'warning' | 'error'; title: string; body?: string }> = [];
  for (const n of s.notifications) {
    if (n.read) continue;
    if (n.type === 'error' || n.type === 'warning' || n.type === 'info') {
      toasts.push({
        id: n.id,
        level: n.type,
        title: n.title,
        body: n.summary || undefined,
      });
    }
    if (toasts.length >= 3) break;
  }
  return toasts;
};

export default function App() {
  const navExpanded = useAppStore((s) => s.navExpanded);
  const setNavExpanded = useAppStore((s) => s.setNavExpanded);
  const logsDrawerOpen = useAppStore((s) => s.logsDrawerOpen);
  const setLogsDrawerOpen = useAppStore((s) => s.setLogsDrawerOpen);
  const viewMode = useAppStore((s) => s.viewMode);
  const threadAgentId = useAppStore((s) => s.threadAgentId);
  const setThreadAgent = useAppStore((s) => s.setThreadAgent);
  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [notificationOpen, setNotificationOpen] = useState(false);
  const unreadCount = useAppStore(selectUnreadCount);
  const voiceState = useAppStore((s) => s.voiceState);
  const sandboxStatus = useAppStore((s) => s.sandboxStatus);
  const sandboxMessage = useAppStore((s) => s.sandboxMessage);
  const toastNotifications = useAppStore(useShallow(selectToastNotifications));
  const markNotificationRead = useAppStore((s) => s.markNotificationRead);

  // Narrow selector — only extracts what HeaderBar needs, shallow-compared
  const headerAgents = useAppStore(
    useShallow((s) => {
      const result: Array<{ id: string; name: string; color: string; visualState: string }> = [];
      for (const id in s.agents) {
        const a = s.agents[id];
        if (!a.profile.isSystem && (a.status === 'running' || a.status === 'starting')) {
          result.push({ id: a.profile.id, name: a.profile.name, color: a.profile.color, visualState: a.visualState });
        }
      }
      return result;
    }),
  );

  // Onboarding gate
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    window.jam.setup.getOnboardingStatus().then((complete) => {
      setShowOnboarding(!complete);
      setOnboardingChecked(true);
    });
  }, []);

  // Remove HTML splash once React is mounted
  useEffect(() => {
    const splash = document.getElementById('splash');
    if (splash) splash.remove();
  }, []);

  // TTS audio queue (sequential playback, interrupt support)
  const { enqueueTTS } = useTTSQueue();

  // IPC event subscriptions (agents, terminal, voice, chat, errors)
  useIPCSubscriptions(enqueueTTS);

  // Resize the Electron window when entering/leaving compact mode
  useEffect(() => {
    window.jam.window.setCompact(viewMode === 'compact');
  }, [viewMode]);

  // Stable callbacks — read current state imperatively so deps are only stable setters
  const toggleNotifications = useCallback(() => setNotificationOpen((v) => !v), []);
  const toggleLogs = useCallback(() => setLogsDrawerOpen(!useAppStore.getState().logsDrawerOpen), [setLogsDrawerOpen]);
  const toggleNav = useCallback(() => setNavExpanded(!useAppStore.getState().navExpanded), [setNavExpanded]);
  const closeThread = useCallback(() => setThreadAgent(null), [setThreadAgent]);

  // Auto-dismiss info/warning toasts after 5 seconds (errors persist)
  useEffect(() => {
    const infos = toastNotifications.filter((n) => n.level !== 'error');
    if (infos.length === 0) return;
    const timer = setTimeout(() => {
      for (const n of infos) markNotificationRead(n.id);
    }, 5000);
    return () => clearTimeout(timer);
  }, [toastNotifications, markNotificationRead]);

  // Show loading overlay while sandbox is initializing (image build / container startup)
  const sandboxLoading = sandboxStatus === 'building-image' || sandboxStatus === 'starting-containers';
  if (!onboardingChecked || sandboxLoading) {
    return <SandboxLoadingOverlay status={sandboxLoading ? sandboxStatus : 'building-image'} message={sandboxLoading ? sandboxMessage : 'Loading...'} />;
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
      <HeaderBar
        agents={headerAgents}
        voiceState={voiceState}
        notificationCount={unreadCount}
        notificationOpen={notificationOpen}
        logsOpen={logsDrawerOpen}
        onToggleNotifications={toggleNotifications}
        onToggleLogs={toggleLogs}
      />

      <div className="flex flex-1 min-h-0">
        <IconRail
          expanded={navExpanded}
          activeTab={activeTab}
          onToggleExpanded={toggleNav}
          onTabChange={setActiveTab}
        />

        {notificationOpen && (
          <NotificationPanel onClose={() => setNotificationOpen(false)} />
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <UpdateBanner />
          <SetupBanner onOpenSettings={() => setActiveTab('settings')} />
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              {renderMainContent()}
            </div>

            {/* Thread drawer — right-side terminal panel (priority over logs) */}
            {threadAgentId && (
              <ThreadDrawer
                agentId={threadAgentId}
                onClose={closeThread}
              />
            )}

            {/* Logs drawer — right-side log panel */}
            {logsDrawerOpen && !threadAgentId && (
              <LogsDrawer onClose={() => setLogsDrawerOpen(false)} />
            )}
          </div>
          <CommandBarContainer />
        </div>
      </div>

      {/* Toast notifications for errors/warnings/info */}
      <NotificationToast
        notifications={toastNotifications}
        onDismiss={markNotificationRead}
      />
    </AppShell>
  );
}
