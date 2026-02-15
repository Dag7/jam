import type { AgentId } from '@jam/core';
import type * as pty from 'node-pty';

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

      const ptyProcess = nodePty.spawn(command, args, {
        name: 'xterm-256color',
        cols: options.cols ?? 120,
        rows: options.rows ?? 30,
        cwd: options.cwd ?? process.env.HOME ?? '/',
        env: {
          ...process.env,
          ...options.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        } as Record<string, string>,
      });

      const instance: PtyInstance = {
        agentId,
        process: ptyProcess,
        scrollback: [],
      };

      // Batch output for performance (~60fps)
      let outputBuffer = '';
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      ptyProcess.onData((data: string) => {
        // Accumulate scrollback
        const lines = data.split('\n');
        instance.scrollback.push(...lines);
        if (instance.scrollback.length > SCROLLBACK_MAX) {
          instance.scrollback.splice(
            0,
            instance.scrollback.length - SCROLLBACK_MAX,
          );
        }

        // Batch and flush
        outputBuffer += data;
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
      return { success: true, pid: ptyProcess.pid };
    } catch (error) {
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
