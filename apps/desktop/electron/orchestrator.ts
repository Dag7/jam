import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { EventBus } from '@jam/eventbus';
import {
  PtyManager,
  AgentManager,
  RuntimeRegistry,
  ClaudeCodeRuntime,
  OpenCodeRuntime,
} from '@jam/agent-runtime';
import { VoiceService, WhisperSTTProvider, ElevenLabsTTSProvider } from '@jam/voice';
import { FileMemoryStore } from '@jam/memory';
import { AppStore } from './storage/store';
import { loadConfig, type JamConfig } from './config';

export class Orchestrator {
  readonly eventBus: EventBus;
  readonly ptyManager: PtyManager;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly agentManager: AgentManager;
  readonly memoryStore: FileMemoryStore;
  readonly appStore: AppStore;
  readonly config: JamConfig;
  voiceService: VoiceService | null = null;

  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.config = loadConfig();
    this.eventBus = new EventBus();
    this.ptyManager = new PtyManager();
    this.runtimeRegistry = new RuntimeRegistry();
    this.appStore = new AppStore();

    // Register runtimes
    this.runtimeRegistry.register(new ClaudeCodeRuntime());
    this.runtimeRegistry.register(new OpenCodeRuntime());

    // Create agent manager
    this.agentManager = new AgentManager(
      this.ptyManager,
      this.runtimeRegistry,
      this.eventBus,
      this.appStore,
    );

    // Create memory store
    const agentsDir = join(app.getPath('userData'), 'agents');
    this.memoryStore = new FileMemoryStore(agentsDir);
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;

    // Forward events to renderer
    this.eventBus.on('agent:statusChanged', (data) => {
      this.mainWindow?.webContents.send('agents:statusChange', data);
    });

    this.eventBus.on('agent:created', (data) => {
      this.mainWindow?.webContents.send('agents:created', data);
    });

    this.eventBus.on('agent:deleted', (data) => {
      this.mainWindow?.webContents.send('agents:deleted', data);
    });

    this.eventBus.on('agent:visualStateChanged', (data) => {
      this.mainWindow?.webContents.send('agents:visualStateChange', data);
    });

    this.eventBus.on('agent:output', (data: { agentId: string; data: string }) => {
      this.mainWindow?.webContents.send('terminal:data', {
        agentId: data.agentId,
        output: data.data,
      });
    });

    this.eventBus.on('voice:transcription', (data) => {
      this.mainWindow?.webContents.send('voice:transcription', data);
    });

    this.eventBus.on('tts:complete', (data) => {
      this.mainWindow?.webContents.send('voice:ttsAudio', data);
    });
  }

  initVoice(): void {
    const openaiKey = this.appStore.getApiKey('openai');
    const elevenlabsKey = this.appStore.getApiKey('elevenlabs');

    if (!openaiKey || !elevenlabsKey) {
      console.warn('[Orchestrator] Voice not initialized: missing API keys');
      return;
    }

    const sttProvider = new WhisperSTTProvider(openaiKey);
    const ttsProvider = new ElevenLabsTTSProvider(elevenlabsKey);
    const audioCacheDir = join(app.getPath('userData'), 'audio-cache', 'tts');

    this.voiceService = new VoiceService({
      sttProvider,
      ttsProvider,
      eventBus: this.eventBus,
      audioCacheDir,
    });

    // Keep command parser in sync with agent list
    this.syncAgentNames();
  }

  syncAgentNames(): void {
    if (!this.voiceService) return;

    const agents = this.agentManager.list().map((a) => ({
      id: a.profile.id,
      name: a.profile.name,
    }));
    this.voiceService.updateAgentNames(agents);
  }

  async startAutoStartAgents(): Promise<void> {
    const agents = this.agentManager.list();
    for (const agent of agents) {
      if (agent.profile.autoStart) {
        console.log(`[Orchestrator] Auto-starting agent: ${agent.profile.name}`);
        await this.agentManager.start(agent.profile.id);
      }
    }
  }

  shutdown(): void {
    this.agentManager.stopHealthCheck();
    this.agentManager.stopAll();
    this.ptyManager.killAll();
    this.eventBus.removeAllListeners();
  }
}
