import { app, BrowserWindow, shell, clipboard, Notification } from 'electron';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFile, readdir, stat, mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, renameSync, mkdirSync } from 'node:fs';
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
  CronScanner,
} from '@jam/agent-runtime';
import type { IPtyManager } from '@jam/agent-runtime';
import { BaseAgentRuntime } from '@jam/agent-runtime';
import type { IContainerManager } from '@jam/core';
import { randomBytes } from 'node:crypto';
import {
  DockerClient,
  ContainerManager,
  PortAllocator,
  SandboxedPtyManager,
  ImageManager,
  HostBridge,
  AGENT_DOCKERFILE,
  DESKTOP_STARTUP_SCRIPT,
} from '@jam/sandbox';
import {
  OsSandboxedPtyManager,
  SandboxConfigBuilder,
  WorktreeManager,
  MergeService,
} from '@jam/os-sandbox';
import {
  VoiceService,
  CommandParser,
  WhisperSTTProvider,
  ElevenLabsSTTProvider,
  ElevenLabsTTSProvider,
  OpenAITTSProvider,
} from '@jam/voice';
import type { ISTTProvider, ITTSProvider, AgentState, IMemoryStore } from '@jam/core';
import { createLogger, JAM_SYSTEM_PROFILE, Batcher, Events, TimeoutTimer } from '@jam/core';
import { FileMemoryStore } from '@jam/memory';
import { BrainClient, BrainMemoryStore } from '@jam/brain';
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
  FileBlackboard,
  TaskNegotiationHandler,
} from '@jam/team';
import type { ITeamExecutor } from '@jam/team';
import { AppStore } from './storage/store';
import { loadConfig, type JamConfig, type STTProviderType, type TTSProviderType } from './config';
import { JAM_CLI_SCRIPT } from '@jam/cli';

const log = createLogger('Orchestrator');

/**
 * Build Docker context files for the agent sandbox image.
 * Reads @jam/computer-use source from the workspace so `yarn dev` just works —
 * no manual Docker build steps needed.
 */
function buildDockerContext(): Record<string, string> {
  const files: Record<string, string> = {
    'start-desktop.sh': DESKTOP_STARTUP_SCRIPT,
  };

  // Find computer-use package source in the workspace
  const cuSrcDir = resolveComputerUseSrc();
  if (!cuSrcDir) {
    log.warn('Could not locate @jam/computer-use source — desktop agents will lack computer-use server');
    return files;
  }

  // Production-only package.json (just the express runtime dependency)
  files['computer-use/package.json'] = JSON.stringify({
    name: 'computer-use',
    private: true,
    type: 'module',
    dependencies: { express: '^4.21.0' },
  }, null, 2);

  // Bundle all TypeScript source files
  try {
    const entries = readdirSync(cuSrcDir, { recursive: true, encoding: 'utf-8' });
    for (const entry of entries) {
      if (typeof entry === 'string' && entry.endsWith('.ts')) {
        files[`computer-use/src/${entry}`] = readFileSync(join(cuSrcDir, entry), 'utf-8');
      }
    }
    log.info(`Bundled ${Object.keys(files).length} files for Docker build context`);
  } catch (err) {
    log.warn('Failed to read computer-use source files:', err);
  }

  return files;
}

