import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createAgentSlice, type AgentSlice } from './agentSlice';
import { createVoiceSlice, type VoiceSlice } from './voiceSlice';
import { createTerminalSlice, type TerminalSlice } from './terminalSlice';
import { createSettingsSlice, type SettingsSlice } from './settingsSlice';

export type AppStore = AgentSlice & VoiceSlice & TerminalSlice & SettingsSlice;

export const useAppStore = create<AppStore>()(
  persist(
    (...args) => ({
      ...createAgentSlice(...args),
      ...createVoiceSlice(...args),
      ...createTerminalSlice(...args),
      ...createSettingsSlice(...args),
    }),
    {
      name: 'jam-ui-store',
      partialize: (state) => ({
        settings: state.settings,
      }),
    },
  ),
);
