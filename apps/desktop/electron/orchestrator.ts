import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { EventBus } from '@jam/eventbus';
import {
  PtyManager,
  AgentManager,
  AgentContextBuilder,
  TaskTracker,
  RuntimeRegistry,
  ClaudeCodeRuntime,
  OpenCodeRuntime,
  CodexCLIRuntime,
  CursorRuntime,
  ServiceRegistry,
} from '@jam/agent-runtime';
import {
  VoiceService,
  CommandParser,
  WhisperSTTProvider,
  ElevenLabsSTTProvider,
  ElevenLabsTTSProvider,
  OpenAITTSProvider,
} from '@jam/voice';
import type { ISTTProvider, ITTSProvider, AgentState } from '@jam/core';
import { createLogger, JAM_SYSTEM_PROFILE } from '@jam/core';
import { FileMemoryStore } from '@jam/memory';
import {
  FileTaskStore,
  FileCommunicationHub,
  FileRelationshipStore,
  FileStatsStore,
  SoulManager,
  TaskScheduler,
  SmartTaskAssigner,
  SelfImprovementEngine,
  InboxWatcher,
  TeamEventHandler,
  ModelResolver,
  TeamExecutor,
  FileScheduleStore,
  FileImprovementStore,
  CodeImprovementEngine,
  TaskExecutor,
} from '@jam/team';
import type { ITeamExecutor } from '@jam/team';
import { AppStore } from './storage/store';
import { loadConfig, type JamConfig, type STTProviderType, type TTSProviderType } from './config';

const log = createLogger('Orchestrator');

const DEATH_PHRASES = [
  '{name} has left the building. Permanently.',
  '{name} just rage-quit. Classic.',
  'Uh oh. {name} is taking an unscheduled nap.',
  '{name} has entered the shadow realm.',
  'Well... {name} is no more. Rest in pixels.',
  '{name} has crashed. Sending thoughts and prayers.',
  'Plot twist: {name} is dead.',
  '{name} just spontaneously combusted. Awkward.',
];

function pickDeathPhrase(name: string): string {
  const phrase = DEATH_PHRASES[Math.floor(Math.random() * DEATH_PHRASES.length)];
  return phrase.replace(/{name}/g, name);
}

export class Orchestrator {
  readonly eventBus: EventBus;
  readonly ptyManager: PtyManager;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly agentManager: AgentManager;
  readonly serviceRegistry: ServiceRegistry;
  readonly memoryStore: FileMemoryStore;
  readonly appStore: AppStore;
  readonly config: JamConfig;
  readonly commandParser: CommandParser;
  voiceService: VoiceService | null = null;

  // Team system services
  readonly taskStore: FileTaskStore;
  readonly communicationHub: FileCommunicationHub;
  readonly relationshipStore: FileRelationshipStore;
  readonly statsStore: FileStatsStore;
  readonly soulManager: SoulManager;
  readonly scheduleStore: FileScheduleStore;
  readonly taskScheduler: TaskScheduler;
  readonly taskAssigner: SmartTaskAssigner;
  readonly selfImprovement: SelfImprovementEngine;
  readonly inboxWatcher: InboxWatcher;
  readonly teamEventHandler: TeamEventHandler;
  readonly modelResolver: ModelResolver;
  readonly teamExecutor: ITeamExecutor;
  readonly improvementStore: FileImprovementStore;
  readonly codeImprovement: CodeImprovementEngine | null = null;
  private readonly sharedSkillsDir: string;
  readonly taskExecutor: TaskExecutor;

  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.config = loadConfig();
    this.eventBus = new EventBus();
    this.ptyManager = new PtyManager();
    this.runtimeRegistry = new RuntimeRegistry();
    this.appStore = new AppStore();
    this.commandParser = new CommandParser();
    this.serviceRegistry = new ServiceRegistry();

    // Register runtimes
    this.runtimeRegistry.register(new ClaudeCodeRuntime());
    this.runtimeRegistry.register(new OpenCodeRuntime());
    this.runtimeRegistry.register(new CodexCLIRuntime());
    this.runtimeRegistry.register(new CursorRuntime());

    // Shared skills directory — injected into every agent's context
    this.sharedSkillsDir = join(homedir(), '.jam', 'shared-skills');
    const sharedSkillsDir = this.sharedSkillsDir;

