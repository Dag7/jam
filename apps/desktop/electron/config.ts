import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export interface JamConfig {
  sttProvider: 'whisper' | 'deepgram';
  ttsProvider: 'elevenlabs' | 'openai';
  defaultModel: string;
  defaultRuntime: 'claude-code' | 'opencode';
  theme: 'dark' | 'light';
}

const DEFAULT_CONFIG: JamConfig = {
  sttProvider: 'whisper',
  ttsProvider: 'elevenlabs',
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
    } catch {
      console.warn('[Config] Failed to parse user config, using defaults');
    }
  } else if (existsSync(bundledConfigPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(bundledConfigPath, 'utf-8'));
    } catch {
      console.warn('[Config] Failed to parse bundled config, using defaults');
    }
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

  return { ...DEFAULT_CONFIG, ...fileConfig, ...envOverrides };
}
