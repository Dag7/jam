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

// --- Ensure Claude Code's --dangerously-skip-permissions prompt is pre-accepted ---
// Claude Code shows a confirmation dialog every time --dangerously-skip-permissions
// is used unless `skipDangerousModePermissionPrompt: true` is in settings.json.
// In a PTY context nobody can answer the prompt, so the agent hangs/crashes.
function ensureClaudePermissionAccepted(): void {
  try {
    const fs = require('node:fs');
    const settingsPath = `${process.env.HOME}/.claude/settings.json`;
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      // File might not exist yet — create it
    }
    if (!settings.skipDangerousModePermissionPrompt) {
      settings.skipDangerousModePermissionPrompt = true;
      const dir = `${process.env.HOME}/.claude`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      log.info('Set skipDangerousModePermissionPrompt in Claude settings');
    }
  } catch (err) {
    log.warn(`Could not update Claude settings: ${String(err)}`);
  }
}

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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('logs:entry', entry);
  }
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
  ipcMain.handle('agents:start', (_, agentId) => {
    // Pre-accept the --dangerously-skip-permissions prompt for Claude Code agents
    const agent = orchestrator.agentManager.get(agentId);
    if (agent?.profile.runtime === 'claude-code' && agent.profile.allowFullAccess) {
      ensureClaudePermissionAccepted();
    }
    return orchestrator.agentManager.start(agentId);
  });
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
  const voiceCommandsInFlight = new Set<string>(); // per-agent guard
  let ttsSpeaking = false;

  /** Send a system message to the chat UI + speak it via TTS */
  function sendStatusMessage(targetId: string, message: string): void {
    const agent = orchestrator.agentManager.get(targetId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('chat:agentAcknowledged', {
        agentId: targetId,
        agentName: agent?.profile.name ?? 'Agent',
        agentRuntime: agent?.profile.runtime ?? '',
        agentColor: agent?.profile.color ?? '#6b7280',
        ackText: message,
      });
    }
    // Speak the status via TTS
    if (orchestrator.voiceService && agent) {
      orchestrator.voiceService.synthesize(
        message,
        agent.profile.voice.ttsVoiceId || 'alloy',
        targetId,
      ).then(async (audioPath) => {
        const { readFile } = await import('node:fs/promises');
        const audioBuffer = await readFile(audioPath);
        const base64 = audioBuffer.toString('base64');
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('voice:ttsAudio', {
            agentId: targetId,
            audioData: `data:audio/mpeg;base64,${base64}`,
          });
        }
      }).catch((err) => {
        log.error(`TTS status failed: ${String(err)}`);
      });
    }
  }

  // TTS playback state is driven by the renderer (which actually plays audio).
  // The renderer calls voice:ttsState(true) when audio starts, false when it
  // finishes or is interrupted by the user speaking.
  ipcMain.on('voice:ttsState', (_, playing: boolean) => {
    ttsSpeaking = playing;
    log.debug(`TTS state from renderer: ${playing ? 'speaking' : 'idle'}`);
  });

  ipcMain.on(
    'voice:audioChunk',
    async (_, _agentId: string, chunk: ArrayBuffer) => {
      if (!orchestrator.voiceService) {
        log.warn('Voice audio received but voice service not initialized');
        return;
      }

      // Guard: skip if TTS is playing (prevents mic feedback loop in VAD mode)
      if (ttsSpeaking) {
        log.debug('Voice audio ignored: TTS is speaking');
        return;
      }

      try {
        log.debug(`Voice audio chunk received (${chunk.byteLength} bytes)`);
        const result = await orchestrator.voiceService.transcribe(
          Buffer.from(chunk),
        );

        log.info(`Transcribed: "${result.text}" (confidence: ${result.confidence})`);

        // --- Noise filtering pipeline ---

        // Strip ambient noise — STT often transcribes background sounds as
        // parenthetical descriptions like "(door closes)", "(birds chirping)" etc.
        const cleaned = result.text.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        if (cleaned.length < 3) {
          log.debug(`Filtered noise transcription: "${result.text}"`);
          return;
        }

        // no_speech_prob filter (Whisper) — high value means audio is likely noise
        const { noSpeechThreshold, noiseBlocklist } = orchestrator.config;
        if (result.noSpeechProb !== undefined && result.noSpeechProb > noSpeechThreshold) {
          log.debug(`Filtered by no_speech_prob (${result.noSpeechProb.toFixed(2)} > ${noSpeechThreshold}): "${cleaned}"`);
          return;
        }

        // Noise phrase blocklist — common phantom transcriptions from ambient sound
        const lowerCleaned = cleaned.toLowerCase().trim();
        if (noiseBlocklist.some((phrase: string) => lowerCleaned === phrase.toLowerCase())) {
          log.debug(`Filtered by noise blocklist: "${cleaned}"`);
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

        if (!targetId || !parsed.command) {
          log.warn(`Voice command not routed: no target agent found`);
          return;
        }

        const agent = orchestrator.agentManager.get(targetId);
        lastVoiceTargetId = targetId;

        // --- Command classification: status / interrupt / task ---

        // Status query — read from task tracker, never disturb the agent
        if (parsed.commandType === 'status-query') {
          log.info(`Voice status query → "${agent?.profile.name ?? targetId}"`);
          const summary = orchestrator.agentManager.getTaskStatusSummary(targetId);
          sendStatusMessage(targetId, summary);
          return;
        }

        // Interrupt — abort current task
        if (parsed.commandType === 'interrupt') {
          const aborted = orchestrator.agentManager.abortTask(targetId);
          const name = agent?.profile.name ?? 'Agent';
          const message = aborted
            ? `Stopped ${name}'s current task.`
            : `${name} isn't working on anything right now.`;
          log.info(`Voice interrupt → "${name}": ${message}`);
          sendStatusMessage(targetId, message);
          voiceCommandsInFlight.delete(targetId);
          return;
        }

        // Task command — check if agent is busy
        if (voiceCommandsInFlight.has(targetId)) {
          // Agent is busy — check allowInterrupts
          if (agent?.profile.allowInterrupts) {
            log.info(`Interrupting "${agent.profile.name}" with new task: "${parsed.command}"`);
            orchestrator.agentManager.abortTask(targetId);
            voiceCommandsInFlight.delete(targetId);
            // Fall through to dispatch the new command below
          } else {
            const name = agent?.profile.name ?? 'Agent';
            const task = orchestrator.agentManager.getTaskStatus(targetId);
            const taskDesc = task?.command
              ? ` on "${task.command.slice(0, 40)}${task.command.length > 40 ? '...' : ''}"`
              : '';
            sendStatusMessage(targetId, `${name} is busy working${taskDesc}. Ask for a status update if you want to know more.`);
            return;
          }
        }

        voiceCommandsInFlight.add(targetId);
        log.info(`Voice → "${agent?.profile.name ?? targetId}": "${parsed.command}"`);

        // Notify renderer of the voice user message for the chat UI
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('chat:voiceCommand', {
            text: parsed.command,
            agentId: targetId,
            agentName: agent?.profile.name ?? null,
          });
        }

        orchestrator.agentManager.voiceCommand(targetId, parsed.command).then((cmdResult) => {
          if (cmdResult.success && cmdResult.text && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('chat:agentResponse', {
              agentId: targetId,
              agentName: agent?.profile.name ?? 'Agent',
              agentRuntime: agent?.profile.runtime ?? '',
              agentColor: agent?.profile.color ?? '#6b7280',
              text: cmdResult.text,
            });
          }
        }).catch((err) => {
          log.error(`Voice command execution failed: ${String(err)}`);
        }).finally(() => {
          voiceCommandsInFlight.delete(targetId);
        });
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

  // Voice filter settings — renderer reads these for VAD threshold + min recording
  const SENSITIVITY_THRESHOLDS: Record<string, number> = { low: 0.01, medium: 0.03, high: 0.06 };

  ipcMain.handle('voice:getFilterSettings', () => {
    const { voiceSensitivity, minRecordingMs } = orchestrator.config;
    return {
      vadThreshold: SENSITIVITY_THRESHOLDS[voiceSensitivity] ?? 0.03,
      minRecordingMs: minRecordingMs ?? 600,
    };
  });

  // Chat — text commands routed through execute() pipeline (same as voice)
  let lastTextTargetId: string | null = null;

  ipcMain.handle('chat:sendCommand', async (_, text: string) => {
    // Handle /status command
    const statusMatch = text.match(/^\/status\s*(.*)/i);
    if (statusMatch) {
      const agentName = statusMatch[1].trim().toLowerCase();
      let targetId: string | undefined;
      if (agentName) {
        targetId = orchestrator.commandParser.resolveAgentId(agentName);
      }
      if (!targetId) {
        // Try last targets or only running agent
        targetId = lastTextTargetId ?? lastVoiceTargetId ?? undefined;
        if (!targetId) {
          const running = orchestrator.agentManager.list().filter((a) => a.status === 'running');
          if (running.length === 1) targetId = running[0].profile.id;
        }
      }
      if (!targetId) return { success: false, error: 'No agent specified. Use /status <agent-name>' };

      const summary = orchestrator.agentManager.getTaskStatusSummary(targetId);
      const agent = orchestrator.agentManager.get(targetId);
      return {
        success: true,
        text: summary,
        agentId: targetId,
        agentName: agent?.profile.name ?? 'Agent',
        agentRuntime: agent?.profile.runtime ?? '',
        agentColor: agent?.profile.color ?? '#6b7280',
      };
    }

    const parsed = orchestrator.commandParser.parse(text);

    if (parsed.isMetaCommand) {
      return { success: false, error: 'Meta commands not yet supported via text' };
    }

    // Name-based routing (same logic as voice)
    let targetId: string | undefined;

    if (parsed.targetAgentName) {
      targetId = orchestrator.commandParser.resolveAgentId(parsed.targetAgentName);
      if (!targetId) {
        return { success: false, error: `Agent "${parsed.targetAgentName}" not found` };
      }
    }

    // Fallback: last text target → last voice target → only running agent
    if (!targetId && lastTextTargetId) {
      const agent = orchestrator.agentManager.get(lastTextTargetId);
      if (agent && agent.status === 'running') {
        targetId = lastTextTargetId;
      }
    }
    if (!targetId && lastVoiceTargetId) {
      const agent = orchestrator.agentManager.get(lastVoiceTargetId);
      if (agent && agent.status === 'running') {
        targetId = lastVoiceTargetId;
      }
    }
    if (!targetId) {
      const running = orchestrator.agentManager.list().filter((a) => a.status === 'running');
      if (running.length === 1) {
        targetId = running[0].profile.id;
      } else if (running.length === 0) {
        return { success: false, error: 'No agents running' };
      } else {
        return {
          success: false,
          error: `Multiple agents running — say the agent's name (${running.map((a) => a.profile.name).join(', ')})`,
        };
      }
    }

    lastTextTargetId = targetId;
    const agent = orchestrator.agentManager.get(targetId);
    if (!agent) return { success: false, error: 'Agent not found' };

    // Classify command — handle status/interrupt via text too
    if (parsed.commandType === 'status-query') {
      const summary = orchestrator.agentManager.getTaskStatusSummary(targetId);
      return {
        success: true,
        text: summary,
        agentId: targetId,
        agentName: agent.profile.name,
        agentRuntime: agent.profile.runtime,
        agentColor: agent.profile.color,
      };
    }

    if (parsed.commandType === 'interrupt') {
      const aborted = orchestrator.agentManager.abortTask(targetId);
      voiceCommandsInFlight.delete(targetId);
      return {
        success: true,
        text: aborted ? `Stopped ${agent.profile.name}'s current task.` : `${agent.profile.name} isn't working on anything right now.`,
        agentId: targetId,
        agentName: agent.profile.name,
        agentRuntime: agent.profile.runtime,
        agentColor: agent.profile.color,
      };
    }

    // Task — check if busy
    if (orchestrator.agentManager.isTaskRunning(targetId)) {
      if (agent.profile.allowInterrupts) {
        orchestrator.agentManager.abortTask(targetId);
        voiceCommandsInFlight.delete(targetId);
      } else {
        const task = orchestrator.agentManager.getTaskStatus(targetId);
        const taskDesc = task?.command ? ` on "${task.command.slice(0, 40)}"` : '';
        return {
          success: false,
          error: `${agent.profile.name} is busy working${taskDesc}. Ask for a status update or use /status.`,
          agentId: targetId,
          agentName: agent.profile.name,
          agentRuntime: agent.profile.runtime,
          agentColor: agent.profile.color,
        };
      }
    }

    log.info(`Chat → "${agent.profile.name}": "${parsed.command.slice(0, 60)}"`, undefined, targetId);

    const result = await orchestrator.agentManager.voiceCommand(targetId, parsed.command);

    return {
      success: result.success,
      text: result.text,
      error: result.error,
      agentId: targetId,
      agentName: agent.profile.name,
      agentRuntime: agent.profile.runtime,
      agentColor: agent.profile.color,
    };
  });

  // Task status — query agent's current task from in-memory tracker
  ipcMain.handle('agents:getTaskStatus', (_, agentId: string) => {
    return orchestrator.agentManager.getTaskStatus(agentId);
  });

  // Chat history — paginated conversation loading from JSONL files
  ipcMain.handle('chat:loadHistory', async (_, options?: { agentId?: string; before?: string; limit?: number }) => {
    return orchestrator.agentManager.loadConversationHistory(options);
  });

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

  // Compact mode — save/restore window bounds
  let savedBounds: Electron.Rectangle | null = null;

  ipcMain.handle('window:setCompact', (_, compact: boolean) => {
    if (!mainWindow) return;

    if (compact) {
      savedBounds = mainWindow.getBounds();
      const { x, y, width } = savedBounds;
      // Keep same top-left position, shrink to a strip
      const compactHeight = 90;
      const compactWidth = Math.min(width, 700);
      mainWindow.setMinimumSize(300, compactHeight);
      mainWindow.setBounds({ x, y, width: compactWidth, height: compactHeight }, true);
      mainWindow.setAlwaysOnTop(true, 'floating');
    } else {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setMinimumSize(640, 480);
      if (savedBounds) {
        mainWindow.setBounds(savedBounds, true);
        savedBounds = null;
      }
    }
  });

  // Setup / Onboarding
  ipcMain.handle('setup:detectRuntimes', () => {
    const homedir = process.env.HOME || '';
    const fs = require('node:fs');

    const runtimes: Array<{
      id: string;
      name: string;
      available: boolean;
      authenticated: boolean;
      version: string;
      authHint: string;
    }> = [];

    for (const [id, name, cmd] of [
      ['claude-code', 'Claude Code', 'claude'],
      ['opencode', 'OpenCode', 'opencode'],
    ] as const) {
      let available = false;
      let authenticated = false;
      let version = '';
      let authHint = '';

      // Check binary exists AND works by running --version
      try {
        const verOutput = execSync(`${cmd} --version 2>/dev/null || command -v ${cmd}`, {
          encoding: 'utf-8',
          timeout: 10000,
        }).trim();
        available = true;
        // Extract version string (first line, strip noise)
        const firstLine = verOutput.split('\n')[0].trim();
        if (firstLine && !firstLine.startsWith('/')) {
          version = firstLine;
        }
      } catch {
        // Binary not in PATH or broken
      }

      if (available) {
        if (id === 'claude-code') {
          // Claude Code stores OAuth tokens in the system keychain after login.
          // settings.json is for user prefs (we may create it ourselves), so check
          // for files that only exist after a real interactive session:
          // - projects/ dir: created on first use
          // - statsCache: created after first session
          // - .credentials.json: some installations store tokens here
          const claudeDir = `${homedir}/.claude`;
          authenticated = fs.existsSync(`${claudeDir}/statsCache`) ||
            fs.existsSync(`${claudeDir}/stats-cache.json`) ||
            (fs.existsSync(`${claudeDir}/projects`) &&
              fs.readdirSync(`${claudeDir}/projects`).length > 0);
          authHint = 'Run "claude" in your terminal to authenticate via browser';
        } else if (id === 'opencode') {
          authenticated = fs.existsSync(`${homedir}/.opencode/config.json`);
          authHint = 'Run "opencode" in your terminal to configure';
        }
      } else {
        if (id === 'claude-code') {
          authHint = 'npm install -g @anthropic-ai/claude-code';
        } else {
          authHint = 'See opencode.ai for installation';
        }
      }

      runtimes.push({ id, name, available, authenticated, version, authHint });
    }
    return runtimes;
  });

  // Quick diagnostic: spawn the CLI and capture first output to check if it works
  ipcMain.handle('setup:testRuntime', async (_, runtimeId: string) => {
    const cmd = runtimeId === 'claude-code' ? 'claude' : 'opencode';
    try {
      // Run a quick print command that requires auth — captures stderr too
      const output = execSync(
        `${cmd} -p "say hello" --max-turns 1 --output-format json 2>&1 | head -50`,
        { encoding: 'utf-8', timeout: 15000 },
      ).trim();
      return { success: true, output: output.slice(0, 500) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // execSync error includes stderr — that's what we want
      const stderr = (err as { stderr?: Buffer })?.stderr?.toString() ?? '';
      return { success: false, output: stderr.slice(0, 500) || message.slice(0, 500) };
    }
  });

  // Open a terminal window to run a command (for CLI auth flows)
  ipcMain.handle('setup:openTerminal', (_, command: string) => {
    try {
      if (process.platform === 'darwin') {
        execSync(`osascript -e 'tell application "Terminal" to do script "${command}"' -e 'tell application "Terminal" to activate'`, { timeout: 5000 });
      } else if (process.platform === 'linux') {
        execSync(`x-terminal-emulator -e "${command}" &`, { timeout: 5000 });
      } else {
        execSync(`start cmd /k "${command}"`, { timeout: 5000 });
      }
      return { success: true };
    } catch {
      return { success: false, error: 'Could not open terminal' };
    }
  });

  ipcMain.handle('setup:getOnboardingStatus', () => {
    return orchestrator.appStore.isOnboardingComplete();
  });

  ipcMain.handle('setup:resetOnboarding', () => {
    orchestrator.appStore.setOnboardingComplete(false);
    return { success: true };
  });

  ipcMain.handle('setup:getSetupStatus', () => {
    const hasAgents = orchestrator.appStore.getProfiles().length > 0;
    const hasOpenai = orchestrator.appStore.getApiKey('openai') !== null;
    const hasElevenlabs = orchestrator.appStore.getApiKey('elevenlabs') !== null;
    const hasVoiceKeys = hasOpenai || hasElevenlabs;

    // Detect runtimes
    let hasRuntime = false;
    for (const cmd of ['claude', 'opencode']) {
      try {
        execSync(`command -v ${cmd}`, { encoding: 'utf-8', timeout: 3000 });
        hasRuntime = true;
        break;
      } catch {
        // not found
      }
    }

    const missing: string[] = [];
    if (!hasRuntime) missing.push('runtime');
    if (!hasVoiceKeys) missing.push('voice-keys');
    if (!hasAgents) missing.push('agent');

    return { hasRuntime, hasVoiceKeys, hasAgents, missing };
  });

  ipcMain.handle('setup:completeOnboarding', () => {
    orchestrator.appStore.setOnboardingComplete(true);
    // Re-initialize voice in case keys were added during onboarding
    orchestrator.initVoice();

    // Ensure Claude Code's --dangerously-skip-permissions prompt is pre-accepted.
    // Without this, Claude Code shows a confirmation dialog on every launch
    // which never gets answered in the PTY — causing agents to hang/crash.
    ensureClaudePermissionAccepted();

    return { success: true };
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

  // Pre-accept Claude Code permission prompt for any agents that need it
  const hasClaudeAgent = orchestrator.agentManager.list().some(
    a => a.profile.runtime === 'claude-code' && a.profile.allowFullAccess && a.profile.autoStart,
  );
  if (hasClaudeAgent) {
    ensureClaudePermissionAccepted();
  }

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
