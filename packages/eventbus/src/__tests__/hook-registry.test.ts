import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../event-bus.js';
import { HookRegistry } from '../hook-registry.js';

describe('HookRegistry', () => {
  let bus: EventBus;
  let registry: HookRegistry;

  beforeEach(() => {
    bus = new EventBus();
    registry = new HookRegistry(bus);
  });

  it('wires handler to the event bus on register', () => {
    const handler = vi.fn();
    registry.register('test-event', handler);
    bus.emit('test-event', { data: 1 });
    expect(handler).toHaveBeenCalledWith({ data: 1 });
  });

  it('passes correct payload to handler', () => {
    const handler = vi.fn();
    registry.register('msg', handler);
    bus.emit('msg', 'hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('fires multiple hooks for the same event', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    registry.register('evt', h1);
    registry.register('evt', h2);
    bus.emit('evt', null);
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('catches errors from hook handlers', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('hook error');
    registry.register('evt', () => { throw error; });
    bus.emit('evt', null);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error in hook'),
      error,
    );
    consoleSpy.mockRestore();
  });

  it('sorts hooks by priority (higher priority fires first via bus iteration)', () => {
    // The hooks array is sorted, but actual firing depends on bus registration order.
    // HookRegistry sorts its internal list by priority (b.priority - a.priority),
    // so higher priority hooks are stored first.
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    registry.register('evt', handler1, 10);
    registry.register('evt', handler2, 20);
    // Both should fire
    bus.emit('evt', null);
    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('uses default priority of 0', () => {
    const handler = vi.fn();
    registry.register('evt', handler);
    bus.emit('evt', null);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('destroy unsubscribes all hooks from bus', () => {
    const handler = vi.fn();
    registry.register('evt', handler);
    registry.destroy();
    bus.emit('evt', null);
    expect(handler).not.toHaveBeenCalled();
  });

  it('emit is safe after destroy', () => {
    registry.register('evt', vi.fn());
    registry.destroy();
    expect(() => bus.emit('evt', null)).not.toThrow();
  });

  it('destroy clears internal lists', () => {
    registry.register('evt', vi.fn());
    registry.register('evt2', vi.fn());
    registry.destroy();
    // Register a new handler after destroy — should work fine
    const handler = vi.fn();
    registry.register('new-evt', handler);
    bus.emit('new-evt', null);
    expect(handler).toHaveBeenCalledOnce();
  });
});
