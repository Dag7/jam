import { ipcMain } from 'electron';
import type { BrainClient } from '@jam/brain';

/** Narrow dependency interface — only what brain handlers need */
export interface BrainHandlerDeps {
  brainClient: BrainClient | null;
}

export function registerBrainHandlers(deps: BrainHandlerDeps): void {
  const { brainClient } = deps;

  ipcMain.handle('brain:health', async () => {
    if (!brainClient) return { healthy: false, error: 'Brain is disabled' };
    const healthy = await brainClient.health();
    return { healthy };
  });

  ipcMain.handle('brain:search', async (_, agentId: string, query: string, limit?: number) => {
    if (!brainClient) return { results: [], error: 'Brain is disabled' };
    try {
      const results = await brainClient.search(agentId, query, limit);
      return { results };
    } catch (error) {
      return { results: [], error: String(error) };
    }
  });

  ipcMain.handle('brain:consolidate', async (_, agentId: string) => {
    if (!brainClient) return { success: false, error: 'Brain is disabled' };
    try {
      await brainClient.consolidate(agentId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
