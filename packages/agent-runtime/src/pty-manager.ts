import type { AgentId } from '@jam/core';
import { createLogger } from '@jam/core';
import type * as pty from 'node-pty';
import { buildCleanEnv } from './utils.js';

const log = createLogger('PtyManager');

/**
 * Escape a string for use in a shell command.
 * Wraps in single quotes, escaping any embedded single quotes.
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export interface PtyInstance {
  agentId: AgentId;
  process: pty.IPty;
  scrollback: string[];
}

export interface PtyOutputHandler {
  (agentId: AgentId, data: string): void;
}

export interface PtyExitHandler {
  (agentId: AgentId, exitCode: number): void;
}

const SCROLLBACK_MAX = 10_000;
const FLUSH_INTERVAL_MS = 16;

// DSR (Device Status Report) pattern — CLI agents like Claude Code send ESC[6n
// to query cursor position. If unanswered, the agent hangs waiting for a reply.
// We intercept and auto-respond with a fake cursor position.
// eslint-disable-next-line no-control-regex
const DSR_PATTERN = /\x1b\[\??6n/g;

function stripDsrRequests(input: string): { cleaned: string; dsrCount: number } {
  let dsrCount = 0;
  const cleaned = input.replace(DSR_PATTERN, () => {
    dsrCount++;
    return '';
  });
  return { cleaned, dsrCount };
}

/** Build a CPR (Cursor Position Report) response: ESC[row;colR */
function buildCursorPositionResponse(row = 1, col = 1): string {
  return `\x1b[${row};${col}R`;
}

export class PtyManager {
  private instances = new Map<string, PtyInstance>();
  private outputHandler: PtyOutputHandler | null = null;
  private exitHandler: PtyExitHandler | null = null;
  onOutput(handler: PtyOutputHandler): void {
    this.outputHandler = handler;
  }

  onExit(handler: PtyExitHandler): void {
    this.exitHandler = handler;
  }

  async spawn(
    agentId: AgentId,
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
    },
  ): Promise<{ success: boolean; pid?: number; error?: string }> {
    if (this.instances.has(agentId)) {
      return { success: false, error: 'PTY already exists for this agent' };
    }

    try {
      // Dynamic import to avoid issues in renderer/test contexts
      const nodePty = await import('node-pty');

      // Spawn through the user's login shell. This is essential in Electron
      // because: (1) the shell handles PATH resolution, shebang execution,
      // and dyld environment correctly, (2) Electron's hardened runtime can
      // interfere with direct posix_spawnp of external binaries, and
      // (3) login shells source the user's profile for the full environment.
      const shell = process.env.SHELL || '/bin/zsh';
      const agentCmd = [command, ...args].map(shellEscape).join(' ');
      const shellCmd = agentCmd;
      log.info(`Spawning via shell: ${shell} -lc ${shellCmd}`, undefined, agentId);

      // Build a clean env — filter out vars that break posix_spawnp
      // or cause nested-session detection (CLAUDECODE, CLAUDE_PARENT_CLI)
      const env = buildCleanEnv({
        ...options.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      });

      const ptyProcess = nodePty.spawn(shell, ['-lc', shellCmd], {
        name: 'xterm-256color',
        cols: options.cols ?? 120,
        rows: options.rows ?? 30,
        cwd: options.cwd ?? process.env.HOME ?? '/',
        env,
      });

      const instance: PtyInstance = {
        agentId,
        process: ptyProcess,
        scrollback: [],
      };

      // Batch output for performance (~60fps)
      let outputBuffer = '';
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const cursorResponse = buildCursorPositionResponse();

      ptyProcess.onData((data: string) => {
        // DSR interception: CLI agents (Claude Code) send ESC[6n cursor queries.
        // Strip them from output and auto-respond so the agent doesn't hang.
        const { cleaned, dsrCount } = stripDsrRequests(data);
        if (dsrCount > 0) {
          for (let i = 0; i < dsrCount; i++) {
            ptyProcess.write(cursorResponse);
          }
        }

        const outputData = cleaned;

        // Accumulate scrollback
        const lines = outputData.split('\n');
        instance.scrollback.push(...lines);
        if (instance.scrollback.length > SCROLLBACK_MAX) {
          instance.scrollback.splice(
            0,
            instance.scrollback.length - SCROLLBACK_MAX,
          );
        }

        // Batch and flush
        outputBuffer += outputData;
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            this.outputHandler?.(agentId, outputBuffer);
            outputBuffer = '';
            flushTimer = null;
          }, FLUSH_INTERVAL_MS);
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        // Flush any remaining output
        if (outputBuffer) {
          this.outputHandler?.(agentId, outputBuffer);
          outputBuffer = '';
        }
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }

        this.instances.delete(agentId);
        this.exitHandler?.(agentId, exitCode);
      });

      this.instances.set(agentId, instance);
      log.info(`Spawned PTY for agent: ${command} ${args.join(' ')} (PID: ${ptyProcess.pid})`, undefined, agentId);
      return { success: true, pid: ptyProcess.pid };
    } catch (error) {
      log.error(`Failed to spawn PTY: ${String(error)}`, { command, args }, agentId);
      return { success: false, error: String(error) };
    }
  }

  write(agentId: AgentId, data: string): void {
    const instance = this.instances.get(agentId);
    if (instance) {
      instance.process.write(data);
    }
  }

  resize(agentId: AgentId, cols: number, rows: number): void {
    const instance = this.instances.get(agentId);
    if (instance) {
      instance.process.resize(cols, rows);
    }
  }

  kill(agentId: AgentId): void {
    const instance = this.instances.get(agentId);
    if (instance) {
      instance.process.kill();
      this.instances.delete(agentId);
    }
  }

  getScrollback(agentId: AgentId): string {
    const instance = this.instances.get(agentId);
    return instance ? instance.scrollback.join('\n') : '';
  }

  isRunning(agentId: AgentId): boolean {
    return this.instances.has(agentId);
  }

  killAll(): void {
    for (const [agentId] of this.instances) {
      this.kill(agentId);
    }
  }
}