    // Create agent manager with injected dependencies
    const contextBuilder = new AgentContextBuilder();
    const taskTracker = new TaskTracker();

    this.agentManager = new AgentManager(
      this.ptyManager,
      this.runtimeRegistry,
      this.eventBus,
      this.appStore,
      contextBuilder,
      taskTracker,
      (bindings) => this.appStore.resolveSecretBindings(bindings),
      () => this.appStore.getAllSecretValues(),
      sharedSkillsDir,
    );

    // Bootstrap JAM system agent (creates if not already persisted)
    this.agentManager.ensureSystemAgent(JAM_SYSTEM_PROFILE);

    // Create memory store
    const agentsDir = join(app.getPath('userData'), 'agents');
    this.memoryStore = new FileMemoryStore(agentsDir);

    // Create team system services
    const teamDir = join(app.getPath('userData'), 'team');
    this.taskStore = new FileTaskStore(teamDir);
    this.communicationHub = new FileCommunicationHub(teamDir, this.eventBus);
    this.relationshipStore = new FileRelationshipStore(teamDir);
    this.statsStore = new FileStatsStore(teamDir);
    this.soulManager = new SoulManager(agentsDir, this.eventBus);
    this.taskAssigner = new SmartTaskAssigner();
    this.scheduleStore = new FileScheduleStore(teamDir);
    this.taskScheduler = new TaskScheduler(
      this.taskStore,
      this.eventBus,
      this.scheduleStore,
      this.config.scheduleCheckIntervalMs,
    );
    this.selfImprovement = new SelfImprovementEngine(
      this.taskStore,
      this.statsStore,
      this.soulManager,
      this.eventBus,
    );

    // Model tier system — resolves operations → tier → model string
    this.modelResolver = new ModelResolver(this.config.modelTiers, this.config.teamRuntime);
    this.teamExecutor = new TeamExecutor(
      this.modelResolver,
      (runtimeId, model, prompt, cwd) => this.executeOnTeamRuntime(runtimeId, model, prompt, cwd),
      this.eventBus,
    );
    this.selfImprovement.setTeamExecutor(this.teamExecutor);
    this.selfImprovement.setConversationLoader(async (agentId, limit) => {
      const result = await this.agentManager.loadConversationHistory({ agentId, limit });
      return result.messages.map((m) => ({
        timestamp: m.timestamp,
        role: m.role,
        content: m.content,
      }));
    });

    this.selfImprovement.setWorkspaceScanner(async (agentId) => {
      const agent = this.agentManager.get(agentId);
      const cwd = agent?.profile.cwd;
      if (!cwd || !existsSync(cwd)) return null;

      // Scan top-level entries (skip hidden dirs except .services.json)
      const dirEntries = await readdir(cwd, { withFileTypes: true });
      const entries: Array<{ name: string; type: 'file' | 'dir' }> = [];
      const SKIP = new Set(['node_modules', '.git', 'conversations', '__pycache__']);

      for (const entry of dirEntries) {
        if (entry.name.startsWith('.') && entry.name !== '.services.json') continue;
        if (SKIP.has(entry.name)) continue;
        entries.push({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' });
      }

      // Use ServiceRegistry for consistent, deduplicated service data
      const tracked = await this.serviceRegistry.scan(agentId, cwd);
      const services = tracked.map(s => ({
        name: s.name,
        port: s.port,
        alive: s.alive ?? false,
      }));

      // Read notable files (READMEs, status docs — truncated)
      const NOTABLE = /^(readme|status|guide|plan|todo).*\.(md|txt)$/i;
      const notableFiles: Array<{ name: string; content: string }> = [];
      for (const entry of entries) {
        if (entry.type === 'file' && NOTABLE.test(entry.name)) {
          try {
            const fileStat = await stat(join(cwd, entry.name));
            if (fileStat.size > 50_000) continue; // skip huge files
            let content = await readFile(join(cwd, entry.name), 'utf-8');
            if (content.length > 1000) content = content.slice(0, 1000) + '\n...(truncated)';
            notableFiles.push({ name: entry.name, content });
          } catch { /* skip unreadable */ }
        }
      }

      return { entries, services, notableFiles };
    });

    // Code improvement system (opt-in)
    this.improvementStore = new FileImprovementStore(teamDir);
    if (this.config.codeImprovement.enabled) {
      const repoDir = this.config.codeImprovement.repoDir || process.cwd();
      this.codeImprovement = new CodeImprovementEngine(
        repoDir,
        this.config.codeImprovement.branch,
        this.teamExecutor,
        this.improvementStore,
        this.eventBus,
        (_agentId, prompt, cwd) => this.executeOnTeamRuntime(
          this.config.teamRuntime,
          this.config.modelTiers.creative,
          prompt,
          cwd,
        ),
        this.config.codeImprovement.testCommand,
        this.config.codeImprovement.maxImprovementsPerDay,
      );
    }

    this.inboxWatcher = new InboxWatcher(this.taskStore, this.eventBus);
    this.teamEventHandler = new TeamEventHandler(
      this.eventBus,
      this.statsStore,
      this.relationshipStore,
      this.taskStore,
      this.taskAssigner,
      () => this.agentManager.list().map((a) => a.profile),
      this.communicationHub,
    );

    this.taskExecutor = new TaskExecutor({
      taskStore: this.taskStore,
      eventBus: this.eventBus,
      executeOnAgent: (agentId, prompt) =>
        this.agentManager.executeDetached(agentId, prompt),
      isAgentAvailable: (agentId) => !!this.agentManager.get(agentId),
      abortAgent: (agentId) => this.agentManager.abortTask(agentId),
    });

    // Bootstrap shared skills (creates directory + default skills if missing)
    this.bootstrapSharedSkills(sharedSkillsDir).catch(err =>
      log.warn(`Failed to bootstrap shared skills: ${String(err)}`),
    );
  }

  /** Create shared skills directory and update default skill files */
  private async bootstrapSharedSkills(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });

