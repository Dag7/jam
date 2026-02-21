import { v4 as uuid } from 'uuid';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type {
  AgentId,
  AgentProfile,
  AgentState,
  AgentStatus,
  IEventBus,
  ExecutionOptions,
} from '@jam/core';
import { createLogger } from '@jam/core';
import { PtyManager } from './pty-manager.js';
import { RuntimeRegistry } from './runtime-registry.js';
import { AgentContextBuilder } from './agent-context-builder.js';
import { TaskTracker } from './task-tracker.js';
import type { TaskInfo } from './task-tracker.js';

const log = createLogger('AgentManager');

const ACK_PHRASES = [
  'On it!',
  'Got it, working on that now.',
  'Sure, let me check.',
  'Looking into it.',
  'Right away!',
  'Working on it.',
];

function pickAckPhrase(): string {
  return ACK_PHRASES[Math.floor(Math.random() * ACK_PHRASES.length)];
}

export interface AgentStore {
  getProfiles(): AgentProfile[];
  saveProfile(profile: AgentProfile): void;
  deleteProfile(agentId: AgentId): void;
}

export class AgentManager {
  private agents = new Map<AgentId, AgentState>();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  /** Session IDs per agent for voice command conversation continuity */
  private voiceSessions = new Map<AgentId, string>();
  private contextBuilder = new AgentContextBuilder();
  private taskTracker = new TaskTracker();
  /** AbortControllers per agent — allows interrupting running tasks */
  private abortControllers = new Map<AgentId, AbortController>();

  constructor(
    private ptyManager: PtyManager,
    private runtimeRegistry: RuntimeRegistry,
    private eventBus: IEventBus,
    private store: AgentStore,
  ) {
    // Restore saved profiles
    for (const profile of this.store.getProfiles()) {
      this.agents.set(profile.id, {
        profile,
        status: 'stopped',
        visualState: 'offline',
      });
    }

    log.info(`Restored ${this.store.getProfiles().length} agent profiles`);

    // Wire PTY events
    this.ptyManager.onOutput((agentId, data) => {
      this.updateLastActivity(agentId);
      this.eventBus.emit('agent:output', { agentId, data });
    });

    this.ptyManager.onExit((agentId, exitCode, lastOutput) => {
      const state = this.agents.get(agentId);
      const name = state?.profile.name ?? agentId;
      if (exitCode === 0) {
        log.info(`Agent "${name}" exited normally`, undefined, agentId);
      } else {
        // Log last PTY output to diagnose crash reason
        const cleaned = lastOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
        log.error(`Agent "${name}" crashed (exit ${exitCode}). Last output:\n${cleaned || '(no output captured)'}`, undefined, agentId);
        // Emit error event so UI can display the reason to the user
        this.eventBus.emit('agent:error', {
          agentId,
          message: `Agent "${name}" crashed (exit ${exitCode})`,
          details: cleaned || undefined,
        });
      }
      this.updateStatus(agentId, exitCode === 0 ? 'stopped' : 'error');
      this.updateVisualState(agentId, 'offline');
    });
  }

  create(
    input: Omit<AgentProfile, 'id'>,
  ): { success: boolean; agentId?: AgentId; error?: string } {
    const id = uuid();
    const profile: AgentProfile = { ...input, id };

    if (!this.runtimeRegistry.has(profile.runtime)) {
      const error = `Unknown runtime: ${profile.runtime}. Available: ${this.runtimeRegistry.list().map((r) => r.runtimeId).join(', ')}`;
      log.error(`Failed to create agent "${input.name}": ${error}`);
      return { success: false, error };
    }

    // Default cwd to ~/.jam/agents/[agent-name] and ensure the directory exists
    if (!profile.cwd) {
      const sanitized = profile.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      profile.cwd = join(homedir(), '.jam', 'agents', sanitized);
    }
    try {
      mkdirSync(profile.cwd, { recursive: true });
    } catch (err) {
      log.warn(`Could not create agent directory "${profile.cwd}": ${String(err)}`, undefined, id);
    }

    // Initialize SOUL.md and skills directory (fire-and-forget)
    this.contextBuilder.initializeSoul(profile.cwd, profile).catch(err =>
      log.warn(`Failed to initialize SOUL.md: ${String(err)}`, undefined, id)
    );
    this.contextBuilder.initializeSkillsDir(profile.cwd).catch(err =>
      log.warn(`Failed to initialize skills dir: ${String(err)}`, undefined, id)
    );

    const state: AgentState = {
      profile,
      status: 'stopped',
      visualState: 'offline',
    };

    this.agents.set(id, state);
    this.store.saveProfile(profile);
    this.eventBus.emit('agent:created', { agentId: id, profile });
    log.info(`Created agent "${profile.name}" (${profile.runtime}), cwd: ${profile.cwd}`, undefined, id);

    return { success: true, agentId: id };
  }

