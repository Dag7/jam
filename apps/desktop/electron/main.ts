import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} from 'electron';
import path from 'node:path';
import { Orchestrator } from './orchestrator';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let orchestrator: Orchestrator;
let isQuitting = false;

// --- Log Buffer (identical to whatsapp-relay pattern) ---
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  agentId?: string;
}

const LOG_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];

function pushLog(
  level: LogEntry['level'],
  args: unknown[],
  agentId?: string,
): void {
  const message = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    agentId,
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  mainWindow?.webContents.send('logs:entry', entry);
}

// Capture console output
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
console.log = (...args) => {
  originalLog(...args);
  pushLog('info', args);
};
console.warn = (...args) => {
  originalWarn(...args);
  pushLog('warn', args);
};
console.error = (...args) => {
  originalError(...args);
  pushLog('error', args);
};

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

  // Voice
  ipcMain.on(
    'voice:audioChunk',
    async (_, agentId: string, chunk: ArrayBuffer) => {
      if (!orchestrator.voiceService) return;

      try {
        const result = await orchestrator.voiceService.transcribe(
          Buffer.from(chunk),
        );

        const parsed = orchestrator.voiceService.parseCommand(result.text);

        if (parsed.isMetaCommand) {
          // Meta commands handled by orchestrator
          console.log(`[Voice] Meta command: ${parsed.command}`);
          return;
        }

        // Route to agent
        const targetId = parsed.targetAgentName
          ? orchestrator.voiceService.resolveAgentId(parsed.targetAgentName)
          : agentId;

        if (targetId && parsed.command) {
          orchestrator.agentManager.sendInput(targetId, parsed.command);
        }
      } catch (error) {
        console.error('[Voice] Transcription error:', error);
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
        const audioPath = await orchestrator.voiceService.synthesize(
          text,
          agent.profile.voice.ttsVoiceId,
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

  console.log('[Jam] App started successfully');
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
