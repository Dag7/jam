import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export type VoiceMode = 'push-to-talk' | 'always-listening';
export type ViewMode = 'chat' | 'stage';

export interface SettingsSlice {
  settings: {
    voiceMode: VoiceMode;
    sidebarCollapsed: boolean;
    currentView: 'stage' | 'settings';
    viewMode: ViewMode;
  };

  setSidebarCollapsed: (collapsed: boolean) => void;
  setVoiceMode: (mode: VoiceMode) => void;
  setCurrentView: (view: 'stage' | 'settings') => void;
  setViewMode: (mode: ViewMode) => void;
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
    viewMode: 'chat',
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

  setViewMode: (mode) =>
    set((state) => ({
      ...state,
      settings: { ...state.settings, viewMode: mode },
    })),
});
