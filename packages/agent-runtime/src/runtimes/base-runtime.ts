import { spawn, type ChildProcess } from 'node:child_process';
import type {
  IAgentRuntime,
  SpawnConfig,
  AgentOutput,
  InputContext,
  AgentProfile,
  ExecutionResult,
  ExecutionOptions,
  RuntimeMetadata,
} from '@jam/core';
import { createLogger } from '@jam/core';
import treeKill from 'tree-kill';
import { buildCleanEnv } from '../utils.js';
import type { OutputStrategy } from './output-strategy.js';

const log = createLogger('BaseAgentRuntime');

/**
 * Abstract base class for agent runtimes using the Template Method pattern.
 * Owns the shared execute() lifecycle (spawn, stdio, abort, error handling).
 * Subclasses override hooks to customize args, env, input, output parsing.
 */
export abstract class BaseAgentRuntime implements IAgentRuntime {
  /**
   * Optional OS-level sandbox wrapper for one-shot execute() spawns.
   * Set by the orchestrator when sandboxTier is 'os'.
   * Transforms a command string through seatbelt/bubblewrap.
   */
  private static sandboxWrapper: ((cmd: string) => Promise<string>) | null = null;

  static setSandboxWrapper(wrapper: ((cmd: string) => Promise<string>) | null): void {
    BaseAgentRuntime.sandboxWrapper = wrapper;
  }

  /**
   * Optional Docker executor for one-shot execute() spawns in container mode.
   * Set by the orchestrator when sandboxTier is 'docker' and agentExecution is 'container'.
   * Transforms command + args + env into a `docker exec` invocation for the agent's container.
   *
   * Returns null if the agent has no container (graceful fallback to host execution).
   */
  private static dockerExecutor: ((
    agentId: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ) => { command: string; args: string[]; cwd: string } | null) | null = null;

  static setDockerExecutor(executor: typeof BaseAgentRuntime.dockerExecutor): void {
    BaseAgentRuntime.dockerExecutor = executor;
  }

  abstract readonly runtimeId: string;
  abstract readonly metadata: RuntimeMetadata;

  // --- IAgentRuntime interface (subclasses implement) ---
  abstract buildSpawnConfig(profile: AgentProfile): SpawnConfig;
  abstract parseOutput(raw: string): AgentOutput;
  abstract formatInput(text: string, context?: InputContext): string;

  // --- Template method hooks ---

  /** CLI command to execute (e.g., 'claude', 'opencode') */
  protected abstract getCommand(): string;

  /** Build CLI args for one-shot execution. `text` is provided for runtimes that pass input as a CLI arg (e.g. Codex). */
  protected abstract buildExecuteArgs(profile: AgentProfile, options?: ExecutionOptions, text?: string): string[];

  /** Build runtime-specific env vars (merged with clean process.env) */
  protected abstract buildExecuteEnv(profile: AgentProfile, options?: ExecutionOptions): Record<string, string>;

  /** Create the output strategy for stdout processing */
  protected abstract createOutputStrategy(): OutputStrategy;

  /** Parse final stdout + stderr into an ExecutionResult. Override for JSONL runtimes. */
  protected abstract parseExecutionOutput(stdout: string, stderr: string, code: number): ExecutionResult;

  /** Write input to the child process. Override for CLI-arg runtimes (e.g., Codex). */
  protected writeInput(child: ChildProcess, _profile: AgentProfile, text: string): void {
    child.stdin!.write(text);
    child.stdin!.end();
  }

