import type { AgentId } from '@jam/core';
import { createLogger } from '@jam/core';
import type {
  IPtyManager,
  PtySpawnOptions,
  PtySpawnResult,
  PtyOutputHandler,
  PtyExitHandler,
} from '@jam/agent-runtime';
import type { SandboxConfigBuilder } from './sandbox-config-builder.js';

const log = createLogger('OsSandboxedPtyManager');

/**
 * Wraps a PtyManager with OS-level sandboxing via @anthropic-ai/sandbox-runtime.
 *
 * Uses the Decorator pattern — intercepts spawn() to transform the command
 * through the sandbox wrapper (seatbelt on macOS, bubblewrap on Linux).
 * All other methods delegate directly to the inner PtyManager.
 *
 * Falls back gracefully if sandbox-runtime is not available.
 */
export class OsSandboxedPtyManager implements IPtyManager {
  private sandboxModule: SandboxModule | null = null;
  private initPromise: Promise<void> | null = null;
  private available = false;

  constructor(
    private readonly inner: IPtyManager,
    private readonly configBuilder: SandboxConfigBuilder,
  ) {}

  /**
   * Attempt to load and initialize @anthropic-ai/sandbox-runtime.
   * Safe to call multiple times — returns cached promise.
   */
  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // Dynamic require — sandbox-runtime is an optional dependency
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('@anthropic-ai/sandbox-runtime') as SandboxModule;
        const config = this.configBuilder.buildGlobalConfig();
        await mod.SandboxManager.initialize(config);
        this.sandboxModule = mod;
        this.available = true;
        log.info('OS-level sandbox initialized (seatbelt/bubblewrap)');
      } catch (err) {
        log.warn(`OS sandbox unavailable: ${String(err)}. Agents will run without OS-level isolation.`);
        this.available = false;
      }
    })();

    return this.initPromise;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async spawn(
    agentId: AgentId,
    command: string,
    args: string[],
    options: PtySpawnOptions,
  ): Promise<PtySpawnResult> {
    // Ensure initialized before first spawn
    if (!this.initPromise) await this.initialize();
    await this.initPromise;

    if (!this.available || !this.sandboxModule) {
      // Fallback: spawn without sandbox
      return this.inner.spawn(agentId, command, args, options);
    }

    try {
      // Build the full command string and wrap it with OS sandbox
      const fullCmd = [command, ...args].join(' ');
      const wrappedCmd = await this.sandboxModule.SandboxManager.wrapWithSandbox(fullCmd);

      // Pass the wrapped command through the inner PtyManager
      // The inner PtyManager will wrap it with shell -c
      return this.inner.spawn(agentId, wrappedCmd, [], options);
    } catch (err) {
      log.error(`OS sandbox wrap failed: ${String(err)}. Falling back to unsandboxed.`, undefined, agentId);
      return this.inner.spawn(agentId, command, args, options);
    }
  }

  // --- Delegate all other methods to inner PtyManager ---

  write(agentId: AgentId, data: string): void {
    this.inner.write(agentId, data);
  }

  resize(agentId: AgentId, cols: number, rows: number): void {
    this.inner.resize(agentId, cols, rows);
  }

  kill(agentId: AgentId): void {
    this.inner.kill(agentId);
  }

  waitForExit(agentId: AgentId, timeoutMs?: number): Promise<void> {
    return this.inner.waitForExit(agentId, timeoutMs);
  }

  getScrollback(agentId: AgentId): string {
    return this.inner.getScrollback(agentId);
  }

  isRunning(agentId: AgentId): boolean {
    return this.inner.isRunning(agentId);
  }

  killAll(): void {
    this.inner.killAll();
  }

  onOutput(handler: PtyOutputHandler): void {
    this.inner.onOutput(handler);
  }

  onExit(handler: PtyExitHandler): void {
    this.inner.onExit(handler);
  }

  async dispose(): Promise<void> {
    if (this.sandboxModule) {
      try {
        await this.sandboxModule.SandboxManager.reset();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/** Shape of the @anthropic-ai/sandbox-runtime module (typed to avoid hard dep) */
interface SandboxModule {
  SandboxManager: {
    initialize(config: unknown): Promise<void>;
    wrapWithSandbox(command: string): Promise<string>;
    reset(): Promise<void>;
  };
}
