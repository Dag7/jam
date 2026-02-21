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

const log = createLogger('CursorRuntime');

export class CursorRuntime implements IAgentRuntime {
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

    // Note: --trust is only valid with -p/headless mode, not interactive PTY
    if (profile.model) {
      args.push('--model', profile.model);
    }

    return {
      command: 'cursor-agent',
      args,
      env: {},
    };
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

  async execute(profile: AgentProfile, text: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const env = buildCleanEnv({ ...options?.env });

    log.info(`Executing: cursor-agent -p <<< "${text.slice(0, 60)}"`, undefined, profile.id);

    return new Promise((resolve) => {
      const args = ['-p', '--output-format', 'stream-json', '--trust'];

      if (profile.model) {
        args.push('--model', profile.model);
      }

      const child = spawn('cursor-agent', args, {
        cwd: options?.cwd ?? profile.cwd ?? process.env.HOME ?? '/',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdin.write(text);
      child.stdin.end();

      let stdout = '';
      let stderr = '';
      let lineBuf = '';

      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          child.kill('SIGTERM');
        }, { once: true });
      }

      child.stdout.on('data', (chunk: Buffer) => {
        const chunkStr = chunk.toString();
        stdout += chunkStr;

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
        if (options?.onProgress && lineBuf.trim()) {
          this.parseStreamEvent(lineBuf, options.onProgress);
        }

        if (code !== 0) {
          const lastLine = stripAnsiSimple(stdout).trim().split('\n').pop()?.trim();
          const errMsg = (stderr.trim() || lastLine || `Exit code ${code}`).slice(0, 500);
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

  private parseStreamEvent(
    line: string,
    onProgress: (event: { type: 'tool-use' | 'thinking' | 'text'; summary: string }) => void,
  ): void {
    try {
      const event = JSON.parse(line);

      if (event.type === 'tool_use' || event.tool_name) {
        const toolName = event.tool_name ?? event.name ?? 'a tool';
        onProgress({ type: 'tool-use', summary: `Using ${toolName}` });
        return;
      }

      if (event.type === 'thinking') {
        onProgress({ type: 'thinking', summary: 'Thinking...' });
        return;
      }

      if (event.type === 'message_start') {
        onProgress({ type: 'thinking', summary: 'Processing request...' });
        return;
      }

      if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
        onProgress({ type: 'text', summary: 'Composing response...' });
        return;
      }
    } catch {
      // Not JSON — ignore
    }
  }

  private parseOneShotOutput(stdout: string): ExecutionResult {
    const lines = stdout.trim().split('\n');

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
      return { success: true, text: stripAnsiSimple(stdout).trim() };
    }
  }
}