/** Locate the @jam/computer-use src/ directory via workspace resolution */
function resolveComputerUseSrc(): string | null {
  // Try require.resolve (works with Yarn workspaces + node_modules linker)
  try {
    const pkgPath = require.resolve('@jam/computer-use/package.json');
    const srcDir = join(pkgPath, '..', 'src');
    if (existsSync(srcDir)) return srcDir;
  } catch { /* fallback */ }

  // Try relative to CWD (monorepo root)
  const fromCwd = join(process.cwd(), 'packages', 'computer-use', 'src');
  if (existsSync(fromCwd)) return fromCwd;

  return null;
}

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
  readonly ptyManager: IPtyManager;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly agentManager: AgentManager;
  readonly serviceRegistry: ServiceRegistry;
  readonly cronScanner: CronScanner;
  readonly containerManager: IContainerManager | null = null;
  private readonly portAllocator: PortAllocator | null = null;
  private readonly docker: DockerClient | null = null;
  private readonly hostBridge: HostBridge | null = null;
  readonly worktreeManager: WorktreeManager | null = null;
  readonly mergeService: MergeService | null = null;
  readonly memoryStore: IMemoryStore;
  readonly brainClient: BrainClient | null = null;
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
  readonly blackboard: FileBlackboard;
  readonly negotiationHandler: TaskNegotiationHandler;
  private readonly sharedSkillsDir: string;
  private readonly teamDir: string;
  private readonly imageReady: Promise<void> = Promise.resolve();
  private readonly reclaimedAgentIds: Set<string> = new Set();
  /** Set to true once all auto-start agents have been launched */
  private sandboxFullyReady = false;
  readonly taskExecutor: TaskExecutor;
  /** IPC batchers — stored for disposal during shutdown */
  private readonly batchers: Array<{ dispose(): void }> = [];
  private windowEventCleanups: Array<() => void> = [];
  /** fs.watch handle for ~/.jam/.rescan — triggers service/cron re-scan */
  private rescanWatcher: import('node:fs').FSWatcher | null = null;

  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.config = loadConfig();
    this.eventBus = new EventBus();
    this.runtimeRegistry = new RuntimeRegistry();
    this.appStore = new AppStore();
    this.commandParser = new CommandParser();
    this.serviceRegistry = new ServiceRegistry();
    this.cronScanner = new CronScanner();

    // Forward service status changes to renderer for real-time UI updates
    this.serviceRegistry.onChange((services) => {
      this.sendToRenderer('services:changed', services);
    });

    // Initialize PTY manager — tiered sandbox: none | os | docker
    const sandboxTier = this.config.sandboxTier;
    log.info(`Sandbox tier: ${sandboxTier}`);

    if (sandboxTier === 'docker') {
      // Docker sandbox — container always runs (services + optional agent isolation)
      const docker = new DockerClient();
      this.docker = docker;
      if (docker.isAvailable()) {
        const agentExecution = this.config.sandbox.agentExecution ?? 'container';
        log.info(`Docker available — agent execution: ${agentExecution}`);
        this.portAllocator = new PortAllocator(
          this.config.sandbox.portRangeStart,
          this.config.sandbox.portsPerAgent,
        );
        this.containerManager = new ContainerManager(docker, this.portAllocator, this.config.sandbox);

        // PTY manager: 'container' → docker exec -it, 'host' → native zsh
        if (agentExecution === 'host') {
          this.ptyManager = new PtyManager();
          log.info('Semi-isolation: agent CLI runs on host, services in Docker container');
        } else {
          this.ptyManager = new SandboxedPtyManager(this.containerManager, docker);
          log.info('Full isolation: agent CLI runs inside Docker container');

          // Set Docker executor for one-shot execute() calls (voiceCommand, tasks).
          // Without this, runtime.execute() spawns directly on the host, bypassing the container.
          const cm = this.containerManager;
          const dockerForExecute = docker;
          BaseAgentRuntime.setDockerExecutor((agentId, command, args, env) => {
            const containerId = cm.getContainerId(agentId);
            if (!containerId) return null; // No container → fall back to host
            const execArgs = dockerForExecute.execPipedArgs(containerId, [command, ...args], env);
            return { command: 'docker', args: execArgs, cwd: '/' };
          });
        }

        // Reclaim running containers from a previous session (e.g. hot reload)
        this.reclaimedAgentIds = this.containerManager.reclaimExisting();

        // Ensure agent image exists — bundle computer-use source into Docker build context
        const extraContextFiles = buildDockerContext();
        const imageManager = new ImageManager(docker, AGENT_DOCKERFILE, extraContextFiles);
        this.config.sandbox.imageName = imageManager.resolveTag(this.config.sandbox.imageName);
        let lastProgressAt = 0;
        let pendingLine = '';
        this.imageReady = imageManager.ensureImage(this.config.sandbox.imageName, (line) => {
          pendingLine = line;
          const now = Date.now();
          if (now - lastProgressAt >= 500) {
            lastProgressAt = now;
            this.sendToRenderer('sandbox:progress', {
              status: 'building-image',
              message: pendingLine,
            });
          }
        }).then(() => {
          this.sendToRenderer('sandbox:progress', {
            status: 'starting-containers',
            message: 'Docker image ready — starting agent containers...',
          });
        }).catch((err) => {
          log.error(`Failed to build sandbox image: ${String(err)}`);
          this.sendToRenderer('sandbox:progress', {
            status: 'error',
            message: `Failed to build sandbox image: ${String(err)}`,
          });
          throw err; // Re-throw so startAutoStartAgents knows the image is NOT ready
        });

        // Start host bridge — only needed when agent runs inside the container
        // (host-mode agents can access host resources directly)
        if (agentExecution === 'container') {
          this.hostBridge = new HostBridge(this.config.sandbox.hostBridgePort, {
            openExternal: (url) => shell.openExternal(url),
            readClipboard: () => clipboard.readText(),
            writeClipboard: (text) => clipboard.writeText(text),
            openPath: (path) => shell.openPath(path),
            showNotification: (title, body) => new Notification({ title, body }).show(),
            // Inter-agent inbox: resolve target by name, append JSONL to their inbox file
            writeInbox: async (targetAgent, senderAgentId, entry) => {
              const agents = this.agentManager.list();
              const target = agents.find(a => a.profile.name.toLowerCase() === targetAgent.toLowerCase());
              if (!target?.profile.cwd) {
                return { success: false, error: `Agent "${targetAgent}" has no workspace` };
              }
              const inboxPath = join(target.profile.cwd, 'inbox.jsonl');
              const { appendFile } = await import('node:fs/promises');
              await appendFile(inboxPath, JSON.stringify(entry) + '\n', 'utf-8');
              log.info(`Bridge inbox-write: ${senderAgentId.slice(0, 8)} → "${targetAgent}": "${entry.title}"`);
              return { success: true };
            },
            listAgentNames: () => this.agentManager.list()
              .filter(a => !a.profile.isSystem)
              .map(a => a.profile.name),
          });
          const bridgeToken = randomBytes(32).toString('hex');
          this.hostBridge.start(bridgeToken).then(({ port }) => {
            log.info(`Host bridge listening on port ${port}`);
            this.agentManager.setExtraEnv({
              JAM_HOST_BRIDGE_URL: `http://host.docker.internal:${port}/bridge`,
              JAM_HOST_BRIDGE_TOKEN: bridgeToken,
            });
          }).catch((err) => {
            log.error(`Failed to start host bridge: ${String(err)}`);
          });
        }
      } else {
        log.warn('Docker not available — falling back to native execution');
        this.eventBus.emit('sandbox:unavailable', { reason: 'Docker Desktop is not running or not installed' });
        this.ptyManager = new PtyManager();
      }
    } else if (sandboxTier === 'os') {
      // OS-level sandbox — seatbelt (macOS) / bubblewrap (Linux)
      const basePty = new PtyManager();
      const configBuilder = new SandboxConfigBuilder(this.config.osSandbox);
      const osSandboxPty = new OsSandboxedPtyManager(basePty, configBuilder);

      // Initialize sandbox runtime (async, graceful fallback to plain PtyManager)
      osSandboxPty.initialize().then(() => {
        log.info('OS sandbox initialized');
      }).catch((err) => {
        log.warn(`OS sandbox init failed: ${String(err)} — commands run unsandboxed`);
      });

      this.ptyManager = osSandboxPty;

      // Also set the sandbox wrapper for one-shot execute() calls via BaseAgentRuntime
      if (this.config.osSandbox.enabled) {
        BaseAgentRuntime.setSandboxWrapper(async (cmd: string) => {
          // When OS sandbox is available, one-shot execute() spawns are already
          // wrapped by OsSandboxedPtyManager. For direct child_process spawns
          // (base-runtime execute()), we pass through — the PTY layer handles wrapping.
          return cmd;
        });
        log.info('OS sandbox wrapper registered for one-shot execute()');
      }
    } else {
      // No sandbox — plain native execution
      this.ptyManager = new PtyManager();
      log.info('No sandbox — agents run directly on host');
    }

    // Git worktree isolation (independent of sandbox tier)
    if (this.config.worktree.autoCreate) {
      this.worktreeManager = new WorktreeManager(this.config.worktree);
      this.mergeService = new MergeService(this.worktreeManager);
      log.info('Git worktree isolation enabled');
    }

    // Register runtimes
    this.runtimeRegistry.register(new ClaudeCodeRuntime());
    this.runtimeRegistry.register(new OpenCodeRuntime());
    this.runtimeRegistry.register(new CodexCLIRuntime());
    this.runtimeRegistry.register(new CursorRuntime());

    // Shared skills directory — injected into every agent's context
    this.sharedSkillsDir = join(homedir(), '.jam', 'shared-skills');
    const sharedSkillsDir = this.sharedSkillsDir;

    // Create memory store — optionally decorated with Brain for semantic recall
    const agentsDir = join(app.getPath('userData'), 'agents');
    const fileMemory = new FileMemoryStore(agentsDir);

    if (this.config.brain.enabled) {
      const brainApiKey = this.appStore.getApiKey('brain') ?? undefined;
      const brainClient = new BrainClient({
        baseUrl: this.config.brain.url,
        apiKey: brainApiKey,
      });
      this.brainClient = brainClient;
      this.memoryStore = new BrainMemoryStore({ inner: fileMemory, client: brainClient });
      log.info(`Brain memory enabled — ${this.config.brain.url}`);
    } else {
      this.memoryStore = fileMemory;
      log.info('Brain memory disabled — using file-based memory only');
    }

    // Team directory lives under ~/.jam/ so it can be bind-mounted into Docker containers
    const teamDir = join(homedir(), '.jam', 'team');
    // Migrate from old Electron-specific path if needed (one-time)
    const oldTeamDir = join(app.getPath('userData'), 'team');
    if (existsSync(oldTeamDir) && !existsSync(teamDir)) {
      try {
        mkdirSync(join(homedir(), '.jam'), { recursive: true });
        renameSync(oldTeamDir, teamDir);
        log.info(`Migrated team directory: ${oldTeamDir} → ${teamDir}`);
      } catch {
        // Cross-device move not supported — copy instead
        const { cpSync } = require('node:fs');
        mkdirSync(teamDir, { recursive: true });
        cpSync(oldTeamDir, teamDir, { recursive: true });
        log.info(`Copied team directory: ${oldTeamDir} → ${teamDir}`);
      }
    }
    this.teamDir = teamDir;
    this.taskStore = new FileTaskStore(teamDir);
    this.blackboard = new FileBlackboard(teamDir, this.eventBus);
    this.negotiationHandler = new TaskNegotiationHandler(this.taskStore, this.eventBus);
    this.communicationHub = new FileCommunicationHub(teamDir, this.eventBus);
    this.relationshipStore = new FileRelationshipStore(teamDir);
    this.statsStore = new FileStatsStore(teamDir);

    // Create agent manager with injected dependencies
    const contextBuilder = new AgentContextBuilder();
    const taskTracker = new TaskTracker();

    // Tell agents whether they're running in sandbox or on host
    if (this.containerManager) {
      const agentExecution = this.config.sandbox.agentExecution ?? 'container';
      if (agentExecution === 'host') {
        // Semi-isolation: agent runs on host, container provides services
        contextBuilder.setExecutionEnvironment({
          mode: 'docker-host',
          // containerServiceUrls set dynamically in pre-start hook (per-agent port mapping)
        });
      } else {
        // Full isolation: agent runs inside the container
        contextBuilder.setExecutionEnvironment({
          mode: 'sandbox',
          containerWorkdir: '/workspace',
          hostBridgeUrl: `http://host.docker.internal:${this.config.sandbox.hostBridgePort}/bridge`,
          mounts: [
            { containerPath: '/workspace', description: 'Agent workspace (bind-mounted from host)' },
            { containerPath: '/team', description: 'Shared team directory (blackboard, channels — shared across all agents)' },
            { containerPath: '/shared-skills', description: 'Shared skills directory', readOnly: true },
            { containerPath: '/home/agent/.claude', description: 'Claude Code credentials', readOnly: true },
          ],
        });
      }
    } else {
      contextBuilder.setExecutionEnvironment({ mode: 'host' });
    }

    this.agentManager = new AgentManager(
      this.ptyManager,
      this.runtimeRegistry,
      this.eventBus,
      this.appStore,
      contextBuilder,
      taskTracker,
      (bindings) => this.appStore.resolveSecretBindings(bindings),
      () => [...this.appStore.getAllSecretValues(), ...this.getOAuthTokenValues()],
      sharedSkillsDir,
      this.statsStore,
    );

    // Forward recorded conversations to Brain for semantic indexing (Observer pattern)
    if (this.brainClient) {
      const brain = this.brainClient;
      this.eventBus.on('conversation:recorded', (event: {
        agentId: string; role: 'user' | 'agent'; content: string; source: string;
      }) => {
        const source = event.role === 'user'
          ? (event.source === 'voice' ? 'user-voice' : 'user-text')
          : 'agent-response';
        brain.ingest(event.agentId, event.content, source).catch(() => {});
      });
    }

    // Register Docker sandbox hooks if sandbox mode is active
    if (this.containerManager && this.portAllocator) {
      const cm = this.containerManager;
      const pa = this.portAllocator;

      // Pre-start: create container before PTY spawn (both modes need the container)
      // createAndStart() already waits for the computer-use server to be ready via
      // waitForComputerUse() — no extra health check needed here.
      const agentExec = this.config.sandbox.agentExecution ?? 'container';
      this.agentManager.setPreStartHook(async (agentId, profile) => {
        const jamBinDir = join(homedir(), '.jam', 'bin');
        const jamIpcDir = join(homedir(), '.jam', 'ipc');
        mkdirSync(jamIpcDir, { recursive: true });

        const containerInfo = await cm.createAndStart({
          agentId,
          agentName: profile.name,
          workspacePath: profile.cwd ?? join(homedir(), '.jam', 'agents', profile.name),
          sharedSkillsPath: sharedSkillsDir,
          teamDirPath: this.teamDir,
          computerUse: profile.allowComputerUse,
          // jam CLI bin — read-only (PATH expects /home/agent/.jam/bin)
          credentialMounts: [
            { hostPath: jamBinDir, containerPath: '/home/agent/.jam/bin' },
          ],
          // IPC dir — read-write so agents can touch .rescan to trigger service discovery
          ipcMounts: [
            { hostPath: jamIpcDir, containerPath: '/home/agent/.jam/ipc' },
          ],
        });

        // When computer-use is enabled in container mode, set DISPLAY so any GUI
        // processes (including Playwright MCP's browser) render on the virtual desktop.
        if (profile.allowComputerUse && agentExec === 'container') {
          profile.env = {
            ...profile.env,
            DISPLAY: ':99',
          };
          log.info(`Set DISPLAY=:99 for "${profile.name}" (computer-use container agent)`, undefined, agentId);
        }

        // In docker-host mode, update the execution environment with per-agent container info
        // and inject the computer-use URL as an env var for the skill to reference
        if (agentExec === 'host') {
          const computerUseHostPort = containerInfo.portMappings.get(3100);
          const noVncHostPort = containerInfo.portMappings.get(6080);
          const containerName = `jam-${profile.name.toLowerCase().replace(/[^a-z0-9_.-]/g, '-')}`;
          contextBuilder.setExecutionEnvironment({
            mode: 'docker-host',
            containerName,
            containerServiceUrls: {
              computerUse: computerUseHostPort ? `http://localhost:${computerUseHostPort}` : undefined,
              noVnc: noVncHostPort ? `http://localhost:${noVncHostPort}` : undefined,
            },
          });

          // Inject per-agent env vars so the skill's $JAM_COMPUTER_USE_URL resolves at runtime
          if (computerUseHostPort) {
            profile.env = {
              ...profile.env,
              JAM_COMPUTER_USE_URL: `http://localhost:${computerUseHostPort}`,
            };
          }
        }
      });

      // Port resolver: map container ports to host ports for health checks
      // Injected directly from PortAllocator (no proxy through ContainerManager)
      this.serviceRegistry.setPortResolver((agentId, containerPort) =>
        pa.resolveHostPort(agentId, containerPort) ?? containerPort,
      );

      // Container ops: stop/restart services inside Docker containers
      const docker = this.docker!;
      this.serviceRegistry.setContainerOps({
        killInContainer: async (agentId, containerPort) => {
          const cid = cm.getContainerId(agentId);
          if (!cid) return false;
          const child = docker.execSpawn(cid,
            ['sh', '-c', `kill $(lsof -ti :${containerPort} -sTCP:LISTEN) 2>/dev/null || true`],
            {});
          await new Promise<void>((res) => child.on('close', () => res()));
          return true;
        },
        restartInContainer: async (agentId, command, cwd) => {
          const cid = cm.getContainerId(agentId);
          if (!cid) return false;

          // Translate host CWD → container CWD
          // Agent workspace (e.g. ~/.jam/agents/john) is mounted at /workspace
          let containerCwd = cwd;
          const agents = this.agentManager.list();
          const agent = agents.find(a => a.profile.id === agentId);
          if (agent?.profile.cwd && cwd.startsWith(agent.profile.cwd)) {
            containerCwd = '/workspace' + cwd.slice(agent.profile.cwd.length);
          }

          const child = docker.execSpawn(cid,
            ['sh', '-c', `cd ${containerCwd} && exec ${command} </dev/null &>/dev/null &`],
            {}, containerCwd);
          child.unref();
          return true;
        },
        healthCheckInContainer: async (agentId, port, healthPath) => {
          const cid = cm.getContainerId(agentId);
          if (!cid) return false;
          // Run curl/TCP check inside the container — avoids host port mapping issues
          const cmd = healthPath
            ? `curl -sf -o /dev/null -m 2 http://127.0.0.1:${port}${healthPath}`
            : `(echo > /dev/tcp/127.0.0.1/${port}) 2>/dev/null`;
          try {
            const child = docker.execSpawn(cid, ['sh', '-c', cmd], {});
            const exitCode = await new Promise<number>((res) =>
              child.on('close', (code) => res(code ?? 1)),
            );
            return exitCode === 0;
          } catch {
            return false;
          }
        },
      });
    }

    // Git worktree pre-start hook — creates worktree before agent launches
    // Note: when Docker sandbox is active, the Docker pre-start hook is already set above.
    // Worktree isolation is independent of sandbox tier and only applies to non-Docker modes.
    if (this.worktreeManager && !this.containerManager) {
      const wm = this.worktreeManager;

      this.agentManager.setPreStartHook(async (_agentId, profile) => {
        if (profile.useWorktree && profile.cwd) {
          try {
            const info = await wm.create(_agentId, profile.name, profile.cwd);
            profile.cwd = info.worktreePath;
            log.info(`Worktree created for "${profile.name}" at ${info.worktreePath}`);
          } catch (err) {
            log.warn(`Worktree creation failed for "${profile.name}": ${String(err)}`);
          }
        }
      });
    }

    // Bootstrap JAM system agent (creates if not already persisted)
    this.agentManager.ensureSystemAgent(JAM_SYSTEM_PROFILE);
    this.soulManager = new SoulManager(agentsDir, this.eventBus);
    // Wire SoulManager to read/write from agent workspace CWDs instead of userData.
    // This makes the workspace SOUL.md the single source of truth — agents can
    // edit it directly, and the UI reads the same file. Falls back to userData
    // for agents that don't have a CWD (shouldn't happen in practice).
    this.soulManager.setCwdResolver((agentId) => {
      const agent = this.agentManager.get(agentId);
      return agent?.profile.cwd as string | undefined;
    });
    // One-time migration: copy SOUL.md from userData to agent workspace CWD.
    // Previously SoulManager stored souls in userData/agents/{uuid}/SOUL.md,
    // now it reads from the workspace CWD. Migrate existing evolved souls.
    this.migrateSoulsToWorkspace(agentsDir).catch((e: unknown) =>
      log.warn(`Soul migration: ${String(e)}`),
    );
    this.taskAssigner = new SmartTaskAssigner();
    this.scheduleStore = new FileScheduleStore(teamDir);
    this.taskScheduler = new TaskScheduler(
      this.taskStore,
      this.eventBus,
      this.scheduleStore,
      this.config.scheduleCheckIntervalMs,
    );

    // Sync agent cron entries into the schedule store when .cron.json files change
    this.cronScanner.onChange((entries) => {
      this.taskScheduler.syncAgentCronEntries(entries).catch((err) =>
        log.warn(`Failed to sync agent cron entries: ${String(err)}`),
      );
    });

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

    // Register system schedule handlers
    this.taskScheduler.registerSystemHandler('self-improvement', async () => {
      const agents = this.agentManager.list().filter(a => a.status === 'running');
      if (agents.length === 0) return;

      // Run reflections sequentially — parallel execution spawns N child
      // processes simultaneously which can OOM the main process.
      log.info(`Scheduled self-reflection for ${agents.length} running agent(s) (sequential)`);
      for (const a of agents) {
        try {
          const result = await this.selfImprovement.triggerReflection(a.profile.id);
          if (result) log.info(`Reflection complete for "${a.profile.name}"`);
        } catch (err) {
          log.error(`Reflection failed for "${a.profile.name}": ${String(err)}`);
        }
      }
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

    this.inboxWatcher = new InboxWatcher(
      this.taskStore,
      this.eventBus,
      (input) => this.agentManager.create(input),
    );

    // Wire inbox events to blackboard and negotiation handler
    this.eventBus.on('inbox:blackboard:publish', (data: {
      agentId: string; topic: string; artifactType: string; content: unknown; metadata?: unknown;
    }) => {
      this.blackboard.publish(data.agentId, data.topic, {
        type: data.artifactType as 'text' | 'diff' | 'json' | 'file-ref',
        content: String(data.content),
        metadata: data.metadata as Record<string, unknown> | undefined,
      }).catch((err) => log.warn(`Blackboard publish failed: ${String(err)}`));
    });

    this.eventBus.on('inbox:task:negotiate', (data: {
      agentId: string; taskId: string; action: string; reason: string;
    }) => {
      if (data.action === 'reassign') {
        this.negotiationHandler.handleReassignRequest(data.taskId, data.agentId, data.reason)
          .catch((err) => log.warn(`Task reassign failed: ${String(err)}`));
      } else if (data.action === 'block') {
        this.negotiationHandler.handleBlockRequest(data.taskId, data.agentId, data.reason)
          .catch((err) => log.warn(`Task block failed: ${String(err)}`));
      }
    });

    this.teamEventHandler = new TeamEventHandler(
      this.eventBus,
      this.statsStore,
      this.relationshipStore,
      this.taskStore,
      this.taskAssigner,
      () => this.agentManager.list().filter((a) => a.status === 'running').map((a) => a.profile),
      this.communicationHub,
    );

    this.taskExecutor = new TaskExecutor({
      taskStore: this.taskStore,
      eventBus: this.eventBus,
      executeOnAgent: (agentId, prompt) =>
        this.agentManager.executeDetached(agentId, prompt),
      isAgentAvailable: (agentId) => {
        const agent = this.agentManager.get(agentId);
        return !!agent && agent.status === 'running';
      },
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

    // Bootstrap jam CLI into ~/.jam/bin/ so agents have it in PATH
    await this.bootstrapJamCli().catch(err =>
      log.warn(`Failed to bootstrap jam CLI: ${String(err)}`),
    );

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

    // Host bridge skill — only when agent runs inside the container (needs bridge to reach host)
    const agentExecution = this.config.sandbox?.agentExecution ?? 'container';
    if (this.config.sandboxTier === 'docker' && agentExecution === 'container' && this.hostBridge) {
      const bridgeSkillPath = join(dir, 'host-bridge.md');
      await writeFile(bridgeSkillPath, HOST_BRIDGE_SKILL, 'utf-8');
    } else {
      // Remove stale host-bridge skill if switching to host mode
      const staleBridgePath = join(dir, 'host-bridge.md');
      await unlink(staleBridgePath).catch(() => {});
    }

    // Computer use skill — only when Docker + computer use is globally enabled
    if (this.config.sandboxTier === 'docker' && this.config.sandbox?.computerUse?.enabled) {
      const computerUseSkillPath = join(dir, 'computer-use.md');
      const skillContent = agentExecution === 'host'
        ? buildComputerUseSkill('host')
        : buildComputerUseSkill('container');
      await writeFile(computerUseSkillPath, skillContent, 'utf-8');
    }
  }

  /** Write the `jam` CLI script to ~/.jam/bin/jam and make it executable */
  private async bootstrapJamCli(): Promise<void> {
    const { chmod } = await import('node:fs/promises');
    const binDir = join(homedir(), '.jam', 'bin');
    await mkdir(binDir, { recursive: true });

    const cliPath = join(binDir, 'jam');
    await writeFile(cliPath, JAM_CLI_SCRIPT, { mode: 0o755 });
    // Ensure executable on Unix
    await chmod(cliPath, 0o755).catch(() => {});
    log.info(`jam CLI bootstrapped → ${cliPath}`);
  }

  /** Rebuild the team communication skill file when agents change */
  private refreshTeamSkill(): void {
    const teamSkillPath = join(this.sharedSkillsDir, 'team-communication.md');
    writeFile(teamSkillPath, this.buildTeamCommunicationSkill(), 'utf-8').catch(() => {});
  }

  /** Build the team communication skill with the current agent roster */
  private buildTeamCommunicationSkill(): string {
    const agents = this.agentManager.list();
    const isSandboxContainer = this.config.sandboxTier === 'docker'
      && (this.config.sandbox?.agentExecution ?? 'container') === 'container';

    if (isSandboxContainer) {
      // Sandbox mode: agents use host bridge for inbox, /team for blackboard/channels
      const roster = agents
        .filter(a => !a.profile.isSystem)
        .map(a => `- **${a.profile.name}** (ID: ${a.profile.id})`)
        .join('\n');
      return TEAM_COMMUNICATION_SKILL_SANDBOX
        .replace('{{AGENT_ROSTER}}', roster || '- No other agents yet');
    }

    // Host mode: agents use direct file paths
    const roster = agents
      .filter(a => !a.profile.isSystem)
      .map(a => `- **${a.profile.name}** (ID: ${a.profile.id}) — workspace: ${a.profile.cwd ?? 'unknown'}`)
      .join('\n');

    const systemAgent = agents.find(a => a.profile.isSystem);
    const systemInbox = systemAgent?.profile.cwd
      ? `${systemAgent.profile.cwd}/inbox.jsonl`
      : '~/.jam/agents/jam/inbox.jsonl';

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
  /** Extract OAuth token values from credential files for redaction.
   *  Prevents agents from leaking access/refresh tokens in their output. */
  private getOAuthTokenValues(): string[] {
    const tokens: string[] = [];
    try {
      const credPath = join(homedir(), '.claude', '.credentials.json');
      if (existsSync(credPath)) {
        const content = readFileSync(credPath, 'utf-8');
        const creds = JSON.parse(content);
        if (creds.claudeAiOauth?.accessToken) tokens.push(creds.claudeAiOauth.accessToken);
        if (creds.claudeAiOauth?.refreshToken) tokens.push(creds.claudeAiOauth.refreshToken);
      }
    } catch { /* best-effort */ }
    // Also redact any ANTHROPIC_API_KEY / OPENAI_API_KEY from process.env
    for (const envVar of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CURSOR_API_KEY']) {
      if (process.env[envVar]) tokens.push(process.env[envVar]!);
    }
    return tokens;
  }

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
    // Clean up previous event listeners (prevents accumulation during HMR)
    for (const cleanup of this.windowEventCleanups) cleanup();
    this.windowEventCleanups = [];

    this.mainWindow = win;

    // Send initial sandbox status so the renderer knows if it should show a loading screen
    if (this.config.sandboxTier === 'docker' && this.containerManager) {
      if (this.sandboxFullyReady) {
        // Auto-start already completed before window was ready — send 'ready' immediately
        this.sendToRenderer('sandbox:progress', {
          status: 'ready',
          message: 'All agent containers running',
        });
      } else {
        this.sendToRenderer('sandbox:progress', {
          status: 'building-image',
          message: 'Preparing sandbox environment...',
        });
      }
    }

    // Forward events to renderer (capture cleanups to prevent listener accumulation)
    const on = <T>(event: string, handler: (payload: T) => void) => {
      this.windowEventCleanups.push(this.eventBus.on(event, handler));
    };

    on<{ agentId: string; status: string; previousStatus: string }>(
      'agent:statusChanged', (data) => {
        this.sendToRenderer('agents:statusChange', data);

        // Agent died unexpectedly — notify with a funny voice message
        if (data.status === 'error') {
          this.speakAgentDeath(data.agentId);
        }
      },
    );

    on<{ agentId: string; profile: { cwd?: string } }>(
      'agent:created', (data) => {
        this.sendToRenderer('agents:created', data);
        this.syncAgentNames();
        // Watch new agent's inbox + refresh team skill roster
        if (data.profile.cwd) {
          this.inboxWatcher.watchAgent(data.agentId, data.profile.cwd);
        }
        this.refreshTeamSkill();
      },
    );

    on<{ agentId: string }>('agent:deleted', (data) => {
      this.sendToRenderer('agents:deleted', data);
      this.syncAgentNames();
      this.inboxWatcher.unwatchAgent(data.agentId);
      this.refreshTeamSkill();
    });

    on('agent:updated', (data) => {
      this.sendToRenderer('agents:updated', data);
      this.syncAgentNames();
    });

    on('agent:visualStateChanged', (data) => {
      this.sendToRenderer('agents:visualStateChange', data);
    });

    // Batch terminal + execute output IPC sends to reduce cross-process overhead.
    // PTY data already arrives batched at ~16ms; we coalesce at ~32ms to halve IPC calls.
    const termBatcher = new Batcher<string>(
      32,
      (batch) => {
        for (const [agentId, output] of batch) {
          this.sendToRenderer('terminal:data', { agentId, output });
        }
      },
      (a, b) => a + b,
    );
    this.batchers.push(termBatcher);

    on<{ agentId: string; data: string }>('agent:output', (data) => {
      termBatcher.add(data.agentId, data.data);
    });

    on<{ agentId: string; exitCode: number }>('pty:exit', (data) => {
      this.sendToRenderer('terminal:exit', data);
    });

    // Execute output arrives per-chunk with no upstream batching — coalesce at 50ms
    const execBatcher = new Batcher<{ chunks: string[]; clear: boolean; command?: string }>(
      50,
      (batch) => {
        for (const [agentId, { chunks, clear, command }] of batch) {
          this.sendToRenderer('terminal:executeOutput', {
            agentId,
            output: chunks.join(''),
            clear,
            command,
          });
        }
      },
      (existing, incoming) => {
        if (incoming.clear) {
          return { chunks: [...incoming.chunks], clear: true, command: incoming.command };
        }
        existing.chunks.push(...incoming.chunks);
        return existing;
      },
    );
    this.batchers.push(execBatcher);

    on<{ agentId: string; data: string; clear?: boolean; command?: string }>('agent:executeOutput', (data) => {
      execBatcher.add(data.agentId, { chunks: [data.data], clear: !!data.clear, command: data.command });
    });

    on<{ agentId: string; status: 'done' | 'error' }>('agent:executeComplete', (data) => {
      this.sendToRenderer('terminal:executeComplete', data);
    });

    on('voice:transcription', (data) => {
      this.sendToRenderer('voice:transcription', data);
    });

    on('voice:stateChanged', (data) => {
      this.sendToRenderer('voice:stateChanged', data);
    });

    // Agent acknowledged — immediate feedback before execute() starts
    on<{
      agentId: string;
      agentName: string;
      agentRuntime: string;
      agentColor: string;
      ackText: string;
    }>('agent:acknowledged', (data) => {
      // Forward to renderer for chat UI
      this.sendToRenderer('chat:agentAcknowledged', data);

      // Speak the ack phrase via TTS (short, immediate feedback)
      this.speakAck(data.agentId, data.ackText);
    });

    // Progress updates during long-running execution — show in chat + speak via TTS
    on<{
      agentId: string;
      agentName: string;
      agentRuntime: string;
      agentColor: string;
      type: string;
      summary: string;
    }>('agent:progress', (data) => {
      // Show progress in chat UI as a system-ish agent message
      this.sendToRenderer('chat:agentProgress', data);

      // Speak a short progress phrase via TTS
      this.speakProgress(data.agentId, data.type, data.summary);
    });

    // Agent errors — surface to UI so users see what went wrong
    on<{ agentId: string; message: string; details?: string }>('agent:error', (data) => {
      this.sendToRenderer('app:error', {
        message: data.message,
        details: data.details,
      });
    });

    // TTS: when AgentManager detects a complete response, synthesize and send audio
    on<{ agentId: string; text: string }>('agent:responseComplete', (data) => {
      this.handleResponseComplete(data.agentId, data.text);
    });

    // Team events → renderer
    on('task:created', (data) => { this.sendToRenderer('tasks:created', data); });
    on('task:updated', (data) => { this.sendToRenderer('tasks:updated', data); });
    on('task:completed', (data) => { this.sendToRenderer('tasks:completed', data); });
    on('stats:updated', (data) => { this.sendToRenderer('stats:updated', data); });
    on('soul:evolved', (data) => { this.sendToRenderer('soul:evolved', data); });
    on('message:received', (data) => { this.sendToRenderer('message:received', data); });
    on('trust:updated', (data) => { this.sendToRenderer('trust:updated', data); });

    // Task execution results → quiet system notification (no voice, no full chat message)
    on<{
      taskId: string;
      agentId: string;
      title: string;
      text: string;
      success: boolean;
    }>('task:resultReady', (data) => {
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
    on('code:proposed', (data) => { this.sendToRenderer('code:proposed', data); });
    on('code:improved', (data) => { this.sendToRenderer('code:improved', data); });
    on('code:failed', (data) => { this.sendToRenderer('code:failed', data); });
    on('code:rolledback', (data) => { this.sendToRenderer('code:rolledback', data); });
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
    if (this.config.voiceEnabled === false) return;

    const agent = this.agentManager.get(agentId);
    if (!agent) return;

    // System agent speaks normally for direct interaction — background tasks
    // (executeDetached) never emit responseComplete/acknowledged, so they stay silent.

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
    const maxChars = this.config.ttsMaxChars ?? 6000;
    if (text.length > maxChars) text = text.slice(0, maxChars) + '...';

    log.info(`Synthesizing TTS (${text.length} chars)`, undefined, agentId);
    await this.speakToRenderer(agentId, text);
  }

  /**
   * One-time migration: copy evolved SOUL.md files from Electron userData
   * to agent workspace CWDs. Previously SoulManager stored souls in
   * `userData/agents/{uuid}/SOUL.md`, now it uses the workspace CWD.
   * Only copies if the workspace doesn't already have a SOUL.md.
   */
  private async migrateSoulsToWorkspace(userDataAgentsDir: string): Promise<void> {
    const agents = this.agentManager.list();
    let migrated = 0;

    for (const agent of agents) {
      const cwd = agent.profile.cwd as string | undefined;
      if (!cwd) continue;

      const workspaceSoul = join(cwd, 'SOUL.md');
      const userDataSoul = join(userDataAgentsDir, agent.profile.id, 'SOUL.md');

      // Skip if workspace already has a SOUL.md or userData doesn't
      if (existsSync(workspaceSoul) || !existsSync(userDataSoul)) continue;

      try {
        mkdirSync(cwd, { recursive: true });
        const content = await readFile(userDataSoul, 'utf-8');
        await writeFile(workspaceSoul, content, 'utf-8');
        migrated++;
        log.info(`Migrated SOUL.md → workspace for "${agent.profile.name}"`, undefined, agent.profile.id);
      } catch (err) {
        log.warn(`Failed to migrate SOUL.md for "${agent.profile.name}": ${String(err)}`);
      }
    }

    if (migrated > 0) {
      log.info(`Soul migration complete: ${migrated} agent(s) migrated to workspace CWDs`);
    }
  }

  /**
   * Import agent folders from disk that aren't yet registered in the store.
   * Looks for `~/.jam/agents/<name>/SOUL.md` and calls `agentManager.create()`.
   */
  private async bootstrapDiskAgents(): Promise<void> {
    const agentsDir = join(homedir(), '.jam', 'agents');
    const COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ec4899', '#06b6d4'];

    let entries: string[];
    try {
      entries = await readdir(agentsDir);
    } catch {
      return;
    }

    const existingAgents = this.agentManager.list();
    const knownCwds = new Set(
      existingAgents.map((a) => a.profile.cwd).filter(Boolean),
    );
    const knownNames = new Set(
      existingAgents.map((a) => a.profile.name.toLowerCase()),
    );

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const cwd = join(agentsDir, entry);
      if (knownCwds.has(cwd)) continue;
      // Skip folders that match an existing agent name (e.g. "jam" when system agent "JAM" exists)
      if (knownNames.has(entry.toLowerCase())) continue;
      if (!existsSync(join(cwd, 'SOUL.md'))) continue;

      const name = entry.charAt(0).toUpperCase() + entry.slice(1);
      const color = COLORS[this.agentManager.list().length % COLORS.length];
      const result = this.agentManager.create({
        name,
        runtime: 'claude-code',
        color,
        voice: { ttsVoiceId: 'onyx' },
        cwd,
      });

      if (result.success) {
        log.info(`Imported disk agent: ${name} (${result.agentId})`);
      }
    }
  }

  async startAutoStartAgents(): Promise<void> {
    const t0 = Date.now();
    const phase = (name: string) => log.info(`[Startup Timing] ${name} at +${Date.now() - t0}ms`);

    // Wait for Docker image to be ready before launching any containers
    try {
      await this.imageReady;
    } catch (err) {
      log.error('Docker image build failed — cannot start agents in sandbox mode');
      phase('imageReady (FAILED)');
      return; // Don't attempt to start agents without a working image
    }
    phase('imageReady');

    // Import agent folders from disk that aren't registered yet (e.g. created by JAM)
    await this.bootstrapDiskAgents();
    phase('bootstrapDiskAgents');

    // Clean up any LaunchAgent plists agents may have installed
    await this.cleanupAgentLaunchAgents();
    phase('cleanupLaunchAgents');

    const agents = this.agentManager.list();
    const autoStartAgents = agents.filter((a) => a.profile.autoStart);

    if (autoStartAgents.length > 0 && this.containerManager) {
      this.sendToRenderer('sandbox:progress', {
        status: 'starting-containers',
        message: `Starting ${autoStartAgents.length} agent container(s)...`,
      });
    }

    for (const agent of autoStartAgents) {
      const agentT0 = Date.now();
      log.info(`Auto-starting agent: ${agent.profile.name}`, undefined, agent.profile.id);
      this.sendToRenderer('sandbox:progress', {
        status: 'starting-containers',
        message: `Starting ${agent.profile.name}...`,
      });
      await this.agentManager.start(agent.profile.id);
      phase(`agent "${agent.profile.name}" started (${Date.now() - agentT0}ms)`);
    }

    // Signal sandbox is fully ready — renderer unmounts loading overlay and cold-mounts
    // the entire UI. Defer ALL heavy background work so the renderer can settle first.
    this.sandboxFullyReady = true;
    if (this.containerManager) {
      this.sendToRenderer('sandbox:progress', {
        status: 'ready',
        message: 'All agent containers running',
      });
    }
    phase('sandbox:ready sent');

    phase('Startup complete');

    // Wait for the renderer's initial mount to complete before starting background work.
    // Without this, service scanning (recursive FS + TCP port checks with 2s timeouts),
    // health monitors, and task draining all compete with the renderer's initial
    // agents:list + loadHistory IPC requests, causing a 10s freeze.
    const RENDERER_SETTLE_MS = 3000;
    log.info(`Deferring background services by ${RENDERER_SETTLE_MS / 1000}s to let renderer settle`);

    await new Promise<void>((resolve) => setTimeout(resolve, RENDERER_SETTLE_MS));
    phase('renderer settle complete');

    // Start team services — must subscribe to AGENTS_READY before we emit it
    this.teamEventHandler.start();
    this.taskExecutor.start();
    await this.taskScheduler.start();
    for (const agent of agents) {
      if (agent.profile.cwd) {
        this.inboxWatcher.watchAgent(agent.profile.id, agent.profile.cwd);
      }
    }
    phase('team services started');

    // Signal that all agents are running — triggers task drain and schedule activation
    this.eventBus.emit(Events.AGENTS_READY, { agentCount: autoStartAgents.length });

    // Orphan service cleanup runs AFTER everything else — its recursive filesystem
    // scanning + TCP port checks (2s timeout each) can block the event loop for seconds.
    const cleanupT0 = Date.now();
    this.cleanupOrphanServices().then(() => {
      phase(`orphan cleanup done (${Date.now() - cleanupT0}ms)`);
      this.serviceRegistry.startHealthMonitor();
      this.startRescanWatcher();
      phase('health monitor + rescan watcher started');
    }).catch((err) => {
      log.warn(`Deferred cleanup failed: ${String(err)}`);
      // Start health monitor anyway — it will discover services on its own
      this.serviceRegistry.startHealthMonitor();
      this.startRescanWatcher();
    });

    phase('startAutoStartAgents complete (background tasks still running)');
  }

  /**
   * Remove any LaunchAgent plists agents may have installed.
   * Agents are forbidden from creating system daemons, but older agents or
   * misbehaving LLMs may have created them before the rule was added.
   * Scans ~/Library/LaunchAgents for plists referencing .jam/agents paths.
   */
  async cleanupAgentLaunchAgents(): Promise<void> {
    if (process.platform !== 'darwin') return;

    const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents');
    try {
      const entries = await readdir(launchAgentsDir);
      const uid = process.getuid?.() ?? '';

      for (const entry of entries) {
        if (!entry.endsWith('.plist')) continue;

        // Match known patterns: com.jam.*, com.<agentname>.*, or any plist
        // that references the .jam/agents directory
        const filePath = join(launchAgentsDir, entry);
        let isAgentPlist = entry.startsWith('com.jam.');

        if (!isAgentPlist) {
          try {
            const content = await readFile(filePath, 'utf-8');
            isAgentPlist = content.includes('.jam/agents/');
          } catch { /* unreadable */ }
        }

        if (isAgentPlist) {
          log.warn(`Removing agent-installed LaunchAgent: ${entry}`);
          try {
            // Unload first (bootout), then delete
            try {
              const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
              execFileSync('launchctl', ['bootout', `gui/${uid}`, filePath], { timeout: 5000 });
            } catch { /* may not be loaded */ }
            await unlink(filePath);
            log.info(`Removed LaunchAgent: ${entry}`);
          } catch (err) {
            log.warn(`Failed to remove LaunchAgent ${entry}: ${String(err)}`);
          }
        }
      }
    } catch {
      // ~/Library/LaunchAgents may not exist
    }
  }

  /**
   * Kill orphan services left over from a previous session.
   * Scans all agent workspaces for .services.json, checks which ports are still
   * alive, and kills them. This handles the case where the app crashed or was
   * force-quit without a clean shutdown.
   */
  async cleanupOrphanServices(): Promise<void> {
    try {
      await this.scanServices();
      const services = this.serviceRegistry.list();
      const alive = services.filter(s => s.alive);

      if (alive.length === 0) {
        log.info('No orphan services found from previous session');
        return;
      }

      log.warn(`Found ${alive.length} orphan service(s) from previous session — killing them`);
      for (const svc of alive) {
        log.info(`Killing orphan service "${svc.name}" on port ${svc.port}`);
        await this.serviceRegistry.stopService(svc.port);
      }
    } catch (err) {
      log.warn(`Orphan service cleanup failed: ${String(err)}`);
    }
  }

  /**
   * Watch ~/.jam/ipc/.rescan for changes — the `jam` CLI touches this file
   * after any mutation (svc register, cron add, etc.) so the orchestrator can
   * re-scan without polling on an interval. The ipc/ directory is a dedicated
   * shared mount, keeping agent workspaces isolated in Docker mode.
   */
  private startRescanWatcher(): void {
    const { watch, mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    const rescanDir = join(homedir(), '.jam', 'ipc');
    const rescanPath = join(rescanDir, '.rescan');

    // Ensure the file exists so fs.watch doesn't error
    try {
      mkdirSync(rescanDir, { recursive: true });
      if (!existsSync(rescanPath)) writeFileSync(rescanPath, '0', 'utf-8');
    } catch { return; }

    try {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      this.rescanWatcher = watch(rescanPath, () => {
        // Debounce rapid-fire changes (e.g. agent runs multiple jam CLI commands)
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          log.info('Rescan triggered by jam CLI');
          this.scanServices().catch((err) =>
            log.warn(`Rescan failed: ${String(err)}`),
          );
        }, 500);
      });
      log.info(`Watching ${rescanPath} for CLI-triggered rescans`);
    } catch (err) {
      log.warn(`Failed to start rescan watcher: ${String(err)}`);
    }
  }

  /** Scan all agent workspaces for .services.json and .cron.json, update registries */
  async scanServices(): Promise<void> {
    const agents = this.agentManager.list().map(a => ({
      id: a.profile.id,
      cwd: a.profile.cwd,
    }));
    try {
      await Promise.all([
        this.serviceRegistry.scanAll(agents),
        this.cronScanner.scanAll(agents),
      ]);
    } catch (err) {
      log.warn(`Service/cron scan failed: ${String(err)}`);
    }
  }

  /**
   * Shut down all services and clean up resources.
   *
   * @param keepContainers - If true, Docker containers stay running for fast
   *   reclaim on next startup (used during HMR hot reload). If false, containers
   *   are stopped and removed (used on real app exit).
   */
  async shutdown(keepContainers = false): Promise<void> {
    // --- Phase 1: Synchronous stops (instant, no I/O) ---
    this.taskExecutor.stop();
    this.teamEventHandler.stop();
    this.taskScheduler.stop();
    this.inboxWatcher.stopAll();
    this.agentManager.stopHealthCheck();
    this.rescanWatcher?.close();
    this.rescanWatcher = null;
    for (const batcher of this.batchers) batcher.dispose();
    this.batchers.length = 0;

    // Kill agents and PTYs immediately — these are the primary orphan risk.
    // Do this BEFORE any async work so processes die even if later steps hang.
    this.agentManager.stopAll();
    this.ptyManager.killAll();
    BaseAgentRuntime.setDockerExecutor(null);

    // --- Phase 2: Best-effort async cleanup (timeout-guarded) ---
    // Each operation is individually guarded so a single hang doesn't block everything.
    const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T | void> =>
      Promise.race([p, new Promise<void>((resolve) => setTimeout(() => {
        log.warn(`Shutdown: ${label} timed out after ${ms}ms — skipping`);
        resolve();
      }, ms))]);

    // Flush stores (disk I/O — usually fast, 2s cap)
    await withTimeout(
      Promise.all([
        this.taskStore.stop().catch((e) => log.warn(`Task store flush failed: ${e}`)),
        this.statsStore.stop().catch((e) => log.warn(`Stats store flush failed: ${e}`)),
        this.scheduleStore.stop().catch((e) => log.warn(`Schedule store flush failed: ${e}`)),
        this.improvementStore.stop().catch((e) => log.warn(`Improvement store flush failed: ${e}`)),
      ]),
      2000,
      'store flushes',
    );

    // Stop tracked services using CACHED data only — no re-scan on shutdown.
    // Scanning does filesystem walks + TCP port checks which can hang indefinitely.
    await withTimeout(
      this.serviceRegistry.stopAll(),
      2000,
      'service cleanup',
    );

    // Stop host bridge — await to ensure the socket is fully released
    await this.hostBridge?.stop().catch(() => {});

    if (keepContainers) {
      // HMR: keep containers running — they'll be reclaimed on next startup
      log.info('Keeping Docker containers alive for hot reload reclaim');
    } else if (this.containerManager) {
      // Real exit: apply user-configured container exit behavior
      const behavior = this.config.sandbox.containerExitBehavior;
      switch (behavior) {
        case 'keep-running':
          log.info('Keeping Docker containers running (configured: keep-running)');
          break;
        case 'delete':
          log.info('Stopping and removing all Docker containers (configured: delete)');
          this.containerManager.removeAll();
          break;
        case 'stop':
        default:
          log.info('Stopping Docker containers without removing (configured: stop)');
          this.containerManager.stopAll();
          break;
      }
    }

    this.eventBus.removeAllListeners();
  }
}

// --- Default shared skill content ---

const PROCESS_MANAGEMENT_SKILL = [
  '---',
  'name: process-management',
  'description: How to run servers, UIs, and background processes safely',
  'triggers: server, run, start, dev, npm run, yarn dev, build, serve, deploy, ui, app, dashboard, website, localhost, port, project, create, cron, schedule, healthcheck',
  '---',
  '',
  '# Background Process Management',
  '',
  'When asked to build and run a server, UI, website, or any long-running process:',
  '',
  '## Workspace Organization',
  '',
  'Keep your workspace organized. Place all project work inside a `projects/` directory:',
  '',
  '```',
  'workspace/',
  '  SOUL.md              # Your identity (managed by Jam)',
  '  skills/              # Your learned skills',
  '  conversations/       # Chat history (managed by Jam)',
  '  projects/            # All project work goes here',
  '    my-app/            # One directory per project',
  '      .services.json   # Service registry (managed by `jam svc`)',
  '      .cron.json       # Cron jobs (managed by `jam cron`)',
  '      src/',
  '      logs/',
  '  inbox.jsonl          # Incoming tasks (managed by Jam)',
  '```',
  '',
  'IMPORTANT: Always create projects inside `projects/`. Never dump files or markdown docs in the workspace root.',
  '',
  '## The `jam` CLI Tool',
  '',
  'You have the `jam` CLI available in your PATH. Use it to register services and cron jobs.',
  'It validates inputs and writes the correct JSON format — prefer it over hand-writing JSON.',
  '',
  '### Service Management',
  '',
  '```bash',
  '# Register a service (writes/updates .services.json atomically)',
  'jam svc register --name my-api --port 3010 --command "node server.js" --health /healthz --log logs/server.log',
  '',
  '# Remove a service entry',
  'jam svc deregister --name my-api',
  '',
  '# List registered services',
  'jam svc list',
  '',
  '# Check service health',
  'jam svc check --name my-api',
  'jam svc check --port 3010',
  '```',
  '',
  '### Cron Job Management',
  '',
  'Use `jam cron` to schedule recurring work. Jam picks up `.cron.json` automatically and runs your jobs on schedule.',
  '',
  '```bash',
  '# Add a cron job (5-field cron: minute hour dom month dow)',
  'jam cron add --name cleanup-logs --schedule "0 2 * * *" --command "node scripts/cleanup.js"',
  'jam cron add --name sync-data --schedule "*/30 * * * *" --command "node scripts/sync.js"',
  '',
  '# List cron jobs',
  'jam cron list',
  '',
  '# Pause/resume a cron job',
  'jam cron disable --name cleanup-logs',
  'jam cron enable --name cleanup-logs',
  '',
  '# Remove a cron job',
  'jam cron remove --name cleanup-logs',
  '```',
  '',
  '## Port Assignment',
  '',
  'Use ports in the range **3000-3099** for your services. Ports outside this range will not be accessible.',
  '- 3000-3009: Web servers and frontends',
  '- 3010-3019: API backends',
  '- 3020-3029: Database UIs, admin panels',
  '- 3030+: Other services',
  '',
  '## Healthcheck Convention',
  '',
  'For HTTP services, implement a `GET /healthz` endpoint that returns `200 OK` when healthy.',
  'Register the service with `--health /healthz` so Jam uses HTTP checks instead of basic TCP port probing.',
  'This lets Jam detect when your service is alive but not functional (e.g., crashed handler, stuck event loop).',
  '',
  '## FORBIDDEN — Do NOT Create System Daemons',
  '',
  'You are **strictly prohibited** from creating persistent system-level services that survive outside of Jam:',
  '',
  '- **NO** `launchctl`, `launchd`, or LaunchAgent/LaunchDaemon plist files',
  '- **NO** `systemctl`, `systemd`, or `.service` unit files',
  '- **NO** `crontab` entries (use `jam cron` instead)',
  '- **NO** writing to `~/Library/LaunchAgents/`, `/Library/LaunchDaemons/`, or `/etc/systemd/`',
  '- **NO** watchdog scripts, monitor scripts, or health-check daemons',
  '- **NO** auto-restart wrappers that respawn processes independently of Jam',
  '',
  'Jam manages your service lifecycle. Use `jam svc` for services and `jam cron` for scheduled work.',
  'Creating system daemons causes orphan processes that consume resources indefinitely.',
  '',
  '## Rules',
  '1. **NEVER** run long-lived processes in the foreground (they block you forever)',
  '2. **NEVER** use `tail -f`, `watch`, or stream logs — they consume infinite tokens',
  '3. **ALWAYS** run processes in the background with output redirected to a log file',
  '4. **ALWAYS** return control after confirming the process started successfully',
  '5. **ALWAYS** register the service with `jam svc register` so Jam can track and manage it',
  '6. **ALWAYS** use a port in the range 3000-3099 so Jam can detect and reach it',
  '7. **NEVER** create LaunchAgents, systemd units, cron jobs, or any persistent daemon',
  '8. **ALWAYS** implement `GET /healthz` for HTTP services and register with `--health /healthz`',
  '',
  '## How to Start a Background Process',
  '',
  '```bash',
  '# Create project directory and logs',
  'mkdir -p projects/my-app/logs',
  'cd projects/my-app',
  '',
  '# Start the process in background, redirect all output to log file',
  'nohup npm run dev -- --port 3000 > logs/server.log 2>&1 &',
  '',
  '# Wait briefly for startup',
  'sleep 3',
  '',
  '# Verify it\'s running by checking the port',
  'lsof -i :3000 -sTCP:LISTEN -t 2>/dev/null && echo "Server is running on port 3000" || echo "Server failed to start"',
  '',
  '# Register with Jam (REQUIRED)',
  'jam svc register --name dev-server --port 3000 --command "npm run dev -- --port 3000" --health /healthz --log logs/server.log',
  '```',
  '',
  '## How to Check if a Process is Running',
  '',
  '```bash',
  '# Check via jam CLI (preferred — uses healthcheck if configured)',
  'jam svc check --name dev-server',
  '',
  '# Check by port (fallback)',
  'lsof -i :3000 -sTCP:LISTEN -t 2>/dev/null && echo "Running" || echo "Stopped"',
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
  '# Find and kill by port',
  'kill $(lsof -ti :3000 -sTCP:LISTEN) 2>/dev/null',
  '```',
  '',
  '## Important',
  '- After starting a background process, tell the user: the URL, the port, and the log file path',
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
  'To send a task to another agent, write a JSON line to their `inbox.jsonl`.',
  'For short tasks, use echo:',
  '',
  '```bash',
  'echo \'{"title":"Check Google stock price","description":"Look up the current GOOG stock price and report back","from":"\'$JAM_AGENT_ID\'"}\' >> /path/to/target-agent-workspace/inbox.jsonl',
  '```',
  '',
  'For longer descriptions, use printf or a heredoc to avoid shell quoting issues:',
  '',
  '```bash',
  'printf \'%s\\n\' "$(cat <<ENDJSON',
  '{"title":"Research brokerage APIs","description":"Find platforms with API access for trading...","from":"\'$JAM_AGENT_ID\'","priority":"high"}',
  'ENDJSON',
  ')" >> /path/to/target-agent-workspace/inbox.jsonl',
  '```',
  '',
  '**IMPORTANT:** Every inbox entry MUST include `title`, `description`, and `from`. If title is missing the task will appear as "Untitled".',
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

/** Sandbox-mode variant: agents use host bridge for inbox writes and /team for shared data */
const TEAM_COMMUNICATION_SKILL_SANDBOX = [
  '---',
  'name: team-communication',
  'description: How to send tasks, delegate work, and share updates with other agents',
  'triggers: ask, tell, send, delegate, message, request, assign, inbox, agent, team, teammate, share, update, broadcast, sync, publish, done, finished, completed',
  '---',
  '',
  '# Team Communication (Sandbox Mode)',
  '',
  'You are part of a team of AI agents managed by Jam. Each agent runs in its own Docker container.',
  '',
  '## Your Teammates',
  '{{AGENT_ROSTER}}',
  '',
  '## Delegating Tasks',
  '',
  'To send a task to another agent, use the **host bridge** `inbox-write` operation.',
  'You CANNOT write directly to other agents\' workspaces — each container is isolated.',
  '',
  '```bash',
  'curl -s -X POST "$JAM_HOST_BRIDGE_URL" \\',
  '  -H "Authorization: Bearer $JAM_HOST_BRIDGE_TOKEN" \\',
  '  -H "X-Jam-Agent-Id: $JAM_AGENT_ID" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"operation":"inbox-write","params":{"targetAgent":"AgentName","title":"Task title","description":"Detailed description of what to do","priority":"normal"}}\'',
  '```',
  '',
  'For longer descriptions, use a variable:',
  '```bash',
  'BODY=$(cat <<\'ENDJSON\'',
  '{"operation":"inbox-write","params":{"targetAgent":"AgentName","title":"Research brokerage APIs","description":"Find platforms with API access for automated trading. Compare fees, supported markets, and rate limits.","priority":"high"}}',
  'ENDJSON',
  ')',
  'curl -s -X POST "$JAM_HOST_BRIDGE_URL" \\',
  '  -H "Authorization: Bearer $JAM_HOST_BRIDGE_TOKEN" \\',
  '  -H "X-Jam-Agent-Id: $JAM_AGENT_ID" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d "$BODY"',
  '```',
  '',
  '**Parameters:**',
  '- `targetAgent` (required): The agent\'s name from the roster above',
  '- `title` (required): Short task title',
  '- `description` (required): Detailed task description',
  '- `priority` (optional): low / normal / high / critical',
  '- `tags` (optional): string array for categorization',
  '',
  '## Shared Team Directory',
  '',
  'All agents share a `/team` directory (mounted read-write in every container):',
  '',
  '- `/team/blackboard/{topic}/` — publish artifacts for other agents to read',
  '- `/team/channels/{channelId}/` — read shared channel messages',
  '',
  'To publish an artifact:',
  '```bash',
  'mkdir -p /team/blackboard/my-topic',
  'echo \'{"agentId":"\'$JAM_AGENT_ID\'","topic":"my-topic","type":"text","content":"Dashboard deployed on port 8085"}\' >> /team/blackboard/my-topic/artifacts.jsonl',
  '```',
  '',
  '## Rules',
  '- Use `inbox-write` via the host bridge — do NOT try to write to other agents\' `/workspace`',
  '- Always include the `X-Jam-Agent-Id` header (set from `$JAM_AGENT_ID`)',
  '- Your agent ID is available as the `JAM_AGENT_ID` environment variable',
  '- The inbox is processed automatically — do NOT wait for a response',
  '- Keep task descriptions clear and actionable',
  '- After sending an inbox message, tell the user you\'ve delegated the task',
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

const HOST_BRIDGE_SKILL = [
  '---',
  'name: host-bridge',
  'description: How to interact with the host machine from inside a Docker container',
  'triggers: browser, open, url, clipboard, paste, copy, applescript, osascript, notification, notify, host, desktop',
  '---',
  '',
  '# Host Bridge — Interacting with the Host Machine',
  '',
  'When running in sandbox mode, you are inside a Docker container and cannot directly',
  'access the host machine\'s browser, clipboard, or other desktop features.',
  '',
  'The Host Bridge provides a secure HTTP API on the host machine.',
  '',
  '## Configuration',
  '',
  'The bridge URL and token are available as environment variables:',
  '- `JAM_HOST_BRIDGE_URL` — the bridge endpoint (only set when sandbox mode is active)',
  '- `JAM_HOST_BRIDGE_TOKEN` — authentication token (rotates each session)',
  '',
  'If `JAM_HOST_BRIDGE_URL` is not set, you are running in native mode and can use',
  'standard tools directly.',
  '',
  '## Operations',
  '',
  '### Open a URL in the host browser',
  '```bash',
  'curl -s -X POST "$JAM_HOST_BRIDGE_URL" \\',
  '  -H "Authorization: Bearer $JAM_HOST_BRIDGE_TOKEN" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"operation":"open-url","params":{"url":"https://example.com"}}\'',
  '```',
  '',
  '### Read host clipboard',
  '```bash',
  'curl -s -X POST "$JAM_HOST_BRIDGE_URL" \\',
  '  -H "Authorization: Bearer $JAM_HOST_BRIDGE_TOKEN" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"operation":"clipboard-read","params":{}}\'',
  '```',
  '',
  '### Write to host clipboard',
  '```bash',
  'curl -s -X POST "$JAM_HOST_BRIDGE_URL" \\',
  '  -H "Authorization: Bearer $JAM_HOST_BRIDGE_TOKEN" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"operation":"clipboard-write","params":{"text":"Hello from container"}}\'',
  '```',
  '',
  '### Run AppleScript (macOS only)',
  '```bash',
  'curl -s -X POST "$JAM_HOST_BRIDGE_URL" \\',
  '  -H "Authorization: Bearer $JAM_HOST_BRIDGE_TOKEN" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"operation":"applescript","params":{"script":"tell application \\"Safari\\" to open location \\"https://example.com\\""}}\'',
  '```',
  '',
  '### Show a desktop notification',
  '```bash',
  'curl -s -X POST "$JAM_HOST_BRIDGE_URL" \\',
  '  -H "Authorization: Bearer $JAM_HOST_BRIDGE_TOKEN" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"operation":"notification","params":{"title":"Build Complete","body":"All tests passed"}}\'',
  '```',
  '',
  '### Open a file on the host',
  '```bash',
  'curl -s -X POST "$JAM_HOST_BRIDGE_URL" \\',
  '  -H "Authorization: Bearer $JAM_HOST_BRIDGE_TOKEN" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"operation":"file-open","params":{"path":"/path/to/file.pdf"}}\'',
  '```',
  '',
  '### Send a task to another agent (inbox-write)',
  '```bash',
  'curl -s -X POST "$JAM_HOST_BRIDGE_URL" \\',
  '  -H "Authorization: Bearer $JAM_HOST_BRIDGE_TOKEN" \\',
  '  -H "X-Jam-Agent-Id: $JAM_AGENT_ID" \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"operation":"inbox-write","params":{"targetAgent":"AgentName","title":"Task title","description":"What to do"}}\'',
  '```',
  '',
  '## Rules',
  '- Only use the bridge when `JAM_HOST_BRIDGE_URL` is set',
  '- The bridge only allows whitelisted operations — arbitrary commands are not supported',
  '- AppleScript: `do shell script` and keystroke simulation are blocked for security',
  '- Always include the `X-Jam-Agent-Id` header for operations that identify the sender (inbox-write)',
  '- Always check the response `success` field before assuming the operation worked',
].join('\n');

/** Build computer-use skill with the correct API URL based on execution mode.
 *  Container mode: 127.0.0.1:3100 (loopback inside Docker).
 *  Host mode: uses $JAM_COMPUTER_USE_URL env var (set per-agent with the mapped host port). */
function buildComputerUseSkill(mode: 'container' | 'host'): string {
  const isContainer = mode === 'container';
  // In container mode: hardcoded loopback. In host mode: env var resolved at runtime.
  const baseUrl = isContainer ? '127.0.0.1:3100' : '$JAM_COMPUTER_USE_URL';

  const envPreamble = isContainer
    ? [
        'IMPORTANT: You are running inside an isolated Docker container (Ubuntu Linux).',
        'Your Bash tool executes commands INSIDE the container — not on the host machine.',
        'You have your own virtual Linux desktop with a display server, window manager, and browser.',
        'For ALL browser, GUI, desktop, screenshot, and visual tasks, use the HTTP API below.',
        'Do NOT use MCP Playwright tools, host bridge openExternal, or any host-side browser.',
        `Those operate on the HOST machine — your desktop is at ${baseUrl} inside your sandbox.`,
      ].join('\n')
    : [
        'You have access to a virtual Linux desktop running in a Docker container.',
        'Your Bash tool executes on the HOST machine — the desktop runs in a container.',
        'The computer-use API is available at the URL in $JAM_COMPUTER_USE_URL.',
        'For ALL browser, GUI, desktop, screenshot, and visual tasks, use the HTTP API below.',
        'Do NOT use MCP Playwright tools or host browser — use the virtual desktop API.',
      ].join('\n');

  return [
    '---',
    'name: computer-use',
    'description: Control the virtual desktop — screenshots, clicks, typing, browser automation',
    'triggers: screenshot, click, screen, browser, desktop, window, type text, scroll, gui, ui, button, menu, navigate, launch, computer use, automate, observe, open, url, website, web, page, site, yahoo, google, search',
    'alwaysInject: true',
    '---',
    '',
    '# Computer Use — Virtual Desktop',
    '',
    envPreamble,
    '',
    `Control the virtual desktop via HTTP API at ${baseUrl}.`,
    '',
    '## Quick Reference',
    '',
    '### Screenshots (IMPORTANT)',
    'To take a screenshot and view it, always save as a real image file using the /raw endpoint:',
    '```bash',
    `curl -s ${baseUrl}/screenshot/raw -o /tmp/screen.png`,
    '```',
    'Then read the image file to see it. The /raw endpoint returns actual PNG bytes.',
    '',
    'For browser-only screenshots:',
    '```bash',
    `curl -s ${baseUrl}/browser/screenshot/raw -o /tmp/browser.png`,
    '```',
    '',
    'For smaller screenshots (recommended), use JPEG with quality parameter:',
    '```bash',
    `curl -s "${baseUrl}/screenshot/raw?format=jpeg&quality=60" -o /tmp/screen.jpg`,
    '```',
    '',
    'NOTE: The non-raw endpoints (/screenshot, /browser/screenshot) return JSON with base64 data.',
    'Do NOT pipe those to a file — the file will contain JSON text, not image bytes.',
    '',
    '### Observe (full screen state as JSON)',
    '```bash',
    `curl -s ${baseUrl}/observe | jq`,
    `curl -s ${baseUrl}/status | jq`,
    '```',
    '',
    '### Click & Type',
    '```bash',
    `curl -s -X POST ${baseUrl}/click -H 'Content-Type: application/json' -d '{"x":500,"y":300}'`,
    `curl -s -X POST ${baseUrl}/type -H 'Content-Type: application/json' -d '{"text":"hello world"}'`,
    `curl -s -X POST ${baseUrl}/key -H 'Content-Type: application/json' -d '{"key":"ctrl+s"}'`,
    `curl -s -X POST ${baseUrl}/scroll -H 'Content-Type: application/json' -d '{"direction":"down","amount":3}'`,
    '```',
    '',
    '### Windows',
    '```bash',
    `curl -s ${baseUrl}/windows | jq`,
    `curl -s -X POST ${baseUrl}/focus -H 'Content-Type: application/json' -d '{"title":"Chromium"}'`,
    `curl -s -X POST ${baseUrl}/launch -H 'Content-Type: application/json' -d '{"command":"xterm"}'`,
    '```',
    '',
    '### Browser (Playwright)',
    '```bash',
    `curl -s -X POST ${baseUrl}/browser/launch -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'`,
    `curl -s ${baseUrl}/browser/snapshot | jq`,
    `curl -s -X POST ${baseUrl}/browser/click -H 'Content-Type: application/json' -d '{"text":"Sign in"}'`,
    `curl -s -X POST ${baseUrl}/browser/type -H 'Content-Type: application/json' -d '{"selector":"#email","text":"user@example.com"}'`,
    `curl -s -X POST ${baseUrl}/browser/eval -H 'Content-Type: application/json' -d '{"expression":"document.title"}'`,
    `curl -s ${baseUrl}/browser/screenshot/raw -o /tmp/browser.png`,
    '```',
    '',
    '### Wait for changes',
    '```bash',
    `curl -s -X POST ${baseUrl}/wait -H 'Content-Type: application/json' -d '{"change":true,"timeout":5}'`,
    '```',
    '',
    '## Tips',
    '- ALWAYS use /screenshot/raw or /browser/screenshot/raw when saving screenshots to files',
    '- Use /observe to see the full screen state (JSON with windows list + screenshot)',
    '- Browser commands use Playwright (fastest, most reliable for web automation)',
    '- For native Linux GUI apps, use /click + /type + /key with coordinates from /screenshot',
    '- All command responses are JSON: {"success": true, "data": {...}, "duration_ms": N}',
  ].join('\n');
}

