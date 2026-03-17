import { ipcMain, type BrowserWindow, app } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@jam/core';
import type { JamConfig } from '../config';

const log = createLogger('AutoUpdater');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface UpdateHandlerDeps {
  getWindow: () => BrowserWindow | null;
  config: JamConfig;
}

/** Read/write the last update check timestamp from a simple file */
function getLastCheckPath(): string {
  return join(app.getPath('userData'), '.last-update-check');
}

function getLastCheckTime(): number {
  try {
    return parseInt(readFileSync(getLastCheckPath(), 'utf-8').trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function setLastCheckTime(): void {
  try {
    writeFileSync(getLastCheckPath(), String(Date.now()), 'utf-8');
  } catch { /* best-effort */ }
}

export function registerUpdateHandlers({ getWindow, config }: UpdateHandlerDeps): void {
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (channel: string, data?: unknown) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  };

  // --- Event forwarding to renderer ---

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info(`Update available: v${info.version}`);
    setLastCheckTime();
    send('updater:available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n) => n.note).join('\n')
          : '',
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('No updates available');
    setLastCheckTime();
    send('updater:not-available');
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    send('updater:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info(`Update downloaded: v${info.version}`);
    send('updater:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    log.error(`Update error: ${err.message}`);
    send('updater:error', { message: err.message });
  });

  // --- IPC handlers ---

  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) {
      return { success: false, error: 'Updates not available in dev mode' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, version: result?.updateInfo.version };
    } catch (err) {
      send('updater:error', { message: String(err) });
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('updater:getAutoUpdate', () => {
    return config.autoUpdate !== false;
  });

  // Auto-check on startup: only if packaged, enabled, AND last check was >24h ago
  if (!app.isPackaged) {
    log.debug('Skipping startup update check — app is not packaged (dev mode)');
  } else if (config.autoUpdate !== false) {
    const elapsed = Date.now() - getLastCheckTime();
    if (elapsed >= CHECK_INTERVAL_MS) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
          log.debug(`Startup update check failed: ${err.message}`);
        });
      }, 30_000);
    } else {
      log.debug(`Skipping startup update check — last check ${Math.round(elapsed / 60_000)}m ago`);
    }
  }
}
