import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentProfile, ExecutionOptions } from '@jam/core';

// Mock node:fs to avoid real filesystem access in detectAuth
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
}));

const { ClaudeCodeRuntime } = await import('../runtimes/claude-code.js');
const { existsSync, readdirSync } = await import('node:fs');

function createProfile(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id: 'test-agent',
    name: 'TestClaude',
    runtime: 'claude-code',
    color: '#4CAF50',
    voice: { ttsVoiceId: 'test' },
    ...overrides,
  };
}

describe('ClaudeCodeRuntime', () => {
  let runtime: InstanceType<typeof ClaudeCodeRuntime>;

  beforeEach(() => {
    runtime = new ClaudeCodeRuntime();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);
  });

  describe('metadata', () => {
    it('has correct runtimeId', () => {
      expect(runtime.runtimeId).toBe('claude-code');
    });

    it('has correct cliCommand', () => {
      expect(runtime.metadata.cliCommand).toBe('claude');
    });

    it('has models', () => {
      expect(runtime.metadata.models.length).toBeGreaterThan(0);
      expect(runtime.metadata.models[0].id).toBe('claude-opus-4-6');
    });

    it('supportsFullAccess is true', () => {
      expect(runtime.metadata.supportsFullAccess).toBe(true);
    });

    it('detectAuth returns true when statsCache exists', () => {
      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('/statsCache'));
      expect(runtime.metadata.detectAuth('/home/user')).toBe(true);
    });

    it('detectAuth returns true when projects dir has entries', () => {
      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('/projects'));
      vi.mocked(readdirSync).mockReturnValue(['project1'] as any);
      expect(runtime.metadata.detectAuth('/home/user')).toBe(true);
    });

    it('detectAuth returns false when nothing exists', () => {
      expect(runtime.metadata.detectAuth('/home/user')).toBe(false);
    });

    it('getAuthHint returns a string', () => {
      expect(runtime.metadata.getAuthHint()).toContain('claude');
    });
  });

  describe('buildSpawnConfig', () => {
    it('returns command "claude"', () => {
      const config = runtime.buildSpawnConfig(createProfile());
      expect(config.command).toBe('claude');
    });

    it('adds --dangerously-skip-permissions for full access', () => {
      const config = runtime.buildSpawnConfig(createProfile({ allowFullAccess: true }));
      expect(config.args).toContain('--dangerously-skip-permissions');
    });

    it('adds --model when profile has model', () => {
      const config = runtime.buildSpawnConfig(createProfile({ model: 'opus' }));
      expect(config.args).toContain('--model');
      expect(config.args).toContain('opus');
    });

    it('adds --system-prompt with custom prompt', () => {
      const config = runtime.buildSpawnConfig(createProfile({ systemPrompt: 'Be helpful.' }));
      expect(config.args).toContain('--system-prompt');
      expect(config.args).toContain('Be helpful.');
    });

    it('adds default system prompt when no systemPrompt', () => {
      const config = runtime.buildSpawnConfig(createProfile({ name: 'Claude' }));
      expect(config.args).toContain('--system-prompt');
      const idx = config.args.indexOf('--system-prompt');
      expect(config.args[idx + 1]).toContain('Claude');
    });
  });

  describe('parseOutput', () => {
    it('detects tool-use output', () => {
      const result = runtime.parseOutput('Tool use: running command');
      expect(result.type).toBe('tool-use');
    });

    it('detects Running: as tool-use', () => {
      const result = runtime.parseOutput('Running: npm test');
      expect(result.type).toBe('tool-use');
    });

    it('detects thinking output', () => {
      const result = runtime.parseOutput('Thinking...');
      expect(result.type).toBe('thinking');
    });

    it('returns text for regular output', () => {
      const result = runtime.parseOutput('Hello world');
      expect(result.type).toBe('text');
      expect(result.content).toBe('Hello world');
    });

    it('strips ANSI codes', () => {
      const result = runtime.parseOutput('\x1b[32mgreen text\x1b[0m');
      expect(result.content).toBe('green text');
    });
  });

  describe('formatInput', () => {
    it('returns text as-is without context', () => {
      expect(runtime.formatInput('hello')).toBe('hello');
    });

    it('prepends shared context', () => {
      const result = runtime.formatInput('hello', { sharedContext: 'from Ray: done' });
      expect(result).toContain('[Context from other agents:');
      expect(result).toContain('hello');
    });
  });

  describe('buildExecuteArgs (via protected hook)', () => {
    it('includes -p and stream-json format', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile());
      expect(args).toContain('-p');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
    });

    it('includes --resume with sessionId', () => {
      const opts: ExecutionOptions = { sessionId: 'sess-123' };
      const args = (runtime as any).buildExecuteArgs(createProfile(), opts);
      expect(args).toContain('--resume');
      expect(args).toContain('sess-123');
    });

    it('includes model flag', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile({ model: 'opus' }));
      expect(args).toContain('--model');
      expect(args).toContain('opus');
    });

    it('includes system prompt', () => {
      const args = (runtime as any).buildExecuteArgs(createProfile({ systemPrompt: 'Be brief.' }));
      expect(args).toContain('--system-prompt');
      expect(args).toContain('Be brief.');
    });
  });

  describe('parseExecutionOutput (via protected hook)', () => {
    it('returns success with parsed JSONL on exit 0', () => {
      const stdout = JSON.stringify({ type: 'result', result: 'Done!', session_id: 'abc' });
      const result = (runtime as any).parseExecutionOutput(stdout, '', 0);
      expect(result.success).toBe(true);
      expect(result.text).toBe('Done!');
    });

    it('returns error on non-zero exit code', () => {
      const result = (runtime as any).parseExecutionOutput('', 'something failed', 1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('something failed');
    });

    it('extracts JSON error from stdout', () => {
      const stdout = JSON.stringify({ error: 'API key invalid' });
      const result = (runtime as any).parseExecutionOutput(stdout, '', 1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('API key invalid');
    });

    it('falls back to exit code when no error message found', () => {
      const result = (runtime as any).parseExecutionOutput('', '', 42);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Exit code 42');
    });
  });
});
