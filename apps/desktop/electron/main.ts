import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  systemPreferences,
} from 'electron';
import path from 'node:path';
import { createLogger, addLogTransport, type LogEntry } from '@jam/core';
import { Orchestrator } from './orchestrator';
import { CommandRouter } from './command-router';
import { fixPath } from './utils/path-fix';
import { registerAgentHandlers, ensureClaudePermissionAccepted } from './ipc/agent-handlers';
import { registerTerminalHandlers } from './ipc/terminal-handlers';
import { registerVoiceHandlers } from './ipc/voice-handlers';
import { registerChatHandlers } from './ipc/chat-handlers';
import { registerConfigHandlers } from './ipc/config-handlers';
import { registerWindowHandlers } from './ipc/window-handlers';
import { registerSetupHandlers } from './ipc/setup-handlers';
import { registerServiceHandlers } from './ipc/service-handlers';
import { registerTaskHandlers } from './ipc/task-handlers';
import { registerTeamHandlers } from './ipc/team-handlers';

const log = createLogger('Main');

// --- Fix PATH for macOS/Linux GUI apps ---
fixPath();
log.debug(`PATH resolved: ${process.env.PATH}`);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let orchestrator: Orchestrator;
let isQuitting = false;

// --- HMR cleanup ---
if (process.env.VITE_DEV_SERVER_URL) {
  const hmrCleanup = () => {
    try {
      if (orchestrator) orchestrator.shutdown();
    } catch {
      // Best-effort cleanup during HMR
    }
  };
  process.on('exit', hmrCleanup);
  process.on('SIGHUP', () => {
    hmrCleanup();
    process.exit(0);
  });
}

// --- Log Buffer & IPC Transport ---
const LOG_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];

addLogTransport((entry: LogEntry) => {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('logs:entry', entry);
  }
});

// --- Single instance lock ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
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

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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
  const trayIconPath = path.join(__dirname, '../assets/tray-icon.png');
  const icon = nativeImage.createFromPath(trayIconPath);
  icon.setTemplateImage(true);
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

// --- IPC Handler Registration ---
function registerIpcHandlers(): void {
  const getWindow = () => mainWindow;

  const router = new CommandRouter(
    orchestrator.agentManager,
    orchestrator.commandParser,
    orchestrator.voiceService,
  );

  // Register domain-specific handler modules with narrow deps
  registerAgentHandlers({
    runtimeRegistry: orchestrator.runtimeRegistry,
    agentManager: orchestrator.agentManager,
  });
  registerTerminalHandlers({
    ptyManager: orchestrator.ptyManager,
  });
  registerVoiceHandlers({
    getVoiceService: () => orchestrator.voiceService,
    agentManager: orchestrator.agentManager,
    config: orchestrator.config,
    speakToRenderer: (id, text) => orchestrator.speakToRenderer(id, text),
  }, router, getWindow);
  registerChatHandlers({
    commandParser: orchestrator.commandParser,
    agentManager: orchestrator.agentManager,
  }, router, getWindow);
  registerConfigHandlers({
    config: orchestrator.config,
    appStore: orchestrator.appStore,
    agentManager: orchestrator.agentManager,
    memoryStore: orchestrator.memoryStore,
    initVoice: () => orchestrator.initVoice(),
  });
  registerWindowHandlers(getWindow);
  registerSetupHandlers({
    runtimeRegistry: orchestrator.runtimeRegistry,
    appStore: orchestrator.appStore,
    initVoice: () => orchestrator.initVoice(),
  });
  registerServiceHandlers({
    serviceRegistry: orchestrator.serviceRegistry,
    scanServices: () => orchestrator.scanServices(),
  });
  registerTaskHandlers({
    taskStore: orchestrator.taskStore,
    scheduleStore: orchestrator.scheduleStore,
    taskExecutor: orchestrator.taskExecutor,
  });
  registerTeamHandlers({
    communicationHub: orchestrator.communicationHub,
    relationshipStore: orchestrator.relationshipStore,
    statsStore: orchestrator.statsStore,
    soulManager: orchestrator.soulManager,
    selfImprovement: orchestrator.selfImprovement,
    scheduleStore: orchestrator.scheduleStore,
    codeImprovement: orchestrator.codeImprovement,
  });

  // App + Logs (trivial, kept inline)
  ipcMain.handle('app:getVersion', () => app.getVersion());
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

  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('microphone').then((granted) => {
      if (!granted) {
        log.warn('Microphone permission denied — voice commands will not work');
      }
    }).catch((err) => {
      log.warn(`Microphone permission request failed: ${String(err)}`);
    });
  }

  orchestrator.initVoice();
  orchestrator.agentManager.startHealthCheck();

  const needsPermissionSetup = orchestrator.agentManager.list().some((a) => {
    if (!a.profile.allowFullAccess || !a.profile.autoStart) return false;
    const rt = orchestrator.runtimeRegistry.get(a.profile.runtime);
    return rt?.metadata.supportsFullAccess;
  });
  if (needsPermissionSetup) {
    ensureClaudePermissionAccepted();
  }

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
  if (tray) {
    tray.destroy();
    tray = null;
  }
  orchestrator.shutdown();
});