    // Always overwrite — ensures agents get the latest skill instructions
    const processSkillPath = join(dir, 'process-management.md');
    await writeFile(processSkillPath, PROCESS_MANAGEMENT_SKILL, 'utf-8');

    // Secrets handling skill
    const secretsSkillPath = join(dir, 'secrets-handling.md');
    await writeFile(secretsSkillPath, SECRETS_HANDLING_SKILL, 'utf-8');

    // Team communication skill — build dynamically with current agent roster
    const teamSkillPath = join(dir, 'team-communication.md');
    const teamSkill = this.buildTeamCommunicationSkill();
    await writeFile(teamSkillPath, teamSkill, 'utf-8');
  }

  /** Rebuild the team communication skill file when agents change */
  private refreshTeamSkill(): void {
    const teamSkillPath = join(this.sharedSkillsDir, 'team-communication.md');
    writeFile(teamSkillPath, this.buildTeamCommunicationSkill(), 'utf-8').catch(() => {});
  }

  /** Build the team communication skill with the current agent roster */
  private buildTeamCommunicationSkill(): string {
    const agents = this.agentManager.list();
    const roster = agents
      .filter(a => !a.profile.isSystem)
      .map(a => `- **${a.profile.name}** (ID: ${a.profile.id}) — workspace: ${a.profile.cwd ?? 'unknown'}`)
      .join('\n');

    // Resolve the JAM system agent's inbox path for work-sharing updates
    const systemAgent = agents.find(a => a.profile.isSystem);
    const systemInbox = systemAgent?.profile.cwd
      ? `${systemAgent.profile.cwd}/inbox.jsonl`
      : '~/.jam/agents/jam-system/inbox.jsonl';

    return TEAM_COMMUNICATION_SKILL
      .replace('{{AGENT_ROSTER}}', roster || '- No other agents yet')
      .replace('{{JAM_SYSTEM_INBOX}}', systemInbox);
  }

  /** Execute a prompt on a team runtime (used by TeamExecutor for autonomous ops) */
  private async executeOnTeamRuntime(
    runtimeId: string,
    model: string,
    prompt: string,
    cwd?: string,
  ): Promise<string> {
    const runtime = this.runtimeRegistry.get(runtimeId);
    if (!runtime) {
      throw new Error(`Team runtime '${runtimeId}' not found`);
    }

    const teamProfile: import('@jam/core').AgentProfile = {
      id: `team-executor-${Date.now()}`,
      name: 'Team Executor',
      runtime: runtimeId,
      model,
      color: '#6366f1',
      voice: { ttsVoiceId: 'default' },
      allowFullAccess: true,
      cwd: cwd ?? process.cwd(),
    };

    const result = await runtime.execute(teamProfile, prompt, { cwd });
    if (!result.success) {
      throw new Error(result.error ?? 'Team runtime execution failed');
    }
    return result.text;
  }

  /** Safely send IPC to renderer — guards against destroyed window during HMR */
  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send(channel, data);
      } catch {
        // Window may have been destroyed between check and send (race during HMR)
      }
    }
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;

    // Forward events to renderer
    this.eventBus.on('agent:statusChanged', (data: {
      agentId: string;
      status: string;
      previousStatus: string;
    }) => {
      this.sendToRenderer('agents:statusChange', data);

      // Agent died unexpectedly — notify with a funny voice message
      if (data.status === 'error') {
        this.speakAgentDeath(data.agentId);
      }
    });

    this.eventBus.on('agent:created', (data: { agentId: string; profile: { cwd?: string } }) => {
      this.sendToRenderer('agents:created', data);
      this.syncAgentNames();
      // Watch new agent's inbox + refresh team skill roster
      if (data.profile.cwd) {
        this.inboxWatcher.watchAgent(data.agentId, data.profile.cwd);
      }
      this.refreshTeamSkill();
    });

    this.eventBus.on('agent:deleted', (data: { agentId: string }) => {
      this.sendToRenderer('agents:deleted', data);
      this.syncAgentNames();
      this.inboxWatcher.unwatchAgent(data.agentId);
      this.refreshTeamSkill();
    });

    this.eventBus.on('agent:updated', (data) => {
      this.sendToRenderer('agents:updated', data);
      this.syncAgentNames();
    });

    this.eventBus.on('agent:visualStateChanged', (data) => {
      this.sendToRenderer('agents:visualStateChange', data);
    });

    this.eventBus.on('agent:output', (data: { agentId: string; data: string }) => {
      this.sendToRenderer('terminal:data', {
        agentId: data.agentId,
        output: data.data,
      });
    });

    this.eventBus.on('agent:executeOutput', (data: { agentId: string; data: string; clear?: boolean }) => {
      this.sendToRenderer('terminal:executeOutput', {
        agentId: data.agentId,
        output: data.data,
        clear: data.clear ?? false,
      });
    });

    this.eventBus.on('voice:transcription', (data) => {
      this.sendToRenderer('voice:transcription', data);
    });

    this.eventBus.on('voice:stateChanged', (data) => {
      this.sendToRenderer('voice:stateChanged', data);
    });

    // Agent acknowledged — immediate feedback before execute() starts
    this.eventBus.on('agent:acknowledged', (data: {
      agentId: string;
      agentName: string;
      agentRuntime: string;
      agentColor: string;
      ackText: string;
    }) => {
      // Forward to renderer for chat UI
      this.sendToRenderer('chat:agentAcknowledged', data);

      // Speak the ack phrase via TTS (short, immediate feedback)
      this.speakAck(data.agentId, data.ackText);
    });

    // Progress updates during long-running execution — show in chat + speak via TTS
    this.eventBus.on('agent:progress', (data: {
      agentId: string;
      agentName: string;
      agentRuntime: string;
      agentColor: string;
      type: string;
      summary: string;
    }) => {
      // Show progress in chat UI as a system-ish agent message
      this.sendToRenderer('chat:agentProgress', data);

      // Speak a short progress phrase via TTS
      this.speakProgress(data.agentId, data.type, data.summary);
    });

    // Agent errors — surface to UI so users see what went wrong
    this.eventBus.on('agent:error', (data: { agentId: string; message: string; details?: string }) => {
      this.sendToRenderer('app:error', {
        message: data.message,
        details: data.details,
      });
    });

    // TTS: when AgentManager detects a complete response, synthesize and send audio
    this.eventBus.on('agent:responseComplete', (data: { agentId: string; text: string }) => {
      this.handleResponseComplete(data.agentId, data.text);
    });

    // Team events → renderer
    this.eventBus.on('task:created', (data) => {
      this.sendToRenderer('tasks:created', data);
    });
    this.eventBus.on('task:updated', (data) => {
      this.sendToRenderer('tasks:updated', data);
    });
    this.eventBus.on('task:completed', (data) => {
      this.sendToRenderer('tasks:completed', data);
    });
    this.eventBus.on('stats:updated', (data) => {
      this.sendToRenderer('stats:updated', data);
    });
    this.eventBus.on('soul:evolved', (data) => {
      this.sendToRenderer('soul:evolved', data);
    });
    this.eventBus.on('message:received', (data) => {
      this.sendToRenderer('message:received', data);
    });
    this.eventBus.on('trust:updated', (data) => {
      this.sendToRenderer('trust:updated', data);
    });

    // Task execution results → quiet system notification (no voice, no full chat message)
    this.eventBus.on('task:resultReady', (data: {
      taskId: string;
      agentId: string;
      title: string;
      text: string;
      success: boolean;
    }) => {
      this.sendToRenderer('chat:systemNotification', {
        taskId: data.taskId,
        agentId: data.agentId,
        title: data.title,
        success: data.success,
        summary: data.success
          ? data.text.slice(0, 200)
          : data.text,
      });
    });

    // Code improvement events
    this.eventBus.on('code:proposed', (data) => {
      this.sendToRenderer('code:proposed', data);
    });
    this.eventBus.on('code:improved', (data) => {
      this.sendToRenderer('code:improved', data);
    });
    this.eventBus.on('code:failed', (data) => {
      this.sendToRenderer('code:failed', data);
    });
    this.eventBus.on('code:rolledback', (data) => {
      this.sendToRenderer('code:rolledback', data);
    });
  }

  initVoice(): void {
    const sttProvider = this.createSTTProvider(this.config.sttProvider);
    const ttsProvider = this.createTTSProvider(this.config.ttsProvider);

    if (!sttProvider || !ttsProvider) {
      log.warn('Voice not initialized: missing API keys for configured providers');
      return;
    }

    const audioCacheDir = join(app.getPath('userData'), 'audio-cache', 'tts');

    this.voiceService = new VoiceService({
      sttProvider,
      ttsProvider,
      eventBus: this.eventBus,
      audioCacheDir,
    });

    log.info(`Voice initialized: STT=${this.config.sttProvider}, TTS=${this.config.ttsProvider}`);
    this.syncAgentNames();
  }

  /** Provider registries — adding a new provider is a data change, not a code change (OCP) */
  private readonly sttFactories: Record<string, (key: string, model: string) => ISTTProvider> = {
    openai: (key, model) => new WhisperSTTProvider(key, model),
    elevenlabs: (key, model) => new ElevenLabsSTTProvider(key, model),
  };

  private readonly ttsFactories: Record<string, (key: string) => ITTSProvider> = {
    openai: (key) => new OpenAITTSProvider(key),
    elevenlabs: (key) => new ElevenLabsTTSProvider(key),
  };

  private createSTTProvider(type: STTProviderType): ISTTProvider | null {
    const key = this.appStore.getApiKey(type);
    if (!key) return null;
    const factory = this.sttFactories[type];
    return factory ? factory(key, this.config.sttModel) : null;
  }

  private createTTSProvider(type: TTSProviderType): ITTSProvider | null {
    const key = this.appStore.getApiKey(type);
    if (!key) return null;
    const factory = this.ttsFactories[type];
    return factory ? factory(key) : null;
  }

  syncAgentNames(): void {
    const agents = this.agentManager.list().map((a) => ({
      id: a.profile.id,
      name: a.profile.name,
    }));

    // Always update the standalone command parser (for text-based routing)
    this.commandParser.updateAgentNames(agents);

    // Update voice service parser if available
    if (this.voiceService) {
      this.voiceService.updateAgentNames(agents);
    }
  }

  /** Resolve the TTS voice ID for an agent, handling provider compatibility */
  private resolveVoiceId(agent: AgentState): string {
    const OPENAI_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);
    const isOpenAI = this.config.ttsProvider === 'openai';
    const agentVoice = agent.profile.voice.ttsVoiceId;

    if (agentVoice && agentVoice !== 'default') {
      const voiceIsOpenAI = OPENAI_VOICES.has(agentVoice);
      if (isOpenAI && !voiceIsOpenAI) {
        return OPENAI_VOICES.has(this.config.ttsVoice) ? this.config.ttsVoice : 'alloy';
      } else if (!isOpenAI && voiceIsOpenAI) {
        return this.config.ttsVoice;
      }
      return agentVoice;
    }
    return this.config.ttsVoice;
  }

  /** Core TTS pipeline: synthesize text → read file → base64 → send to renderer.
   *  Used by all TTS callers (ack, progress, death, response complete, status messages). */
  async speakToRenderer(agentId: string, text: string): Promise<void> {
    if (!this.voiceService) return;

    const agent = this.agentManager.get(agentId);
    if (!agent) return;

    // System agents don't speak — their results are shown as text notifications
    if (agent.profile.isSystem) return;

    try {
      const voiceId = this.resolveVoiceId(agent);
      const speed = agent.profile.voice.speed ?? this.config.ttsSpeed ?? 1.0;
      const audioPath = await this.voiceService.synthesize(text, voiceId, agentId, { speed });
      const audioBuffer = await readFile(audioPath);
      this.sendToRenderer('voice:ttsAudio', {
        agentId,
        audioData: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
      });
    } catch (error) {
      log.error(`TTS failed: ${String(error)}`, undefined, agentId);
    }
  }

  /** Speak a short acknowledgment phrase */
  private async speakAck(agentId: string, ackText: string): Promise<void> {
    log.info(`TTS ack: "${ackText}"`, undefined, agentId);
    await this.speakToRenderer(agentId, ackText);
  }

  /** Data-driven tool-use → TTS phrase mappings (OCP: add entries to extend) */
  private readonly progressPhrases: Array<{ pattern: RegExp; phrase: string }> = [
    { pattern: /bash|command|shell/i, phrase: 'Running a command.' },
    { pattern: /write|edit|create/i, phrase: 'Writing some code.' },
    { pattern: /read|glob|search|grep/i, phrase: 'Reading files.' },
    { pattern: /web|fetch|browse/i, phrase: 'Searching the web.' },
    { pattern: /test|spec|assert/i, phrase: 'Running tests.' },
  ];

  /** Speak a short progress update for long-running tasks */
  private async speakProgress(agentId: string, type: string, summary: string): Promise<void> {
    let phrase = 'Still thinking about it.';
    if (type === 'tool-use') {
      const match = this.progressPhrases.find(p => p.pattern.test(summary));
      phrase = match?.phrase ?? 'Still working on it.';
    }
    log.debug(`TTS progress: "${phrase}"`, undefined, agentId);
    await this.speakToRenderer(agentId, phrase);
  }

  /** Speak a funny death notification when an agent crashes */
  private async speakAgentDeath(agentId: string): Promise<void> {
    const agent = this.agentManager.get(agentId);
    const name = agent?.profile.name ?? 'Unknown Agent';
    const deathPhrase = pickDeathPhrase(name);

    log.info(`Agent death notification: "${deathPhrase}"`, undefined, agentId);

    this.sendToRenderer('chat:agentAcknowledged', {
      agentId,
      agentName: name,
      agentRuntime: agent?.profile.runtime ?? '',
      agentColor: agent?.profile.color ?? '#6b7280',
      ackText: deathPhrase,
    });

    await this.speakToRenderer(agentId, deathPhrase);
  }

  /** Strip markdown formatting so TTS reads natural text, not syntax */
  private stripMarkdownForTTS(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, ' (code block omitted) ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
      .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/^[-*_]{3,}\s*$/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Synthesize TTS audio from a completed agent response and send to renderer */
  private async handleResponseComplete(agentId: string, responseText: string): Promise<void> {
    if (!this.voiceService) return;
    if (!responseText || responseText.length < 10) {
      log.debug(`Skipping TTS: output too short (${responseText.length} chars)`, undefined, agentId);
      return;
    }

    let text = this.stripMarkdownForTTS(responseText);
    if (text.length > 1500) text = text.slice(0, 1500) + '...';

    log.info(`Synthesizing TTS (${text.length} chars)`, undefined, agentId);
    await this.speakToRenderer(agentId, text);
  }

  async startAutoStartAgents(): Promise<void> {
    const agents = this.agentManager.list();
    for (const agent of agents) {
      if (agent.profile.autoStart) {
        log.info(`Auto-starting agent: ${agent.profile.name}`, undefined, agent.profile.id);
        await this.agentManager.start(agent.profile.id);
      }
    }

    // Initial scan for background services agents may have left running
    this.scanServices();

    // Start team services
    this.teamEventHandler.start();
    this.taskExecutor.start();
    await this.taskScheduler.start();
    for (const agent of agents) {
      if (agent.profile.cwd) {
        this.inboxWatcher.watchAgent(agent.profile.id, agent.profile.cwd);
      }
    }
    log.info('Team services started');
  }

  /** Scan all agent workspaces for .services.json and update the registry */
  async scanServices(): Promise<void> {
    const agents = this.agentManager.list().map(a => ({
      id: a.profile.id,
      cwd: a.profile.cwd,
    }));
    try {
      await this.serviceRegistry.scanAll(agents);
    } catch (err) {
      log.warn(`Service scan failed: ${String(err)}`);
    }
  }

  shutdown(): void {
    this.taskExecutor.stop();
    this.teamEventHandler.stop();
    this.taskScheduler.stop();
    this.inboxWatcher.stopAll();
    this.agentManager.stopHealthCheck();
    this.agentManager.stopAll();
    this.serviceRegistry.stopAll();
    this.ptyManager.killAll();
    this.eventBus.removeAllListeners();
  }
}

