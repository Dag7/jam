import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createLogger } from '@jam/core';
import type { ModelTierConfig } from '@jam/core';
import { DEFAULT_MODEL_TIERS } from '@jam/core';
import type { SandboxConfig } from '@jam/sandbox';
import { DEFAULT_SANDBOX_CONFIG } from '@jam/sandbox';
import type { SandboxTier, OsSandboxConfig, WorktreeConfig } from '@jam/os-sandbox';
import { DEFAULT_OS_SANDBOX_CONFIG, DEFAULT_WORKTREE_CONFIG } from '@jam/os-sandbox';

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
export type { SandboxTier, OsSandboxConfig, WorktreeConfig } from '@jam/os-sandbox';

export interface BrainConfig {
  /** Whether Kalanu Brain semantic memory is active (opt-in) */
  enabled: boolean;
  /** Brain server URL */
  url: string;
}

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
  // Sandbox tier: 'none' | 'os' (default) | 'docker'
  sandboxTier: SandboxTier;
  // OS-level sandbox (seatbelt/bubblewrap) — used when sandboxTier is 'os'
  osSandbox: OsSandboxConfig;
  // Git worktree isolation — independent of sandbox tier
  worktree: WorktreeConfig;
  // Docker sandbox — used when sandboxTier is 'docker'
  sandbox: SandboxConfig;
  // Kalanu Brain memory server (opt-in)
  brain: BrainConfig;
  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
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
  // Sandbox tier: OS-level is the default (no Docker required)
  sandboxTier: 'os',
  // OS sandbox defaults
  osSandbox: { ...DEFAULT_OS_SANDBOX_CONFIG },
  // Git worktree defaults
  worktree: { ...DEFAULT_WORKTREE_CONFIG },
  // Docker sandbox (opt-in, disabled by default)
  sandbox: { ...DEFAULT_SANDBOX_CONFIG },
  // Kalanu Brain memory server (opt-in, disabled by default)
  brain: {
    enabled: false,
    url: 'http://localhost:8080',
  },
  // Logging
  logLevel: 'info',
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

  // Sandbox tier env override: JAM_SANDBOX_TIER=none|os|docker
  if (process.env.JAM_SANDBOX_TIER) {
    envOverrides.sandboxTier = process.env.JAM_SANDBOX_TIER as SandboxTier;
  }

  // Backward compatibility: JAM_SANDBOX=1 maps to sandboxTier='docker'
  const sandboxEnvOverride: Partial<SandboxConfig> = {};
  if (process.env.JAM_SANDBOX === '1' || process.env.JAM_SANDBOX === 'true') {
    sandboxEnvOverride.enabled = true;
    if (!process.env.JAM_SANDBOX_TIER) {
      envOverrides.sandboxTier = 'docker';
    }
  } else if (process.env.JAM_SANDBOX === '0' || process.env.JAM_SANDBOX === 'false') {
    sandboxEnvOverride.enabled = false;
    if (!process.env.JAM_SANDBOX_TIER) {
      envOverrides.sandboxTier = 'none';
    }
  }

  // Brain env override: JAM_BRAIN=1 enables brain mode, JAM_BRAIN_URL overrides URL
  const brainEnvOverride: Partial<BrainConfig> = {};
  if (process.env.JAM_BRAIN === '1' || process.env.JAM_BRAIN === 'true') {
    brainEnvOverride.enabled = true;
  } else if (process.env.JAM_BRAIN === '0' || process.env.JAM_BRAIN === 'false') {
    brainEnvOverride.enabled = false;
  }
  if (process.env.JAM_BRAIN_URL) {
    brainEnvOverride.url = process.env.JAM_BRAIN_URL;
  }

  // Deep merge nested objects so partial overrides don't erase defaults
  const merged: JamConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...envOverrides,
    modelTiers: { ...DEFAULT_CONFIG.modelTiers, ...fileConfig.modelTiers },
    codeImprovement: { ...DEFAULT_CONFIG.codeImprovement, ...fileConfig.codeImprovement },
    osSandbox: { ...DEFAULT_CONFIG.osSandbox, ...fileConfig.osSandbox },
    worktree: { ...DEFAULT_CONFIG.worktree, ...fileConfig.worktree },
    sandbox: { ...DEFAULT_CONFIG.sandbox, ...fileConfig.sandbox, ...sandboxEnvOverride },
    brain: { ...DEFAULT_CONFIG.brain, ...fileConfig.brain, ...brainEnvOverride },
  };

  // Backward compatibility: migrate sandbox.enabled=true to sandboxTier='docker'
  if (merged.sandbox.enabled && !fileConfig.sandboxTier && !process.env.JAM_SANDBOX_TIER) {
    merged.sandboxTier = 'docker';
    log.info('Migrated sandbox.enabled=true → sandboxTier=docker');
  }

  log.info(`Config resolved: stt=${merged.sttProvider}, tts=${merged.ttsProvider}, runtime=${merged.defaultRuntime}, sandboxTier=${merged.sandboxTier}`);
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
