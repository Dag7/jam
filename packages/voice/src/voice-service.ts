import type {
  ISTTProvider,
  ITTSProvider,
  IEventBus,
  AgentId,
  TranscriptionResult,
} from '@jam/core';
import { CommandParser, type ParsedCommand } from './command-parser.js';

export interface VoiceServiceConfig {
  sttProvider: ISTTProvider;
  ttsProvider: ITTSProvider;
  eventBus: IEventBus;
  audioCacheDir: string;
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
    this.commandParser = new CommandParser();
    this.audioCacheDir = config.audioCacheDir;
  }

  updateAgentNames(agents: Array<{ id: AgentId; name: string }>): void {
    this.commandParser.updateAgentNames(agents);
  }

  async transcribe(audio: Buffer): Promise<TranscriptionResult> {
    this.eventBus.emit('voice:stateChanged', { state: 'processing' });

    try {
      const result = await this.sttProvider.transcribe(audio);

      this.eventBus.emit('voice:transcription', {
        text: result.text,
        isFinal: true,
        confidence: result.confidence,
      });

      return result;
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
  ): Promise<string> {
    this.eventBus.emit('voice:stateChanged', { state: 'speaking' });

    try {
      const { createHash } = await import('node:crypto');
      const { writeFile, mkdir, access } = await import('node:fs/promises');
      const { join } = await import('node:path');

      // Check cache
      const hash = createHash('sha256')
        .update(`${voiceId}:${text}`)
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

      const audioBuffer = await this.ttsProvider.synthesize(text, voiceId);

      await mkdir(this.audioCacheDir, { recursive: true });
      await writeFile(audioPath, audioBuffer);

      this.eventBus.emit('tts:complete', { agentId, audioPath });
      return audioPath;
    } finally {
      this.eventBus.emit('voice:stateChanged', { state: 'idle' });
    }
  }
}