// --- Default shared skill content ---

const PROCESS_MANAGEMENT_SKILL = [
  '---',
  'name: process-management',
  'description: How to run servers, UIs, and background processes safely',
  'triggers: server, run, start, dev, npm run, yarn dev, build, serve, deploy, ui, app, dashboard, website, localhost, port',
  '---',
  '',
  '# Background Process Management',
  '',
  'When asked to build and run a server, UI, website, or any long-running process:',
  '',
  '## Rules',
  '1. **NEVER** run long-lived processes in the foreground (they block you forever)',
  '2. **NEVER** use `tail -f`, `watch`, or stream logs — they consume infinite tokens',
  '3. **ALWAYS** run processes in the background with output redirected to a log file',
  '4. **ALWAYS** return control after confirming the process started successfully',
  '5. **ALWAYS** register the service in `.services.json` so Jam can track and clean it up',
  '',
  '## How to Start a Background Process',
  '',
  '```bash',
  '# Create a logs directory',
  'mkdir -p logs',
  '',
  '# Start the process in background, redirect all output to log file',
  'nohup npm run dev > logs/server.log 2>&1 &',
  'SERVER_PID=$!',
  'echo "Started server with PID: $SERVER_PID"',
  '',
  '# Wait briefly for startup',
  'sleep 3',
  '',
  '# Verify it\'s running',
  'if kill -0 $SERVER_PID 2>/dev/null; then',
  '  echo "Server is running (PID: $SERVER_PID)"',
  'else',
  '  echo "Server failed to start. Check logs:"',
  '  tail -20 logs/server.log',
  'fi',
  '```',
  '',
  '## Register the Service (REQUIRED)',
  '',
  'After starting a background process, write a JSON line to `.services.json` in your workspace directory so Jam can track and restart it.',
  'You MUST include `command` and `cwd` so the user can restart the service from the Jam UI:',
  '',
  '```bash',
  'echo \'{"pid":\'$SERVER_PID\',"port":3000,"name":"dev-server","command":"npm run dev","cwd":"\'$(pwd)\'","logFile":"logs/server.log","startedAt":"\'$(date -u +%FT%TZ)\'"}\' >> .services.json',
  '```',
  '',
  'Required fields: `pid`, `name`, `command`, `cwd`, `startedAt`',
  'Optional fields: `port`, `logFile`',
  '',
  '## How to Check if a Process is Running',
  '',
  '```bash',
  '# Check by PID',
  'kill -0 $PID 2>/dev/null && echo "Running" || echo "Stopped"',
  '',
  '# Check by port',
  'lsof -i :3000 -t 2>/dev/null',
  '```',
  '',
  '## How to Check Logs (only when user asks)',
  '',
  '```bash',
  '# Show last 50 lines (bounded, never streaming)',
  'tail -50 logs/server.log',
  '',
  '# Search for errors',
  'grep -i "error|fail|crash" logs/server.log | tail -20',
  '```',
  '',
  '## How to Stop a Process',
  '',
  '```bash',
  'kill $PID 2>/dev/null',
  '```',
  '',
  '## Important',
  '- After starting a background process, tell the user: the URL, the PID, and the log file path',
  '- Do NOT open a browser automatically unless asked',
  '- If the user says "check logs" or "show logs", use `tail -50` (bounded), never `tail -f`',
  '- If something fails, show the last 20 lines of the log file to diagnose',
].join('\n');

