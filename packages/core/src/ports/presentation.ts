import type { AgentId, AgentVisualState } from '../models/agent.js';
import type { VoiceState } from '../models/voice.js';

export interface AppNotification {
  level: 'info' | 'warning' | 'error';
  title: string;
  body?: string;
  agentId?: AgentId;
  duration?: number;
}

export interface IPresentationAdapter {
  updateAgentVisualState(agentId: AgentId, state: AgentVisualState): void;
  appendTerminalOutput(agentId: AgentId, data: string): void;
  showTranscript(text: string, isFinal: boolean): void;
  updateVoiceState(state: VoiceState): void;
  showNotification(notification: AppNotification): void;
}
