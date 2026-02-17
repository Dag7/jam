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

  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
  setIsProcessing: (v: boolean) => void;
}

export const createChatSlice: StateCreator<
  AppStore,
  [],
  [],
  ChatSlice
> = (set) => ({
  messages: [],
  isProcessing: false,

  addMessage: (msg) =>
    set((state) => ({
      ...state,
      messages: [...state.messages, msg],
    })),

  updateMessage: (id, updates) =>
    set((state) => ({
      ...state,
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    })),

  clearMessages: () =>
    set((state) => ({ ...state, messages: [] })),

  setIsProcessing: (isProcessing) =>
    set((state) => ({ ...state, isProcessing })),
});
