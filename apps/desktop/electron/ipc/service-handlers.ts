import { ipcMain, shell } from 'electron';
import type { ServiceRegistry } from '@jam/agent-runtime';

/** Narrow dependency interface — only what service handlers need */
export interface ServiceHandlerDeps {
  serviceRegistry: ServiceRegistry;
  scanServices: () => Promise<void>;
}

export function registerServiceHandlers(deps: ServiceHandlerDeps): void {
  const { serviceRegistry, scanServices } = deps;

  ipcMain.handle('services:list', async () => {
    await scanServices();
    return serviceRegistry.list();
  });

  ipcMain.handle('services:listForAgent', async (_, agentId: string) => {
    await scanServices();
    return serviceRegistry.listForAgent(agentId);
  });

  ipcMain.handle('services:stop', async (_, port: number) => {
    const success = await serviceRegistry.stopService(port);
    return { success };
  });

  ipcMain.handle('services:restart', async (_, serviceName: string) => {
    return serviceRegistry.restartService(serviceName);
  });

  ipcMain.handle('services:openUrl', (_, port: number) => {
    // Validate port range to prevent URL injection
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { success: false };
    }
    try {
      shell.openExternal(`http://localhost:${port}`);
      return { success: true };
    } catch {
      return { success: false };
    }
  });
}
