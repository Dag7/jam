import { ipcMain } from 'electron';
import type { ICommunicationHub, IRelationshipStore, IStatsStore } from '@jam/core';
import type { SoulManager, SelfImprovementEngine } from '@jam/team';

export interface TeamHandlerDeps {
  communicationHub: ICommunicationHub;
  relationshipStore: IRelationshipStore;
  statsStore: IStatsStore;
  soulManager: SoulManager;
  selfImprovement: SelfImprovementEngine;
}

export function registerTeamHandlers(deps: TeamHandlerDeps): void {
  const { communicationHub, relationshipStore, statsStore, soulManager, selfImprovement } = deps;

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
      const context = await selfImprovement.gatherContext(agentId);
      // Return the prompt for the renderer to display or for the agent to process
      const prompt = selfImprovement.buildReflectionPrompt(context);
      return { success: true, prompt, context };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
