import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentProfile } from '@jam/core';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

const { CursorRuntime } = await import('../runtimes/cursor.js');
const { existsSync } = await import('node:fs');

function createProfile(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id: 'test-agent',
    name: 'TestCursor',
    runtime: 'cursor',
    color: '#2196F3',
    voice: { ttsVoiceId: 'test' },
    ...overrides,
  };
}

describe('CursorRuntime', () => {
  let runtime: InstanceType<typeof CursorRuntime>;

  beforeEach(() => {
    runtime = new CursorRuntime();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  describe('metadata', () => {
    it('has correct runtimeId', () => {
      expect(runtime.runtimeId).toBe('cursor');
    });

    it('has correct cliCommand', () => {
      expect(runtime.metadata.cliCommand).toBe('cursor-agent');
    });

    it('detectAuth returns true with cli-config.json', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      expect(runtime.metadata.detectAuth('/home/user')).toBe(true);
    });
  });

  describe('buildSpawnConfig', () => {
    it('returns command "cursor-agent"', () => {
      const config = runtime.buildSpawnConfig(createProfile());
      expect(config.command).toBe('cursor-agent');
    });

    it('adds model when specified', () => {
      const config = runtime.buildSpawnConfig(createProfile({ model: 'auto' }));
      expect(config.args).toContain('--model');
      expect(config.args).toContain('auto');
    });
  });

  describe('parseOutput', () => {
    it('detects tool-use from "Tool:" keyword', () => {
      expect(runtime.parseOutput('Tool: running npm install').type).toBe('tool-use');
    });

    it('detects tool-use from "executing" keyword', () => {
      expect(runtime.parseOutput('executing bash command').type).toBe('tool-use');
    });

    it('detects thinking output', () => {
      expect(runtime.parseOutput('Thinking about the problem').type).toBe('thinking');
    });

    it('returns text for regular output', () => {
      const result = runtime.parseOutput('Hello from Cursor');
      expect(result.type).toBe('text');
      expect(result.content).toBe('Hello from Cursor');
    });
  });

  describe('formatInput', () => {
    it('returns text without context', () => {
      expect(runtime.formatInput('hello')).toBe('hello');
    });

    it('prepends shared context', () => {
      const result = runtime.formatInput('fix', { sharedContext: 'context data' });
      expect(result).toContain('[Context from other agents:');
      expect(result).toContain('fix');
    });
  });

  describe('buildExecuteArgs (via protected hook)', () => {
    it('includes -p, stream-json, and --trust flags', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile());
      expect(args).toContain('-p');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--trust');
    });

    it('includes model flag', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile({ model: 'auto' }));
      expect(args).toContain('--model');
      expect(args).toContain('auto');
    });
  });

  describe('parseExecutionOutput (via protected hook)', () => {
    it('returns success with parsed JSONL on exit 0', () => {
      const stdout = JSON.stringify({ type: 'result', result: 'Cursor done', session_id: 'c1' });
      const result = (runtime as any).parseExecutionOutput(stdout, '', 0);
      expect(result.success).toBe(true);
      expect(result.text).toBe('Cursor done');
    });

    it('returns error on non-zero exit', () => {
      const result = (runtime as any).parseExecutionOutput('fail output', 'error msg', 1);
      expect(result.success).toBe(false);
      expect(result.error).toBe('error msg');
    });
  });
});
