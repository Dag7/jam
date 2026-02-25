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
  /** Ordered list of message IDs */
  messageIds: string[];
  /** O(1) lookup by ID */
  messagesById: Record<string, ChatMessage>;
  /** Pre-indexed per-agent message ID lists — avoids O(n) filter */
  messageIdsByAgent: Record<string, string[]>;

  isProcessing: boolean;
  processingAgentId: string | null;
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
  messageIds: [],
  messagesById: {},
  messageIdsByAgent: {},
  isProcessing: false,
  processingAgentId: null,
  threadAgentId: null,
  isLoadingHistory: false,
  hasMoreHistory: true,
  historyLoaded: false,

  addMessage: (msg) =>
    set((state) => {
      const messagesById = { ...state.messagesById, [msg.id]: msg };
      const messageIds = [...state.messageIds, msg.id];

      let messageIdsByAgent = state.messageIdsByAgent;
      if (msg.agentId) {
        const agentIds = messageIdsByAgent[msg.agentId];
        messageIdsByAgent = {
          ...messageIdsByAgent,
          [msg.agentId]: agentIds ? [...agentIds, msg.id] : [msg.id],
        };
      }

      return { messageIds, messagesById, messageIdsByAgent };
    }),

  prependMessages: (msgs) =>
    set((state) => {
      if (msgs.length === 0) return state;

      const messagesById = { ...state.messagesById };
      const newIds: string[] = [];
      const agentUpdates: Record<string, string[]> = {};

      for (const msg of msgs) {
        messagesById[msg.id] = msg;
        newIds.push(msg.id);
        if (msg.agentId) {
          (agentUpdates[msg.agentId] ??= []).push(msg.id);
        }
      }

      const messageIds = [...newIds, ...state.messageIds];

      let messageIdsByAgent = state.messageIdsByAgent;
      if (Object.keys(agentUpdates).length > 0) {
        messageIdsByAgent = { ...messageIdsByAgent };
        for (const agentId in agentUpdates) {
          const existing = messageIdsByAgent[agentId] ?? [];
          messageIdsByAgent[agentId] = [...agentUpdates[agentId], ...existing];
        }
      }

      return { messageIds, messagesById, messageIdsByAgent };
    }),

  updateMessage: (id, updates) =>
    set((state) => {
      const existing = state.messagesById[id];
      if (!existing) return state;
      return {
        messagesById: { ...state.messagesById, [id]: { ...existing, ...updates } },
      };
    }),

  deleteMessage: (id) =>
    set((state) => {
      const msg = state.messagesById[id];
      if (!msg) return state;

      const { [id]: _, ...messagesById } = state.messagesById;
      const messageIds = state.messageIds.filter((mid) => mid !== id);

      let messageIdsByAgent = state.messageIdsByAgent;
      if (msg.agentId && messageIdsByAgent[msg.agentId]) {
        messageIdsByAgent = {
          ...messageIdsByAgent,
          [msg.agentId]: messageIdsByAgent[msg.agentId].filter((mid) => mid !== id),
        };
      }

      return { messageIds, messagesById, messageIdsByAgent };
    }),

  clearMessages: () =>
    set({ messageIds: [], messagesById: {}, messageIdsByAgent: {}, hasMoreHistory: false, historyLoaded: true }),

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
