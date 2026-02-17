import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { createLogger } from '@jam/core';

const log = createLogger('Config');

export type STTProviderType = 'openai' | 'elevenlabs';
export type TTSProviderType = 'openai' | 'elevenlabs';

export interface JamConfig {
  sttProvider: STTProviderType;
  ttsProvider: TTSProviderType;
  sttModel: string;
  ttsVoice: string;
  defaultModel: string;
  defaultRuntime: 'claude-code' | 'opencode';
  theme: 'dark' | 'light';
}

const DEFAULT_CONFIG: JamConfig = {
  sttProvider: 'openai',
  ttsProvider: 'openai',
  sttModel: 'whisper-1',
  ttsVoice: 'alloy',
  defaultModel: 'claude-opus-4-6',
  defaultRuntime: 'claude-code',
  theme: 'dark',
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

  const merged = { ...DEFAULT_CONFIG, ...fileConfig, ...envOverrides };
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
