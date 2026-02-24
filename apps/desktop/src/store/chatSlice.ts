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
  /** System task result — shown as compact notification with expandable output */
  taskResult?: {
    taskId: string;
    title: string;
    success: boolean;
    summary: string;
  };
}

export interface ChatSlice {
  messages: ChatMessage[];
  isProcessing: boolean;
  /** Agent ID currently being processed (for interrupt targeting) */
  processingAgentId: string | null;
  /** Agent ID whose output thread drawer is open (null = closed) */
  threadAgentId: string | null;
  isLoadingHistory: boolean;
  hasMoreHistory: boolean;
  historyLoaded: boolean;

  addMessage: (msg: ChatMessage) => void;
  prependMessages: (msgs: ChatMessage[]) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  deleteMessage: (id: string) => void;
  clearMessages: () => void;
  setIsProcessing: (v: boolean, agentId?: string | null) => void;
  setThreadAgent: (agentId: string | null) => void;
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
  processingAgentId: null,
  threadAgentId: null,
  isLoadingHistory: false,
  hasMoreHistory: true,
  historyLoaded: false,

  addMessage: (msg) =>
    set((state) => ({
      messages: [...state.messages, msg],
    })),

  prependMessages: (msgs) =>
    set((state) => ({
      messages: [...msgs, ...state.messages],
    })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    })),

  deleteMessage: (id) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    })),

  clearMessages: () =>
    set({ messages: [], hasMoreHistory: false, historyLoaded: true }),

  setIsProcessing: (isProcessing, agentId) =>
    set({ isProcessing, processingAgentId: isProcessing ? (agentId ?? null) : null }),

  setThreadAgent: (threadAgentId) =>
    set({ threadAgentId }),

  setIsLoadingHistory: (isLoadingHistory) =>
    set({ isLoadingHistory }),

  setHasMoreHistory: (hasMoreHistory) =>
    set({ hasMoreHistory }),

  setHistoryLoaded: (historyLoaded) =>
    set({ historyLoaded }),
});
