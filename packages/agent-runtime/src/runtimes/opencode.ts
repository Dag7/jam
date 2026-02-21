import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
import { stripAnsiSimple, buildCleanEnv } from '../utils.js';

const log = createLogger('OpenCodeRuntime');

export class OpenCodeRuntime implements IAgentRuntime {
  readonly runtimeId = 'opencode';

  readonly metadata: RuntimeMetadata = {
    id: 'opencode',
    displayName: 'OpenCode',
    cliCommand: 'opencode',
    installHint: 'curl -fsSL https://opencode.ai/install | bash',
    models: [
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', group: 'Anthropic' },
      { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', group: 'Anthropic' },
      { id: 'gpt-4o', label: 'GPT-4o', group: 'OpenAI' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', group: 'OpenAI' },
      { id: 'o3', label: 'o3', group: 'OpenAI' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', group: 'Google' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', group: 'Google' },
    ],
    detectAuth(homedir: string): boolean {
      return existsSync(`${homedir}/.opencode/config.json`);
    },
    getAuthHint: () => 'Run "opencode" in your terminal to configure',
  };

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

      // Pipe text via stdin — use enriched prompt directly if present (from AgentContextBuilder)
      const stdinText = profile.systemPrompt
        ? `[${profile.systemPrompt}]\n\n${text}`
        : `[You are ${profile.name}. When asked who you are, respond as ${profile.name}.]\n\n${text}`;
      child.stdin.write(stdinText);
      child.stdin.end();

      let stdout = '';
      let stderr = '';
      let lastProgressEmit = 0;
      let firstChunkSent = false;

      // Abort signal support
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }

      child.stdout.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        stdout += chunkStr;

        // Emit throttled progress events from raw output
        if (options?.onProgress) {
          // Emit immediately on first output so status isn't stuck on "initializing"
          if (!firstChunkSent) {
            firstChunkSent = true;
            lastProgressEmit = Date.now();
            options.onProgress({ type: 'thinking', summary: 'Processing request...' });
          }

          const now = Date.now();
          if (now - lastProgressEmit > 5000) {
            lastProgressEmit = now;
            const cleaned = stripAnsiSimple(chunkStr).trim();
            if (cleaned.length > 0) {
              const type = cleaned.includes('executing') || cleaned.includes('running')
                ? 'tool-use' as const
                : 'text' as const;
              options.onProgress({ type, summary: cleaned.slice(0, 80) });
            }
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          const lastLine = stripAnsiSimple(stdout).trim().split('\n').pop()?.trim();
          const errMsg = (stderr.trim() || lastLine || `Exit code ${code}`).slice(0, 500);
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
        log.error(`Spawn error: ${String(err)}`, undefined, profile.id);
        resolve({ success: false, text: '', error: String(err) });
      });
    });
  }
}
