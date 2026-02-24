import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/store';
import { useOrchestrator } from '@/hooks/useOrchestrator';
import { AgentConfigForm, type AgentFormValues, type RuntimeMetadataInfo } from '@/components/agent/AgentConfigForm';
import type { AgentVisualState } from '@/store/agentSlice';

type FormMode = { type: 'closed' } | { type: 'create' } | { type: 'edit'; agentId: string };

const VISUAL_STATE_LABELS: Record<AgentVisualState, { label: string; color: string; dot: string }> = {
  idle: { label: 'Idle', color: 'text-zinc-400', dot: 'bg-zinc-400' },
  listening: { label: 'Listening', color: 'text-green-400', dot: 'bg-green-400 animate-pulse' },
  thinking: { label: 'Thinking', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
  speaking: { label: 'Speaking', color: 'text-blue-400', dot: 'bg-blue-400 animate-pulse' },
  working: { label: 'Working', color: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' },
  error: { label: 'Error', color: 'text-red-400', dot: 'bg-red-400' },
  offline: { label: 'Offline', color: 'text-zinc-500', dot: 'bg-zinc-600' },
};

export const AgentsOverviewContainer: React.FC = () => {
  const agents = useAppStore((s) => Object.values(s.agents));
  const souls = useAppStore((s) => s.souls);
  const { startAgent, stopAgent, deleteAgent, createAgent, updateAgent } = useOrchestrator();
  const [formMode, setFormMode] = useState<FormMode>({ type: 'closed' });
  const [runtimes, setRuntimes] = useState<RuntimeMetadataInfo[]>([]);

  const setSoul = useAppStore((s) => s.setSoul);

  useEffect(() => {
    window.jam.runtimes.listMetadata().then((data) => {
      setRuntimes(data.map((r) => ({ id: r.id, displayName: r.displayName, models: r.models })));
    });
  }, []);

  // Load souls for all agents to display role info
  useEffect(() => {
    for (const agent of agents) {
      if (!souls[agent.profile.id]) {
        window.jam.team.soul.get(agent.profile.id).then((result) => {
          if (result) setSoul(agent.profile.id, result as unknown as Parameters<typeof setSoul>[1]);
        });
      }
    }
  }, [agents, souls, setSoul]);

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

  // Modal overlay for create/edit form
  if (formMode.type !== 'closed') {
    return (
      <div className="flex-1 flex items-start justify-center p-8 overflow-y-auto bg-zinc-900">
        <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-zinc-100 mb-4">
            {formMode.type === 'create' ? 'Create Agent' : 'Configure Agent'}
          </h2>
          <AgentConfigForm
            onSubmit={formMode.type === 'edit' ? handleUpdate : handleCreate}
            onCancel={() => setFormMode({ type: 'closed' })}
            initialValues={editInitialValues}
            runtimes={runtimes}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-900">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Agents</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {agents.length} agent{agents.length !== 1 ? 's' : ''} configured
            </p>
          </div>
          <button
            onClick={() => setFormMode({ type: 'create' })}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="7" y1="2" x2="7" y2="12" />
              <line x1="2" y1="7" x2="12" y2="7" />
            </svg>
            New Agent
          </button>
        </div>

        {/* Agent grid */}
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-4 text-zinc-600">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p className="text-sm mb-4">No agents configured yet</p>
            <button
              onClick={() => setFormMode({ type: 'create' })}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
            >
              Create your first agent
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {agents.map((agent) => {
              const vs = (agent.visualState as AgentVisualState) || 'offline';
              const isRunning = agent.status === 'running';
              const stateInfo = VISUAL_STATE_LABELS[vs];

              return (
                <div
                  key={agent.profile.id}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors"
                >
                  {/* Top row: avatar + name + status */}
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                      style={{
                        backgroundColor: `${agent.profile.color}20`,
                        color: agent.profile.color,
                      }}
                    >
                      {agent.profile.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-zinc-100 truncate">
                          {agent.profile.name}
                        </h3>
                        {agent.profile.isSystem && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-500/20 text-violet-400 shrink-0">
                            System
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stateInfo.dot}`} />
                        <span className={`text-xs ${stateInfo.color}`}>{stateInfo.label}</span>
                      </div>
                      {souls[agent.profile.id]?.role && (
                        <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                          {souls[agent.profile.id].role}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Info row: runtime + model */}
                  <div className="flex items-center gap-2 mb-4 text-xs text-zinc-500">
                    <span className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">
                      {agent.profile.runtime}
                    </span>
                    {agent.profile.model && (
                      <span className="truncate">{agent.profile.model}</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
                    {isRunning ? (
                      <button
                        onClick={() => stopAgent(agent.profile.id)}
                        className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        onClick={() => startAgent(agent.profile.id)}
                        className="flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                      >
                        Start
                      </button>
                    )}
                    {!agent.profile.isSystem && (
                      <button
                        onClick={() => setFormMode({ type: 'edit', agentId: agent.profile.id })}
                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                      >
                        Configure
                      </button>
                    )}
                    {!agent.profile.isSystem && (
                      <button
                        onClick={() => deleteAgent(agent.profile.id)}
                        className="p-1.5 rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete agent"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