  async start(
    agentId: AgentId,
  ): Promise<{ success: boolean; error?: string }> {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };
    if (state.status === 'running')
      return { success: false, error: 'Agent already running' };

    const runtime = this.runtimeRegistry.get(state.profile.runtime);
    if (!runtime)
      return { success: false, error: `Runtime not found: ${state.profile.runtime}` };

    this.updateStatus(agentId, 'starting');
    this.updateVisualState(agentId, 'idle');

    const spawnConfig = runtime.buildSpawnConfig(state.profile);
    log.info(
      `Starting agent "${state.profile.name}": ${spawnConfig.command} ${spawnConfig.args.join(' ')}`,
      { cwd: state.profile.cwd },
      agentId,
    );

    const result = await this.ptyManager.spawn(agentId, spawnConfig.command, spawnConfig.args, {
      cwd: state.profile.cwd,
      env: { ...spawnConfig.env, ...state.profile.env, JAM_AGENT_ID: agentId },
    });

    if (result.success) {
      state.pid = result.pid;
      state.startedAt = new Date().toISOString();
      this.updateStatus(agentId, 'running');
      log.info(`Agent "${state.profile.name}" started (PID: ${result.pid})`, undefined, agentId);
    } else {
      this.updateStatus(agentId, 'error');
      this.updateVisualState(agentId, 'error');
      log.error(`Failed to start agent "${state.profile.name}": ${result.error}`, undefined, agentId);
      this.eventBus.emit('agent:error', {
        agentId,
        message: `Failed to start agent "${state.profile.name}"`,
        details: result.error,
      });
    }

