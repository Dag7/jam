import { existsSync, readdirSync } from 'node:fs';
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
import { JsonlOutputStrategy } from './output-strategy.js';
import { parseJsonlStreamEvent, emitJsonlTerminalLine, parseJsonlResult } from './jsonl-parser.js';

export class ClaudeCodeRuntime extends BaseAgentRuntime {
  readonly runtimeId = 'claude-code';

  readonly metadata: RuntimeMetadata = {
    id: 'claude-code',
    displayName: 'Claude Code',
    cliCommand: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    supportsFullAccess: true,
    nodeVersionRequired: 20,
    models: [
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', group: 'Claude 4' },
      { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', group: 'Claude 4' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', group: 'Claude 4' },
      { id: 'opus', label: 'Opus (latest)', group: 'Aliases' },
      { id: 'sonnet', label: 'Sonnet (latest)', group: 'Aliases' },
      { id: 'haiku', label: 'Haiku (latest)', group: 'Aliases' },
    ],
    detectAuth(homedir: string): boolean {
      const claudeDir = `${homedir}/.claude`;
      return existsSync(`${claudeDir}/statsCache`) ||
        existsSync(`${claudeDir}/stats-cache.json`) ||
        (existsSync(`${claudeDir}/projects`) &&
          readdirSync(`${claudeDir}/projects`).length > 0);
    },
    getAuthHint: () => 'Run "claude" in your terminal to authenticate via browser',
  };

  buildSpawnConfig(profile: AgentProfile): SpawnConfig {
    const args: string[] = [];

    if (profile.allowFullAccess) {
      args.push('--dangerously-skip-permissions');
    }

    if (profile.model) {
      args.push('--model', profile.model);
    }

    const systemPrompt = this.buildSystemPrompt(profile);
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
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

  // --- Template method hooks ---

  protected getCommand(): string {
    return 'claude';
  }

  protected buildExecuteArgs(profile: AgentProfile, options?: ExecutionOptions): string[] {
    const args: string[] = ['-p', '--verbose', '--output-format', 'stream-json'];

    if (profile.allowFullAccess) {
      args.push('--dangerously-skip-permissions');
    }

    if (profile.model) {
      args.push('--model', profile.model);
    }

    const systemPrompt = this.buildSystemPrompt(profile);
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    if (options?.sessionId) {
      args.push('--resume', options.sessionId);
    }

    return args;
  }

  protected buildExecuteEnv(): Record<string, string> {
    return { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  }

  protected createOutputStrategy() {
    return new JsonlOutputStrategy(parseJsonlStreamEvent, emitJsonlTerminalLine);
  }

  protected parseExecutionOutput(stdout: string, stderr: string, code: number): ExecutionResult {
    if (code !== 0) {
      const stdoutErr = this.extractErrorFromOutput(stdout);
      const stderrErr = stderr.trim();
      const errMsg = (stdoutErr || stderrErr || `Exit code ${code}`).slice(0, 500);
      return { success: false, text: '', error: errMsg };
    }

    return parseJsonlResult(stdout);
  }

  // --- Claude-specific helpers ---

  /** Compose a system prompt — uses enriched prompt directly if present (from AgentContextBuilder) */
  private buildSystemPrompt(profile: AgentProfile): string {
    if (profile.systemPrompt) return profile.systemPrompt;
    return `Your name is ${profile.name}. When asked who you are, respond as ${profile.name}.`;
  }

  /** Try to extract an error message from stdout (Claude Code outputs errors as JSON) */
  private extractErrorFromOutput(stdout: string): string | undefined {
    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.error) return typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error);
        if (obj.type === 'error' && obj.message) return obj.message;
        if (obj.type === 'result' && obj.is_error) {
          return obj.result ?? obj.error ?? 'Unknown error in result';
        }
        if (obj.type === 'system' && obj.error) return obj.error;
      } catch { /* skip non-JSON */ }
    }
    const stripped = stripAnsiSimple(stdout).trim();
    const rawLines = stripped.split('\n').filter(l => {
      const t = l.trim();
      return t.length > 0 && t !== 'unknown' && !t.startsWith('{');
    });
    return rawLines.pop()?.trim() || undefined;
  }
}
