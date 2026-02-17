import { spawn } from 'node:child_process';
import type {
  IAgentRuntime,
  SpawnConfig,
  AgentOutput,
  InputContext,
  AgentProfile,
  ExecutionResult,
  ExecutionOptions,
} from '@jam/core';
import { createLogger } from '@jam/core';
import { stripAnsiSimple, buildCleanEnv } from '../utils.js';

const log = createLogger('OpenCodeRuntime');

export class OpenCodeRuntime implements IAgentRuntime {
  readonly runtimeId = 'opencode';

  buildSpawnConfig(profile: AgentProfile): SpawnConfig {
    const args: string[] = [];
    const env: Record<string, string> = {};

    if (profile.model) {
      env.OPENCODE_MODEL = profile.model;
    }

    return {
      command: 'opencode',
      args,
      env,
    };
  }

  parseOutput(raw: string): AgentOutput {
    const cleaned = stripAnsiSimple(raw);

    if (cleaned.includes('executing') || cleaned.includes('running')) {
      return { type: 'tool-use', content: cleaned.trim(), raw };
    }

    return { type: 'text', content: cleaned.trim(), raw };
  }

  formatInput(text: string, context?: InputContext): string {
    let input = text;

    if (context?.sharedContext) {
      input = `[Shared context: ${context.sharedContext}]\n\n${input}`;
    }

    return input;
  }

  async execute(profile: AgentProfile, text: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const runtimeEnv: Record<string, string> = {};
    if (profile.model) {
      runtimeEnv.OPENCODE_MODEL = profile.model;
    }

    const env = buildCleanEnv({ ...runtimeEnv, ...options?.env });

    log.info(`Executing: opencode run <<< "${text.slice(0, 60)}"`, undefined, profile.id);

    return new Promise((resolve) => {
      const child = spawn('opencode', ['run'], {
        cwd: options?.cwd ?? profile.cwd ?? process.env.HOME ?? '/',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Pipe text via stdin — prepend identity context
      const identity = `[You are ${profile.name}. When asked who you are, respond as ${profile.name}.]`;
      const systemContext = profile.systemPrompt
        ? `${identity}\n[${profile.systemPrompt}]\n\n${text}`
        : `${identity}\n\n${text}`;
      child.stdin.write(systemContext);
      child.stdin.end();

      let stdout = '';
      let stderr = '';

      // No-output watchdog: kill if no stdout for 60s
      const resetWatchdog = () => {
        clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(() => {
          log.warn('Watchdog: no output for 60s, killing', undefined, profile.id);
          child.kill('SIGTERM');
        }, 60_000);
      };
      let watchdogTimer: ReturnType<typeof setTimeout>;
      resetWatchdog();

      // Overall timeout: 2 minutes max
      const overallTimer = setTimeout(() => {
        log.warn('Overall timeout (2min), killing', undefined, profile.id);
        child.kill('SIGTERM');
      }, 120_000);

      // Abort signal support
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        resetWatchdog();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        clearTimeout(watchdogTimer);
        clearTimeout(overallTimer);

        if (code !== 0) {
          const errMsg = stderr.slice(0, 500) || `Exit code ${code}`;
          log.error(`Execute failed (exit ${code}): ${errMsg}`, undefined, profile.id);
          resolve({ success: false, text: '', error: errMsg });
          return;
        }

        // Strip ANSI and return
        const cleaned = stripAnsiSimple(stdout).trim();
        log.info(`Execute complete: ${cleaned.length} chars`, undefined, profile.id);
        resolve({ success: true, text: cleaned });
      });

      child.on('error', (err) => {
        clearTimeout(watchdogTimer);
        clearTimeout(overallTimer);
        log.error(`Spawn error: ${String(err)}`, undefined, profile.id);
        resolve({ success: false, text: '', error: String(err) });
      });
    });
  }
}
