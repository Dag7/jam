import { ipcMain } from 'electron';
import type { AgentManager } from '@jam/agent-runtime';
import type { BrainMemoryStore } from '@jam/brain';
import type { AppStore } from '../storage/store';
import { saveConfig, type JamConfig } from '../config';

/** Narrow dependency interface — only what config handlers need */
export interface ConfigHandlerDeps {
  config: JamConfig;
  appStore: AppStore;
  agentManager: AgentManager;
  memoryStore: BrainMemoryStore;
  initVoice: () => void;
}

/** Allowed top-level config keys — prevents renderer from injecting arbitrary properties */
const ALLOWED_CONFIG_KEYS = new Set<string>([
  'sttProvider', 'ttsProvider', 'sttModel', 'ttsVoice', 'ttsSpeed',
  'defaultModel', 'defaultRuntime', 'theme', 'voiceSensitivity',
  'minRecordingMs', 'noSpeechThreshold', 'noiseBlocklist',
  'modelTiers', 'teamRuntime', 'scheduleCheckIntervalMs',
  'codeImprovement', 'sandbox', 'brainUrl',
]);

export function registerConfigHandlers(deps: ConfigHandlerDeps): void {
  const { config, appStore, agentManager, memoryStore, initVoice } = deps;

  // Config
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:set', (_, updates) => {
    // Only allow known config keys to prevent prototype pollution or arbitrary injection
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(updates)) {
      if (ALLOWED_CONFIG_KEYS.has(key)) {
        sanitized[key] = updates[key];
      }
    }
    // Deep merge nested objects to preserve unset fields
    for (const key of Object.keys(sanitized)) {
      const val = sanitized[key];
      if (val && typeof val === 'object' && !Array.isArray(val) && key in config) {
        const existing = (config as Record<string, unknown>)[key];
        if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
          (config as Record<string, unknown>)[key] = { ...existing, ...val };
          continue;
        }
      }
      (config as Record<string, unknown>)[key] = val;
    }
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
