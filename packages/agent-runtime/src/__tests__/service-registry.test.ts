import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceRegistry, type TrackedService } from '../service-registry.js';

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

// Mock node:child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// Mock tree-kill
vi.mock('tree-kill', () => ({ default: vi.fn() }));

// Mock net.createConnection for isPortAlive — always return alive=false
vi.mock('node:net', () => ({
  createConnection: vi.fn(() => {
    const handlers: Record<string, Function> = {};
    const socket = {
      on: (evt: string, handler: Function) => { handlers[evt] = handler; return socket; },
      setTimeout: (_ms: number) => socket,
      destroy: () => {},
      end: () => {},
    };
    // Simulate connection error (port not alive) in next microtask
    queueMicrotask(() => handlers.error?.(new Error('ECONNREFUSED')));
    return socket;
  }),
}));

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const mockedReadFile = vi.mocked(readFile);
const mockedReaddir = vi.mocked(readdir);
const mockedExistsSync = vi.mocked(existsSync);

/** Helper: create a .services.json line */
function serviceLine(name: string, port: number): string {
  return JSON.stringify({
    name,
    port,
    startedAt: new Date().toISOString(),
    command: `node ${name}.js`,
    cwd: '/workspace',
  });
}

/** Setup mocks so findServiceFiles finds .services.json in the root dir */
function mockServicesFile(...lines: string[]): void {
  // existsSync returns true for the .services.json path
  mockedExistsSync.mockReturnValue(true);
  // readdir returns no subdirectories (flat workspace)
  mockedReaddir.mockResolvedValue([]);
  // readFile returns the service lines
  mockedReadFile.mockResolvedValue(lines.join('\n'));
}

/** Setup mocks so findServiceFiles finds nothing */
function mockNoServicesFile(): void {
  mockedExistsSync.mockReturnValue(false);
  mockedReaddir.mockResolvedValue([]);
}

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    registry = new ServiceRegistry();
  });

  afterEach(() => {
    registry.stopHealthMonitor();
    vi.useRealTimers();
  });

  describe('change-detection in scan()', () => {
    it('should notify listeners when services change', async () => {
      const listener = vi.fn();
      registry.onChange(listener);

      mockServicesFile(serviceLine('web', 3000));
      await registry.scan('agent-1', '/workspace');

      // Debounced — advance timer to trigger
      await vi.advanceTimersByTimeAsync(300);

      expect(listener).toHaveBeenCalledTimes(1);
      const services = listener.mock.calls[0][0] as TrackedService[];
      expect(services).toHaveLength(1);
      expect(services[0].name).toBe('web');
    });

    it('should NOT notify listeners when scan returns same data', async () => {
      const listener = vi.fn();
      registry.onChange(listener);

      // First scan
      mockServicesFile(serviceLine('web', 3000));
      await registry.scan('agent-1', '/workspace');
      await vi.advanceTimersByTimeAsync(300);
      expect(listener).toHaveBeenCalledTimes(1);
      listener.mockClear();

      // Second scan — same data, should NOT notify
      mockServicesFile(serviceLine('web', 3000));
      await registry.scan('agent-1', '/workspace');
      await vi.advanceTimersByTimeAsync(300);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('debounced notifyChange()', () => {
    it('should coalesce multiple rapid changes into one notification', async () => {
      const listener = vi.fn();
      registry.onChange(listener);

      // Simulate 3 rapid scans with different agent data
      for (let i = 0; i < 3; i++) {
        mockServicesFile(serviceLine(`service-${i}`, 3000 + i));
        await registry.scan(`agent-${i}`, '/workspace');
      }

      // Before debounce fires — no notifications yet
      expect(listener).not.toHaveBeenCalled();

      // After 250ms debounce
      await vi.advanceTimersByTimeAsync(300);

      // Should have been called exactly once (coalesced)
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should not throw when there are no listeners', async () => {
      mockServicesFile(serviceLine('web', 3000));
      await expect(registry.scan('agent-1', '/workspace')).resolves.not.toThrow();
    });
  });

  describe('list / listForAgent', () => {
    it('should list all services across agents', async () => {
      mockServicesFile(serviceLine('web', 3000));
      await registry.scan('agent-1', '/workspace1');

      mockServicesFile(serviceLine('api', 4000));
      await registry.scan('agent-2', '/workspace2');

      const all = registry.list();
      expect(all).toHaveLength(2);
    });

    it('should list services for a specific agent', async () => {
      mockServicesFile(serviceLine('web', 3000));
      await registry.scan('agent-1', '/workspace');

      expect(registry.listForAgent('agent-1')).toHaveLength(1);
      expect(registry.listForAgent('agent-unknown')).toHaveLength(0);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate services by port', async () => {
      mockServicesFile(
        serviceLine('web-old', 3000),
        serviceLine('web-new', 3000),
      );

      const result = await registry.scan('agent-1', '/workspace');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('web-new');
    });
  });

  describe('servicesEqual (change-detection)', () => {
    it('should detect changes in service count', async () => {
      const listener = vi.fn();
      registry.onChange(listener);

      // First: 1 service
      mockServicesFile(serviceLine('web', 3000));
      await registry.scan('agent-1', '/workspace');
      await vi.advanceTimersByTimeAsync(300);
      listener.mockClear();

      // Second: 2 services — should notify
      mockServicesFile(
        serviceLine('web', 3000),
        serviceLine('api', 4000),
      );
      await registry.scan('agent-1', '/workspace');
      await vi.advanceTimersByTimeAsync(300);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should detect changes in service name on same port', async () => {
      const listener = vi.fn();
      registry.onChange(listener);

      // First: "web" on port 3000
      mockServicesFile(serviceLine('web', 3000));
      await registry.scan('agent-1', '/workspace');
      await vi.advanceTimersByTimeAsync(300);
      listener.mockClear();

      // Second: "frontend" on port 3000 — name changed
      mockServicesFile(serviceLine('frontend', 3000));
      await registry.scan('agent-1', '/workspace');
      await vi.advanceTimersByTimeAsync(300);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('empty workspace', () => {
    it('should clear services when workspace has no .services.json', async () => {
      // First: has a service
      mockServicesFile(serviceLine('web', 3000));
      await registry.scan('agent-1', '/workspace');
      expect(registry.listForAgent('agent-1')).toHaveLength(1);

      // Second: no .services.json found
      mockNoServicesFile();
      await registry.scan('agent-1', '/workspace');
      expect(registry.listForAgent('agent-1')).toHaveLength(0);
    });
  });
});
