import { existsSync } from 'node:fs';
import type {
  SpawnConfig,
  AgentOutput,
  InputContext,
  AgentProfile,
  ExecutionResult,
  RuntimeMetadata,
} from '@jam/core';
import { stripAnsiSimple } from '../utils.js';
import { BaseAgentRuntime } from './base-runtime.js';
import { JsonlOutputStrategy } from './output-strategy.js';
import { parseJsonlStreamEvent, emitJsonlTerminalLine, parseJsonlResult } from './jsonl-parser.js';

export class CursorRuntime extends BaseAgentRuntime {
  readonly runtimeId = 'cursor';

  readonly metadata: RuntimeMetadata = {
    id: 'cursor',
    displayName: 'Cursor',
    cliCommand: 'cursor-agent',
    installHint: 'curl https://cursor.com/install -fsS | bash',
    models: [
      { id: 'auto', label: 'Auto', group: 'Cursor' },
      { id: 'composer-1.5', label: 'Composer 1.5', group: 'Cursor' },
      { id: 'composer-1', label: 'Composer 1', group: 'Cursor' },
      { id: 'opus-4.6-thinking', label: 'Opus 4.6 Thinking', group: 'Anthropic' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', group: 'OpenAI' },
      { id: 'gpt-5.3-codex-fast', label: 'GPT-5.3 Codex Fast', group: 'OpenAI' },
      { id: 'gpt-5.2', label: 'GPT-5.2', group: 'OpenAI' },
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', group: 'OpenAI' },
      { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', group: 'OpenAI' },
    ],
    detectAuth(homedir: string): boolean {
      return !!process.env.CURSOR_API_KEY ||
        existsSync(`${homedir}/.cursor/cli-config.json`);
    },
    supportsFullAccess: true,
    getAuthHint: () => 'Run "cursor-agent" in your terminal to authenticate',
  };

  buildSpawnConfig(profile: AgentProfile): SpawnConfig {
    const args: string[] = [];
    if (profile.model) {
      args.push('--model', profile.model);
    }
    return { command: 'cursor-agent', args, env: {} };
  }

  parseOutput(raw: string): AgentOutput {
    const cleaned = stripAnsiSimple(raw);

    if (cleaned.includes('Tool:') || cleaned.includes('Running') || cleaned.includes('executing')) {
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
    return 'cursor-agent';
  }

  protected buildExecuteArgs(profile: AgentProfile): string[] {
    const args = ['-p', '--output-format', 'stream-json', '--trust'];
    if (profile.model) {
      args.push('--model', profile.model);
    }
    return args;
  }

  protected buildExecuteEnv(): Record<string, string> {
    return {};
  }

  protected createOutputStrategy() {
    return new JsonlOutputStrategy(parseJsonlStreamEvent, emitJsonlTerminalLine);
  }

  protected parseExecutionOutput(stdout: string, stderr: string, code: number): ExecutionResult {
    if (code !== 0) {
      const lastLine = stripAnsiSimple(stdout).trim().split('\n').pop()?.trim();
      const errMsg = (stderr.trim() || lastLine || `Exit code ${code}`).slice(0, 500);
      return { success: false, text: '', error: errMsg };
    }

    return parseJsonlResult(stdout);
  }
}
