import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMemory, SessionEntry, IMemoryStore } from '@jam/core';
import type { BrainClient } from '../brain-client.js';
import { BrainMemoryStore } from '../brain-memory-store.js';

const testMemory: AgentMemory = {
  persona: 'helpful assistant',
  facts: ['prefers dark mode'],
  preferences: { language: 'typescript' },
  lastUpdated: '2025-06-01',
};

const testEntry: SessionEntry = {
  timestamp: '2025-06-01T12:00:00Z',
  type: 'user-text',
  content: 'how do I deploy?',
  agentId: 'agent-1',
};

function createMockInner(): IMemoryStore {
  return {
    load: vi.fn().mockResolvedValue(testMemory),
    save: vi.fn().mockResolvedValue(undefined),
    appendSession: vi.fn().mockResolvedValue(undefined),
    getSessionHistory: vi.fn().mockResolvedValue([testEntry]),
  };
}

function createMockClient(): BrainClient {
  return {
    health: vi.fn().mockResolvedValue(true),
    ingest: vi.fn().mockResolvedValue('trace-abc'),
    search: vi.fn().mockResolvedValue([
      { score: 0.9, source: 'pattern', content: 'deploy with docker' },
    ]),
    consolidate: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrainClient;
}

describe('BrainMemoryStore', () => {
  let inner: IMemoryStore;
  let client: BrainClient;
  let store: BrainMemoryStore;

  beforeEach(() => {
    inner = createMockInner();
    client = createMockClient();
    store = new BrainMemoryStore({ inner, client });
  });

  describe('load', () => {
    it('delegates to inner store', async () => {
      const result = await store.load('agent-1');
      expect(result).toEqual(testMemory);
      expect(inner.load).toHaveBeenCalledWith('agent-1');
    });

    it('returns null when inner store returns null', async () => {
      vi.mocked(inner.load).mockResolvedValue(null);
      expect(await store.load('agent-1')).toBeNull();
    });
  });

  describe('save', () => {
    it('delegates to inner store', async () => {
      await store.save('agent-1', testMemory);
      expect(inner.save).toHaveBeenCalledWith('agent-1', testMemory);
    });
  });

  describe('appendSession', () => {
    it('delegates to inner store and ingests into brain', async () => {
      await store.appendSession('agent-1', testEntry);

      expect(inner.appendSession).toHaveBeenCalledWith('agent-1', testEntry);
      // Allow microtask to flush fire-and-forget
      await new Promise((r) => setTimeout(r, 0));
      expect(client.ingest).toHaveBeenCalledWith(
        'agent-1',
        'how do I deploy?',
        'user-text',
      );
    });

    it('succeeds even when brain ingest fails', async () => {
      vi.mocked(client.ingest).mockRejectedValue(new Error('down'));

      await expect(
        store.appendSession('agent-1', testEntry),
      ).resolves.toBeUndefined();

      expect(inner.appendSession).toHaveBeenCalledWith('agent-1', testEntry);
    });
  });

  describe('getSessionHistory', () => {
    it('delegates to inner store with limit', async () => {
      const result = await store.getSessionHistory('agent-1', 10);
      expect(result).toEqual([testEntry]);
      expect(inner.getSessionHistory).toHaveBeenCalledWith('agent-1', 10);
    });

    it('passes undefined limit when not specified', async () => {
      await store.getSessionHistory('agent-1');
      expect(inner.getSessionHistory).toHaveBeenCalledWith(
        'agent-1',
        undefined,
      );
    });
  });

  describe('searchMemory', () => {
    it('searches brain for relevant memories', async () => {
      const results = await store.searchMemory('agent-1', 'deployment');

      expect(results).toEqual([
        { score: 0.9, source: 'pattern', content: 'deploy with docker' },
      ]);
      expect(client.search).toHaveBeenCalledWith('agent-1', 'deployment', 5);
    });

    it('passes custom limit', async () => {
      await store.searchMemory('agent-1', 'test', 3);
      expect(client.search).toHaveBeenCalledWith('agent-1', 'test', 3);
    });

    it('returns empty array when brain is down', async () => {
      vi.mocked(client.search).mockResolvedValue([]);
      const results = await store.searchMemory('agent-1', 'anything');
      expect(results).toEqual([]);
    });
  });

  describe('consolidate', () => {
    it('delegates to brain client', async () => {
      await store.consolidate('agent-1');
      expect(client.consolidate).toHaveBeenCalledWith('agent-1');
    });
  });
});
