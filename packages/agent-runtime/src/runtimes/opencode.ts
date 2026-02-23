import { existsSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
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
import { ThrottledOutputStrategy } from './output-strategy.js';

export class OpenCodeRuntime extends BaseAgentRuntime {
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
    const env: Record<string, string> = {};
    if (profile.model) {
      env.OPENCODE_MODEL = profile.model;
    }
    return { command: 'opencode', args: [], env };
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

  // --- Template method hooks ---

  protected getCommand(): string {
    return 'opencode';
  }

  protected buildExecuteArgs(): string[] {
    return ['run'];
  }

  protected buildExecuteEnv(profile: AgentProfile): Record<string, string> {
    const env: Record<string, string> = {};
    if (profile.model) {
      env.OPENCODE_MODEL = profile.model;
    }
    return env;
  }

  /** OpenCode receives system prompt inline via stdin */
  protected writeInput(child: ChildProcess, profile: AgentProfile, text: string): void {
    const stdinText = profile.systemPrompt
      ? `[${profile.systemPrompt}]\n\n${text}`
      : `[You are ${profile.name}. When asked who you are, respond as ${profile.name}.]\n\n${text}`;
    child.stdin!.write(stdinText);
    child.stdin!.end();
  }

  protected createOutputStrategy() {
    return new ThrottledOutputStrategy((cleaned) =>
      cleaned.includes('executing') || cleaned.includes('running')
        ? 'tool-use'
        : 'text',
    );
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
