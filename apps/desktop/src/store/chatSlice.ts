import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export type ChatMessageRole = 'user' | 'agent' | 'system';
export type ChatMessageStatus = 'sending' | 'complete' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  agentId: string | null;
  agentName: string | null;
  agentRuntime: string | null;
  agentColor: string | null;
  content: string;
  status: ChatMessageStatus;
  source: 'text' | 'voice';
  timestamp: number;
  error?: string;
}

export interface ChatSlice {
  messages: ChatMessage[];
  isProcessing: boolean;
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  historyLoaded: boolean;

  addMessage: (msg: ChatMessage) => void;
  prependMessages: (msgs: ChatMessage[]) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  setIsProcessing: (v: boolean) => void;
  setIsLoadingHistory: (v: boolean) => void;
  setHasMoreHistory: (v: boolean) => void;
  setHistoryLoaded: (v: boolean) => void;
}

export const createChatSlice: StateCreator<
  AppStore,
  [],
  [],
  ChatSlice
> = (set) => ({
  messages: [],
  isProcessing: false,
  isLoadingHistory: false,
  hasMoreHistory: true,
  historyLoaded: false,

  addMessage: (msg) =>
    set((state) => ({
      ...state,
      messages: [...state.messages, msg],
    })),

  prependMessages: (msgs) =>
    set((state) => ({
      ...state,
      messages: [...msgs, ...state.messages],
    })),

  updateMessage: (id, updates) =>
    set((state) => ({
      ...state,
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    })),

  clearMessages: () =>
    set((state) => ({ ...state, messages: [], hasMoreHistory: false, historyLoaded: true })),

  setIsProcessing: (isProcessing) =>
    set((state) => ({ ...state, isProcessing })),

  setIsLoadingHistory: (isLoadingHistory) =>
    set((state) => ({ ...state, isLoadingHistory })),

  setHasMoreHistory: (hasMoreHistory) =>
    set((state) => ({ ...state, hasMoreHistory })),

  setHistoryLoaded: (historyLoaded) =>
    set((state) => ({ ...state, historyLoaded })),
});
