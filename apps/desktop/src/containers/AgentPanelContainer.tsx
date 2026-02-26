import React, { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '@/store';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { useRuntimeMetadata } from '@/hooks/useRuntimeMetadata';
import { AgentCard } from '@/components/agent/AgentCard';
import { AgentConfigForm, type AgentFormValues } from '@/components/agent/AgentConfigForm';
import type { AgentVisualState } from '@/store/agentSlice';

type FormMode = { type: 'closed' } | { type: 'create' } | { type: 'edit'; agentId: string };

export const AgentPanelContainer: React.FC = () => {
  const agentsMap = useAppStore((s) => s.agents);
  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const { selectAgent, startAgent, stopAgent, deleteAgent, createAgent, updateAgent } =
    useOrchestrator();
  const [formMode, setFormMode] = useState<FormMode>({ type: 'closed' });
  const runtimes = useRuntimeMetadata();

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

  const handleSelect = useCallback((agentId: string) => {
    selectAgent(useAppStore.getState().selectedAgentId === agentId ? null : agentId);
  }, [selectAgent]);

  const handleStart = useCallback((agentId: string) => startAgent(agentId), [startAgent]);
  const handleStop = useCallback((agentId: string) => stopAgent(agentId), [stopAgent]);
  const handleDelete = useCallback((agentId: string) => deleteAgent(agentId), [deleteAgent]);
  const handleConfigure = useCallback((agentId: string) => {
    setFormMode({ type: 'edit', agentId });
  }, []);

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
                isRunning={agent.status === 'running' || agent.status === 'starting'}
                onClick={() => handleSelect(agent.profile.id)}
                onStart={() => handleStart(agent.profile.id)}
                onStop={() => handleStop(agent.profile.id)}
                onDelete={() => handleDelete(agent.profile.id)}
                onConfigure={() => handleConfigure(agent.profile.id)}
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
