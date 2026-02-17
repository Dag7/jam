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

const log = createLogger('ClaudeCodeRuntime');

export class ClaudeCodeRuntime implements IAgentRuntime {
  readonly runtimeId = 'claude-code';

  buildSpawnConfig(profile: AgentProfile): SpawnConfig {
    const args: string[] = [];

    if (profile.model) {
      args.push('--model', profile.model);
    }

    if (profile.systemPrompt) {
      args.push('--system-prompt', profile.systemPrompt);
    }

    return {
      command: 'claude',
      args,
      env: {
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    };
  }

  parseOutput(raw: string): AgentOutput {
    const cleaned = stripAnsiSimple(raw);

    if (cleaned.includes('Tool use:') || cleaned.includes('Running:')) {
      return { type: 'tool-use', content: cleaned.trim(), raw };
    }

    if (cleaned.includes('Thinking...') || cleaned.includes('thinking')) {
      return { type: 'thinking', content: cleaned.trim(), raw };
    }

    return { type: 'text', content: cleaned.trim(), raw };
  }

  formatInput(text: string, context?: InputContext): string {
    let input = text;

    if (context?.sharedContext) {
      input = `[Context from other agents: ${context.sharedContext}]\n\n${input}`;
    }

    return input;
  }

  async execute(profile: AgentProfile, text: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const args = this.buildOneShotArgs(profile, options?.sessionId);
    const env = buildCleanEnv({
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ...options?.env,
    });

    log.info(`Executing: claude ${args.join(' ')} <<< "${text.slice(0, 60)}"`, undefined, profile.id);

    return new Promise((resolve) => {
      const child = spawn('claude', args, {
        cwd: options?.cwd ?? profile.cwd ?? process.env.HOME ?? '/',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Pipe voice command text via stdin — avoids shell escaping issues
      child.stdin.write(text);
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

        const result = this.parseOneShotOutput(stdout);
        log.info(`Execute complete: ${result.text.length} chars`, undefined, profile.id);
        resolve(result);
      });

      child.on('error', (err) => {
        clearTimeout(watchdogTimer);
        clearTimeout(overallTimer);
        log.error(`Spawn error: ${String(err)}`, undefined, profile.id);
        resolve({ success: false, text: '', error: String(err) });
      });
    });
  }

  /** Build CLI args for one-shot `claude -p --output-format json` */
  private buildOneShotArgs(profile: AgentProfile, sessionId?: string): string[] {
    const args: string[] = ['-p', '--output-format', 'json'];

    if (profile.model) {
      args.push('--model', profile.model);
    }

    if (profile.systemPrompt) {
      args.push('--system-prompt', profile.systemPrompt);
    }

    if (sessionId) {
      args.push('--resume', sessionId);
    }

    return args;
  }

  /** Parse JSON output from `claude -p --output-format json` */
  private parseOneShotOutput(stdout: string): ExecutionResult {
    try {
      const data = JSON.parse(stdout);
      return {
        success: true,
        text: data.result ?? data.text ?? data.content ?? stdout,
        sessionId: data.session_id,
      };
    } catch {
      // Try JSONL (multiple JSON objects, one per line)
      const lines = stdout.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(lines[i]);
          if (obj.type === 'result') {
            return { success: true, text: obj.result ?? '', sessionId: obj.session_id };
          }
        } catch { /* skip non-JSON lines */ }
      }
      // Fallback: return raw stdout stripped of ANSI
      return { success: true, text: stripAnsiSimple(stdout).trim() };
    }
  }
}
