import React, { useState } from 'react';
import { useAppStore } from '@/store';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { AgentCard } from '@/components/agent/AgentCard';
import { AgentConfigForm } from '@/components/agent/AgentConfigForm';
import type { AgentVisualState } from '@/store/agentSlice';

export const AgentPanelContainer: React.FC = () => {
  const agents = useAppStore((s) => Object.values(s.agents));
  const { selectedAgentId, selectAgent, startAgent, stopAgent, createAgent } =
    useOrchestrator();
  const [showForm, setShowForm] = useState(false);

  const handleCreate = async (profile: Record<string, unknown>) => {
    const result = await createAgent(profile);
    if (result.success) {
      setShowForm(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {showForm ? (
        <AgentConfigForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {agents.map((agent) => (
              <AgentCard
                key={agent.profile.id}
                name={agent.profile.name}
                runtime={agent.profile.runtime}
                color={agent.profile.color}
                visualState={agent.visualState as AgentVisualState}
                isSelected={agent.profile.id === selectedAgentId}
                isRunning={agent.status === 'running'}
                onClick={() => selectAgent(agent.profile.id)}
                onStart={() => startAgent(agent.profile.id)}
                onStop={() => stopAgent(agent.profile.id)}
              />
            ))}
          </div>

          {agents.length === 0 && (
            <div className="text-center py-8 text-zinc-500 text-sm">
              No agents configured yet
            </div>
          )}

          <div className="mt-auto p-2">
            <button
              onClick={() => setShowForm(true)}
              className="w-full px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <line x1="7" y1="2" x2="7" y2="12" />
                <line x1="2" y1="7" x2="12" y2="7" />
              </svg>
              New Agent
            </button>
          </div>
        </>
      )}
    </div>
  );
};
