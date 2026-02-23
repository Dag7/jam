import { ipcMain } from 'electron';
import type { AgentManager } from '@jam/agent-runtime';
import type { FileMemoryStore } from '@jam/memory';
import type { AppStore } from '../storage/store';
import { saveConfig, type JamConfig } from '../config';

/** Narrow dependency interface — only what config handlers need */
export interface ConfigHandlerDeps {
  config: JamConfig;
  appStore: AppStore;
  agentManager: AgentManager;
  memoryStore: FileMemoryStore;
  initVoice: () => void;
}

export function registerConfigHandlers(deps: ConfigHandlerDeps): void {
  const { config, appStore, agentManager, memoryStore, initVoice } = deps;

  // Config
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:set', (_, updates) => {
    Object.assign(config, updates);
    saveConfig(config);
    initVoice();
    return { success: true };
  });

  // API Keys
  ipcMain.handle('apiKeys:set', (_, service: string, key: string) => {
    appStore.setApiKey(service, key);
    return { success: true };
  });
  ipcMain.handle('apiKeys:has', (_, service: string) => {
    return appStore.getApiKey(service) !== null;
  });
  ipcMain.handle('apiKeys:delete', (_, service: string) => {
    appStore.setApiKey(service, '');
    return { success: true };
  });

  // Secrets vault
  ipcMain.handle('secrets:list', () => {
    return appStore.getSecrets();
  });
  ipcMain.handle('secrets:set', (_, id: string, name: string, type: string, value: string) => {
    appStore.setSecret(id, name, type, value);
    agentManager.rebuildRedactor();
    return { success: true };
  });
  ipcMain.handle('secrets:delete', (_, id: string) => {
    appStore.deleteSecret(id);
    agentManager.rebuildRedactor();
    return { success: true };
  });

  // Memory
  ipcMain.handle('memory:load', (_, agentId) =>
    memoryStore.load(agentId),
  );
  ipcMain.handle('memory:save', async (_, agentId, memory) => {
    try {
      await memoryStore.save(agentId, memory);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
