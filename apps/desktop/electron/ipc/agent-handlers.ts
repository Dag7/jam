import { ipcMain } from 'electron';
import type { AgentManager, RuntimeRegistry } from '@jam/agent-runtime';

/** Narrow dependency interface — only what agent handlers need */
export interface AgentHandlerDeps {
  runtimeRegistry: RuntimeRegistry;
  agentManager: AgentManager;
}

/** Ensure Claude Code's --dangerously-skip-permissions prompt is pre-accepted */
export function ensureClaudePermissionAccepted(): void {
  try {
    const fs = require('node:fs');
    const settingsPath = `${process.env.HOME}/.claude/settings.json`;
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      // File might not exist yet — create it
    }
    if (!settings.skipDangerousModePermissionPrompt) {
      settings.skipDangerousModePermissionPrompt = true;
      const dir = `${process.env.HOME}/.claude`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    }
  } catch {
    // Best-effort
  }
}

export function registerAgentHandlers(deps: AgentHandlerDeps): void {
  const { runtimeRegistry, agentManager } = deps;

  ipcMain.handle('runtimes:listMetadata', () =>
    runtimeRegistry.listMetadata(),
  );

  ipcMain.handle('agents:create', (_, profile) =>
    agentManager.create(profile),
  );
  ipcMain.handle('agents:update', (_, agentId, updates) =>
    agentManager.update(agentId, updates),
  );
  ipcMain.handle('agents:delete', (_, agentId) =>
    agentManager.delete(agentId),
  );
  ipcMain.handle('agents:list', () =>
    agentManager.list(),
  );
  ipcMain.handle('agents:get', (_, agentId) =>
    agentManager.get(agentId) ?? null,
  );
  ipcMain.handle('agents:start', (_, agentId) => {
    const agent = agentManager.get(agentId);
    if (agent?.profile.allowFullAccess) {
      const rt = runtimeRegistry.get(agent.profile.runtime);
      if (rt?.metadata.supportsFullAccess) {
        ensureClaudePermissionAccepted();
      }
    }
    return agentManager.start(agentId);
  });
  ipcMain.handle('agents:stop', (_, agentId) =>
    agentManager.stop(agentId),
  );
  ipcMain.handle('agents:restart', (_, agentId) =>
    agentManager.restart(agentId),
  );
  ipcMain.handle('agents:stopAll', () => {
    agentManager.stopAll();
    return { success: true };
  });

  ipcMain.handle('agents:getTaskStatus', (_, agentId: string) => {
    return agentManager.getTaskStatus(agentId);
  });
}
