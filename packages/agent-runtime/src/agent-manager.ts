import { v4 as uuid } from 'uuid';
import type {
  AgentId,
  AgentProfile,
  AgentState,
  AgentStatus,
  IEventBus,
} from '@jam/core';
import { createLogger } from '@jam/core';
import { PtyManager } from './pty-manager.js';
import { RuntimeRegistry } from './runtime-registry.js';

const log = createLogger('AgentManager');

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

    this.ptyManager.onExit((agentId, exitCode) => {
      const state = this.agents.get(agentId);
      const name = state?.profile.name ?? agentId;
      if (exitCode === 0) {
        log.info(`Agent "${name}" exited normally`, undefined, agentId);
      } else {
        log.warn(`Agent "${name}" exited with code ${exitCode}`, undefined, agentId);
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

    const state: AgentState = {
      profile,
      status: 'stopped',
      visualState: 'offline',
    };

    this.agents.set(id, state);
    this.store.saveProfile(profile);
    this.eventBus.emit('agent:created', { agentId: id, profile });
    log.info(`Created agent "${profile.name}" (${profile.runtime})`, undefined, id);

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
      env: { ...spawnConfig.env, ...state.profile.env },
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

    const result = await runtime.execute(state.profile, text, {
      sessionId,
      cwd: state.profile.cwd,
    });

    if (!result.success) {
      this.eventBus.emit('agent:output', {
        agentId,
        data: `\r\n\x1b[31m⚠ Error: ${(result.error ?? 'Unknown error').slice(0, 200)}\x1b[0m\r\n`,
      });
      this.updateVisualState(agentId, state.status === 'running' ? 'idle' : 'offline');
      return { success: false, error: result.error };
    }

    // Store session ID for conversation continuity
    if (result.sessionId) {
      this.voiceSessions.set(agentId, result.sessionId);
      log.debug(`Voice session stored: ${result.sessionId}`, undefined, agentId);
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