  /**
   * Spawn a child process. Extracted as a hook so sandboxed runtimes can
   * override to route through `docker exec` instead.
   *
   * When an OS-level sandbox wrapper is set (via setSandboxWrapper),
   * the command is automatically wrapped through seatbelt/bubblewrap.
   */
  protected spawnProcess(
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string> },
  ): ChildProcess {
    return spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Wrap a command through the OS sandbox if available.
   * Called from execute() before spawnProcess().
   */
  private static async maybeSandboxCommand(
    command: string,
    args: string[],
  ): Promise<{ command: string; args: string[] }> {
    if (!BaseAgentRuntime.sandboxWrapper) return { command, args };

    try {
      const fullCmd = [command, ...args].join(' ');
      const wrappedCmd = await BaseAgentRuntime.sandboxWrapper(fullCmd);
      const shell = process.env.SHELL || '/bin/zsh';
      return { command: shell, args: ['-c', wrappedCmd] };
    } catch (err) {
      log.warn(`OS sandbox wrapping failed: ${String(err)}. Proceeding unsandboxed.`);
      return { command, args };
    }
  }

  /** Concrete execute() — shared lifecycle across all runtimes */
  async execute(profile: AgentProfile, text: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const rawCommand = this.getCommand();
    const rawArgs = this.buildExecuteArgs(profile, options, text);
    // Runtime-specific env vars (NOT merged with host process.env yet)
    const runtimeEnv = { ...this.buildExecuteEnv(profile, options), ...options?.env };
    let cwd = options?.cwd ?? profile.cwd ?? process.env.HOME ?? '/';

    // Apply Docker container wrapping if configured (takes priority over OS sandbox)
    let command: string;
    let args: string[];
    let env: Record<string, string>;
    const dockerWrapped = BaseAgentRuntime.dockerExecutor?.(profile.id, rawCommand, rawArgs, runtimeEnv);
    if (dockerWrapped) {
      command = dockerWrapped.command;
      args = dockerWrapped.args;
      cwd = dockerWrapped.cwd;
      // For Docker exec: use minimal host env (docker binary just needs PATH).
      // The runtime-specific vars are already passed as -e flags by the executor.
      env = buildCleanEnv({ TERM: 'xterm-256color' });
      log.info(`Docker-wrapped execute: ${command} ${args.join(' ').slice(0, 120)}`, undefined, profile.id);
    } else {
      // Host execution: merge runtime env with host process.env
      env = buildCleanEnv(runtimeEnv);
      // Apply OS-level sandbox wrapping if configured
      ({ command, args } = await BaseAgentRuntime.maybeSandboxCommand(rawCommand, rawArgs));
      log.info(`Executing: ${command} ${args.join(' ').slice(0, 80)}`, undefined, profile.id);
    }

    return new Promise((resolve) => {
      const child = this.spawnProcess(command, args, { cwd, env });

      // Write input via hook (stdin by default, CLI arg for Codex)
      this.writeInput(child, profile, text);

      // Abort signal support — kill entire process tree on abort
      const abortHandler = options?.signal ? () => {
        if (child.pid) treeKill(child.pid, 'SIGTERM');
      } : undefined;
      if (options?.signal && abortHandler) {
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      const MAX_OUTPUT = 5 * 1024 * 1024; // 5 MB cap — keeps main process memory bounded
      let stdout = '';
      let stderr = '';
      let stdoutCapped = false;
      const strategy = this.createOutputStrategy();
      const callbacks = {
        onProgress: options?.onProgress,
        onOutput: options?.onOutput,
      };

      child.stdout!.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        if (!stdoutCapped) {
          if (stdout.length + chunkStr.length > MAX_OUTPUT) {
            stdout += chunkStr.slice(0, MAX_OUTPUT - stdout.length);
            stdoutCapped = true;
          } else {
            stdout += chunkStr;
          }
        }
        strategy.processChunk(chunkStr, callbacks);
      });

      child.stderr!.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        if (stderr.length < MAX_OUTPUT) {
          stderr += chunkStr;
        }
        // Log stderr in Docker mode for debugging container exec failures
        if (BaseAgentRuntime.dockerExecutor && chunkStr.trim()) {
          log.debug(`Docker stderr: ${chunkStr.trim().slice(0, 200)}`, undefined, profile.id);
        }
      });

      const cleanup = () => {
        if (options?.signal && abortHandler) {
          options.signal.removeEventListener('abort', abortHandler);
        }
      };

      child.on('close', (code) => {
        cleanup();
        strategy.flush(callbacks);

        if (code !== 0) {
          const result = this.parseExecutionOutput(stdout, stderr, code ?? 1);
          if (!result.success) {
            log.error(`Execute failed (exit ${code}): ${result.error}`, undefined, profile.id);
          }
          resolve(result);
          return;
        }

        const result = this.parseExecutionOutput(stdout, stderr, 0);
        log.info(`Execute complete: ${result.text.length} chars`, undefined, profile.id);
        resolve(result);
      });

      child.on('error', (err) => {
        cleanup();
        log.error(`Spawn error: ${String(err)}`, undefined, profile.id);
        resolve({ success: false, text: '', error: String(err) });
      });
    });
  }
}
