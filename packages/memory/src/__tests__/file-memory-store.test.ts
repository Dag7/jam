import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMemory, SessionEntry } from '@jam/core';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  appendFile: vi.fn(),
  readdir: vi.fn(),
}));

const { FileMemoryStore } = await import('../file-memory-store.js');
const { readFile, writeFile, mkdir, appendFile, readdir } = await import('node:fs/promises');

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);
const mockedAppendFile = vi.mocked(appendFile);
const mockedReaddir = vi.mocked(readdir);

const testMemory: AgentMemory = {
  persona: 'helpful',
  facts: ['likes tests'],
  preferences: { style: 'terse' },
  lastUpdated: '2025-01-01',
};

const testEntry: SessionEntry = {
  timestamp: '2025-06-01T12:00:00Z',
  type: 'user-text',
  content: 'hello',
  agentId: 'agent-1',
};

describe('FileMemoryStore', () => {
  let store: InstanceType<typeof FileMemoryStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new FileMemoryStore('/tmp/jam-memory');
    mockedMkdir.mockResolvedValue(undefined as any);
    mockedWriteFile.mockResolvedValue(undefined);
    mockedAppendFile.mockResolvedValue(undefined);
  });

  describe('load', () => {
    it('reads and parses memory.json', async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify(testMemory));
      const result = await store.load('agent-1');
      expect(result).toEqual(testMemory);
      expect(mockedReadFile).toHaveBeenCalledWith(
        '/tmp/jam-memory/agent-1/memory.json',
        'utf-8',
      );
    });

    it('returns null when file not found', async () => {
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      const result = await store.load('agent-1');
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      mockedReadFile.mockResolvedValue('not json{{{');
      const result = await store.load('agent-1');
      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('creates directory and writes JSON', async () => {
      await store.save('agent-1', testMemory);
      expect(mockedMkdir).toHaveBeenCalledWith('/tmp/jam-memory/agent-1', { recursive: true });
      expect(mockedWriteFile).toHaveBeenCalledWith(
        '/tmp/jam-memory/agent-1/memory.json',
        JSON.stringify(testMemory, null, 2),
        'utf-8',
      );
    });

    it('uses correct path for different agent IDs', async () => {
      await store.save('agent-2', testMemory);
      expect(mockedMkdir).toHaveBeenCalledWith('/tmp/jam-memory/agent-2', { recursive: true });
    });
  });

  describe('appendSession', () => {
    it('creates sessions directory and appends JSONL', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'));

      await store.appendSession('agent-1', testEntry);
      expect(mockedMkdir).toHaveBeenCalledWith(
        '/tmp/jam-memory/agent-1/sessions',
        { recursive: true },
      );
      expect(mockedAppendFile).toHaveBeenCalledWith(
        '/tmp/jam-memory/agent-1/sessions/2025-06-01.jsonl',
        JSON.stringify(testEntry) + '\n',
        'utf-8',
      );

      vi.useRealTimers();
    });
  });

  describe('getSessionHistory', () => {
    it('reads files in reverse chronological order', async () => {
      const entry1: SessionEntry = { ...testEntry, content: 'first' };
      const entry2: SessionEntry = { ...testEntry, content: 'second' };

      mockedReaddir.mockResolvedValue(['2025-05-31.jsonl', '2025-06-01.jsonl'] as any);
      mockedReadFile
        .mockResolvedValueOnce(JSON.stringify(entry2)) // 2025-06-01 (read first due to reverse)
        .mockResolvedValueOnce(JSON.stringify(entry1)); // 2025-05-31

      const result = await store.getSessionHistory('agent-1');
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('second');
      expect(result[1].content).toBe('first');
    });

    it('respects limit parameter', async () => {
      const entries = Array.from({ length: 5 }, (_, i) => ({
        ...testEntry,
        content: `entry-${i}`,
      }));

      mockedReaddir.mockResolvedValue(['2025-06-01.jsonl'] as any);
      mockedReadFile.mockResolvedValue(
        entries.map((e) => JSON.stringify(e)).join('\n'),
      );

      const result = await store.getSessionHistory('agent-1', 3);
      expect(result).toHaveLength(3);
    });

    it('skips malformed lines', async () => {
      mockedReaddir.mockResolvedValue(['2025-06-01.jsonl'] as any);
      mockedReadFile.mockResolvedValue(
        `${JSON.stringify(testEntry)}\nnot-valid-json\n${JSON.stringify({ ...testEntry, content: 'valid' })}`,
      );

      const result = await store.getSessionHistory('agent-1');
      expect(result).toHaveLength(2);
    });

    it('returns empty array when directory does not exist', async () => {
      mockedReaddir.mockRejectedValue(new Error('ENOENT'));
      const result = await store.getSessionHistory('agent-1');
      expect(result).toEqual([]);
    });

    it('filters only .jsonl files', async () => {
      mockedReaddir.mockResolvedValue(['2025-06-01.jsonl', 'readme.txt', '.DS_Store'] as any);
      mockedReadFile.mockResolvedValue(JSON.stringify(testEntry));

      const result = await store.getSessionHistory('agent-1');
      // Only one .jsonl file should be processed
      expect(result).toHaveLength(1);
    });
  });
});
