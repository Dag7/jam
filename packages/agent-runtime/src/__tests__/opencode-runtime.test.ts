import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentProfile } from '@jam/core';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

const { OpenCodeRuntime } = await import('../runtimes/opencode.js');
const { existsSync } = await import('node:fs');

function createProfile(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id: 'test-agent',
    name: 'TestOpenCode',
    runtime: 'opencode',
    color: '#FF9800',
    voice: { ttsVoiceId: 'test' },
    ...overrides,
  };
}

describe('OpenCodeRuntime', () => {
  let runtime: InstanceType<typeof OpenCodeRuntime>;

  beforeEach(() => {
    runtime = new OpenCodeRuntime();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  describe('metadata', () => {
    it('has correct runtimeId', () => {
      expect(runtime.runtimeId).toBe('opencode');
    });

    it('has correct cliCommand', () => {
      expect(runtime.metadata.cliCommand).toBe('opencode');
    });

    it('detectAuth returns true when config exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      expect(runtime.metadata.detectAuth('/home/user')).toBe(true);
    });
  });

  describe('buildSpawnConfig', () => {
    it('returns command "opencode"', () => {
      const config = runtime.buildSpawnConfig(createProfile());
      expect(config.command).toBe('opencode');
    });

    it('sets OPENCODE_MODEL env var when model specified', () => {
      const config = runtime.buildSpawnConfig(createProfile({ model: 'gpt-4o' }));
      expect(config.env.OPENCODE_MODEL).toBe('gpt-4o');
    });

    it('returns empty args', () => {
      const config = runtime.buildSpawnConfig(createProfile());
      expect(config.args).toEqual([]);
    });
  });

  describe('parseOutput', () => {
    it('detects tool-use from "executing"', () => {
      expect(runtime.parseOutput('executing command').type).toBe('tool-use');
    });

    it('detects tool-use from "running"', () => {
      expect(runtime.parseOutput('running tests').type).toBe('tool-use');
    });

    it('returns text for regular output', () => {
      const result = runtime.parseOutput('Hello from OpenCode');
      expect(result.type).toBe('text');
      expect(result.content).toBe('Hello from OpenCode');
    });
  });

  describe('formatInput', () => {
    it('returns text without context', () => {
      expect(runtime.formatInput('hello')).toBe('hello');
    });

    it('prepends shared context with OpenCode-specific format', () => {
      const result = runtime.formatInput('fix', { sharedContext: 'data' });
      expect(result).toContain('[Shared context:');
      expect(result).toContain('fix');
    });
  });

  describe('buildExecuteArgs (via protected hook)', () => {
    it('returns ["run"]', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile());
      expect(args).toEqual(['run']);
    });
  });

  describe('buildExecuteEnv (via protected hook)', () => {
    it('includes OPENCODE_MODEL when model set', () => {
      const env = (runtime as any).buildExecuteEnv(createProfile({ model: 'gpt-4o' }));
      expect(env.OPENCODE_MODEL).toBe('gpt-4o');
    });

    it('returns empty object when no model', () => {
      const env = (runtime as any).buildExecuteEnv(createProfile());
      expect(env).toEqual({});
    });
  });

  describe('writeInput (via protected hook)', () => {
    it('writes system prompt + text to stdin', () => {
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const child = { stdin: mockStdin } as any;
      (runtime as any).writeInput(child, createProfile({ systemPrompt: 'Be concise.' }), 'fix bug');
      expect(mockStdin.write).toHaveBeenCalledWith('[Be concise.]\n\nfix bug');
      expect(mockStdin.end).toHaveBeenCalled();
    });

    it('uses default prompt when no systemPrompt', () => {
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const child = { stdin: mockStdin } as any;
      (runtime as any).writeInput(child, createProfile({ name: 'TestAgent' }), 'hello');
      const written = mockStdin.write.mock.calls[0][0] as string;
      expect(written).toContain('TestAgent');
      expect(written).toContain('hello');
    });
  });

  describe('parseExecutionOutput (via protected hook)', () => {
    it('returns success with stripped output on exit 0', () => {
      const result = (runtime as any).parseExecutionOutput('\x1b[32mresult text\x1b[0m', '', 0);
      expect(result.success).toBe(true);
      expect(result.text).toBe('result text');
    });

    it('returns error on non-zero exit', () => {
      const result = (runtime as any).parseExecutionOutput('', 'err', 1);
      expect(result.success).toBe(false);
      expect(result.error).toBe('err');
    });
  });
});
