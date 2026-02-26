import type { ITTSProvider, VoiceInfo, TTSOptions } from '@jam/core';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

export class ElevenLabsTTSProvider implements ITTSProvider {
  readonly providerId = 'elevenlabs';

  constructor(private apiKey: string) {}

  async synthesize(
    text: string,
    voiceId: string,
    options?: TTSOptions,
  ): Promise<Buffer> {
    const response = await fetch(
      `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: options?.stability ?? 0.5,
            similarity_boost: options?.similarityBoost ?? 0.75,
            speed: options?.speed ?? 1.0,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      voices: Array<{ voice_id: string; name: string; preview_url?: string }>;
    };

    return data.voices.map(
      (voice: { voice_id: string; name: string; preview_url?: string }) => ({
        id: voice.voice_id,
        name: voice.name,
        previewUrl: voice.preview_url,
      }),
    );
  }
}
