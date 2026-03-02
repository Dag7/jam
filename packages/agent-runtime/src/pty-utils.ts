import type { AgentId } from '@jam/core';
import { TimeoutTimer } from '@jam/core';
import type { PtyOutputHandler, PtyExitHandler } from './pty-manager.js';

export const SCROLLBACK_MAX = 10_000;
export const FLUSH_INTERVAL_MS = 16;

/** Global PTY data rate counters — reset after each read for delta measurement */
let _globalPtyBytes = 0;
let _globalPtyCalls = 0;
export function getPtyDataRate(): { bytes: number; calls: number } {
  const result = { bytes: _globalPtyBytes, calls: _globalPtyCalls };
  _globalPtyBytes = 0;
  _globalPtyCalls = 0;
  return result;
}

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

/** Diagnostic: set JAM_MUTE_PTY=1 to drop all PTY output (isolates OOM to output pipeline) */
const MUTE_PTY = process.env.JAM_MUTE_PTY === '1';

/**
 * Shared PTY data handler — encapsulates DSR interception, scrollback accumulation,
 * and output batching (~60fps). Used by both PtyManager and SandboxedPtyManager.
 */
export class PtyDataHandler {
  private outputBuffer = '';
  private readonly flushTimer = new TimeoutTimer();
  private readonly cursorResponse = buildCursorPositionResponse();
  /** Pre-bound flush callback — avoids creating a new closure on every onData() call */
  private readonly boundFlush: () => void;
  readonly scrollback: string[] = [];
  /** Diagnostic counter: total bytes received */
  private _totalBytes = 0;
  private _callCount = 0;

  constructor(
    private readonly agentId: AgentId,
    private readonly ptyProcess: WritablePty,
    private readonly outputHandler: () => PtyOutputHandler | null,
  ) {
    this.boundFlush = () => {
      try {
        this.outputHandler()?.(this.agentId, this.outputBuffer);
      } finally {
        this.outputBuffer = '';
      }
    };
  }

  /** Process incoming PTY data: strip DSR, accumulate scrollback, batch output */
  onData(data: string): void {
    this._totalBytes += data.length * 2; // JS strings = UTF-16
    this._callCount++;
    _globalPtyBytes += data.length * 2;
    _globalPtyCalls++;

    const { cleaned, dsrCount } = stripDsrRequests(data);
    if (dsrCount > 0) {
      for (let i = 0; i < dsrCount; i++) {
        this.ptyProcess.write(this.cursorResponse);
      }
    }

    // Diagnostic: drop all output processing when muted
    if (MUTE_PTY) return;

    // Accumulate scrollback
    const lines = cleaned.split('\n');
    this.scrollback.push(...lines);
    if (this.scrollback.length > SCROLLBACK_MAX) {
      this.scrollback.splice(0, this.scrollback.length - SCROLLBACK_MAX);
    }

    // Batch and flush
    this.outputBuffer += cleaned;
    this.flushTimer.setIfNotSet(this.boundFlush, FLUSH_INTERVAL_MS);
  }

  /** Diagnostic: get total bytes received and call count */
  get diagnostics(): { totalBytes: number; callCount: number } {
    return { totalBytes: this._totalBytes, callCount: this._callCount };
  }

  /** Flush remaining buffered output and clean up timers */
  flush(): void {
    if (this.outputBuffer) {
      this.outputHandler()?.(this.agentId, this.outputBuffer);
      this.outputBuffer = '';
    }
    this.flushTimer.cancel();
  }

  /** Get the last N lines of scrollback for crash diagnostics */
  getLastOutput(lines = 30): string {
    return this.scrollback.slice(-lines).join('\n');
  }
}
