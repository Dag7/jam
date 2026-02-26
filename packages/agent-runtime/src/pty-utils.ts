import type { AgentId } from '@jam/core';
import type { PtyOutputHandler, PtyExitHandler } from './pty-manager.js';

export const SCROLLBACK_MAX = 10_000;
export const FLUSH_INTERVAL_MS = 16;

// DSR (Device Status Report) pattern — CLI agents like Claude Code send ESC[6n
// to query cursor position. If unanswered, the agent hangs waiting for a reply.
// eslint-disable-next-line no-control-regex
const DSR_PATTERN = /\x1b\[\??6n/g;

export function stripDsrRequests(input: string): { cleaned: string; dsrCount: number } {
  let dsrCount = 0;
  const cleaned = input.replace(DSR_PATTERN, () => {
    dsrCount++;
    return '';
  });
  return { cleaned, dsrCount };
}

/** Build a CPR (Cursor Position Report) response: ESC[row;colR */
export function buildCursorPositionResponse(row = 1, col = 1): string {
  return `\x1b[${row};${col}R`;
}

/** Writable PTY process — minimal interface for the data handler */
export interface WritablePty {
  write(data: string): void;
}

/**
 * Shared PTY data handler — encapsulates DSR interception, scrollback accumulation,
 * and output batching (~60fps). Used by both PtyManager and SandboxedPtyManager.
 */
export class PtyDataHandler {
  private outputBuffer = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly cursorResponse = buildCursorPositionResponse();
  readonly scrollback: string[] = [];

  constructor(
    private readonly agentId: AgentId,
    private readonly ptyProcess: WritablePty,
    private readonly outputHandler: () => PtyOutputHandler | null,
  ) {}

  /** Process incoming PTY data: strip DSR, accumulate scrollback, batch output */
  onData(data: string): void {
    const { cleaned, dsrCount } = stripDsrRequests(data);
    if (dsrCount > 0) {
      for (let i = 0; i < dsrCount; i++) {
        this.ptyProcess.write(this.cursorResponse);
      }
    }

    // Accumulate scrollback
    const lines = cleaned.split('\n');
    this.scrollback.push(...lines);
    if (this.scrollback.length > SCROLLBACK_MAX) {
      this.scrollback.splice(0, this.scrollback.length - SCROLLBACK_MAX);
    }

    // Batch and flush
    this.outputBuffer += cleaned;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        try {
          this.outputHandler()?.(this.agentId, this.outputBuffer);
        } finally {
          this.outputBuffer = '';
          this.flushTimer = null;
        }
      }, FLUSH_INTERVAL_MS);
    }
  }

  /** Flush remaining buffered output and clean up timers */
  flush(): void {
    if (this.outputBuffer) {
      this.outputHandler()?.(this.agentId, this.outputBuffer);
      this.outputBuffer = '';
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Get the last N lines of scrollback for crash diagnostics */
  getLastOutput(lines = 30): string {
    return this.scrollback.slice(-lines).join('\n');
  }
}
