import type { AgentId, AgentStatus, AgentVisualState, AgentProfile } from '../models/agent.js';
import type { VoiceState } from '../models/voice.js';
import type { Task, TaskStatus } from '../models/task.js';
import type { Channel, ChannelMessage } from '../models/communication.js';
import type { AgentRelationship } from '../models/relationship.js';
import type { SoulStructure } from '../models/soul.js';
import type { AgentStats } from '../models/agent-stats.js';

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

export interface AgentAcknowledgedEvent {
  agentId: AgentId;
  agentName: string;
  agentRuntime: string;
  agentColor: string;
  ackText: string;
}

export interface AgentResponseCompleteEvent {
  agentId: AgentId;
  text: string;
}

export interface AgentProgressEvent {
  agentId: AgentId;
  agentName: string;
  agentRuntime: string;
  agentColor: string;
  type: 'tool-use' | 'thinking' | 'text';
  summary: string;
}

export interface AgentErrorEvent {
  agentId: AgentId;
  message: string;
  details?: string;
}

export interface TTSCompleteEvent {
  agentId: AgentId;
  audioPath: string;
}

// Task events
export interface TaskCreatedEvent {
  task: Task;
}

export interface TaskUpdatedEvent {
  task: Task;
  previousStatus: TaskStatus;
}

export interface TaskCompletedEvent {
  task: Task;
  durationMs: number;
}

// Communication events
export interface MessageReceivedEvent {
  message: ChannelMessage;
  channel: Channel;
}

// Relationship events
export interface TrustUpdatedEvent {
  relationship: AgentRelationship;
}

// Soul events
export interface SoulEvolvedEvent {
  agentId: AgentId;
  soul: SoulStructure;
  version: number;
}

// Stats events
export interface StatsUpdatedEvent {
  agentId: AgentId;
  stats: AgentStats;
}

// Code improvement events
export interface CodeImprovementProposedEvent {
  improvement: import('../models/code-improvement.js').CodeImprovement;
}

export interface CodeImprovementCompletedEvent {
  improvement: import('../models/code-improvement.js').CodeImprovement;
}

export interface CodeImprovementFailedEvent {
  improvement: import('../models/code-improvement.js').CodeImprovement;
  error: string;
}

export interface CodeImprovementRolledBackEvent {
  improvement: import('../models/code-improvement.js').CodeImprovement;
}

export const Events = {
  AGENT_CREATED: 'agent:created',
  AGENT_DELETED: 'agent:deleted',
  AGENT_STATUS_CHANGED: 'agent:statusChanged',
  AGENT_VISUAL_STATE_CHANGED: 'agent:visualStateChanged',
  AGENT_OUTPUT: 'agent:output',
  AGENT_INPUT: 'agent:input',
  AGENT_ACKNOWLEDGED: 'agent:acknowledged',
  AGENT_RESPONSE_COMPLETE: 'agent:responseComplete',
  AGENT_PROGRESS: 'agent:progress',
  AGENT_ERROR: 'agent:error',
  VOICE_TRANSCRIPTION: 'voice:transcription',
  VOICE_STATE_CHANGED: 'voice:stateChanged',
  TTS_COMPLETE: 'tts:complete',
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_COMPLETED: 'task:completed',
  MESSAGE_RECEIVED: 'message:received',
  TRUST_UPDATED: 'trust:updated',
  SOUL_EVOLVED: 'soul:evolved',
  STATS_UPDATED: 'stats:updated',
  CODE_PROPOSED: 'code:proposed',
  CODE_IMPROVED: 'code:improved',
  CODE_FAILED: 'code:failed',
  CODE_ROLLED_BACK: 'code:rolledback',
} as const;
