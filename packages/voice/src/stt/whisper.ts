import type { ISTTProvider, TranscriptionResult, STTOptions } from '@jam/core';

export class WhisperSTTProvider implements ISTTProvider {
  readonly providerId = 'whisper';

  constructor(private apiKey: string) {}

  async transcribe(
    audio: Buffer,
    options?: STTOptions,
  ): Promise<TranscriptionResult> {
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([audio], { type: 'audio/wav' }),
      'audio.wav',
    );
    formData.append('model', 'whisper-1');

    if (options?.language) {
      formData.append('language', options.language);
    }

    if (options?.prompt) {
      formData.append('prompt', options.prompt);
    }

    formData.append('response_format', 'verbose_json');

    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Whisper API error (${response.status}): ${error}`);
    }

    const result = (await response.json()) as { text: string; language?: string };

    return {
      text: result.text,
      confidence: 1.0,
      language: result.language,
    };
  }
}
