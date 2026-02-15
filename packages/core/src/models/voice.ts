export type VoiceState = 'idle' | 'capturing' | 'processing' | 'speaking';

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language?: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
  previewUrl?: string;
}

export interface STTOptions {
  language?: string;
  prompt?: string;
}

export interface TTSOptions {
  speed?: number;
  stability?: number;
  similarityBoost?: number;
}
