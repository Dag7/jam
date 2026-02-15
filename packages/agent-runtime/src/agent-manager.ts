import { v4 as uuid } from 'uuid';
import type {
  AgentId,
  AgentProfile,
  AgentState,
  AgentStatus,
  IEventBus,
  Events,
} from '@jam/core';
import { PtyManager } from './pty-manager.js';
import { RuntimeRegistry } from './runtime-registry.js';

export interface AgentStore {
  getProfiles(): AgentProfile[];
  saveProfile(profile: AgentProfile): void;
  deleteProfile(agentId: AgentId): void;
}

export class AgentManager {
  private agents = new Map<AgentId, AgentState>();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

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

    // Wire PTY events
    this.ptyManager.onOutput((agentId, data) => {
      this.updateLastActivity(agentId);
      this.eventBus.emit('agent:output', { agentId, data });
    });

    this.ptyManager.onExit((agentId, exitCode) => {
      console.log(`[AgentManager] Agent ${agentId} exited with code ${exitCode}`);
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
      return {
        success: false,
        error: `Unknown runtime: ${profile.runtime}. Available: ${this.runtimeRegistry.list().map((r) => r.runtimeId).join(', ')}`,
      };
    }

    const state: AgentState = {
      profile,
      status: 'stopped',
      visualState: 'offline',
    };

    this.agents.set(id, state);
    this.store.saveProfile(profile);
    this.eventBus.emit('agent:created', { agentId: id, profile });

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
    const result = await this.ptyManager.spawn(agentId, spawnConfig.command, spawnConfig.args, {
      cwd: state.profile.cwd,
      env: { ...spawnConfig.env, ...state.profile.env },
    });

    if (result.success) {
      state.pid = result.pid;
      state.startedAt = new Date().toISOString();
      this.updateStatus(agentId, 'running');
    } else {
      this.updateStatus(agentId, 'error');
      this.updateVisualState(agentId, 'error');
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
    if (!state || state.status !== 'running') return;

    const runtime = this.runtimeRegistry.get(state.profile.runtime);
    if (!runtime) return;

    const formatted = runtime.formatInput(text);
    this.ptyManager.write(agentId, formatted + '\n');
    this.updateVisualState(agentId, 'listening');
    this.updateLastActivity(agentId);
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
          console.warn(
            `[AgentManager] Agent ${agentId} (${state.profile.name}) PTY died unexpectedly`,
          );
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
