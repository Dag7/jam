import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrainClient } from '../brain-client.js';

const BASE_URL = 'http://localhost:8080';

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

function mockFetchError(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  );
}

describe('BrainClient', () => {
  let client: BrainClient;

  beforeEach(() => {
    client = new BrainClient({ baseUrl: BASE_URL, timeout: 1_000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('health', () => {
    it('returns true when server responds ok', async () => {
      mockFetch({ status: 'ok' });
      expect(await client.health()).toBe(true);
    });

    it('returns false when server is down', async () => {
      mockFetchError();
      expect(await client.health()).toBe(false);
    });

    it('returns false on non-ok status', async () => {
      mockFetch({ status: 'ok' }, 500);
      expect(await client.health()).toBe(false);
    });
  });

  describe('ingest', () => {
    it('sends correct payload and returns trace_id', async () => {
      mockFetch({ result: 'in_working_memory', trace_id: 'abc-123' });

      const result = await client.ingest('agent-1', 'hello world', 'user-text');

      expect(result).toBe('abc-123');
      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/ingest`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            namespace: 'agent-1',
            content: 'hello world',
            source: 'user-text',
          }),
        }),
      );
    });

    it('includes session_id when provided', async () => {
      mockFetch({ trace_id: 'def-456' });

      await client.ingest('agent-1', 'hi', 'user-text', 'session-42');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            namespace: 'agent-1',
            content: 'hi',
            source: 'user-text',
            session_id: 'session-42',
          }),
        }),
      );
    });

    it('returns null on network error', async () => {
      mockFetchError();
      expect(await client.ingest('agent-1', 'hi', 'test')).toBeNull();
    });

    it('returns null when no trace_id in response', async () => {
      mockFetch({ result: 'filtered' });
      expect(await client.ingest('agent-1', 'hi', 'test')).toBeNull();
    });
  });

  describe('search', () => {
    it('parses search results correctly', async () => {
      mockFetch({
        traces: [
          {
            score: 0.95,
            source: 'pattern',
            trace: { content: { Text: 'React with Next.js' } },
          },
          {
            score: 0.72,
            source: 'pattern',
            trace: { content: { Text: 'Rust with Axum' } },
          },
        ],
      });

      const results = await client.search('agent-1', 'frontend framework');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        score: 0.95,
        source: 'pattern',
        content: 'React with Next.js',
      });
      expect(results[1]).toEqual({
        score: 0.72,
        source: 'pattern',
        content: 'Rust with Axum',
      });
    });

    it('sends correct payload with limit', async () => {
      mockFetch({ traces: [] });

      await client.search('agent-1', 'test query', 3);

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/memories/search`,
        expect.objectContaining({
          body: JSON.stringify({
            namespace: 'agent-1',
            mode: 'pattern',
            query: 'test query',
            limit: 3,
          }),
        }),
      );
    });

    it('returns empty array on network error', async () => {
      mockFetchError();
      expect(await client.search('agent-1', 'test')).toEqual([]);
    });

    it('handles missing Text content gracefully', async () => {
      mockFetch({
        traces: [{ score: 0.5, source: 'pattern', trace: { content: {} } }],
      });

      const results = await client.search('agent-1', 'test');
      expect(results[0].content).toBe('');
    });
  });

  describe('consolidate', () => {
    it('sends POST with namespace in query string', async () => {
      mockFetch({ status: 'done' });

      await client.consolidate('my-agent');

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/consolidate?namespace=my-agent`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('does not throw on network error', async () => {
      mockFetchError();
      await expect(client.consolidate('agent-1')).resolves.toBeUndefined();
    });

    it('encodes namespace with special characters', async () => {
      mockFetch({ status: 'done' });

      await client.consolidate('agent with spaces');

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/consolidate?namespace=agent%20with%20spaces`,
        expect.any(Object),
      );
    });
  });

  describe('constructor', () => {
    it('strips trailing slashes from baseUrl', async () => {
      const c = new BrainClient({ baseUrl: 'http://localhost:8080///' });
      mockFetch({ status: 'ok' });

      await c.health();

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/health',
        expect.any(Object),
      );
    });
  });
});
