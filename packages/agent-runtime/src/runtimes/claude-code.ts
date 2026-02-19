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

      // Abort signal support
      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }

      // Parse streaming JSONL events for progress reporting
      let lineBuf = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        stdout += chunkStr;

        // Parse line-delimited JSON for progress events
        if (options?.onProgress) {
          lineBuf += chunkStr;
          const lines = lineBuf.split('\n');
          lineBuf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            this.parseStreamEvent(line, options.onProgress);
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (code) => {
        // Parse any remaining buffered line
        if (options?.onProgress && lineBuf.trim()) {
          this.parseStreamEvent(lineBuf, options.onProgress);
        }

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
        log.error(`Spawn error: ${String(err)}`, undefined, profile.id);
        resolve({ success: false, text: '', error: String(err) });
      });
    });
  }

  /** Parse a single streaming JSONL event and emit progress if interesting */
  private parseStreamEvent(
    line: string,
    onProgress: (event: { type: 'tool-use' | 'thinking' | 'text'; summary: string }) => void,
  ): void {
    try {
      const event = JSON.parse(line);

      // Tool use events
      if (event.type === 'tool_use' || event.tool_name) {
        const toolName = event.tool_name ?? event.name ?? 'a tool';
        const input = event.input?.command ?? event.input?.file_path ?? '';
        const summary = input
          ? `Using ${toolName}: ${String(input).slice(0, 60)}`
          : `Using ${toolName}`;
        onProgress({ type: 'tool-use', summary });
        return;
      }

      // Content block with tool_use type
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        const name = event.content_block.name ?? 'a tool';
        onProgress({ type: 'tool-use', summary: `Using ${name}` });
        return;
      }

      // Thinking events
      if (event.type === 'thinking' || (event.type === 'content_block_start' && event.content_block?.type === 'thinking')) {
        onProgress({ type: 'thinking', summary: 'Thinking...' });
        return;
      }

      // Message start — agent has begun processing the request
      if (event.type === 'message_start') {
        onProgress({ type: 'thinking', summary: 'Processing request...' });
        return;
      }

      // Text content block — agent is composing a text response
      if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
        onProgress({ type: 'text', summary: 'Composing response...' });
        return;
      }
    } catch {
      // Not JSON or unrecognized format — ignore
    }
  }

  /** Build CLI args for one-shot `claude -p --output-format stream-json` */
  private buildOneShotArgs(profile: AgentProfile, sessionId?: string): string[] {
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

    if (sessionId) {
      args.push('--resume', sessionId);
    }

    return args;
  }

  /** Compose a system prompt — uses enriched prompt directly if present (from AgentContextBuilder) */
  private buildSystemPrompt(profile: AgentProfile): string {
    if (profile.systemPrompt) return profile.systemPrompt;
    return `Your name is ${profile.name}. When asked who you are, respond as ${profile.name}.`;
  }

  /** Parse streaming JSONL output — find the result event */
  private parseOneShotOutput(stdout: string): ExecutionResult {
    const lines = stdout.trim().split('\n');

    // Look for the result event (last one wins)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === 'result') {
          return {
            success: true,
            text: obj.result ?? '',
            sessionId: obj.session_id,
          };
        }
      } catch { /* skip non-JSON lines */ }
    }

    // Fallback: try as single JSON
    try {
      const data = JSON.parse(stdout);
      return {
        success: true,
        text: data.result ?? data.text ?? data.content ?? stdout,
        sessionId: data.session_id,
      };
    } catch {
      // Last resort: return raw stdout stripped of ANSI
      return { success: true, text: stripAnsiSimple(stdout).trim() };
    }
  }
}
