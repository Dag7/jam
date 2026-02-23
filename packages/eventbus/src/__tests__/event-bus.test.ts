import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../event-bus.js';

describe('EventBus', () => {
  describe('emit / on', () => {
    it('calls handler when event is emitted', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('test', handler);
      bus.emit('test', { data: 42 });
      expect(handler).toHaveBeenCalledWith({ data: 42 });
    });

    it('passes payload correctly', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('msg', handler);
      bus.emit('msg', 'hello');
      expect(handler).toHaveBeenCalledWith('hello');
    });

    it('calls multiple handlers for the same event', () => {
      const bus = new EventBus();
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('evt', h1);
      bus.on('evt', h2);
      bus.emit('evt', null);
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it('does not call handler for a different event', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.on('a', handler);
      bus.emit('b', null);
      expect(handler).not.toHaveBeenCalled();
    });

    it('catches and logs errors from handlers', () => {
      const bus = new EventBus();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('handler failure');
      bus.on('evt', () => { throw error; });
      bus.emit('evt', null);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[EventBus] Error in handler for "evt":',
        error,
      );
      consoleSpy.mockRestore();
    });
  });

  describe('unsubscribe', () => {
    it('returns unsubscribe function from on()', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      const unsub = bus.on('evt', handler);
      expect(typeof unsub).toBe('function');
    });

    it('removes handler when unsubscribe is called', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      const unsub = bus.on('evt', handler);
      unsub();
      bus.emit('evt', null);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not affect other handlers when one is unsubscribed', () => {
      const bus = new EventBus();
      const h1 = vi.fn();
      const h2 = vi.fn();
      const unsub1 = bus.on('evt', h1);
      bus.on('evt', h2);
      unsub1();
      bus.emit('evt', null);
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledOnce();
    });
  });

  describe('once', () => {
    it('fires handler exactly once', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.once('evt', handler);
      bus.emit('evt', 'first');
      bus.emit('evt', 'second');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('first');
    });

    it('removes handler after first call', () => {
      const bus = new EventBus();
      const handler = vi.fn();
      bus.once('evt', handler);
      bus.emit('evt', null);
      // Second emit should not call handler
      bus.emit('evt', null);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeAllListeners', () => {
    it('removes all listeners for a specific event', () => {
      const bus = new EventBus();
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('evt', h1);
      bus.on('evt', h2);
      bus.removeAllListeners('evt');
      bus.emit('evt', null);
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });

    it('removes all listeners for all events when no arg', () => {
      const bus = new EventBus();
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('a', h1);
      bus.on('b', h2);
      bus.removeAllListeners();
      bus.emit('a', null);
      bus.emit('b', null);
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });

    it('does not throw when emitting after removeAllListeners', () => {
      const bus = new EventBus();
      bus.on('evt', vi.fn());
      bus.removeAllListeners('evt');
      expect(() => bus.emit('evt', null)).not.toThrow();
    });
  });
});
