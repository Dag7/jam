import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export type VoiceMode = 'push-to-talk' | 'always-listening';
export type ViewMode = 'chat' | 'stage' | 'compact';

export interface SettingsSlice {
  settings: {
    voiceMode: VoiceMode;
    navExpanded: boolean;
    logsDrawerOpen: boolean;
    viewMode: ViewMode;
  };

  setNavExpanded: (expanded: boolean) => void;
  setLogsDrawerOpen: (open: boolean) => void;
  setVoiceMode: (mode: VoiceMode) => void;
  setViewMode: (mode: ViewMode) => void;
}

export const createSettingsSlice: StateCreator<
  AppStore,
  [],
  [],
  SettingsSlice
> = (set) => ({
  settings: {
    voiceMode: 'always-listening',
    navExpanded: false,
    logsDrawerOpen: false,
    viewMode: 'chat',
  },

  setNavExpanded: (expanded) =>
    set((state) => ({
      settings: { ...state.settings, navExpanded: expanded },
    })),

  setLogsDrawerOpen: (open) =>
    set((state) => ({
      settings: { ...state.settings, logsDrawerOpen: open },
    })),

  setVoiceMode: (mode) =>
    set((state) => ({
      settings: { ...state.settings, voiceMode: mode },
    })),

  setViewMode: (mode) =>
    set((state) => ({
      settings: { ...state.settings, viewMode: mode },
    })),
});