const TEAM_COMMUNICATION_SKILL = [
  '---',
  'name: team-communication',
  'description: How to send tasks, delegate work, and share updates with other agents',
  'triggers: ask, tell, send, delegate, message, request, assign, inbox, agent, team, teammate, share, update, broadcast, sync, publish, done, finished, completed',
  '---',
  '',
  '# Team Communication',
  '',
  'You are part of a team of AI agents managed by Jam.',
  '',
  '## Your Teammates',
  '{{AGENT_ROSTER}}',
  '',
  '## Delegating Tasks',
  '',
  'To send a task to another agent, write a JSON line to their `inbox.jsonl`:',
  '',
  '```bash',
  'echo \'{"title":"Check Google stock price","description":"Look up the current GOOG stock price and report back","from":"\'$JAM_AGENT_ID\'"}\' >> /path/to/target-agent-workspace/inbox.jsonl',
  '```',
  '',
  'Fields: `title` (required), `description` (required), `from` (required — use `$JAM_AGENT_ID`),',
  '`priority` (optional: low/normal/high/critical), `tags` (optional: string array)',
  '',
  '## Sharing Work Updates',
  '',
  'When you finish significant work (built a feature, deployed a service, fixed a bug),',
  'write a **brief** 1-2 sentence summary to the JAM system agent\'s inbox so the team stays informed:',
  '',
  '```bash',
  'echo \'{"title":"Work update","description":"Built and deployed the marketing dashboard on port 8085. API runs on port 3001.","from":"\'$JAM_AGENT_ID\'"}\' >> {{JAM_SYSTEM_INBOX}}',
  '```',
  '',
  'Keep updates short and factual. Include: what you did, relevant URLs/ports, any blockers.',
  'Jam automatically broadcasts task completions to the team feed. Only share manual updates',
  'for work that teammates would benefit from knowing about (new services, shared resources, API changes).',
  '',
  '## Rules',
  '- Use the target agent\'s **workspace directory** path from the roster above',
  '- Your agent ID is available as the `JAM_AGENT_ID` environment variable',
  '- The inbox file is processed automatically — do NOT wait for a response',
  '- Keep task descriptions clear and actionable',
  '- After writing to the inbox, tell the user you\'ve delegated the task',
].join('\n');

