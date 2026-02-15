import { useAppStore } from '@/store';

export function useAgent(agentId: string) {
  const agent = useAppStore((s) => s.agents[agentId]);

  return {
    profile: agent?.profile,
    status: agent?.status ?? 'stopped',
    visualState: agent?.visualState ?? 'offline',
    isRunning: agent?.status === 'running',
    pid: agent?.pid,
    startedAt: agent?.startedAt,
    lastActivity: agent?.lastActivity,
  };
}
