import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentProfile, ExecutionOptions } from '@jam/core';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

const { CodexCLIRuntime } = await import('../runtimes/codex-cli.js');
const { existsSync } = await import('node:fs');

function createProfile(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id: 'test-agent',
    name: 'TestCodex',
    runtime: 'codex',
    color: '#9C27B0',
    voice: { ttsVoiceId: 'test' },
    ...overrides,
  };
}

describe('CodexCLIRuntime', () => {
  let runtime: InstanceType<typeof CodexCLIRuntime>;

  beforeEach(() => {
    runtime = new CodexCLIRuntime();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  describe('metadata', () => {
    it('has correct runtimeId', () => {
      expect(runtime.runtimeId).toBe('codex');
    });

    it('has correct cliCommand', () => {
      expect(runtime.metadata.cliCommand).toBe('codex');
    });

    it('has models', () => {
      expect(runtime.metadata.models.length).toBeGreaterThan(0);
    });

    it('detectAuth returns true when config exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      expect(runtime.metadata.detectAuth('/home/user')).toBe(true);
    });

    it('detectAuth returns true when OPENAI_API_KEY set', () => {
      const origKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';
      expect(runtime.metadata.detectAuth('/home/user')).toBe(true);
      if (origKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = origKey;
      }
    });
  });

  describe('buildSpawnConfig', () => {
    it('returns command "codex"', () => {
      const config = runtime.buildSpawnConfig(createProfile());
      expect(config.command).toBe('codex');
    });

    it('adds model when specified', () => {
      const config = runtime.buildSpawnConfig(createProfile({ model: 'gpt-5.3-codex' }));
      expect(config.args).toContain('--model');
      expect(config.args).toContain('gpt-5.3-codex');
    });
  });

  describe('parseOutput', () => {
    it('detects tool-use from "executing"', () => {
      expect(runtime.parseOutput('executing command').type).toBe('tool-use');
    });

    it('detects tool-use from "Running"', () => {
      expect(runtime.parseOutput('Running npm test').type).toBe('tool-use');
    });

    it('detects tool-use from "shell"', () => {
      expect(runtime.parseOutput('shell: ls -la').type).toBe('tool-use');
    });

    it('detects thinking output', () => {
      expect(runtime.parseOutput('Thinking about it').type).toBe('thinking');
    });

    it('returns text for regular output', () => {
      const result = runtime.parseOutput('Hello from Codex');
      expect(result.type).toBe('text');
      expect(result.content).toBe('Hello from Codex');
    });
  });

  describe('formatInput', () => {
    it('returns text without context', () => {
      expect(runtime.formatInput('hello')).toBe('hello');
    });

    it('prepends shared context', () => {
      const result = runtime.formatInput('fix', { sharedContext: 'data' });
      expect(result).toContain('[Context from other agents:');
    });
  });

  describe('buildExecuteArgs (via protected hook)', () => {
    it('starts with "exec"', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile());
      expect(args[0]).toBe('exec');
    });

    it('includes model flag', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile({ model: 'gpt-5' }));
      expect(args).toContain('--model');
      expect(args).toContain('gpt-5');
    });

    it('appends text as CLI argument', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile(), undefined, 'fix the bug');
      expect(args).toContain('fix the bug');
    });

    it('omits text when not provided', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile());
      expect(args).toEqual(['exec']);
    });
  });

  describe('writeInput is a no-op', () => {
    it('does not write to stdin', () => {
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const child = { stdin: mockStdin } as any;
      (runtime as any).writeInput(child, createProfile(), 'some text');
      expect(mockStdin.write).not.toHaveBeenCalled();
      expect(mockStdin.end).not.toHaveBeenCalled();
    });
  });

  describe('parseExecutionOutput (via protected hook)', () => {
    it('returns success with stripped output on exit 0', () => {
      const result = (runtime as any).parseExecutionOutput('\x1b[31mresult\x1b[0m', '', 0);
      expect(result.success).toBe(true);
      expect(result.text).toBe('result');
    });

    it('returns error on non-zero exit', () => {
      const result = (runtime as any).parseExecutionOutput('output', 'err msg', 1);
      expect(result.success).toBe(false);
      expect(result.error).toBe('err msg');
    });

    it('falls back to stdout last line when stderr empty', () => {
      const result = (runtime as any).parseExecutionOutput('line1\nlast line', '', 1);
      expect(result.error).toBe('last line');
    });

    it('falls back to exit code when no output', () => {
      const result = (runtime as any).parseExecutionOutput('', '', 127);
      expect(result.error).toContain('Exit code 127');
    });
  });
});
