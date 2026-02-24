import { ipcMain } from 'electron';
import type { ICommunicationHub, IRelationshipStore, IStatsStore } from '@jam/core';
import type { SoulManager, SelfImprovementEngine, FileScheduleStore } from '@jam/team';
import type { CodeImprovementEngine } from '@jam/team';

export interface TeamHandlerDeps {
  communicationHub: ICommunicationHub;
  relationshipStore: IRelationshipStore;
  statsStore: IStatsStore;
  soulManager: SoulManager;
  selfImprovement: SelfImprovementEngine;
  scheduleStore: FileScheduleStore;
  codeImprovement: CodeImprovementEngine | null;
}

export function registerTeamHandlers(deps: TeamHandlerDeps): void {
  const { communicationHub, relationshipStore, statsStore, soulManager, selfImprovement, scheduleStore, codeImprovement } = deps;

  // Channels
  ipcMain.handle('channels:list', async (_, agentId?: string) => {
    return communicationHub.listChannels(agentId);
  });

  ipcMain.handle(
    'channels:create',
    async (_, name: string, type: 'team' | 'direct' | 'broadcast', participants: string[]) => {
      try {
        const channel = await communicationHub.createChannel(name, type, participants);
        return { success: true, channel };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'channels:getMessages',
    async (_, channelId: string, limit?: number, before?: string) => {
      return communicationHub.getMessages(channelId, limit, before);
    },
  );

  ipcMain.handle(
    'channels:sendMessage',
    async (_, channelId: string, senderId: string, content: string, replyTo?: string) => {
      try {
        const message = await communicationHub.sendMessage(channelId, senderId, content, replyTo);
        return { success: true, message };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Relationships
  ipcMain.handle('relationships:get', async (_, sourceAgentId: string, targetAgentId: string) => {
    return relationshipStore.get(sourceAgentId, targetAgentId);
  });

  ipcMain.handle('relationships:getAll', async (_, agentId: string) => {
    return relationshipStore.getAll(agentId);
  });

  // Stats
  ipcMain.handle('stats:get', async (_, agentId: string) => {
    return statsStore.get(agentId);
  });

  ipcMain.handle('stats:getAll', async () => {
    // No built-in "getAll" — caller should iterate agents
    // This is handled at the renderer level
    return null;
  });

  // Soul
  ipcMain.handle('soul:get', async (_, agentId: string) => {
    return soulManager.load(agentId);
  });

  ipcMain.handle('soul:evolve', async (_, agentId: string) => {
    try {
      await selfImprovement.triggerReflection(agentId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // --- Schedules ---

  ipcMain.handle('schedules:list', async () => {
    return scheduleStore.list();
  });

  ipcMain.handle(
    'schedules:create',
    async (_, schedule: { name: string; pattern: Record<string, unknown>; taskTemplate: Record<string, unknown> }) => {
      try {
        const created = await scheduleStore.create({
          name: schedule.name,
          pattern: schedule.pattern as import('@jam/team').SchedulePattern,
          taskTemplate: schedule.taskTemplate as Parameters<typeof scheduleStore.create>[0]['taskTemplate'],
          enabled: true,
          lastRun: null,
          source: 'user',
        });
        return { success: true, schedule: created };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'schedules:update',
    async (_, id: string, updates: Record<string, unknown>) => {
      try {
        await scheduleStore.update(id, updates as Parameters<typeof scheduleStore.update>[1]);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('schedules:delete', async (_, id: string) => {
    try {
      await scheduleStore.delete(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // --- Code Improvements ---

  ipcMain.handle('improvements:list', async (_, filter?: Record<string, unknown>) => {
    if (!codeImprovement) return [];
    return codeImprovement.list(filter as Parameters<typeof codeImprovement.list>[0]);
  });

  ipcMain.handle(
    'improvements:propose',
    async (_, agentId: string, title: string, description: string) => {
      if (!codeImprovement) return { success: false, error: 'Code improvement is disabled' };
      try {
        const improvement = await codeImprovement.propose(agentId, title, description);
        return { success: true, improvement };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('improvements:execute', async (_, improvementId: string) => {
    if (!codeImprovement) return { success: false, error: 'Code improvement is disabled' };
    try {
      const improvement = await codeImprovement.execute(improvementId);
      return { success: true, improvement };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('improvements:rollback', async (_, improvementId: string) => {
    if (!codeImprovement) return { success: false, error: 'Code improvement is disabled' };
    try {
      await codeImprovement.rollback(improvementId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('improvements:health', async () => {
    if (!codeImprovement) return { healthy: false, lastCheck: new Date().toISOString(), issues: ['Code improvement is disabled'] };
    return codeImprovement.getHealth();
  });
}
