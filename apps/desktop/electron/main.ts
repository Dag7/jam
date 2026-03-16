import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  net,
  powerMonitor,
  protocol,
  systemPreferences,
} from 'electron';
import path, { join } from 'node:path';
import { homedir } from 'node:os';
import { appendFileSync, renameSync, statSync, mkdirSync } from 'node:fs';
import { createLogger, addLogTransport, Batcher, TimeoutTimer, type LogEntry } from '@jam/core';
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
import { registerBrainHandlers } from './ipc/brain-handlers';
import { registerSandboxHandlers } from './ipc/sandbox-handlers';
import { registerAuthHandlers } from './ipc/auth-handlers';

const log = createLogger('Main');

// --- Fix PATH for macOS/Linux GUI apps ---
fixPath();

// Prepend ~/.jam/bin so agents can use the `jam` CLI tool
const jamBinDir = join(homedir(), '.jam', 'bin');
process.env.PATH = `${jamBinDir}:${process.env.PATH}`;

log.debug(`PATH resolved: ${process.env.PATH}`);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let orchestrator: Orchestrator;
let isQuitting = false;

// --- Crash safety: prevent the process from becoming a zombie ---
process.on('uncaughtException', (err) => {
  log.error(`Uncaught exception: ${err.message}\n${err.stack}`);
  // Give a brief window for the log to flush, then force exit
  setTimeout(() => process.exit(1), 1000);
});
process.on('unhandledRejection', (reason) => {
  log.error(`Unhandled rejection: ${String(reason)}`);
});

// --- HMR cleanup ---
if (process.env.VITE_DEV_SERVER_URL) {
  const hmrCleanup = async () => {
    try {
      if (orchestrator) await orchestrator.shutdown(true);
    } catch {
      // Best-effort cleanup during HMR
    }
  };
  process.on('exit', () => {
    // Sync context — can't await, best-effort only
    try { if (orchestrator) orchestrator.shutdown(true); } catch { /* ignore */ }
  });
  process.on('SIGHUP', () => {
    hmrCleanup().finally(() => process.exit(0));
  });
}

// --- Log Buffer & IPC Transport (batched) ---
const LOG_BUFFER_SIZE = 1000;
const logBuffer: LogEntry[] = [];

const logBatcher = new Batcher<LogEntry[]>(
  200,
  (batch) => {
    const entries = batch.get('logs');
    if (!entries || entries.length === 0) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('logs:batch', entries);
    }
  },
  (existing, incoming) => { existing.push(...incoming); return existing; },
);

// --- Persistent log file transport with rotation ---
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
let logFilePath: string | null = null;
let logFileReady = false;

// app.getPath() is only available after 'ready', so we defer setup
app.whenReady().then(() => {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    mkdirSync(logDir, { recursive: true });
    logFilePath = path.join(logDir, 'jam.log');
    logFileReady = true;
  } catch { /* best-effort */ }
});

function writeToLogFile(entry: LogEntry): void {
  if (!logFileReady || !logFilePath) return;
  try {
    // Rotate if over size limit
    try {
      const st = statSync(logFilePath);
      if (st.size > LOG_MAX_BYTES) {
        const rotated = logFilePath + '.1';
        renameSync(logFilePath, rotated);
      }
    } catch { /* file may not exist yet */ }

    const line = `${entry.timestamp} [${entry.level.toUpperCase()}] [${entry.scope}]${entry.agentId ? ` (${entry.agentId.slice(0, 8)})` : ''} ${entry.message}\n`;
    appendFileSync(logFilePath, line, 'utf-8');
  } catch { /* best-effort */ }
}

