import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { AgentCard } from '@/components/agent/AgentCard';
import { AgentConfigForm, type AgentFormValues, type RuntimeMetadataInfo } from '@/components/agent/AgentConfigForm';
import type { AgentVisualState } from '@/store/agentSlice';

type FormMode = { type: 'closed' } | { type: 'create' } | { type: 'edit'; agentId: string };

export const AgentPanelContainer: React.FC = () => {
  const agents = useAppStore((s) => Object.values(s.agents));
  const { selectedAgentId, selectAgent, startAgent, stopAgent, deleteAgent, createAgent, updateAgent } =
    useOrchestrator();
  const [formMode, setFormMode] = useState<FormMode>({ type: 'closed' });
  const [runtimes, setRuntimes] = useState<RuntimeMetadataInfo[]>([]);

  useEffect(() => {
    window.jam.runtimes.listMetadata().then((data) => {
      setRuntimes(data.map((r) => ({ id: r.id, displayName: r.displayName, models: r.models })));
    });
  }, []);

  const handleCreate = async (profile: Record<string, unknown>) => {
    const result = await createAgent(profile);
    if (result.success) {
      setFormMode({ type: 'closed' });
    }
  };

  const handleUpdate = async (profile: Record<string, unknown>) => {
    const { id, ...updates } = profile;
    if (!id) return;
    const result = await updateAgent(id as string, updates);
    if (result.success) {
      setFormMode({ type: 'closed' });
    }
  };

  const editingAgent = formMode.type === 'edit'
    ? agents.find((a) => a.profile.id === formMode.agentId)
    : null;

  const editInitialValues: AgentFormValues | undefined = editingAgent
    ? {
        id: editingAgent.profile.id,
        name: editingAgent.profile.name,
        runtime: editingAgent.profile.runtime,
        model: editingAgent.profile.model,
        systemPrompt: editingAgent.profile.systemPrompt,
        color: editingAgent.profile.color,
        voice: editingAgent.profile.voice,
        cwd: editingAgent.profile.cwd,
        autoStart: editingAgent.profile.autoStart,
        allowFullAccess: editingAgent.profile.allowFullAccess,
        allowInterrupts: editingAgent.profile.allowInterrupts,
        secretBindings: editingAgent.profile.secretBindings,
      }
    : undefined;

  return (
    <div className="flex flex-col h-full p-2">
      {formMode.type !== 'closed' ? (
        <AgentConfigForm
          onSubmit={formMode.type === 'edit' ? handleUpdate : handleCreate}
          onCancel={() => setFormMode({ type: 'closed' })}
          initialValues={editInitialValues}
          runtimes={runtimes}
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
                onClick={() => selectAgent(agent.profile.id === selectedAgentId ? null : agent.profile.id)}
                onStart={() => startAgent(agent.profile.id)}
                onStop={() => stopAgent(agent.profile.id)}
                onDelete={() => deleteAgent(agent.profile.id)}
                onConfigure={() => setFormMode({ type: 'edit', agentId: agent.profile.id })}
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
              onClick={() => setFormMode({ type: 'create' })}
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
