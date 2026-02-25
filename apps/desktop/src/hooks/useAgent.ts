import { useAppStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';

export function useAgent(agentId: string) {
  return useAppStore(
    useShallow((s) => {
      const agent = s.agents[agentId];
      return {
        profile: agent?.profile,
        status: agent?.status ?? 'stopped',
        visualState: agent?.visualState ?? 'offline',
        isRunning: agent?.status === 'running',
        pid: agent?.pid,
        startedAt: agent?.startedAt,
        lastActivity: agent?.lastActivity,
      };
    }),
  );
}