    return result;
  }

  stop(agentId: AgentId): { success: boolean; error?: string } {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };

    this.ptyManager.kill(agentId);
    state.pid = undefined;
    this.updateStatus(agentId, 'stopped');
    this.updateVisualState(agentId, 'offline');

    return { success: true };
  }

  async restart(
    agentId: AgentId,
  ): Promise<{ success: boolean; error?: string }> {
    this.updateStatus(agentId, 'restarting');
    this.stop(agentId);
    await new Promise((r) => setTimeout(r, 500));
    return this.start(agentId);
  }

  delete(agentId: AgentId): { success: boolean; error?: string } {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };

    if (state.status === 'running') {
      this.ptyManager.kill(agentId);
    }

    this.agents.delete(agentId);
    this.store.deleteProfile(agentId);
    this.eventBus.emit('agent:deleted', { agentId });

    return { success: true };
  }

  update(
    agentId: AgentId,
    updates: Partial<Omit<AgentProfile, 'id'>>,
  ): { success: boolean; error?: string } {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };

    state.profile = { ...state.profile, ...updates };
    this.store.saveProfile(state.profile);
    this.eventBus.emit('agent:updated', { agentId, profile: state.profile });

    return { success: true };
  }

  sendInput(agentId: AgentId, text: string): void {
    const state = this.agents.get(agentId);
    if (!state || state.status !== 'running') {
      log.warn(`sendInput ignored: agent ${agentId} status=${state?.status ?? 'not found'}`);
      return;
    }

    const runtime = this.runtimeRegistry.get(state.profile.runtime);
    if (!runtime) return;

    const formatted = runtime.formatInput(text);
    log.info(`Sending input to "${state.profile.name}": "${formatted.slice(0, 100)}${formatted.length > 100 ? '...' : ''}"`, undefined, agentId);

    this.ptyManager.write(agentId, formatted + '\r');
    this.updateVisualState(agentId, 'listening');
    this.updateLastActivity(agentId);
  }

  /** Run a voice command via the runtime's execute() method (one-shot child process).
   *  Returns clean text — deterministic completion via process exit.
   *  Echoes the conversation into the terminal view and maintains session continuity. */
  async voiceCommand(agentId: AgentId, text: string): Promise<{ success: boolean; text?: string; error?: string }> {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };

    const runtime = this.runtimeRegistry.get(state.profile.runtime);
    if (!runtime) return { success: false, error: `Runtime not found: ${state.profile.runtime}` };

    const sessionId = this.voiceSessions.get(agentId);
    log.info(`Voice command${sessionId ? ' (resume)' : ''}: "${text.slice(0, 60)}"`, undefined, agentId);

    this.updateVisualState(agentId, 'thinking');

    // Emit acknowledgment immediately — gives instant voice + visual feedback
    const ackText = pickAckPhrase();
    this.eventBus.emit('agent:acknowledged', {
      agentId,
      agentName: state.profile.name,
      agentRuntime: state.profile.runtime,
      agentColor: state.profile.color,
      ackText,
    });

    // Enrich profile with SOUL.md, conversation history, and matched skills
    const enrichedProfile = await this.contextBuilder.buildContext(state.profile, text);

    // Track task + set up abort controller
    this.taskTracker.startTask(agentId, text);
    const abortController = new AbortController();
    this.abortControllers.set(agentId, abortController);

    // Throttled progress reporting — emit voice updates during long-running tasks
    let lastProgressTime = 0;
    const PROGRESS_THROTTLE_MS = 15_000; // Max one progress update every 15s

    const onProgress: ExecutionOptions['onProgress'] = (event) => {
      // Always track steps (unthrottled)
      this.taskTracker.addStep(agentId, { type: event.type, summary: event.summary });

      const now = Date.now();
      if (now - lastProgressTime < PROGRESS_THROTTLE_MS) return;
      lastProgressTime = now;

      log.debug(`Progress: [${event.type}] ${event.summary}`, undefined, agentId);
      this.updateVisualState(agentId, 'thinking');
      this.eventBus.emit('agent:progress', {
        agentId,
        agentName: state.profile.name,
        agentRuntime: state.profile.runtime,
        agentColor: state.profile.color,
        type: event.type,
        summary: event.summary,
      });
    };

    let result;
    try {
      result = await runtime.execute(enrichedProfile, text, {
        sessionId,
        cwd: state.profile.cwd,
        env: { JAM_AGENT_ID: agentId },
        onProgress,
        signal: abortController.signal,
      });
    } catch (err) {
      this.taskTracker.completeTask(agentId, 'failed');
      this.abortControllers.delete(agentId);
      this.updateVisualState(agentId, state.status === 'running' ? 'idle' : 'offline');
      return { success: false, error: String(err) };
    }

    this.abortControllers.delete(agentId);

    if (!result.success) {
      this.taskTracker.completeTask(agentId, 'failed');
      this.eventBus.emit('agent:output', {
        agentId,
        data: `\r\n\x1b[31m⚠ Error: ${(result.error ?? 'Unknown error').slice(0, 200)}\x1b[0m\r\n`,
      });
      this.updateVisualState(agentId, state.status === 'running' ? 'idle' : 'offline');
      return { success: false, error: result.error };
    }

    this.taskTracker.completeTask(agentId, 'completed');

    // Store session ID for conversation continuity
    if (result.sessionId) {
      this.voiceSessions.set(agentId, result.sessionId);
      log.debug(`Voice session stored: ${result.sessionId}`, undefined, agentId);
    }

    // Record conversation for cross-session memory (fire-and-forget)
    if (state.profile.cwd) {
      const ts = new Date().toISOString();
      this.contextBuilder.recordConversation(state.profile.cwd, {
        timestamp: ts, role: 'user', content: text,
      }).catch(() => {});
      if (result.text) {
        this.contextBuilder.recordConversation(state.profile.cwd, {
          timestamp: ts, role: 'agent', content: result.text,
        }).catch(() => {});
      }
    }

    // Echo the conversation into the terminal view
    if (result.text.length > 0) {
      const name = state.profile.name || 'Agent';
      this.eventBus.emit('agent:output', {
        agentId,
        data: `\x1b[33m🤖 ${name}:\x1b[0m ${result.text}\r\n\r\n`,
      });
    }

    this.updateVisualState(agentId, state.status === 'running' ? 'idle' : 'offline');

    // Emit response for TTS
    if (result.text.length > 0) {
      this.eventBus.emit('agent:responseComplete', { agentId, text: result.text });
    }

    return { success: true, text: result.text };
  }

  /** Get the current task status for an agent (from in-memory tracker) */
  getTaskStatus(agentId: AgentId): TaskInfo | null {
    return this.taskTracker.getStatus(agentId);
  }

  /** Get a human-readable status summary suitable for TTS */
  getTaskStatusSummary(agentId: AgentId): string {
    const state = this.agents.get(agentId);
    const name = state?.profile.name ?? 'Agent';
    return this.taskTracker.formatStatusSummary(agentId, name);
  }

  /** Abort a running task for an agent. Returns true if a task was aborted. */
  abortTask(agentId: AgentId): boolean {
    const controller = this.abortControllers.get(agentId);
    if (controller) {
      log.info(`Aborting task for agent ${agentId}`);
      controller.abort();
      this.abortControllers.delete(agentId);
      this.taskTracker.completeTask(agentId, 'failed');
      return true;
    }
    return false;
  }

  /** Check if an agent currently has a task in flight */
  isTaskRunning(agentId: AgentId): boolean {
    return this.abortControllers.has(agentId);
  }

  /** Load conversation history across all (or one) agent(s), merged and sorted chronologically.
   *  Supports cursor-based pagination for infinite scrolling.
   *  Pass agentId to load for a single agent only. */
  async loadConversationHistory(options?: {
    agentId?: string;
    before?: string;
    limit?: number;
  }): Promise<{
    messages: Array<{
      timestamp: string;
      role: 'user' | 'agent';
      content: string;
      agentId: string;
      agentName: string;
      agentRuntime: string;
      agentColor: string;
    }>;
    hasMore: boolean;
  }> {
    const limit = options?.limit ?? 50;
    const before = options?.before;
    const filterAgentId = options?.agentId;

    // Collect conversation entries from target agent(s) in parallel
    const agentEntries = await Promise.all(
      Array.from(this.agents.values())
        .filter(state => state.profile.cwd && (!filterAgentId || state.profile.id === filterAgentId))
        .map(async (state) => {
          const result = await this.contextBuilder.loadPaginatedConversations(
            state.profile.cwd!,
            { before, limit },
          );
          return {
            profile: state.profile,
            entries: result.entries,
            hasMore: result.hasMore,
          };
        }),
    );

    // Merge all entries with agent metadata
    type EnrichedEntry = {
      timestamp: string;
      role: 'user' | 'agent';
      content: string;
      agentId: string;
      agentName: string;
      agentRuntime: string;
      agentColor: string;
    };

    const merged: EnrichedEntry[] = [];
    let anyHasMore = false;

    for (const { profile, entries, hasMore } of agentEntries) {
      if (hasMore) anyHasMore = true;
      for (const entry of entries) {
        merged.push({
          timestamp: entry.timestamp,
          role: entry.role,
          content: entry.content,
          agentId: profile.id,
          agentName: profile.name,
          agentRuntime: profile.runtime,
          agentColor: profile.color ?? '#6b7280',
        });
      }
    }

    // Sort chronologically and take the last `limit` entries
    merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const page = merged.slice(-limit);
    const hasMore = anyHasMore || merged.length > limit;

    return { messages: page, hasMore };
  }

  get(agentId: AgentId): AgentState | undefined {
    return this.agents.get(agentId);
  }

  list(): AgentState[] {
    return Array.from(this.agents.values());
  }

  stopAll(): void {
    for (const [agentId, state] of this.agents) {
      if (state.status === 'running') {
        this.stop(agentId);
      }
    }
  }

  startHealthCheck(intervalMs = 10_000): void {
    this.healthCheckInterval = setInterval(() => {
      for (const [agentId, state] of this.agents) {
        if (state.status === 'running' && !this.ptyManager.isRunning(agentId)) {
          log.error(`Agent "${state.profile.name}" PTY died unexpectedly`, undefined, agentId);
          this.updateStatus(agentId, 'error');
          this.updateVisualState(agentId, 'error');
        }
      }
    }, intervalMs);
  }

  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private updateStatus(agentId: AgentId, status: AgentStatus): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    const previousStatus = state.status;
    state.status = status;
    this.eventBus.emit('agent:statusChanged', {
      agentId,
      status,
      previousStatus,
    });
  }

  private updateVisualState(
    agentId: AgentId,
    visualState: AgentState['visualState'],
  ): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.visualState = visualState;
    this.eventBus.emit('agent:visualStateChanged', { agentId, visualState });
  }

  private updateLastActivity(agentId: AgentId): void {
    const state = this.agents.get(agentId);
    if (state) {
      state.lastActivity = new Date().toISOString();
    }
  }
}
