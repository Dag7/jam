import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store';
import { useAgentSoul } from '@/hooks/useAgentSoul';
import { useTeamStats } from '@/hooks/useTeamStats';
import { useTasks } from '@/hooks/useTasks';
import { AgentDetailView } from '@/components/dashboard/AgentDetailView';

interface AgentDetailContainerProps {
  agentId: string;
}

interface ServiceEntry {
  pid: number;
  port?: number;
  name: string;
  logFile?: string;
  startedAt: string;
  alive?: boolean;
}

export function AgentDetailContainer({ agentId }: AgentDetailContainerProps) {
  const agents = useAppStore((s) => s.agents);
  const agent = agents[agentId];
  const { soul, isReflecting, triggerReflection } = useAgentSoul(agentId);
  const { stats, relationships } = useTeamStats();
  const { tasks } = useTasks();
  const [services, setServices] = useState<ServiceEntry[]>([]);

  const refreshServices = useCallback(async () => {
    try {
      const result = await window.jam.services.listForAgent(agentId);
      setServices(result);
    } catch {
      // services API not ready
    }
  }, [agentId]);

  useEffect(() => {
    refreshServices();
    const interval = setInterval(refreshServices, 10_000);
    return () => clearInterval(interval);
  }, [refreshServices]);

  const handleStopService = useCallback(async (pid: number) => {
    await window.jam.services.stop(pid);
    refreshServices();
  }, [refreshServices]);

  const handleRestartService = useCallback(async (serviceName: string) => {
    await window.jam.services.restart(serviceName);
    // Brief delay for process to start before refreshing
    setTimeout(refreshServices, 1000);
  }, [refreshServices]);

  const handleOpenService = useCallback((port: number) => {
    window.jam.services.openUrl(port);
  }, []);

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500">
        Agent not found
      </div>
    );
  }

  const agentStats = stats[agentId] ?? null;
  const agentTasks = tasks.filter(
    (t) => t.assignedTo === agentId || t.createdBy === agentId,
  );
  const agentRelationships = relationships
    .filter((r) => r.sourceAgentId === agentId)
    .map((r) => ({
      targetAgentId: r.targetAgentId,
      trustScore: r.trustScore,
      interactionCount: r.interactionCount,
    }));

  const agentMap = Object.fromEntries(
    Object.values(agents).map((a) => [
      a.profile.id,
      { name: a.profile.name, color: a.profile.color },
    ]),
  );

  // Derive activity log from tasks involving this agent
  const activity = useMemo(() => {
    const allTasks = Object.values(useAppStore.getState().tasks);
    const items: Array<{
      id: string;
      type: 'delegation_sent' | 'delegation_received' | 'task_completed' | 'task_failed' | 'broadcast';
      title: string;
      detail?: string;
      counterpart?: string;
      timestamp: string;
    }> = [];

    for (const t of allTasks) {
      // Tasks this agent created and delegated to someone else
      if (t.createdBy === agentId && t.assignedTo && t.assignedTo !== agentId && t.source === 'agent') {
        items.push({
          id: `sent-${t.id}`,
          type: 'delegation_sent',
          title: `Delegated: ${t.title}`,
          detail: t.description?.slice(0, 120),
          counterpart: t.assignedTo,
          timestamp: t.createdAt,
        });
      }
      // Tasks delegated TO this agent by another agent
      if (t.assignedTo === agentId && t.createdBy !== agentId && t.source === 'agent') {
        items.push({
          id: `recv-${t.id}`,
          type: 'delegation_received',
          title: `Received: ${t.title}`,
          detail: t.description?.slice(0, 120),
          counterpart: t.createdBy,
          timestamp: t.createdAt,
        });
      }
      // Tasks this agent completed or failed
      if (t.assignedTo === agentId && (t.status === 'completed' || t.status === 'failed') && t.completedAt) {
        items.push({
          id: `done-${t.id}`,
          type: t.status === 'completed' ? 'task_completed' : 'task_failed',
          title: `${t.status === 'completed' ? 'Completed' : 'Failed'}: ${t.title}`,
          detail: t.result?.slice(0, 120) || t.error?.slice(0, 120),
          counterpart: t.createdBy !== agentId ? t.createdBy : undefined,
          timestamp: t.completedAt,
        });
      }
    }

    // Sort newest first
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items;
  }, [agentId, tasks]);

  return (
    <AgentDetailView
      agent={{
        id: agent.profile.id,
        name: agent.profile.name,
        color: agent.profile.color,
      }}
      soul={soul}
      stats={agentStats}
      tasks={agentTasks}
      activity={activity}
      services={services}
      relationships={agentRelationships}
      agents={agentMap}
      onTriggerReflection={triggerReflection}
      onCancelTask={(taskId) => window.jam.tasks.cancel(taskId)}
      onStopService={handleStopService}
      onRestartService={handleRestartService}
      onOpenService={handleOpenService}
      isReflecting={isReflecting}
    />
  );
}
