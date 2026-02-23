import { describe, it, expect, beforeEach } from 'vitest';
import { RuntimeRegistry } from '../runtime-registry.js';
import type { IAgentRuntime, RuntimeMetadata } from '@jam/core';

function createMockRuntime(id: string, overrides?: Partial<RuntimeMetadata>): IAgentRuntime {
  return {
    runtimeId: id,
    metadata: {
      id,
      displayName: `${id} Runtime`,
      cliCommand: id,
      installHint: `npm install ${id}`,
      models: [{ id: 'default', label: 'Default', group: 'main' }],
      supportsFullAccess: false,
      detectAuth: () => true,
      getAuthHint: () => `Configure ${id}`,
      ...overrides,
    },
    buildSpawnConfig: () => ({ command: id, args: [], env: {} }),
    parseOutput: (raw: string) => ({ type: 'text' as const, content: raw, raw }),
    formatInput: (text: string) => text,
    execute: async () => ({ success: true, text: '' }),
  };
}

describe('RuntimeRegistry', () => {
  let registry: RuntimeRegistry;

  beforeEach(() => {
    registry = new RuntimeRegistry();
  });

  it('registers and retrieves a runtime by ID', () => {
    const rt = createMockRuntime('claude');
    registry.register(rt);
    expect(registry.get('claude')).toBe(rt);
  });

  it('returns undefined for unknown runtime ID', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all registered runtimes', () => {
    registry.register(createMockRuntime('claude'));
    registry.register(createMockRuntime('cursor'));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.runtimeId)).toEqual(['claude', 'cursor']);
  });

  it('returns empty list when no runtimes registered', () => {
    expect(registry.list()).toEqual([]);
  });

  it('has() returns true for registered runtime', () => {
    registry.register(createMockRuntime('claude'));
    expect(registry.has('claude')).toBe(true);
  });

  it('has() returns false for unregistered runtime', () => {
    expect(registry.has('ghost')).toBe(false);
  });

  it('overwrites runtime with same ID', () => {
    const rt1 = createMockRuntime('claude', { displayName: 'First' });
    const rt2 = createMockRuntime('claude', { displayName: 'Second' });
    registry.register(rt1);
    registry.register(rt2);
    expect(registry.get('claude')!.metadata.displayName).toBe('Second');
    expect(registry.list()).toHaveLength(1);
  });

  it('listMetadata returns serializable data without functions', () => {
    registry.register(createMockRuntime('claude', {
      supportsFullAccess: true,
      models: [
        { id: 'opus', label: 'Opus', group: 'premium' },
        { id: 'sonnet', label: 'Sonnet', group: 'standard' },
      ],
    }));
    const meta = registry.listMetadata();
    expect(meta).toHaveLength(1);
    expect(meta[0]).toEqual({
      id: 'claude',
      displayName: 'claude Runtime',
      cliCommand: 'claude',
      installHint: 'npm install claude',
      models: [
        { id: 'opus', label: 'Opus', group: 'premium' },
        { id: 'sonnet', label: 'Sonnet', group: 'standard' },
      ],
      supportsFullAccess: true,
      nodeVersionRequired: undefined,
      authHint: 'Configure claude',
    });
    // Ensure no functions leaked into serialized form
    expect(typeof meta[0].authHint).toBe('string');
  });

  it('getCliCommands returns all CLI commands', () => {
    registry.register(createMockRuntime('claude', { cliCommand: 'claude' }));
    registry.register(createMockRuntime('cursor', { cliCommand: 'cursor' }));
    registry.register(createMockRuntime('opencode', { cliCommand: 'opencode' }));
    expect(registry.getCliCommands()).toEqual(['claude', 'cursor', 'opencode']);
  });

  it('getCliCommands returns empty array when no runtimes', () => {
    expect(registry.getCliCommands()).toEqual([]);
  });
});
