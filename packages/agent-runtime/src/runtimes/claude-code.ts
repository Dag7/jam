import type {
  IAgentRuntime,
  SpawnConfig,
  AgentOutput,
  InputContext,
  AgentProfile,
} from '@jam/core';

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
    // Claude Code uses ANSI escape codes and structured output
    // Strip ANSI for content extraction
    const cleaned = raw.replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;]*[a-zA-Z]/g,
      '',
    );

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

  detectResponseComplete(buffer: string): boolean {
    // Claude Code shows a prompt character when ready for input
    const cleaned = buffer.replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;]*[a-zA-Z]/g,
      '',
    );

    // Look for the Claude Code prompt indicator
    return cleaned.trimEnd().endsWith('>') || cleaned.trimEnd().endsWith('$');
  }
}
