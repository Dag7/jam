import type { AgentId, AgentStatus, AgentVisualState, AgentProfile } from '../models/agent.js';
import type { VoiceState } from '../models/voice.js';

export interface AgentCreatedEvent {
  agentId: AgentId;
  profile: AgentProfile;
}

export interface AgentDeletedEvent {
  agentId: AgentId;
}

export interface AgentStatusChangedEvent {
  agentId: AgentId;
  status: AgentStatus;
  previousStatus: AgentStatus;
}

export interface AgentVisualStateChangedEvent {
  agentId: AgentId;
  visualState: AgentVisualState;
}

export interface AgentOutputEvent {
  agentId: AgentId;
  data: string;
}

export interface AgentInputEvent {
  agentId: AgentId;
  text: string;
  source: 'voice' | 'text';
}

export interface VoiceTranscriptionEvent {
  text: string;
  isFinal: boolean;
  confidence: number;
}

export interface VoiceStateChangedEvent {
  state: VoiceState;
}

export interface TTSCompleteEvent {
  agentId: AgentId;
  audioPath: string;
}

export const Events = {
  AGENT_CREATED: 'agent:created',
  AGENT_DELETED: 'agent:deleted',
  AGENT_STATUS_CHANGED: 'agent:statusChanged',
  AGENT_VISUAL_STATE_CHANGED: 'agent:visualStateChanged',
  AGENT_OUTPUT: 'agent:output',
  AGENT_INPUT: 'agent:input',
  VOICE_TRANSCRIPTION: 'voice:transcription',
  VOICE_STATE_CHANGED: 'voice:stateChanged',
  TTS_COMPLETE: 'tts:complete',
} as const;
