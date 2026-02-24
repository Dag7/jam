import type {
  ISTTProvider,
  ITTSProvider,
  IEventBus,
  AgentId,
  TranscriptionResult,
  TTSOptions,
} from '@jam/core';
import { createLogger } from '@jam/core';
import { CommandParser, type ParsedCommand } from './command-parser.js';

const log = createLogger('VoiceService');

export interface VoiceServiceConfig {
  sttProvider: ISTTProvider;
  ttsProvider: ITTSProvider;
  eventBus: IEventBus;
  audioCacheDir: string;
  /** Optional injected command parser — defaults to new instance if not provided */
  commandParser?: CommandParser;
}

export class VoiceService {
  private sttProvider: ISTTProvider;
  private ttsProvider: ITTSProvider;
  private eventBus: IEventBus;
  private commandParser: CommandParser;
  private audioCacheDir: string;

  constructor(config: VoiceServiceConfig) {
    this.sttProvider = config.sttProvider;
    this.ttsProvider = config.ttsProvider;
    this.eventBus = config.eventBus;
    this.commandParser = config.commandParser ?? new CommandParser();
    this.audioCacheDir = config.audioCacheDir;
  }

  updateAgentNames(agents: Array<{ id: AgentId; name: string }>): void {
    this.commandParser.updateAgentNames(agents);
  }

  async transcribe(audio: Buffer): Promise<TranscriptionResult> {
    this.eventBus.emit('voice:stateChanged', { state: 'processing' });
    log.debug(`Transcribing audio chunk (${audio.length} bytes)`);

    try {
      // Pass agent names as prompt hints — helps Whisper recognize domain terms
      const agentNames = this.commandParser.getAgentNames();
      const prompt = agentNames.length > 0
        ? `Agent names: ${agentNames.join(', ')}.`
        : undefined;

      const result = await this.sttProvider.transcribe(audio, { language: 'en', prompt });
      log.info(`Transcription: "${result.text}" (confidence: ${result.confidence})`);

      this.eventBus.emit('voice:transcription', {
        text: result.text,
        isFinal: true,
        confidence: result.confidence,
      });

      return result;
    } catch (error) {
      log.error(`Transcription failed: ${String(error)}`);
      throw error;
    } finally {
      this.eventBus.emit('voice:stateChanged', { state: 'idle' });
    }
  }

  parseCommand(transcript: string): ParsedCommand {
    return this.commandParser.parse(transcript);
  }

  resolveAgentId(name: string): AgentId | undefined {
    return this.commandParser.resolveAgentId(name);
  }

  async synthesize(
    text: string,
    voiceId: string,
    agentId: AgentId,
    options?: TTSOptions,
  ): Promise<string> {
    this.eventBus.emit('voice:stateChanged', { state: 'speaking' });

    try {
      const { createHash } = await import('node:crypto');
      const { writeFile, mkdir, access } = await import('node:fs/promises');
      const { join } = await import('node:path');

      // Include speed in cache key so different speeds produce separate files
      const speed = options?.speed ?? 1.0;
      const hash = createHash('sha256')
        .update(`${voiceId}:${speed}:${text}`)
        .digest('hex')
        .slice(0, 16);
      const audioPath = join(this.audioCacheDir, `${hash}.mp3`);

      try {
        await access(audioPath);
        // Cache hit
        this.eventBus.emit('tts:complete', { agentId, audioPath });
        return audioPath;
      } catch {
        // Cache miss - synthesize
      }

      log.debug(`Synthesizing TTS for voice ${voiceId} (speed=${speed})`, undefined, agentId);
      const audioBuffer = await this.ttsProvider.synthesize(text, voiceId, options);

      await mkdir(this.audioCacheDir, { recursive: true });
      await writeFile(audioPath, audioBuffer);
      log.info(`TTS audio cached: ${audioPath}`, undefined, agentId);

      this.eventBus.emit('tts:complete', { agentId, audioPath });
      return audioPath;
    } finally {
      this.eventBus.emit('voice:stateChanged', { state: 'idle' });
    }
  }
}
