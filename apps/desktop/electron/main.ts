import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} from 'electron';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createLogger, addLogTransport, type LogEntry } from '@jam/core';
import { Orchestrator } from './orchestrator';
import { saveConfig } from './config';

const log = createLogger('Main');

// --- Fix PATH for macOS GUI apps ---
// Electron apps on macOS don't inherit the shell PATH, so tools like
// 'claude', 'opencode', etc. won't be found. Resolve the real PATH from
// the user's login shell at startup.
function fixPath(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;

  try {
    const shell = process.env.SHELL || '/bin/zsh';
    // Use login (-l) but NOT interactive (-i) to avoid prompt/compinit noise
    const result = execSync(`${shell} -lc 'echo -n "$PATH"'`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (result && !result.includes('\n')) {
      process.env.PATH = result;
    }
  } catch {
    // Fallback: append common locations
  }

  // Always ensure common tool locations are in PATH
  const extras = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${process.env.HOME}/.local/bin`,
    `${process.env.HOME}/.cargo/bin`,
    '/opt/homebrew/sbin',
  ];
  const currentPath = process.env.PATH || '';
  const pathSet = new Set(currentPath.split(':'));
  const missing = extras.filter((p) => !pathSet.has(p));
  if (missing.length > 0) {
    process.env.PATH = `${currentPath}:${missing.join(':')}`;
  }
}

fixPath();
log.debug(`PATH resolved: ${process.env.PATH}`);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let orchestrator: Orchestrator;
let isQuitting = false;

// --- Log Buffer & IPC Transport ---
const LOG_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];

// Register a transport that buffers logs and forwards them to the renderer
addLogTransport((entry: LogEntry) => {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  mainWindow?.webContents.send('logs:entry', entry);
});

// --- Single instance lock ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// --- Window creation ---
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 12 },
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Dev or production loading
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Minimize to tray on close
  mainWindow.on('close', (event) => {
    if (tray && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Tray ---
function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Jam',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Stop All Agents',
      click: () => {
        orchestrator.agentManager.stopAll();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Jam - AI Agent Orchestrator');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

// --- IPC Handlers ---
function registerIpcHandlers(): void {
  // Agent management
  ipcMain.handle('agents:create', (_, profile) =>
    orchestrator.agentManager.create(profile),
  );
  ipcMain.handle('agents:update', (_, agentId, updates) =>
    orchestrator.agentManager.update(agentId, updates),
  );
  ipcMain.handle('agents:delete', (_, agentId) =>
    orchestrator.agentManager.delete(agentId),
  );
  ipcMain.handle('agents:list', () =>
    orchestrator.agentManager.list(),
  );
  ipcMain.handle('agents:get', (_, agentId) =>
    orchestrator.agentManager.get(agentId) ?? null,
  );
  ipcMain.handle('agents:start', (_, agentId) =>
    orchestrator.agentManager.start(agentId),
  );
  ipcMain.handle('agents:stop', (_, agentId) =>
    orchestrator.agentManager.stop(agentId),
  );
  ipcMain.handle('agents:restart', (_, agentId) =>
    orchestrator.agentManager.restart(agentId),
  );
  ipcMain.handle('agents:stopAll', () => {
    orchestrator.agentManager.stopAll();
    return { success: true };
  });

  // Terminal I/O
  ipcMain.on('terminal:write', (_, agentId: string, data: string) => {
    orchestrator.ptyManager.write(agentId, data);
  });
  ipcMain.on(
    'terminal:resize',
    (_, agentId: string, cols: number, rows: number) => {
      orchestrator.ptyManager.resize(agentId, cols, rows);
    },
  );
  ipcMain.handle('terminal:getScrollback', (_, agentId) =>
    orchestrator.ptyManager.getScrollback(agentId),
  );

  // Voice — routing is purely name-based (not driven by UI selection)
  let lastVoiceTargetId: string | null = null;

  ipcMain.on(
    'voice:audioChunk',
    async (_, _agentId: string, chunk: ArrayBuffer) => {
      if (!orchestrator.voiceService) {
        log.warn('Voice audio received but voice service not initialized');
        return;
      }

      try {
        log.debug(`Voice audio chunk received (${chunk.byteLength} bytes)`);
        const result = await orchestrator.voiceService.transcribe(
          Buffer.from(chunk),
        );

        log.info(`Transcribed: "${result.text}" (confidence: ${result.confidence})`);

        // Strip ambient noise — STT often transcribes background sounds as
        // parenthetical descriptions like "(door closes)", "(birds chirping)" etc.
        const cleaned = result.text.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        if (cleaned.length < 3) {
          log.debug(`Filtered noise transcription: "${result.text}"`);
          return;
        }

        const parsed = orchestrator.voiceService.parseCommand(cleaned);

        if (parsed.isMetaCommand) {
          log.info(`Voice meta command: ${parsed.command}`);
          return;
        }

        // Route purely by name — no UI selection fallback
        let targetId: string | undefined;

        if (parsed.targetAgentName) {
          targetId = orchestrator.voiceService.resolveAgentId(parsed.targetAgentName);
          if (!targetId) {
            log.warn(`Agent name "${parsed.targetAgentName}" not found`);
          }
        }

        // Fallback: last agent that was voice-commanded, then first running agent
        if (!targetId && lastVoiceTargetId) {
          targetId = lastVoiceTargetId;
          log.debug(`Routing to last voice target: ${targetId}`);
        }
        if (!targetId) {
          const running = orchestrator.agentManager.list().filter((a) => a.status === 'running');
          if (running.length === 1) {
            targetId = running[0].profile.id;
            log.debug(`Routing to only running agent: ${targetId}`);
          } else if (running.length > 1) {
            log.warn(`No agent name detected and ${running.length} agents running — say the agent's name`);
            return;
          }
        }

        if (targetId && parsed.command) {
          lastVoiceTargetId = targetId;
          const agent = orchestrator.agentManager.get(targetId);
          log.info(`Voice → "${agent?.profile.name ?? targetId}": "${parsed.command}"`);
          orchestrator.agentManager.voiceCommand(targetId, parsed.command).catch((err) => {
            log.error(`Voice command execution failed: ${String(err)}`);
          });
        } else {
          log.warn(`Voice command not routed: no target agent found`);
        }
      } catch (error) {
        log.error(`Voice transcription error: ${String(error)}`);
      }
    },
  );

  ipcMain.handle(
    'voice:requestTTS',
    async (_, agentId: string, text: string) => {
      if (!orchestrator.voiceService) {
        return { success: false, error: 'Voice service not initialized' };
      }

      const agent = orchestrator.agentManager.get(agentId);
      if (!agent) return { success: false, error: 'Agent not found' };

      try {
        const voiceId = (agent.profile.voice.ttsVoiceId && agent.profile.voice.ttsVoiceId !== 'default')
          ? agent.profile.voice.ttsVoiceId
          : orchestrator.config.ttsVoice;
        const audioPath = await orchestrator.voiceService.synthesize(
          text,
          voiceId,
          agentId,
        );
        return { success: true, audioPath };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // Memory
  ipcMain.handle('memory:load', (_, agentId) =>
    orchestrator.memoryStore.load(agentId),
  );
  ipcMain.handle('memory:save', async (_, agentId, memory) => {
    try {
      await orchestrator.memoryStore.save(agentId, memory);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Config
  ipcMain.handle('config:get', () => orchestrator.config);
  ipcMain.handle('config:set', (_, config) => {
    Object.assign(orchestrator.config, config);
    saveConfig(orchestrator.config);
    // Re-initialize voice if provider changed
    orchestrator.initVoice();
    return { success: true };
  });

  // API Keys — don't call initVoice() here; config:set always follows and handles it
  ipcMain.handle('apiKeys:set', (_, service: string, key: string) => {
    orchestrator.appStore.setApiKey(service, key);
    return { success: true };
  });
  ipcMain.handle('apiKeys:has', (_, service: string) => {
    return orchestrator.appStore.getApiKey(service) !== null;
  });
  ipcMain.handle('apiKeys:delete', (_, service: string) => {
    orchestrator.appStore.setApiKey(service, '');
    return { success: true };
  });

  // Window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:close', () => mainWindow?.hide());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  // App
  ipcMain.handle('app:getVersion', () => app.getVersion());

  // Logs
  ipcMain.handle('logs:get', () => logBuffer);
}

// --- App lifecycle ---
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  orchestrator = new Orchestrator();

  createWindow();
  createTray();
  registerIpcHandlers();

  if (mainWindow) {
    orchestrator.setMainWindow(mainWindow);
  }

  // Initialize voice if API keys are present
  orchestrator.initVoice();

  // Start health checks
  orchestrator.agentManager.startHealthCheck();

  // Auto-start configured agents
  orchestrator.startAutoStartAgents();

  log.info('App started successfully');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
    if (mainWindow) {
      orchestrator.setMainWindow(mainWindow);
    }
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  orchestrator.shutdown();
});
