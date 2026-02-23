import { ipcMain, type BrowserWindow } from 'electron';
import { createLogger } from '@jam/core';
import type { AgentManager } from '@jam/agent-runtime';
import type { CommandParser } from '@jam/voice';
import type { CommandRouter } from '../command-router';

const log = createLogger('ChatHandlers');

/** Narrow dependency interface — only what chat handlers need */
export interface ChatHandlerDeps {
  commandParser: CommandParser;
  agentManager: AgentManager;
}

export function registerChatHandlers(
  deps: ChatHandlerDeps,
  router: CommandRouter,
  getWindow: () => BrowserWindow | null,
): void {
  const { commandParser, agentManager } = deps;

  ipcMain.handle('chat:sendCommand', async (_, text: string) => {
    // Handle /status command
    const statusMatch = text.match(/^\/status\s*(.*)/i);
    if (statusMatch) {
      const agentName = statusMatch[1].trim().toLowerCase();
      let targetId: string | undefined;
      if (agentName) {
        targetId = commandParser.resolveAgentId(agentName);
      }
      if (!targetId) {
        // Use router's resolve logic for fallback
        targetId = router.resolveTarget(
          { targetAgentName: null, command: text, isMetaCommand: false, commandType: 'status-query' },
          'text',
        );
      }
      if (!targetId) return { success: false, error: 'No agent specified. Use /status <agent-name>' };
      return router.handleStatusQuery(targetId);
    }

    const parsed = commandParser.parse(text);

    if (parsed.isMetaCommand) {
      return { success: false, error: 'Meta commands not yet supported via text' };
    }

    const targetId = router.resolveTarget(parsed, 'text');

    if (!targetId) {
      if (parsed.targetAgentName) {
        return { success: false, error: `Agent "${parsed.targetAgentName}" not found` };
      }
      const running = router.getRunningAgentNames();
      if (running.length === 0) {
        return { success: false, error: 'No agents running' };
      }
      return {
        success: false,
        error: `Multiple agents running — say the agent's name (${running.join(', ')})`,
      };
    }

    router.recordTarget(targetId, 'text');
    const info = router.getAgentInfo(targetId);
    if (!info) return { success: false, error: 'Agent not found' };

    // Dispatch special command types via registry (status-query, interrupt, etc.)
    const dispatched = router.dispatch(targetId, parsed);
    if (dispatched) return dispatched;

    log.info(`Chat → "${info.agentName}": "${parsed.command.slice(0, 60)}"`, undefined, targetId);

    const { promise, queuePosition } = agentManager.enqueueCommand(targetId, parsed.command, 'text');

    if (queuePosition > 0) {
      const win = getWindow();
      win?.webContents.send('chat:messageQueued', {
        agentId: targetId,
        agentName: info.agentName,
        agentRuntime: info.agentRuntime,
        agentColor: info.agentColor,
        queuePosition,
        command: parsed.command.slice(0, 60),
      });
    }

    const result = await promise;

    return {
      success: result.success,
      text: result.text,
      error: result.error,
      agentId: targetId,
      agentName: info.agentName,
      agentRuntime: info.agentRuntime,
      agentColor: info.agentColor,
    };
  });

  ipcMain.handle('chat:interruptAgent', (_, agentId: string) => {
    return router.handleInterrupt(agentId);
  });

  ipcMain.handle('chat:loadHistory', async (_, options?: { agentId?: string; before?: string; limit?: number }) => {
    return agentManager.loadConversationHistory(options);
  });
}
