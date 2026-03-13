import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HostBridge, type HostBridgeDeps } from '../host-bridge.js';

function createMockDeps(overrides?: Partial<HostBridgeDeps>): HostBridgeDeps {
  return {
    openExternal: vi.fn().mockResolvedValue(undefined),
    readClipboard: vi.fn().mockReturnValue('clipboard text'),
    writeClipboard: vi.fn(),
    openPath: vi.fn().mockResolvedValue(''),
    showNotification: vi.fn(),
    writeInbox: vi.fn().mockResolvedValue({ success: true }),
    listAgentNames: vi.fn().mockReturnValue(['Charlie', 'Warren']),
    ...overrides,
  };
}

async function postBridge(
  port: number,
  body: unknown,
  token: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/bridge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: json };
}

describe('HostBridge', () => {
  const PORT = 19999;
  const TOKEN = 'test-token-123';
  let bridge: HostBridge;
  let deps: HostBridgeDeps;

  beforeEach(async () => {
    deps = createMockDeps();
    bridge = new HostBridge(PORT, deps);
    await bridge.start(TOKEN);
  });

  afterEach(async () => {
    await bridge.stop();
  });

  describe('inbox-write operation', () => {
    it('should write to target agent inbox', async () => {
      const { status, body } = await postBridge(PORT, {
        operation: 'inbox-write',
        params: {
          targetAgent: 'Warren',
          title: 'Check stock price',
          description: 'Look up GOOG current price',
        },
      }, TOKEN, { 'X-Jam-Agent-Id': 'agent-charlie-123' });

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(deps.writeInbox).toHaveBeenCalledWith(
        'Warren',
        'agent-charlie-123',
        expect.objectContaining({
          title: 'Check stock price',
          description: 'Look up GOOG current price',
          from: 'agent-charlie-123',
          priority: 'normal',
        }),
      );
    });

    it('should reject when targetAgent is missing', async () => {
      const { status, body } = await postBridge(PORT, {
        operation: 'inbox-write',
        params: { title: 'Test', description: 'Test' },
      }, TOKEN, { 'X-Jam-Agent-Id': 'agent-123' });

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('targetAgent');
    });

    it('should reject when title is missing', async () => {
      const { status, body } = await postBridge(PORT, {
        operation: 'inbox-write',
        params: { targetAgent: 'Warren', description: 'Test' },
      }, TOKEN, { 'X-Jam-Agent-Id': 'agent-123' });

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('title');
    });

    it('should reject when description is missing', async () => {
      const { status, body } = await postBridge(PORT, {
        operation: 'inbox-write',
        params: { targetAgent: 'Warren', title: 'Test' },
      }, TOKEN, { 'X-Jam-Agent-Id': 'agent-123' });

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('description');
    });

    it('should reject unknown target agent (prevents path traversal)', async () => {
      const { status, body } = await postBridge(PORT, {
        operation: 'inbox-write',
        params: {
          targetAgent: '../../etc/passwd',
          title: 'Hack',
          description: 'Malicious',
        },
      }, TOKEN, { 'X-Jam-Agent-Id': 'agent-123' });

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unknown agent');
      expect(deps.writeInbox).not.toHaveBeenCalled();
    });

    it('should reject when X-Jam-Agent-Id header is missing', async () => {
      const { status, body } = await postBridge(PORT, {
        operation: 'inbox-write',
        params: {
          targetAgent: 'Warren',
          title: 'Test',
          description: 'Test desc',
        },
      }, TOKEN);

      expect(status).toBe(200); // Validation passes, but execute rejects
      expect(body.success).toBe(false);
      expect(body.error).toContain('X-Jam-Agent-Id');
    });

    it('should pass priority and tags when provided', async () => {
      await postBridge(PORT, {
        operation: 'inbox-write',
        params: {
          targetAgent: 'Charlie',
          title: 'Urgent task',
          description: 'Do it now',
          priority: 'critical',
          tags: ['finance', 'urgent'],
        },
      }, TOKEN, { 'X-Jam-Agent-Id': 'agent-warren-456' });

      expect(deps.writeInbox).toHaveBeenCalledWith(
        'Charlie',
        'agent-warren-456',
        expect.objectContaining({
          priority: 'critical',
          tags: ['finance', 'urgent'],
        }),
      );
    });

    it('should match agent names case-insensitively', async () => {
      const { status, body } = await postBridge(PORT, {
        operation: 'inbox-write',
        params: {
          targetAgent: 'warren',
          title: 'Test',
          description: 'Test desc',
        },
      }, TOKEN, { 'X-Jam-Agent-Id': 'agent-123' });

      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('authentication', () => {
    it('should reject requests without auth token', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/bridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'clipboard-read', params: {} }),
      });
      expect(res.status).toBe(401);
    });

    it('should reject requests with wrong token', async () => {
      const { status } = await postBridge(PORT, {
        operation: 'clipboard-read',
        params: {},
      }, 'wrong-token');
      expect(status).toBe(401);
    });
  });

  describe('existing operations', () => {
    it('should handle clipboard-read', async () => {
      const { status, body } = await postBridge(PORT, {
        operation: 'clipboard-read',
        params: {},
      }, TOKEN);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect((body.data as Record<string, unknown>).text).toBe('clipboard text');
    });

    it('should reject unknown operations', async () => {
      const { status, body } = await postBridge(PORT, {
        operation: 'hack-the-planet',
        params: {},
      }, TOKEN);

      expect(status).toBe(400);
      expect(body.error).toContain('Unknown operation');
    });
  });
});
