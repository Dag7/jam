import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export type VoiceMode = 'push-to-talk' | 'toggle';

export interface SettingsSlice {
  settings: {
    voiceMode: VoiceMode;
    sidebarCollapsed: boolean;
    currentView: 'stage' | 'settings';
  };

  setSidebarCollapsed: (collapsed: boolean) => void;
  setVoiceMode: (mode: VoiceMode) => void;
  setCurrentView: (view: 'stage' | 'settings') => void;
}

export const createSettingsSlice: StateCreator<
  AppStore,
  [],
  [],
  SettingsSlice
> = (set) => ({
  settings: {
    voiceMode: 'push-to-talk',
    sidebarCollapsed: false,
    currentView: 'stage',
  },

  setSidebarCollapsed: (collapsed) =>
    set((state) => ({
      ...state,
      settings: { ...state.settings, sidebarCollapsed: collapsed },
    })),

  setVoiceMode: (mode) =>
    set((state) => ({
      ...state,
      settings: { ...state.settings, voiceMode: mode },
    })),

  setCurrentView: (view) =>
    set((state) => ({
      ...state,
      settings: { ...state.settings, currentView: view },
    })),
});