addLogTransport((entry: LogEntry) => {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  logBatcher.add('logs', [entry]);
  writeToLogFile(entry);
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
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Detect renderer crash (OOM, GPU crash, etc.) — trigger immediate shutdown
  // to prevent the main process from becoming an unkillable zombie.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error(`Renderer crashed: ${details.reason} (exit code ${details.exitCode})`);
    if (!isQuitting) {
      isQuitting = true;
      // Don't wait for graceful shutdown — the renderer is already dead.
      // Kill agents/PTYs synchronously, then force exit.
      try {
        orchestrator?.agentManager.stopAll();
        orchestrator?.ptyManager.killAll();
      } catch { /* best-effort */ }
      if (tray) { tray.destroy(); tray = null; }
      setTimeout(() => process.exit(1), 500);
    }
  });

  mainWindow.on('close', (event) => {
    if (tray && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('unresponsive', () => {
    log.warn('Renderer became unresponsive');
  });
  mainWindow.webContents.on('responsive', () => {
    log.info('Renderer became responsive again');
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
    blackboard: orchestrator.blackboard,
  });
  registerBrainHandlers({
    brainClient: orchestrator.brainClient,
  });
  registerSandboxHandlers({
    worktreeManager: orchestrator.worktreeManager,
    mergeService: orchestrator.mergeService,
    config: orchestrator.config,
    desktopPortResolver: orchestrator.containerManager && 'getNoVncPort' in orchestrator.containerManager
      ? orchestrator.containerManager as unknown as { getNoVncPort(agentId: string): number | undefined }
      : null,
  });
  registerAuthHandlers({
    runtimeRegistry: orchestrator.runtimeRegistry,
    appStore: orchestrator.appStore,
    getSandboxTier: () => orchestrator.config.sandboxTier,
  });

  // App + Logs (trivial, kept inline)
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('logs:get', () => logBuffer);
}

// --- App lifecycle ---
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  // Custom protocol to serve local files (avatars, etc.) from the renderer.
  // Sandboxed renderers can't load file:// URLs, so we use jam-local:// instead.
  protocol.handle('jam-local', (request) => {
    // URL format: jam-local:///absolute/path/to/file
    const filePath = decodeURIComponent(new URL(request.url).pathname);
    return net.fetch(`file://${filePath}`);
  });

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

  // --- System suspend/resume handling ---
  // Prevent false health-check failures and stale renderer state after sleep/lock.
  // Uses a shared TimeoutTimer so rapid suspend/resume cycles don't stack restarts.
  const healthResumeTimer = new TimeoutTimer();

  powerMonitor.on('suspend', () => {
    log.info('System suspending — pausing health check');
    healthResumeTimer.cancel();
    orchestrator.agentManager.stopHealthCheck();
    orchestrator.serviceRegistry.stopHealthMonitor();
  });
  powerMonitor.on('lock-screen', () => {
    log.info('Screen locked — pausing health check');
    healthResumeTimer.cancel();
    orchestrator.agentManager.stopHealthCheck();
    orchestrator.serviceRegistry.stopHealthMonitor();
  });
  powerMonitor.on('resume', () => {
    log.info('System resumed — restarting health checks after grace period');
    healthResumeTimer.cancelAndSet(() => {
      orchestrator.agentManager.startHealthCheck();
      orchestrator.serviceRegistry.startHealthMonitor();
    }, 5000);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system:resumed');
    }
  });
  powerMonitor.on('unlock-screen', () => {
    log.info('Screen unlocked — restarting health checks after grace period');
    healthResumeTimer.cancelAndSet(() => {
      orchestrator.agentManager.startHealthCheck();
      orchestrator.serviceRegistry.startHealthMonitor();
    }, 5000);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('system:resumed');
    }
  });

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

let shutdownComplete = false;

/** Hard deadline — if the process is still alive after this, force exit.
 *  Keeps the timeout short (3s) because orchestrator.shutdown() already
 *  has per-operation timeouts internally. */
const SHUTDOWN_TIMEOUT_MS = 3000;

app.on('before-quit', (event) => {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }

  if (!shutdownComplete) {
    event.preventDefault();

    // Absolute safety net: process.exit() as the hard backstop.
    // app.quit() goes through the Electron event loop which itself may be stuck.
    const forceExitTimer = setTimeout(() => {
      log.warn(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms — force exiting`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    orchestrator.shutdown().finally(() => {
      clearTimeout(forceExitTimer);
      shutdownComplete = true;
      app.quit();
    });
  }
});

// Graceful shutdown on signals (Ctrl+C, kill, etc.)
// Without these, agent PTY processes and spawned services become orphans.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info(`Received ${sig} — shutting down`);
    isQuitting = true;
    if (!shutdownComplete) {
      const forceTimer = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
      orchestrator.shutdown().finally(() => {
        clearTimeout(forceTimer);
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
}
