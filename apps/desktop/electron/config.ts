import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createLogger } from '@jam/core';
import type { ModelTierConfig } from '@jam/core';
import { DEFAULT_MODEL_TIERS } from '@jam/core';
import type { SandboxConfig } from '@jam/sandbox';
import { DEFAULT_SANDBOX_CONFIG } from '@jam/sandbox';

const log = createLogger('Config');

export type STTProviderType = 'openai' | 'elevenlabs';
export type TTSProviderType = 'openai' | 'elevenlabs';

export type VoiceSensitivity = 'low' | 'medium' | 'high';

export interface CodeImprovementConfig {
  /** Whether the self-improving code system is active (opt-in) */
  enabled: boolean;
  /** Git branch for improvements (agents work here, never on main) */
  branch: string;
  /** Command to verify improvements are safe */
  testCommand: string;
  /** Repository directory (auto-detected if empty) */
  repoDir: string;
  /** Rate limit: max improvements per day */
  maxImprovementsPerDay: number;
  /** Only these agents can propose improvements (empty = all) */
  allowedAgentIds: string[];
}

export type { SandboxConfig } from '@jam/sandbox';

export interface JamConfig {
  sttProvider: STTProviderType;
  ttsProvider: TTSProviderType;
  sttModel: string;
  ttsVoice: string;
  ttsSpeed: number;
  defaultModel: string;
  defaultRuntime: string;
  theme: 'dark' | 'light';
  // Voice filtering
  voiceSensitivity: VoiceSensitivity;
  minRecordingMs: number;
  noSpeechThreshold: number;
  noiseBlocklist: string[];
  // Model tier system
  modelTiers: ModelTierConfig;
  teamRuntime: string;
  // Scheduling
  scheduleCheckIntervalMs: number;
  // Code improvement
  codeImprovement: CodeImprovementConfig;
  // Docker sandbox
  sandbox: SandboxConfig;
  // Kalanu Brain memory server
  brainUrl: string;
}

const DEFAULT_CONFIG: JamConfig = {
  sttProvider: 'openai',
  ttsProvider: 'openai',
  sttModel: 'whisper-1',
  ttsVoice: 'alloy',
  ttsSpeed: 1.25,
  defaultModel: 'claude-opus-4-6',
  defaultRuntime: 'claude-code',
  theme: 'dark',
  voiceSensitivity: 'medium',
  minRecordingMs: 800,
  noSpeechThreshold: 0.6,
  noiseBlocklist: [
    // Common Whisper phantom transcriptions from ambient noise
    'bye', 'bye bye', 'bye-bye', 'goodbye',
    'thank you', 'thanks', 'thank', 'you',
    'hmm', 'uh', 'um', 'ah', 'oh',
    'okay', 'ok', 'yeah', 'yes', 'no', 'nah',
    'so', 'well', 'right', 'like',
    'hey', 'hi', 'hello',
    // Whisper audio artifacts
    'thank you for watching',
    'thanks for watching',
    'subscribe',
    'please subscribe',
    'like and subscribe',
    'music',
    'applause',
    'laughter',
    'silence',
    'you',
    'the',
    'a',
    'i',
    'it',
  ],
  // Model tier defaults: best cost/performance balance
  modelTiers: { ...DEFAULT_MODEL_TIERS },
  teamRuntime: 'claude-code',
  // Scheduling
  scheduleCheckIntervalMs: 60_000,
  // Code improvement (opt-in, disabled by default)
  codeImprovement: {
    enabled: false,
    branch: 'jam/auto-improve',
    testCommand: 'yarn typecheck && yarn test',
    repoDir: '',
    maxImprovementsPerDay: 5,
    allowedAgentIds: [],
  },
  // Docker sandbox (opt-in, disabled by default)
  sandbox: { ...DEFAULT_SANDBOX_CONFIG },
  // Kalanu Brain memory server (defaults to localhost)
  brainUrl: 'http://localhost:8080',
};

export function loadConfig(): JamConfig {
  // Priority: user config file > bundled defaults
  const userConfigPath = join(app.getPath('userData'), 'jam.config.json');
  const bundledConfigPath = join(process.cwd(), 'jam.config.json');

  let fileConfig: Partial<JamConfig> = {};

  if (existsSync(userConfigPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(userConfigPath, 'utf-8'));
      log.info(`Loaded user config from ${userConfigPath}`);
    } catch {
      log.warn('Failed to parse user config, using defaults');
    }
  } else if (existsSync(bundledConfigPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(bundledConfigPath, 'utf-8'));
      log.info(`Loaded bundled config from ${bundledConfigPath}`);
    } catch {
      log.warn('Failed to parse bundled config, using defaults');
    }
  } else {
    log.info('No config file found, using defaults');
  }

  // Environment variable overrides
  const envOverrides: Partial<JamConfig> = {};
  if (process.env.JAM_STT_PROVIDER) {
    envOverrides.sttProvider = process.env.JAM_STT_PROVIDER as JamConfig['sttProvider'];
  }
  if (process.env.JAM_TTS_PROVIDER) {
    envOverrides.ttsProvider = process.env.JAM_TTS_PROVIDER as JamConfig['ttsProvider'];
  }
  if (process.env.JAM_DEFAULT_MODEL) {
    envOverrides.defaultModel = process.env.JAM_DEFAULT_MODEL;
  }
  if (process.env.JAM_BRAIN_URL) {
    envOverrides.brainUrl = process.env.JAM_BRAIN_URL;
  }

  // Sandbox env override: JAM_SANDBOX=1 enables sandbox mode
  const sandboxEnvOverride: Partial<SandboxConfig> = {};
  if (process.env.JAM_SANDBOX === '1' || process.env.JAM_SANDBOX === 'true') {
    sandboxEnvOverride.enabled = true;
  } else if (process.env.JAM_SANDBOX === '0' || process.env.JAM_SANDBOX === 'false') {
    sandboxEnvOverride.enabled = false;
  }

  // Deep merge nested objects so partial overrides don't erase defaults
  const merged: JamConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envOverrides,
    modelTiers: { ...DEFAULT_CONFIG.modelTiers, ...fileConfig.modelTiers },
    codeImprovement: { ...DEFAULT_CONFIG.codeImprovement, ...fileConfig.codeImprovement },
    sandbox: { ...DEFAULT_CONFIG.sandbox, ...fileConfig.sandbox, ...sandboxEnvOverride },
  };

  log.info(`Config resolved: stt=${merged.sttProvider}, tts=${merged.ttsProvider}, runtime=${merged.defaultRuntime}, theme=${merged.theme}`);
  return merged;
}

export function saveConfig(config: JamConfig): void {
  const userConfigPath = join(app.getPath('userData'), 'jam.config.json');
  try {
    writeFileSync(userConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    log.info(`Config saved to ${userConfigPath}`);
  } catch (error) {
    log.error(`Failed to save config: ${String(error)}`);
  }
}
