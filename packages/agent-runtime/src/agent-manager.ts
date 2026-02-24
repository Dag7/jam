import { v4 as uuid } from 'uuid';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type {
  AgentId,
  AgentProfile,
  AgentState,
  AgentStatus,
  SecretBinding,
  IEventBus,
  ExecutionOptions,
} from '@jam/core';
import { createLogger } from '@jam/core';
import { PtyManager } from './pty-manager.js';
import { RuntimeRegistry } from './runtime-registry.js';
import { AgentContextBuilder } from './agent-context-builder.js';
import { TaskTracker } from './task-tracker.js';
import type { TaskInfo } from './task-tracker.js';
import { createSecretRedactor } from './utils.js';

const log = createLogger('AgentManager');

/** Strip JSON wrapper objects from result text — prevents raw JSONL from leaking into chat */
function sanitizeResultText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return text;
  try {
    const obj = JSON.parse(trimmed);
    // Claude Code result event: {"type":"result","result":"actual text",...}
    if (obj.type === 'result' && typeof obj.result === 'string') return obj.result;
    // Generic wrappers
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
  } catch { /* not JSON — return as-is */ }
  return text;
}

interface QueuedMessage {
  text: string;
  source: 'text' | 'voice';
  /** If true, the user-side message is hidden from chat history UI (e.g. task triggers) */
  hidden?: boolean;
  resolve: (result: { success: boolean; text?: string; error?: string }) => void;
}

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

/** Resolves secret bindings to env var key-value pairs. Provided by the host app. */
export type SecretResolver = (bindings: SecretBinding[]) => Record<string, string>;

/** Returns all decrypted secret values (for building output redactors). */
export type SecretValuesProvider = () => string[];

export class AgentManager {
  private agents = new Map<AgentId, AgentState>();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  /** Session IDs per agent for voice command conversation continuity */
  private voiceSessions = new Map<AgentId, string>();
  /** AbortControllers per agent — allows interrupting running tasks */
  private abortControllers = new Map<AgentId, AbortController>();
  /** Per-agent message queues — messages are processed sequentially */
  private messageQueues = new Map<AgentId, QueuedMessage[]>();
  /** Per-agent processing locks — prevents concurrent voiceCommand calls */
  private processingLocks = new Set<AgentId>();
  /** Output redactor — masks leaked secret values */
  private redact: (text: string) => string = (t) => t;

