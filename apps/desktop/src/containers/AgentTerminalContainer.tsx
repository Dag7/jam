import React from 'react';
import { useAgentTerminal } from '@/hooks/useAgentTerminal';
import { useAppStore } from '@/store';
import { TerminalView } from '@/components/terminal/TerminalView';

interface AgentTerminalContainerProps {
  agentId: string;
}

export const AgentTerminalContainer: React.FC<AgentTerminalContainerProps> = ({
  agentId,
}) => {
  const { containerRef } = useAgentTerminal(agentId);
  const isSelected = useAppStore((s) => s.selectedAgentId === agentId);

  return <TerminalView containerRef={containerRef} isActive={isSelected} />;
};
