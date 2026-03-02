import type { IEventBus } from '@jam/core';
import { createLogger, IntervalTimer } from '@jam/core';

const log = createLogger('EventBus');

type Handler = (payload: unknown) => void;

export class EventBus implements IEventBus {
  private listeners = new Map<string, Set<Handler>>();
  /** Event counters for diagnostics — tracks count + payload bytes per event type */
  private eventCounts = new Map<string, { count: number; bytes: number }>();
  private readonly diagTimer = new IntervalTimer();

  /** Start logging event frequency every `intervalMs` (call once at startup) */
  startDiagnostics(intervalMs = 10_000): void {
    this.diagTimer.cancelAndSet(() => {
      if (this.eventCounts.size === 0) return;
      const lines: string[] = ['[EventBus Diagnostics]'];
      for (const [event, { count, bytes }] of this.eventCounts) {
        const perSec = (count / (intervalMs / 1000)).toFixed(1);
        const kbPerSec = ((bytes / 1024) / (intervalMs / 1000)).toFixed(1);
        lines.push(`  ${event}: ${count} events (${perSec}/s, ${kbPerSec} KB/s)`);
      }
      log.info(lines.join('\n'));
      this.eventCounts.clear();
    }, intervalMs);
  }

  stopDiagnostics(): void {
    this.diagTimer.cancel();
    this.eventCounts.clear();
  }

  emit<T>(event: string, payload: T): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    // Track event frequency + approximate payload size
    const entry = this.eventCounts.get(event);
    const payloadBytes = typeof (payload as { data?: string })?.data === 'string'
      ? ((payload as { data: string }).data).length * 2  // JS strings are UTF-16
      : 0;
    if (entry) {
      entry.count++;
      entry.bytes += payloadBytes;
    } else {
      this.eventCounts.set(event, { count: 1, bytes: payloadBytes });
    }

    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (error) {
        log.error(`Error in handler for "${event}": ${String(error)}`);
      }
    }
  }

  on<T>(event: string, handler: (payload: T) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const handlers = this.listeners.get(event)!;
    const wrappedHandler = handler as Handler;
    handlers.add(wrappedHandler);

    return () => {
      handlers.delete(wrappedHandler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  once<T>(event: string, handler: (payload: T) => void): void {
    const unsubscribe = this.on<T>(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
