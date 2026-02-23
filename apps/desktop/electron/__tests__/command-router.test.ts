import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentState, AgentProfile } from '@jam/core';
import type { ParsedCommand } from '@jam/voice';

// Mock @jam/core createLogger
vi.mock('@jam/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jam/core')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const { CommandRouter } = await import('../command-router.js');

function createMockAgentManager() {
  return {
    get: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    getTaskStatusSummary: vi.fn().mockReturnValue('Agent is idle.'),
    abortTask: vi.fn().mockReturnValue(true),
    start: vi.fn(),
    stop: vi.fn(),
    execute: vi.fn(),
  };
}

function createMockCommandParser() {
  return {
    parse: vi.fn(),
    resolveAgentId: vi.fn(),
    updateAgentNames: vi.fn(),
    getAgentNames: vi.fn().mockReturnValue([]),
  };
}

function createMockProfile(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id: 'agent-1',
    name: 'Claude',
    runtime: 'claude-code',
    color: '#4CAF50',
    voice: { ttsVoiceId: 'test' },
    ...overrides,
  };
}

function createMockAgentState(overrides?: Partial<AgentState>): AgentState {
  return {
    profile: createMockProfile(),
    status: 'running',
    visualState: 'idle',
    ...overrides,
  };
}

describe('CommandRouter', () => {
  let manager: ReturnType<typeof createMockAgentManager>;
  let parser: ReturnType<typeof createMockCommandParser>;
  let router: InstanceType<typeof CommandRouter>;

  beforeEach(() => {
    manager = createMockAgentManager();
    parser = createMockCommandParser();
    router = new CommandRouter(manager as any, parser as any, null);
  });

  describe('constructor', () => {
    it('registers built-in status-query and interrupt handlers', () => {
      const parsed: ParsedCommand = {
        targetAgentName: null,
        command: 'status',
        isMetaCommand: false,
        commandType: 'status-query',
      };
      manager.get.mockReturnValue(createMockAgentState());
      const result = router.dispatch('agent-1', parsed);
      expect(result).not.toBeNull();
      expect((result as any).success).toBe(true);
    });
  });

  describe('registerCommand / dispatch', () => {
    it('registers and dispatches custom command', () => {
      const handler = vi.fn().mockReturnValue({ success: true, text: 'custom' });
      router.registerCommand('custom-cmd', handler);
      const parsed: ParsedCommand = {
        targetAgentName: null,
        command: 'custom',
        isMetaCommand: false,
        commandType: 'custom-cmd' as any,
      };
      const result = router.dispatch('agent-1', parsed);
      expect(handler).toHaveBeenCalledWith('agent-1', parsed);
      expect((result as any).text).toBe('custom');
    });

    it('returns null for unregistered command type', () => {
      const parsed: ParsedCommand = {
        targetAgentName: null,
        command: 'do something',
        isMetaCommand: false,
        commandType: 'task',
      };
      const result = router.dispatch('agent-1', parsed);
      expect(result).toBeNull();
    });

    it('overwrites handler for same command type', () => {
      const handler1 = vi.fn().mockReturnValue({ success: true, text: 'first' });
      const handler2 = vi.fn().mockReturnValue({ success: true, text: 'second' });
      router.registerCommand('test', handler1);
      router.registerCommand('test', handler2);

      const parsed: ParsedCommand = {
        targetAgentName: null,
        command: 'test',
        isMetaCommand: false,
        commandType: 'test' as any,
      };
      const result = router.dispatch('agent-1', parsed);
      expect(handler1).not.toHaveBeenCalled();
      expect((result as any).text).toBe('second');
    });
  });

  describe('resolveTarget', () => {
    it('resolves explicit agent name via commandParser', () => {
      parser.resolveAgentId.mockReturnValue('agent-1');
      const parsed: ParsedCommand = {
        targetAgentName: 'claude',
        command: 'fix bug',
        isMetaCommand: false,
        commandType: 'task',
      };
      const result = router.resolveTarget(parsed, 'text');
      expect(result).toBe('agent-1');
      expect(parser.resolveAgentId).toHaveBeenCalledWith('claude');
    });

    it('falls back to last target for same source', () => {
      router.recordTarget('agent-2', 'text');
      manager.get.mockReturnValue(createMockAgentState({ status: 'running' }));

      const parsed: ParsedCommand = {
        targetAgentName: null,
        command: 'fix bug',
        isMetaCommand: false,
        commandType: 'task',
      };
      const result = router.resolveTarget(parsed, 'text');
      expect(result).toBe('agent-2');
    });

    it('falls back to last target from other source', () => {
      router.recordTarget('agent-3', 'voice');
      manager.get.mockReturnValue(createMockAgentState({ status: 'running' }));

      const parsed: ParsedCommand = {
        targetAgentName: null,
        command: 'fix bug',
        isMetaCommand: false,
        commandType: 'task',
      };
      const result = router.resolveTarget(parsed, 'text');
      expect(result).toBe('agent-3');
    });

    it('falls back to only running agent', () => {
      manager.list.mockReturnValue([
        createMockAgentState({ profile: createMockProfile({ id: 'only-one' }) }),
      ]);

      const parsed: ParsedCommand = {
        targetAgentName: null,
        command: 'fix bug',
        isMetaCommand: false,
        commandType: 'task',
      };
      const result = router.resolveTarget(parsed, 'text');
      expect(result).toBe('only-one');
    });

    it('returns undefined when no target found', () => {
      const parsed: ParsedCommand = {
        targetAgentName: null,
        command: 'fix bug',
        isMetaCommand: false,
        commandType: 'task',
      };
      const result = router.resolveTarget(parsed, 'text');
      expect(result).toBeUndefined();
    });
  });

  describe('recordTarget', () => {
    it('records voice target separately from text', () => {
      manager.get.mockReturnValue(createMockAgentState({ status: 'running' }));

      router.recordTarget('agent-1', 'voice');
      router.recordTarget('agent-2', 'text');

      const parsed: ParsedCommand = {
        targetAgentName: null,
        command: 'cmd',
        isMetaCommand: false,
        commandType: 'task',
      };

      const voiceResult = router.resolveTarget(parsed, 'voice');
      expect(voiceResult).toBe('agent-1');

      const textResult = router.resolveTarget(parsed, 'text');
      expect(textResult).toBe('agent-2');
    });
  });

  describe('handleStatusQuery', () => {
    it('returns task status summary', () => {
      manager.get.mockReturnValue(createMockAgentState());
      manager.getTaskStatusSummary.mockReturnValue('Claude is working on fixing bugs.');

      const result = router.handleStatusQuery('agent-1');
      expect(result.success).toBe(true);
      expect(result.text).toBe('Claude is working on fixing bugs.');
      expect(result.agentName).toBe('Claude');
    });

    it('uses default name when agent not found', () => {
      manager.get.mockReturnValue(undefined);
      const result = router.handleStatusQuery('unknown');
      expect(result.agentName).toBe('Agent');
    });
  });

  describe('handleInterrupt', () => {
    it('aborts task and returns success message', () => {
      manager.get.mockReturnValue(createMockAgentState());
      manager.abortTask.mockReturnValue(true);

      const result = router.handleInterrupt('agent-1');
      expect(result.success).toBe(true);
      expect(result.text).toContain('Stopped');
      expect(result.text).toContain('Claude');
    });

    it('returns not-working message when nothing to abort', () => {
      manager.get.mockReturnValue(createMockAgentState());
      manager.abortTask.mockReturnValue(false);

      const result = router.handleInterrupt('agent-1');
      expect(result.text).toContain("isn't working on anything");
    });

    it('clears commands in flight for the agent', () => {
      router.commandsInFlight.add('agent-1');
      manager.get.mockReturnValue(createMockAgentState());
      router.handleInterrupt('agent-1');
      expect(router.commandsInFlight.has('agent-1')).toBe(false);
    });
  });

  describe('getRunningAgentNames', () => {
    it('returns names of running agents', () => {
      manager.list.mockReturnValue([
        createMockAgentState({ profile: createMockProfile({ name: 'Claude' }) }),
        createMockAgentState({ profile: createMockProfile({ name: 'Ray' }), status: 'stopped' }),
      ]);
      expect(router.getRunningAgentNames()).toEqual(['Claude']);
    });
  });

  describe('getAgentInfo', () => {
    it('returns agent metadata', () => {
      manager.get.mockReturnValue(createMockAgentState());
      const info = router.getAgentInfo('agent-1');
      expect(info).toEqual({
        agentId: 'agent-1',
        agentName: 'Claude',
        agentRuntime: 'claude-code',
        agentColor: '#4CAF50',
      });
    });

    it('returns null for unknown agent', () => {
      manager.get.mockReturnValue(undefined);
      expect(router.getAgentInfo('unknown')).toBeNull();
    });

    it('uses default color when agent has no color', () => {
      manager.get.mockReturnValue(
        createMockAgentState({ profile: createMockProfile({ color: undefined as any }) }),
      );
      const info = router.getAgentInfo('agent-1');
      expect(info!.agentColor).toBe('#6b7280');
    });
  });
});
