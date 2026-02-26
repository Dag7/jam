import { createWithEqualityFn } from 'zustand/traditional';
import { shallow } from 'zustand/shallow';
import { persist } from 'zustand/middleware';
import { createAgentSlice, type AgentSlice } from './agentSlice';
import { createVoiceSlice, type VoiceSlice } from './voiceSlice';
import { createTerminalSlice, type TerminalSlice } from './terminalSlice';
import { createSettingsSlice, type SettingsSlice } from './settingsSlice';
import { createChatSlice, type ChatSlice } from './chatSlice';
import { createTaskSlice, type TaskSlice } from './taskSlice';
import { createTeamSlice, type TeamSlice } from './teamSlice';
import { createNotificationSlice, type NotificationSlice } from './notificationSlice';

export type AppStore = AgentSlice & VoiceSlice & TerminalSlice & SettingsSlice & ChatSlice & TaskSlice & TeamSlice & NotificationSlice;

export const useAppStore = createWithEqualityFn<AppStore>()(
  persist(
    (...args) => ({
      ...createAgentSlice(...args),
      ...createVoiceSlice(...args),
      ...createTerminalSlice(...args),
      ...createSettingsSlice(...args),
      ...createChatSlice(...args),
      ...createTaskSlice(...args),
      ...createTeamSlice(...args),
      ...createNotificationSlice(...args),
    }),
    {
      name: 'jam-ui-store',
      partialize: (state) => ({
        voiceMode: state.voiceMode,
        navExpanded: state.navExpanded,
        logsDrawerOpen: state.logsDrawerOpen,
        viewMode: state.viewMode,
      }),
    },
  ),
  shallow,
);
