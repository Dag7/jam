import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createAgentSlice, type AgentSlice } from './agentSlice';
import { createVoiceSlice, type VoiceSlice } from './voiceSlice';
import { createTerminalSlice, type TerminalSlice } from './terminalSlice';
import { createSettingsSlice, type SettingsSlice } from './settingsSlice';
import { createChatSlice, type ChatSlice } from './chatSlice';
import { createTaskSlice, type TaskSlice } from './taskSlice';
import { createTeamSlice, type TeamSlice } from './teamSlice';

export type AppStore = AgentSlice & VoiceSlice & TerminalSlice & SettingsSlice & ChatSlice & TaskSlice & TeamSlice;

export const useAppStore = create<AppStore>()(
  persist(
    (...args) => ({
      ...createAgentSlice(...args),
      ...createVoiceSlice(...args),
      ...createTerminalSlice(...args),
      ...createSettingsSlice(...args),
      ...createChatSlice(...args),
      ...createTaskSlice(...args),
      ...createTeamSlice(...args),
    }),
    {
      name: 'jam-ui-store',
      partialize: (state) => ({
        settings: state.settings,
      }),
    },
  ),
);
