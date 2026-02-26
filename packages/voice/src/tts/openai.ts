import type { ITTSProvider, VoiceInfo, TTSOptions } from '@jam/core';

const OPENAI_VOICES: VoiceInfo[] = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'ash', name: 'Ash' },
  { id: 'ballad', name: 'Ballad' },
  { id: 'coral', name: 'Coral' },
  { id: 'echo', name: 'Echo' },
  { id: 'fable', name: 'Fable' },
  { id: 'onyx', name: 'Onyx' },
  { id: 'nova', name: 'Nova' },
  { id: 'sage', name: 'Sage' },
  { id: 'shimmer', name: 'Shimmer' },
];

export class OpenAITTSProvider implements ITTSProvider {
  readonly providerId = 'openai';

  constructor(private apiKey: string) {}

  async synthesize(
    text: string,
    voiceId: string,
    options?: TTSOptions,
  ): Promise<Buffer> {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voiceId || 'alloy',
        speed: options?.speed ?? 1.0,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS API error (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return OPENAI_VOICES;
  }
}
