import type { ISTTProvider, TranscriptionResult, STTOptions } from '@jam/core';

export class ElevenLabsSTTProvider implements ISTTProvider {
  readonly providerId = 'elevenlabs';

  constructor(
    private apiKey: string,
    private model: string = 'scribe_v1',
    private defaultLanguage: string = 'en',
  ) {}

  async transcribe(
    audio: Buffer,
    options?: STTOptions,
  ): Promise<TranscriptionResult> {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: 'audio/wav' }),
      'audio.wav',
    );
    formData.append('model_id', this.model);

    // Default to English to avoid incorrect language detection
    const language = options?.language ?? this.defaultLanguage;
    if (language) {
      formData.append('language_code', language);
    }

    const response = await fetch(
      'https://api.elevenlabs.io/v1/speech-to-text',
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
        },
        body: formData,
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `ElevenLabs STT API error (${response.status}): ${error}`,
      );
    }

    const result = (await response.json()) as {
      text: string;
      language_code?: string;
    };

    return {
      text: result.text,
      confidence: 1.0,
      language: result.language_code,
    };
  }
}
