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

const log = createLogger('CodexCLIRuntime');

export class CodexCLIRuntime implements IAgentRuntime {
  readonly runtimeId = 'codex';

  readonly metadata: RuntimeMetadata = {
    id: 'codex',
    displayName: 'Codex CLI',
    cliCommand: 'codex',
    installHint: 'npm install -g @openai/codex',
    models: [
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', group: 'GPT-5' },
      { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', group: 'GPT-5' },
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', group: 'GPT-5' },
      { id: 'gpt-5.2', label: 'GPT-5.2', group: 'GPT-5' },
      { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', group: 'GPT-5' },
      { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', group: 'GPT-5' },
      { id: 'gpt-5.1', label: 'GPT-5.1', group: 'GPT-5' },
      { id: 'gpt-5-codex', label: 'GPT-5 Codex', group: 'GPT-5' },
      { id: 'gpt-5-codex-mini', label: 'GPT-5 Codex Mini', group: 'GPT-5' },
      { id: 'gpt-5', label: 'GPT-5', group: 'GPT-5' },
      { id: 'o3', label: 'o3', group: 'Reasoning' },
      { id: 'o4-mini', label: 'o4-mini', group: 'Reasoning' },
      { id: 'codex-mini-latest', label: 'Codex Mini (latest)', group: 'Legacy' },
    ],
    detectAuth(homedir: string): boolean {
      return existsSync(`${homedir}/.codex/config.toml`) ||
        !!process.env.OPENAI_API_KEY;
    },
    getAuthHint: () => 'Set OPENAI_API_KEY or run "codex" to configure',
  };

  buildSpawnConfig(profile: AgentProfile): SpawnConfig {
    const args: string[] = [];

    if (profile.model) {
      args.push('--model', profile.model);
    }

    return {
      command: 'codex',
      args,
      env: {},
    };
  }

  parseOutput(raw: string): AgentOutput {
    const cleaned = stripAnsiSimple(raw);

    if (cleaned.includes('executing') || cleaned.includes('Running') || cleaned.includes('shell')) {
      return { type: 'tool-use', content: cleaned.trim(), raw };
    }

    if (cleaned.includes('Thinking') || cleaned.includes('thinking')) {
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
    const env = buildCleanEnv({ ...options?.env });

    log.info(`Executing: codex exec <<< "${text.slice(0, 60)}"`, undefined, profile.id);

    return new Promise((resolve) => {
      const args = ['exec'];

      if (profile.model) {
        args.push('--model', profile.model);
      }

      args.push(text);

      const child = spawn('codex', args, {
        cwd: options?.cwd ?? profile.cwd ?? process.env.HOME ?? '/',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let lastProgressEmit = 0;
      let firstChunkSent = false;

      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }

      child.stdout.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        stdout += chunkStr;

        if (options?.onProgress) {
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
              const type = cleaned.includes('executing') || cleaned.includes('Running') || cleaned.includes('shell')
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
          const errMsg = stderr.slice(0, 500) || `Exit code ${code}`;
          log.error(`Execute failed (exit ${code}): ${errMsg}`, undefined, profile.id);
          resolve({ success: false, text: '', error: errMsg });
          return;
        }

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
