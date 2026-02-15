import React from 'react';
import { useAgent } from '@/hooks/useAgent';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { AgentAvatar } from '@/components/agent/AgentAvatar';
import { AgentStatusBadge } from '@/components/agent/AgentStatusBadge';
import type { AgentVisualState } from '@/store/agentSlice';

interface AgentAvatarContainerProps {
  agentId: string;
}

export const AgentAvatarContainer: React.FC<AgentAvatarContainerProps> = ({
  agentId,
}) => {
  const { profile, visualState } = useAgent(agentId);
  const { selectAgent } = useOrchestrator();

  if (!profile) return null;

  return (
    <div
      onClick={() => selectAgent(agentId)}
      onKeyDown={(e) => e.key === 'Enter' && selectAgent(agentId)}
      role="button"
      tabIndex={0}
      className="flex flex-col items-center gap-2 cursor-pointer"
    >
      <AgentAvatar
        visualState={visualState as AgentVisualState}
        name={profile.name}
        color={profile.color}
        avatarUrl={profile.avatarUrl}
        size="lg"
      />
      <div className="text-sm font-medium text-zinc-300">{profile.name}</div>
      <AgentStatusBadge state={visualState as AgentVisualState} />
    </div>
  );
};
