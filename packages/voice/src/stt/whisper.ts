import type { ISTTProvider, TranscriptionResult, STTOptions } from '@jam/core';

export class WhisperSTTProvider implements ISTTProvider {
  readonly providerId = 'whisper';

  constructor(
    private apiKey: string,
    private model: string = 'whisper-1',
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
    formData.append('model', this.model);

    // Default to English to avoid incorrect language detection
    const language = options?.language ?? 'en';
    if (language) {
      formData.append('language', language);
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
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Whisper API error (${response.status}): ${error}`);
    }

    const result = (await response.json()) as {
      text: string;
      language?: string;
      segments?: Array<{ no_speech_prob: number }>;
    };

    // Extract worst-case no_speech_prob across segments (highest = most likely noise)
    const noSpeechProb = result.segments?.length
      ? Math.max(...result.segments.map((s) => s.no_speech_prob))
      : undefined;

    return {
      text: result.text,
      confidence: 1.0,
      language: result.language,
      noSpeechProb,
    };
  }
}
