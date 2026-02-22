import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export type VoiceState = 'idle' | 'capturing' | 'processing' | 'speaking';

export interface VoiceSlice {
  voiceState: VoiceState;
  currentTranscript: { text: string; isFinal: boolean } | null;

  setVoiceState: (state: VoiceState) => void;
  setTranscript: (transcript: { text: string; isFinal: boolean } | null) => void;
}

export const createVoiceSlice: StateCreator<
  AppStore,
  [],
  [],
  VoiceSlice
> = (set) => ({
  voiceState: 'idle',
  currentTranscript: null,

  setVoiceState: (voiceState) =>
    set({ voiceState }),

  setTranscript: (currentTranscript) =>
    set({ currentTranscript }),
});
