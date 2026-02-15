import type {
  IAgentRuntime,
  SpawnConfig,
  AgentOutput,
  InputContext,
  AgentProfile,
} from '@jam/core';

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
    const cleaned = raw.replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;]*[a-zA-Z]/g,
      '',
    );

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

  detectResponseComplete(buffer: string): boolean {
    const cleaned = buffer.replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;]*[a-zA-Z]/g,
      '',
    );

    return cleaned.trimEnd().endsWith('>') || cleaned.trimEnd().endsWith('$');
  }
}
