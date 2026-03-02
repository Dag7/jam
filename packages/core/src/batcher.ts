/**
 * Generic key-based batcher that coalesces high-frequency values and flushes
 * them on a timer. Uses TimeoutTimer internally — callers never deal with raw
 * setTimeout/clearTimeout.
 *
 * Implements IDisposable for proper lifecycle management.
 *
 * Usage:
 *   const batcher = new Batcher<string>(32, (batch) => { ... }, (a, b) => a + b);
 *   batcher.add('agent-1', chunk);   // coalesced
 *   batcher.add('agent-1', chunk2);  // merged with previous
 *   // flush fires automatically after 32ms
 *   batcher.dispose();               // cancel pending flush
 */
import type { IDisposable } from './disposable.js';
import { TimeoutTimer } from './timers.js';

export class Batcher<V> implements IDisposable {
  private queue = new Map<string, V>();
  private readonly timer = new TimeoutTimer();
  /** Pre-bound flush callback — avoids creating a new closure on every add() call */
  private readonly boundFlush: () => void;

  constructor(
    private readonly intervalMs: number,
    private readonly flush: (batch: Map<string, V>) => void,
    private readonly merge: (existing: V, incoming: V) => V,
  ) {
    this.boundFlush = () => this.doFlush();
  }

  add(key: string, value: V): void {
    const existing = this.queue.get(key);
    this.queue.set(key, existing !== undefined ? this.merge(existing, value) : value);
    this.timer.setIfNotSet(this.boundFlush, this.intervalMs);
  }

  /** Force-flush any pending items immediately */
  flushNow(): void {
    this.timer.cancel();
    this.doFlush();
  }

  dispose(): void {
    this.timer.dispose();
    this.queue.clear();
  }

  private doFlush(): void {
    if (this.queue.size === 0) return;
    const batch = new Map(this.queue);
    this.queue.clear();
    this.flush(batch);
  }
}