  constructor(
    private ptyManager: PtyManager,
    private runtimeRegistry: RuntimeRegistry,
    private eventBus: IEventBus,
    private store: AgentStore,
    private contextBuilder: AgentContextBuilder,
    private taskTracker: TaskTracker,
    private secretResolver?: SecretResolver,
    private secretValuesProvider?: SecretValuesProvider,
    sharedSkillsDir?: string,
  ) {
    if (sharedSkillsDir) {
      this.contextBuilder.setSharedSkillsDir(sharedSkillsDir);
    }
    // Restore saved profiles
    for (const profile of this.store.getProfiles()) {
      this.agents.set(profile.id, {
        profile,
        status: 'stopped',
        visualState: 'offline',
      });
    }

    log.info(`Restored ${this.store.getProfiles().length} agent profiles`);

    // Build initial output redactor from stored secrets
    this.rebuildRedactor();

    // Wire PTY events — redact secret values from terminal output
    this.ptyManager.onOutput((agentId, data) => {
      this.updateLastActivity(agentId);
      this.eventBus.emit('agent:output', { agentId, data: this.redact(data) });
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

  /** Bootstrap a system agent if not already present. Used by Orchestrator at startup. */
  ensureSystemAgent(profile: AgentProfile): void {
    if (this.agents.has(profile.id)) return;

    // Default cwd for system agent
    if (!profile.cwd) {
      const sanitized = profile.name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
      profile = { ...profile, cwd: join(homedir(), '.jam', 'agents', sanitized) };
    }
    try {
      mkdirSync(profile.cwd!, { recursive: true });
    } catch (err) {
      log.warn(`Could not create system agent directory: ${String(err)}`, undefined, profile.id);
    }

    const state: AgentState = { profile, status: 'stopped', visualState: 'offline' };
    this.agents.set(profile.id, state);
    this.store.saveProfile(profile);
    this.eventBus.emit('agent:created', { agentId: profile.id, profile });
    log.info(`Bootstrapped system agent "${profile.name}"`, undefined, profile.id);
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

    const secrets = this.secretResolver?.(state.profile.secretBindings ?? []) ?? {};

    const result = await this.ptyManager.spawn(agentId, spawnConfig.command, spawnConfig.args, {
      cwd: state.profile.cwd,
      env: { ...spawnConfig.env, ...state.profile.env, ...secrets, JAM_AGENT_ID: agentId },
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
    if (state.profile.isSystem) return { success: false, error: 'Cannot delete system agent' };

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
    if (state.profile.isSystem) return { success: false, error: 'Cannot modify system agent' };

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
  async voiceCommand(agentId: AgentId, text: string, source: 'text' | 'voice' = 'voice', hidden?: boolean): Promise<{ success: boolean; text?: string; error?: string }> {
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
    const PROGRESS_THROTTLE_MS = 5_000; // Max one progress update every 5s

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

    const secrets = this.secretResolver?.(state.profile.secretBindings ?? []) ?? {};

    // Stream execute() output to dedicated channel (rendered with streamdown in ThreadDrawer)
    const onOutput: ExecutionOptions['onOutput'] = (data) => {
      this.eventBus.emit('agent:executeOutput', { agentId, data: this.redact(data) });
    };

    // Clear previous execute output and show command header
    const cmdPreview = text.length > 60 ? text.slice(0, 60) + '...' : text;
    this.eventBus.emit('agent:executeOutput', {
      agentId,
      data: `\n---\n**${state.profile.name}:** "${cmdPreview}"\n\n`,
      clear: true,
    });

    let result;
    try {
      result = await runtime.execute(enrichedProfile, text, {
        sessionId,
        cwd: state.profile.cwd,
        env: { JAM_AGENT_ID: agentId, ...secrets },
        onProgress,
        onOutput,
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
      this.eventBus.emit('agent:executeOutput', {
        agentId,
        data: `\n> **Error:** ${(result.error ?? 'Unknown error').slice(0, 200)}\n`,
      });
      this.updateVisualState(agentId, state.status === 'running' ? 'idle' : 'offline');
      return { success: false, error: result.error };
    }

    this.taskTracker.completeTask(agentId, 'completed');

    // Sanitize result text — strip JSON wrappers that runtimes may leak
    result.text = sanitizeResultText(result.text);

    // Redact any leaked secret values from agent output
    result.text = this.redact(result.text);

    // Store session ID for conversation continuity
    if (result.sessionId) {
      this.voiceSessions.set(agentId, result.sessionId);
      log.debug(`Voice session stored: ${result.sessionId}`, undefined, agentId);
    }

    // Record conversation for cross-session memory (fire-and-forget)
    // Use distinct timestamps so sort order is deterministic on reload
    if (state.profile.cwd) {
      const userTs = new Date().toISOString();
      this.contextBuilder.recordConversation(state.profile.cwd, {
        timestamp: userTs, role: 'user', content: text, source, ...(hidden && { hidden: true }),
      }).catch(() => {});
      if (result.text) {
        const agentTs = new Date(Date.now() + 1).toISOString();
        this.contextBuilder.recordConversation(state.profile.cwd, {
          timestamp: agentTs, role: 'agent', content: result.text, source, ...(hidden && { hidden: true }),
        }).catch(() => {});
      }
    }

    // Completion marker (output was already streamed via onOutput)
    this.eventBus.emit('agent:executeOutput', {
      agentId,
      data: '\n\n---\n',
    });

    this.updateVisualState(agentId, state.status === 'running' ? 'idle' : 'offline');

    // Emit response for TTS
    if (result.text.length > 0) {
      this.eventBus.emit('agent:responseComplete', { agentId, text: result.text });
    }

    return { success: true, text: result.text };
  }

  /** Execute a command independently — does NOT enter the message queue.
   *  Used for task board execution so the agent stays responsive for user interaction.
   *  Spawns an independent child process; multiple detached tasks can run concurrently. */
  async executeDetached(agentId: AgentId, text: string): Promise<{ success: boolean; text?: string; error?: string }> {
    const state = this.agents.get(agentId);
    if (!state) return { success: false, error: 'Agent not found' };

    const runtime = this.runtimeRegistry.get(state.profile.runtime);
    if (!runtime) return { success: false, error: `Runtime not found: ${state.profile.runtime}` };

    log.info(`Detached execution: "${text.slice(0, 60)}"`, undefined, agentId);

    // Enrich profile (soul, skills, conversation history)
    const enrichedProfile = await this.contextBuilder.buildContext(state.profile, text);

    // Independent abort controller — keyed separately so it doesn't collide with queue-based execution
    const abortController = new AbortController();
    const detachedKey = `detached:${agentId}:${Date.now()}` as AgentId;
    this.abortControllers.set(detachedKey, abortController);

    const secrets = this.secretResolver?.(state.profile.secretBindings ?? []) ?? {};

    // Stream output to the execute output channel (same as voiceCommand)
    const onOutput: ExecutionOptions['onOutput'] = (data) => {
      this.eventBus.emit('agent:executeOutput', { agentId, data: this.redact(data) });
    };

    const onProgress: ExecutionOptions['onProgress'] = (event) => {
      this.eventBus.emit('agent:progress', {
        agentId,
        agentName: state.profile.name,
        agentRuntime: state.profile.runtime,
        agentColor: state.profile.color,
        type: event.type,
        summary: event.summary,
      });
    };

    try {
      const result = await runtime.execute(enrichedProfile, text, {
        cwd: state.profile.cwd,
        env: { JAM_AGENT_ID: agentId, ...secrets },
        onProgress,
        onOutput,
        signal: abortController.signal,
      });

      result.text = sanitizeResultText(result.text);
      result.text = this.redact(result.text);

      // Store session ID for conversation continuity
      if (result.sessionId) {
        this.voiceSessions.set(agentId, result.sessionId);
      }

      // Record conversation as hidden (task-triggered, not user-initiated)
      if (state.profile.cwd) {
        const userTs = new Date().toISOString();
        this.contextBuilder.recordConversation(state.profile.cwd, {
          timestamp: userTs, role: 'user', content: text, source: 'text', hidden: true,
        }).catch(() => {});
        if (result.text) {
          const agentTs = new Date(Date.now() + 1).toISOString();
          this.contextBuilder.recordConversation(state.profile.cwd, {
            timestamp: agentTs, role: 'agent', content: result.text, source: 'text', hidden: true,
          }).catch(() => {});
        }
      }

      return { success: result.success, text: result.text, error: result.error };
    } catch (err) {
      return { success: false, error: String(err) };
    } finally {
      this.abortControllers.delete(detachedKey);
    }
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

  /** Enqueue a command for an agent. If idle, runs immediately.
   *  If busy, queues the message and processes it when the current task finishes.
   *  Returns the number of messages ahead in the queue (0 = running now). */
  enqueueCommand(agentId: AgentId, text: string, source: 'text' | 'voice' = 'voice', options?: { hidden?: boolean }): {
    promise: Promise<{ success: boolean; text?: string; error?: string }>;
    queuePosition: number;
  } {
    const queue = this.messageQueues.get(agentId) ?? [];
    if (!this.messageQueues.has(agentId)) {
      this.messageQueues.set(agentId, queue);
    }

    let resolve!: QueuedMessage['resolve'];
    const promise = new Promise<{ success: boolean; text?: string; error?: string }>((r) => {
      resolve = r;
    });

    queue.push({ text, source, hidden: options?.hidden, resolve });
    const queuePosition = queue.length - 1;

    // Kick off processing if not already running
    if (!this.processingLocks.has(agentId)) {
      this.processQueue(agentId);
    }

    return { promise, queuePosition };
  }

  /** Get the number of queued messages for an agent */
  getQueueLength(agentId: AgentId): number {
    return this.messageQueues.get(agentId)?.length ?? 0;
  }

  /** Process queued messages sequentially */
  private async processQueue(agentId: AgentId): Promise<void> {
    if (this.processingLocks.has(agentId)) return;
    this.processingLocks.add(agentId);

    const queue = this.messageQueues.get(agentId);
    while (queue && queue.length > 0) {
      const msg = queue.shift()!;
      try {
        const result = await this.voiceCommand(agentId, msg.text, msg.source, msg.hidden);
        msg.resolve(result);
      } catch (err) {
        msg.resolve({ success: false, error: String(err) });
      }

      // Notify UI that queue advanced (so it can update queue count)
      if (queue.length > 0) {
        const state = this.agents.get(agentId);
        this.eventBus.emit('agent:queueUpdate', {
          agentId,
          agentName: state?.profile.name ?? 'Agent',
          remaining: queue.length,
          nextCommand: queue[0].text.slice(0, 60),
        });
      }
    }

    this.processingLocks.delete(agentId);
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
      source: 'text' | 'voice';
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
      source: 'text' | 'voice';
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
          source: entry.source ?? 'voice',
          agentId: profile.id,
          agentName: profile.name,
          agentRuntime: profile.runtime,
          agentColor: profile.color ?? '#6b7280',
        });
      }
    }

    // Sort chronologically, with user before agent as tiebreaker for identical timestamps
    merged.sort((a, b) => {
      const cmp = a.timestamp.localeCompare(b.timestamp);
      if (cmp !== 0) return cmp;
      if (a.role === 'user' && b.role !== 'user') return -1;
      if (a.role !== 'user' && b.role === 'user') return 1;
      return 0;
    });
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
    // Abort all running one-shot tasks (execute() child processes)
    for (const [agentId, controller] of this.abortControllers) {
      log.info(`Aborting running task for agent ${agentId} (shutdown)`);
      controller.abort();
    }
    this.abortControllers.clear();
    this.processingLocks.clear();
    this.messageQueues.clear();

    // Stop all PTY-based agents
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

  /** Rebuild the output redactor from the current secret vault.
   *  Call after secrets are added/removed/updated. */
  rebuildRedactor(): void {
    const values = this.secretValuesProvider?.() ?? [];
    this.redact = createSecretRedactor(values);
  }
}
