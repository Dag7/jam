import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export interface TerminalBuffer {
  pendingData: string[];
}

export interface TerminalSlice {
  terminalBuffers: Record<string, TerminalBuffer>;

  appendTerminalData: (agentId: string, data: string) => void;
  flushTerminalData: (agentId: string) => void;
  clearTerminal: (agentId: string) => void;
}

export const createTerminalSlice: StateCreator<
  AppStore,
  [],
  [],
  TerminalSlice
> = (set) => ({
  terminalBuffers: {},

  appendTerminalData: (agentId, data) =>
    set((state) => {
      const existing = state.terminalBuffers[agentId] ?? { pendingData: [] };
      return {
        ...state,
        terminalBuffers: {
          ...state.terminalBuffers,
          [agentId]: {
            pendingData: [...existing.pendingData, data],
          },
        },
      };
    }),

  flushTerminalData: (agentId) =>
    set((state) => ({
      ...state,
      terminalBuffers: {
        ...state.terminalBuffers,
        [agentId]: { pendingData: [] },
      },
    })),

  clearTerminal: (agentId) =>
    set((state) => ({
      ...state,
      terminalBuffers: {
        ...state.terminalBuffers,
        [agentId]: { pendingData: [] },
      },
    })),
});
