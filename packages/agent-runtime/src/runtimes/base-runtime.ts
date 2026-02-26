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

  /** Concrete execute() — shared lifecycle across all runtimes */
  async execute(profile: AgentProfile, text: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const command = this.getCommand();
    const args = this.buildExecuteArgs(profile, options, text);
    const env = buildCleanEnv({ ...this.buildExecuteEnv(profile, options), ...options?.env });
    const cwd = options?.cwd ?? profile.cwd ?? process.env.HOME ?? '/';

    log.info(`Executing: ${command} ${args.join(' ').slice(0, 80)}`, undefined, profile.id);

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

      const MAX_OUTPUT = 50 * 1024 * 1024; // 50 MB cap
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
        if (stderr.length < MAX_OUTPUT) {
          stderr += chunk.toString();
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
