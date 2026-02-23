import { ipcMain } from 'electron';
import type { PtyManager } from '@jam/agent-runtime';

/** Narrow dependency interface — only what terminal handlers need */
export interface TerminalHandlerDeps {
  ptyManager: PtyManager;
}

export function registerTerminalHandlers(deps: TerminalHandlerDeps): void {
  const { ptyManager } = deps;

  ipcMain.on('terminal:write', (_, agentId: string, data: string) => {
    ptyManager.write(agentId, data);
  });

  ipcMain.on(
    'terminal:resize',
    (_, agentId: string, cols: number, rows: number) => {
      ptyManager.resize(agentId, cols, rows);
    },
  );

  ipcMain.handle('terminal:getScrollback', (_, agentId) =>
    ptyManager.getScrollback(agentId),
  );
}
