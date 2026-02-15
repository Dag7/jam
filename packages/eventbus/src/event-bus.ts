import type { IEventBus } from '@jam/core';

type Handler = (payload: unknown) => void;

export class EventBus implements IEventBus {
  private listeners = new Map<string, Set<Handler>>();

  emit<T>(event: string, payload: T): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[EventBus] Error in handler for "${event}":`, error);
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
