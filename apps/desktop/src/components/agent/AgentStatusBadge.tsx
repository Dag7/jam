import React from 'react';
import type { AgentVisualState } from '@/store/agentSlice';

interface AgentStatusBadgeProps {
  state: AgentVisualState;
  message?: string;
}

const stateLabels: Record<AgentVisualState, string> = {
  idle: 'Idle',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  working: 'Working',
  error: 'Error',
  offline: 'Offline',
};

const stateColors: Record<AgentVisualState, string> = {
  idle: 'bg-status-idle',
  listening: 'bg-status-listening',
  thinking: 'bg-status-thinking',
  speaking: 'bg-status-speaking',
  working: 'bg-status-working',
  error: 'bg-status-error',
  offline: 'bg-status-offline',
};

export const AgentStatusBadge: React.FC<AgentStatusBadgeProps> = ({
  state,
  message,
}) => {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${stateColors[state]}`} />
      <span className="text-xs text-zinc-400">
        {message ?? stateLabels[state]}
      </span>
    </div>
  );
};
