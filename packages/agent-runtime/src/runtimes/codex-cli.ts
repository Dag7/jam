import { existsSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type {
  SpawnConfig,
  AgentOutput,
  InputContext,
  AgentProfile,
  ExecutionResult,
  ExecutionOptions,
  RuntimeMetadata,
} from '@jam/core';
import { stripAnsiSimple } from '../utils.js';
import { BaseAgentRuntime } from './base-runtime.js';
import { ThrottledOutputStrategy } from './output-strategy.js';

export class CodexCLIRuntime extends BaseAgentRuntime {
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
    return { command: 'codex', args, env: {} };
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

  // --- Template method hooks ---

  protected getCommand(): string {
    return 'codex';
  }

  /** Codex passes input text as a CLI argument, not stdin */
  protected buildExecuteArgs(profile: AgentProfile, _options?: ExecutionOptions, text?: string): string[] {
    const args = ['exec'];
    if (profile.model) {
      args.push('--model', profile.model);
    }
    if (text) {
      args.push(text);
    }
    return args;
  }

  protected buildExecuteEnv(): Record<string, string> {
    return {};
  }

  /** Codex uses CLI arg for input — no stdin needed */
  protected writeInput(_child: ChildProcess, _profile: AgentProfile, _text: string): void {
    // No-op: text is passed as CLI argument via buildExecuteArgs
  }

  protected createOutputStrategy() {
    return new ThrottledOutputStrategy((cleaned) => {
      if (cleaned.includes('executing') || cleaned.includes('Running') || cleaned.includes('shell')) {
        return 'tool-use';
      }
      return 'text';
    });
  }

  protected parseExecutionOutput(stdout: string, stderr: string, code: number): ExecutionResult {
    if (code !== 0) {
      const lastLine = stripAnsiSimple(stdout).trim().split('\n').pop()?.trim();
      const errMsg = (stderr.trim() || lastLine || `Exit code ${code}`).slice(0, 500);
      return { success: false, text: '', error: errMsg };
    }

    return { success: true, text: stripAnsiSimple(stdout).trim() };
  }
}
