import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

/** Maximum channel messages kept in memory per channel */
const MAX_CHANNEL_MESSAGES = 500;

export interface StatsEntry {
  agentId: string;
  tasksCompleted: number;
  tasksFailed: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalExecutionMs: number;
  averageResponseMs: number;
  uptime: number;
  lastActive: string;
  streaks: { current: number; best: number };
}

export interface RelationshipEntry {
  sourceAgentId: string;
  targetAgentId: string;
  trustScore: number;
  interactionCount: number;
  lastInteraction: string;
  delegationCount: number;
  delegationSuccessRate: number;
  notes: string[];
}

export interface SoulEntry {
  persona: string;
  role: string;
  traits: Record<string, number>;
  goals: string[];
  strengths: string[];
  weaknesses: string[];
  learnings: string[];
  lastReflection: string;
  version: number;
}

export interface ChannelEntry {
  id: string;
  name: string;
  type: string;
  participants: string[];
  createdAt: string;
}

export interface ChannelMessageEntry {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  timestamp: string;
  replyTo?: string;
}

export interface TeamSlice {
  stats: Record<string, StatsEntry>;
  relationships: RelationshipEntry[];
  souls: Record<string, SoulEntry>;
  channels: ChannelEntry[];
  activeChannelId: string | null;
  channelMessages: Record<string, ChannelMessageEntry[]>;
  /** Agents currently undergoing reflection — persists across tab switches */
  reflectingAgents: Set<string>;

  setStats: (agentId: string, stats: StatsEntry) => void;
  setAllStats: (stats: Record<string, StatsEntry>) => void;
  setRelationships: (rels: RelationshipEntry[]) => void;
  addRelationship: (rel: RelationshipEntry) => void;
  setSoul: (agentId: string, soul: SoulEntry) => void;
  setChannels: (channels: ChannelEntry[]) => void;
  setActiveChannel: (channelId: string | null) => void;
  addChannelMessage: (channelId: string, message: ChannelMessageEntry) => void;
  prependChannelMessages: (channelId: string, channelMessages: ChannelMessageEntry[]) => void;
  setReflecting: (agentId: string, reflecting: boolean) => void;
}

export const createTeamSlice: StateCreator<
  AppStore,
  [],
  [],
  TeamSlice
> = (set) => ({
  stats: {},
  relationships: [],
  souls: {},
  channels: [],
  activeChannelId: null,
  channelMessages: {},
  reflectingAgents: new Set<string>(),

  setStats: (agentId, stats) =>
    set((state) => ({
      stats: { ...state.stats, [agentId]: stats },
    })),

  setAllStats: (stats) => set({ stats }),

  setRelationships: (rels) => set({ relationships: rels }),

  addRelationship: (rel) =>
    set((state) => {
      const filtered = state.relationships.filter(
        (r) =>
          !(
            r.sourceAgentId === rel.sourceAgentId &&
            r.targetAgentId === rel.targetAgentId
          ),
      );
      return { relationships: [...filtered, rel] };
    }),

  setSoul: (agentId, soul) =>
    set((state) => ({
      souls: { ...state.souls, [agentId]: soul },
    })),

  setChannels: (channels) => set({ channels }),

  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  addChannelMessage: (channelId, message) =>
    set((state) => {
      const existing = state.channelMessages[channelId] ?? [];
      let updated = [...existing, message];
      // Cap to prevent unbounded memory growth
      if (updated.length > MAX_CHANNEL_MESSAGES) {
        updated = updated.slice(-MAX_CHANNEL_MESSAGES);
      }
      return {
        channelMessages: { ...state.channelMessages, [channelId]: updated },
      };
    }),

  prependChannelMessages: (channelId, msgs) =>
    set((state) => {
      const existing = state.channelMessages[channelId] ?? [];
      let updated = [...msgs, ...existing];
      if (updated.length > MAX_CHANNEL_MESSAGES) {
        updated = updated.slice(-MAX_CHANNEL_MESSAGES);
      }
      return {
        channelMessages: { ...state.channelMessages, [channelId]: updated },
      };
    }),

  setReflecting: (agentId, reflecting) =>
    set((state) => {
      const has = state.reflectingAgents.has(agentId);
      if (reflecting && has) return state;
      if (!reflecting && !has) return state;
      const next = new Set(state.reflectingAgents);
      if (reflecting) next.add(agentId);
      else next.delete(agentId);
      return { reflectingAgents: next };
    }),
});
