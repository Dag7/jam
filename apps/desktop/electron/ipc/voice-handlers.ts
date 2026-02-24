import { ipcMain, systemPreferences, type BrowserWindow } from 'electron';
import { createLogger } from '@jam/core';
import type { AgentManager } from '@jam/agent-runtime';
import type { VoiceService } from '@jam/voice';
import type { CommandRouter } from '../command-router';
import type { JamConfig } from '../config';

const log = createLogger('VoiceHandlers');

const SENSITIVITY_THRESHOLDS: Record<string, number> = { low: 0.01, medium: 0.03, high: 0.06 };

/** Narrow dependency interface — only what voice handlers need */
export interface VoiceHandlerDeps {
  getVoiceService: () => VoiceService | null;
  agentManager: AgentManager;
  config: JamConfig;
  speakToRenderer: (agentId: string, message: string) => void;
}

export function registerVoiceHandlers(
  deps: VoiceHandlerDeps,
  router: CommandRouter,
  getWindow: () => BrowserWindow | null,
): void {
  const { getVoiceService, agentManager, config, speakToRenderer } = deps;
  let ttsSpeaking = false;

  /** Send a system message to the chat UI + speak it via TTS */
  function sendStatusMessage(targetId: string, message: string): void {
    const info = router.getAgentInfo(targetId);
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('chat:agentAcknowledged', {
        agentId: targetId,
        agentName: info?.agentName ?? 'Agent',
        agentRuntime: info?.agentRuntime ?? '',
        agentColor: info?.agentColor ?? '#6b7280',
        ackText: message,
      });
    }
    speakToRenderer(targetId, message);
  }

  ipcMain.on('voice:ttsState', (_, playing: boolean) => {
    ttsSpeaking = playing;
    log.debug(`TTS state from renderer: ${playing ? 'speaking' : 'idle'}`);
  });

  ipcMain.on(
    'voice:audioChunk',
    async (_, _agentId: string, chunk: ArrayBuffer) => {
      const voiceService = getVoiceService();
      if (!voiceService) {
        log.warn('Voice audio received but voice service not initialized');
        return;
      }

      if (ttsSpeaking) {
        log.debug('Voice audio ignored: TTS is speaking');
        return;
      }

      try {
        log.debug(`Voice audio chunk received (${chunk.byteLength} bytes)`);
        const result = await voiceService.transcribe(Buffer.from(chunk));

        log.info(`Transcribed: "${result.text}" (confidence: ${result.confidence})`);

        // --- Noise filtering pipeline ---
        const cleaned = result.text.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        if (cleaned.length < 5) {
          log.debug(`Filtered noise (too short ${cleaned.length} chars): "${result.text}"`);
          return;
        }

        if (result.confidence !== undefined && result.confidence < 0.4) {
          log.debug(`Filtered by low confidence (${result.confidence.toFixed(2)}): "${cleaned}"`);
          return;
        }

        const { noSpeechThreshold, noiseBlocklist } = config;
        const confidence = result.confidence ?? 1;
        if (result.noSpeechProb !== undefined && result.noSpeechProb > noSpeechThreshold && confidence < 0.7) {
          log.debug(`Filtered by no_speech_prob (${result.noSpeechProb.toFixed(2)} > ${noSpeechThreshold}, confidence ${confidence.toFixed(2)}): "${cleaned}"`);
          return;
        }

        const lowerCleaned = cleaned.toLowerCase().trim();
        if (noiseBlocklist.some((phrase: string) => lowerCleaned === phrase.toLowerCase())) {
          log.debug(`Filtered by noise blocklist: "${cleaned}"`);
          return;
        }

        const wordCount = cleaned.split(/\s+/).length;
        if (wordCount < 2) {
          log.debug(`Filtered single word: "${cleaned}"`);
          return;
        }

        const parsed = voiceService.parseCommand(cleaned);

        if (parsed.isMetaCommand) {
          log.info(`Voice meta command: ${parsed.command}`);
          return;
        }

        // --- Route via CommandRouter ---
        const targetId = router.resolveTarget(parsed, 'voice');

        if (!targetId) {
          const running = router.getRunningAgentNames();
          if (running.length > 1) {
            log.warn(`No agent name detected and ${running.length} agents running — say the agent's name`);
          } else {
            log.warn('Voice command not routed: no target agent found');
          }
          return;
        }

        if (!parsed.command) {
          log.warn('Voice command not routed: no command text');
          return;
        }

        router.recordTarget(targetId, 'voice');
        const info = router.getAgentInfo(targetId);

        // Dispatch special command types via registry (status-query, interrupt, etc.)
        const dispatched = router.dispatch(targetId, parsed);
        if (dispatched) {
          const cmdResult = dispatched instanceof Promise ? await dispatched : dispatched;
          log.info(`Voice ${parsed.commandType} → "${info?.agentName ?? targetId}": ${cmdResult.text}`);
          if (cmdResult.text) sendStatusMessage(targetId, cmdResult.text);
          return;
        }

        // Task command
        router.commandsInFlight.add(targetId);
        log.info(`Voice → "${info?.agentName ?? targetId}": "${parsed.command}"`);

        const win = getWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('chat:voiceCommand', {
            text: parsed.command,
            agentId: targetId,
            agentName: info?.agentName ?? null,
          });
        }

        const { promise, queuePosition } = agentManager.enqueueCommand(targetId, parsed.command, 'voice');

        if (queuePosition > 0 && win && !win.isDestroyed()) {
          win.webContents.send('chat:messageQueued', {
            agentId: targetId,
            agentName: info?.agentName ?? 'Agent',
            agentRuntime: info?.agentRuntime ?? '',
            agentColor: info?.agentColor ?? '#6b7280',
            queuePosition,
            command: parsed.command.slice(0, 60),
          });
        }

        promise.then((cmdResult) => {
          const w = getWindow();
          if (!w || w.isDestroyed()) return;

          if (cmdResult.success && cmdResult.text) {
            w.webContents.send('chat:agentResponse', {
              agentId: targetId,
              agentName: info?.agentName ?? 'Agent',
              agentRuntime: info?.agentRuntime ?? '',
              agentColor: info?.agentColor ?? '#6b7280',
              text: cmdResult.text,
            });
          } else if (!cmdResult.success) {
            w.webContents.send('chat:agentResponse', {
              agentId: targetId,
              agentName: info?.agentName ?? 'Agent',
              agentRuntime: info?.agentRuntime ?? '',
              agentColor: info?.agentColor ?? '#6b7280',
              text: `Error: ${cmdResult.error ?? 'Command failed'}`,
              error: cmdResult.error ?? 'Command failed',
            });
          }
        }).catch((err) => {
          log.error(`Voice command execution failed: ${String(err)}`);
          const w = getWindow();
          if (w && !w.isDestroyed()) {
            w.webContents.send('chat:agentResponse', {
              agentId: targetId,
              agentName: info?.agentName ?? 'Agent',
              agentRuntime: info?.agentRuntime ?? '',
              agentColor: info?.agentColor ?? '#6b7280',
              text: `Error: ${String(err)}`,
              error: String(err),
            });
          }
        }).finally(() => {
          router.commandsInFlight.delete(targetId);
        });
      } catch (error) {
        log.error(`Voice transcription error: ${String(error)}`);
      }
    },
  );

  ipcMain.handle(
    'voice:requestTTS',
    async (_, agentId: string, text: string) => {
      const voiceService = getVoiceService();
      if (!voiceService) {
        return { success: false, error: 'Voice service not initialized' };
      }
      const agent = agentManager.get(agentId);
      if (!agent) return { success: false, error: 'Agent not found' };

      try {
        const voiceId = (agent.profile.voice.ttsVoiceId && agent.profile.voice.ttsVoiceId !== 'default')
          ? agent.profile.voice.ttsVoiceId
          : config.ttsVoice;
        const speed = agent.profile.voice.speed ?? config.ttsSpeed ?? 1.0;
        const audioPath = await voiceService.synthesize(text, voiceId, agentId, { speed });
        return { success: true, audioPath };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle('voice:getFilterSettings', () => {
    const { voiceSensitivity, minRecordingMs } = config;
    return {
      vadThreshold: SENSITIVITY_THRESHOLDS[voiceSensitivity] ?? 0.03,
      minRecordingMs: minRecordingMs ?? 600,
    };
  });

  ipcMain.handle('voice:checkMicPermission', async () => {
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'granted') return { granted: true };
      if (status === 'not-determined') {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        return { granted };
      }
      return { granted: false, status };
    }
    return { granted: true };
  });
}