const SECRETS_HANDLING_SKILL = [
  '---',
  'name: secrets-handling',
  'description: How to handle API keys, tokens, passwords, and other secrets safely',
  'triggers: api, key, token, secret, password, credential, auth, env, environment, .env, config, database, connection, stripe, openai, firebase, supabase, aws, gcp, azure, mongodb, redis, postgres, mysql',
  '---',
  '',
  '# Secrets Handling — CRITICAL SECURITY RULES',
  '',
  '## NEVER Hardcode Secrets',
  '',
  'You MUST NEVER write API keys, tokens, passwords, or any secret values directly into source code, config files, or scripts.',
  '',
  'Bad (NEVER do this):',
  '```',
  'const API_KEY = "sk-abc123..."',
  'OPENAI_API_KEY=sk-abc123',
  'password: "mypassword"',
  '```',
  '',
  '## How Secrets Work in Jam',
  '',
  'The user can bind secrets to you through the Jam UI (Agent Settings → Secrets).',
  'These secrets are injected into your process as **environment variables** at startup.',
  '',
  '## How to Use Secrets',
  '',
  '1. **Always read secrets from environment variables:**',
  '```javascript',
  'const apiKey = process.env.OPENAI_API_KEY;',
  'const dbUrl = process.env.DATABASE_URL;',
  '```',
  '',
  '2. **For .env files, use placeholders and tell the user:**',
  '```bash',
  '# Create .env with placeholder values',
  'cat > .env << \'EOF\'',
  'OPENAI_API_KEY=${OPENAI_API_KEY}',
  'DATABASE_URL=${DATABASE_URL}',
  'EOF',
  '```',
  'Then tell the user: "I\'ve created .env with placeholders. Please add your actual keys through the Jam Secrets Manager (Agent Settings → Secrets) and bind them as environment variables."',
  '',
  '3. **For config files that need secrets, use environment variable references:**',
  '```javascript',
  '// config.js',
  'module.exports = {',
  '  apiKey: process.env.API_KEY,',
  '  dbConnection: process.env.DATABASE_URL,',
  '};',
  '```',
  '',
  '## Rules',
  '- NEVER write actual secret values into any file — not even temporarily',
  '- NEVER echo, log, or print secret values',
  '- NEVER commit .env files with real values to git',
  '- Always add `.env` to `.gitignore`',
  '- When a project needs an API key, use `process.env.VAR_NAME` and tell the user to configure the secret in Jam',
  '- If you see hardcoded secrets in existing code, flag it to the user immediately',
].join('\n');
