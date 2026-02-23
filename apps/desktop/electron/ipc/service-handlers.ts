import { ipcMain, shell } from 'electron';
import type { ServiceRegistry } from '@jam/agent-runtime';

/** Narrow dependency interface — only what service handlers need */
export interface ServiceHandlerDeps {
  serviceRegistry: ServiceRegistry;
  scanServices: () => void;
}

export function registerServiceHandlers(deps: ServiceHandlerDeps): void {
  const { serviceRegistry, scanServices } = deps;

  ipcMain.handle('services:list', async () => {
    scanServices();
    await new Promise(r => setTimeout(r, 50));
    return serviceRegistry.list();
  });

  ipcMain.handle('services:stop', (_, pid: number) => {
    const success = serviceRegistry.stopService(pid);
    return { success };
  });

  ipcMain.handle('services:openUrl', (_, port: number) => {
    try {
      shell.openExternal(`http://localhost:${port}`);
      return { success: true };
    } catch {
      return { success: false };
    }
  });
}
