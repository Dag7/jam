import type { StateCreator } from 'zustand';
import type { AppStore } from './index';

export type AgentVisualState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'working'
  | 'error'
  | 'offline';

export interface AgentEntry {
  profile: {
    id: string;
    name: string;
    runtime: string;
    model?: string;
    systemPrompt?: string;
    color: string;
    avatarUrl?: string;
    voice: {
      ttsVoiceId: string;
      ttsProvider?: string;
      speed?: number;
    };
    autoStart?: boolean;
    allowFullAccess?: boolean;
    cwd?: string;
  };
  status: string;
  visualState: AgentVisualState;
  pid?: number;
  startedAt?: string;
  lastActivity?: string;
}

export interface AgentSlice {
  agents: Record<string, AgentEntry>;
  activeAgentIds: string[];
  selectedAgentId: string | null;

  setAgents: (agents: AgentEntry[]) => void;
  addAgent: (agent: AgentEntry) => void;
  removeAgent: (agentId: string) => void;
  updateAgentStatus: (agentId: string, status: string) => void;
  updateAgentVisualState: (agentId: string, state: AgentVisualState) => void;
  setSelectedAgent: (agentId: string | null) => void;
  setAgentActive: (agentId: string, active: boolean) => void;
}

export const createAgentSlice: StateCreator<
  AppStore,
  [],
  [],
  AgentSlice
> = (set) => ({
  agents: {},
  activeAgentIds: [],
  selectedAgentId: null,

  setAgents: (agents) =>
    set((state) => {
      const map: Record<string, AgentEntry> = {};
      for (const agent of agents) {
        map[agent.profile.id] = agent;
      }
      return { ...state, agents: map };
    }),

  addAgent: (agent) =>
    set((state) => ({
      ...state,
      agents: { ...state.agents, [agent.profile.id]: agent },
    })),

  removeAgent: (agentId) =>
    set((state) => {
      const { [agentId]: _, ...rest } = state.agents;
      return {
        ...state,
        agents: rest,
        activeAgentIds: state.activeAgentIds.filter((id) => id !== agentId),
        selectedAgentId:
          state.selectedAgentId === agentId ? null : state.selectedAgentId,
      };
    }),

  updateAgentStatus: (agentId, status) =>
    set((state) => {
      const agent = state.agents[agentId];
      if (!agent) return state;
      return {
        ...state,
        agents: {
          ...state.agents,
          [agentId]: { ...agent, status },
        },
      };
    }),

  updateAgentVisualState: (agentId, visualState) =>
    set((state) => {
      const agent = state.agents[agentId];
      if (!agent) return state;
      return {
        ...state,
        agents: {
          ...state.agents,
          [agentId]: { ...agent, visualState },
        },
      };
    }),

  setSelectedAgent: (agentId) =>
    set((state) => ({ ...state, selectedAgentId: agentId })),

  setAgentActive: (agentId, active) =>
    set((state) => ({
      ...state,
      activeAgentIds: active
        ? [...new Set([...state.activeAgentIds, agentId])]
        : state.activeAgentIds.filter((id) => id !== agentId),
    })),
});
