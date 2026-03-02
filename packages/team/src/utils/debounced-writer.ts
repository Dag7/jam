import { writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IDisposable } from '@jam/core';
import { RunOnceScheduler } from '@jam/core';

/**
 * Debounced file writer — coalesces rapid writes into a single disk flush.
 * Used by all file-backed stores to avoid I/O thrashing.
 *
 * Uses RunOnceScheduler (trailing-edge debounce): each call reschedules
 * the timer so that the flush only fires once writes have settled for `delayMs`.
 *
 * Implements IDisposable for proper lifecycle management.
 */
export class DebouncedFileWriter implements IDisposable {
  private pendingFlush: (() => Promise<void>) | null = null;
  private readonly scheduler: RunOnceScheduler;

  constructor(delayMs: number = 500) {
    this.scheduler = new RunOnceScheduler(() => {
      const flush = this.pendingFlush;
      this.pendingFlush = null;
      flush?.().catch(() => {});
    }, delayMs);
  }

  /** Schedule a flush. Resets the timer on each call (trailing-edge debounce). */
  schedule(flush: () => Promise<void>): void {
    this.pendingFlush = flush;
    this.scheduler.schedule();
  }

  /** Cancel any pending flush (e.g. on shutdown). */
  cancel(): void {
    this.scheduler.cancel();
    this.pendingFlush = null;
  }

  /** Force an immediate flush, cancelling any pending timer. */
  async flushNow(flush: () => Promise<void>): Promise<void> {
    this.cancel();
    await flush();
  }

  get pending(): boolean {
    return this.scheduler.isScheduled;
  }

  dispose(): void {
    this.scheduler.dispose();
    this.pendingFlush = null;
  }
}

/** Ensure directory exists, then atomically write compact JSON to file. */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data), 'utf-8');
  await rename(tmpPath, filePath);
}
