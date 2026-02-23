import type { ExecutionProgress } from '@jam/core';
import { stripAnsiSimple } from '../utils.js';

/**
 * Strategy pattern for processing child process stdout.
 * Two implementations:
 * - JsonlOutputStrategy: line-buffered parsing for JSONL-streaming runtimes
 * - ThrottledOutputStrategy: chunk-based with throttled progress for raw-output runtimes
 */

export interface OutputCallbacks {
  onProgress?: (event: ExecutionProgress) => void;
  onOutput?: (data: string) => void;
}

export interface OutputStrategy {
  /** Process a raw stdout chunk */
  processChunk(chunk: string, callbacks: OutputCallbacks): void;
  /** Flush any remaining buffered data on process close */
  flush(callbacks: OutputCallbacks): void;
}

/** Line-buffered JSONL strategy for runtimes that output stream-json format */
export class JsonlOutputStrategy implements OutputStrategy {
  private lineBuf = '';

  constructor(
    private parseStreamEvent: (line: string, onProgress: (event: ExecutionProgress) => void) => void,
    private emitTerminalLine: (line: string, onOutput: (data: string) => void) => void,
  ) {}

  processChunk(chunk: string, callbacks: OutputCallbacks): void {
    if (!callbacks.onProgress && !callbacks.onOutput) return;

    this.lineBuf += chunk;
    const lines = this.lineBuf.split('\n');
    this.lineBuf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      if (callbacks.onProgress) this.parseStreamEvent(line, callbacks.onProgress);
      if (callbacks.onOutput) this.emitTerminalLine(line, callbacks.onOutput);
    }
  }

  flush(callbacks: OutputCallbacks): void {
    if (!this.lineBuf.trim()) return;
    if (callbacks.onProgress) this.parseStreamEvent(this.lineBuf, callbacks.onProgress);
    if (callbacks.onOutput) this.emitTerminalLine(this.lineBuf, callbacks.onOutput);
    this.lineBuf = '';
  }
}

/** Chunk-based strategy for runtimes that output raw ANSI text */
export class ThrottledOutputStrategy implements OutputStrategy {
  private lastProgressEmit = 0;
  private firstChunkSent = false;

  constructor(
    private classifyChunk: (cleaned: string) => 'tool-use' | 'thinking' | 'text',
  ) {}

  processChunk(chunk: string, callbacks: OutputCallbacks): void {
    if (callbacks.onOutput) {
      callbacks.onOutput(stripAnsiSimple(chunk));
    }

    if (callbacks.onProgress) {
      if (!this.firstChunkSent) {
        this.firstChunkSent = true;
        this.lastProgressEmit = Date.now();
        callbacks.onProgress({ type: 'thinking', summary: 'Processing request...' });
      }

      const now = Date.now();
      if (now - this.lastProgressEmit > 5000) {
        this.lastProgressEmit = now;
        const cleaned = stripAnsiSimple(chunk).trim();
        if (cleaned.length > 0) {
          const type = this.classifyChunk(cleaned);
          callbacks.onProgress({ type, summary: cleaned.slice(0, 80) });
        }
      }
    }
  }

  flush(_callbacks: OutputCallbacks): void {
    // No buffering — nothing to flush
  }
}
