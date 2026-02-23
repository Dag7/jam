import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskTracker } from '../task-tracker.js';

describe('TaskTracker', () => {
  let tracker: TaskTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
    tracker = new TaskTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startTask', () => {
    it('returns a task ID with agent ID prefix', () => {
      const taskId = tracker.startTask('agent-1', 'do something');
      expect(taskId).toMatch(/^agent-1-\d+$/);
    });

    it('creates a task with running status', () => {
      tracker.startTask('agent-1', 'do something');
      const status = tracker.getStatus('agent-1');
      expect(status).not.toBeNull();
      expect(status!.status).toBe('running');
      expect(status!.command).toBe('do something');
    });

    it('stores the start timestamp', () => {
      tracker.startTask('agent-1', 'cmd');
      const status = tracker.getStatus('agent-1');
      expect(status!.startedAt).toBe(Date.now());
    });

    it('replaces previous task for same agent', () => {
      const id1 = tracker.startTask('agent-1', 'first');
      vi.advanceTimersByTime(1); // advance so Date.now() differs
      const id2 = tracker.startTask('agent-1', 'second');
      expect(id1).not.toBe(id2);
      expect(tracker.getStatus('agent-1')!.command).toBe('second');
    });
  });

  describe('addStep', () => {
    it('appends steps with timestamp', () => {
      tracker.startTask('agent-1', 'cmd');
      tracker.addStep('agent-1', { type: 'tool-use', summary: 'Using Bash' });
      const status = tracker.getStatus('agent-1');
      expect(status!.steps).toHaveLength(1);
      expect(status!.steps[0]).toEqual({
        type: 'tool-use',
        summary: 'Using Bash',
        timestamp: Date.now(),
      });
    });

    it('ignores steps for nonexistent agents', () => {
      // Should not throw
      tracker.addStep('no-agent', { type: 'text', summary: 'ignored' });
    });

    it('ignores steps for non-running tasks', () => {
      tracker.startTask('agent-1', 'cmd');
      tracker.completeTask('agent-1', 'completed');
      tracker.addStep('agent-1', { type: 'text', summary: 'ignored' });
      expect(tracker.getStatus('agent-1')!.steps).toHaveLength(0);
    });

    it('trims steps at MAX_STEPS (50)', () => {
      tracker.startTask('agent-1', 'cmd');
      for (let i = 0; i < 55; i++) {
        tracker.addStep('agent-1', { type: 'text', summary: `step-${i}` });
      }
      const status = tracker.getStatus('agent-1');
      expect(status!.steps).toHaveLength(50);
      // First 5 should have been shifted out
      expect(status!.steps[0].summary).toBe('step-5');
    });
  });

  describe('completeTask', () => {
    it('marks task as completed', () => {
      tracker.startTask('agent-1', 'cmd');
      tracker.completeTask('agent-1', 'completed');
      expect(tracker.getStatus('agent-1')!.status).toBe('completed');
    });

    it('marks task as failed', () => {
      tracker.startTask('agent-1', 'cmd');
      tracker.completeTask('agent-1', 'failed');
      expect(tracker.getStatus('agent-1')!.status).toBe('failed');
    });

    it('does nothing for nonexistent agent', () => {
      // Should not throw
      tracker.completeTask('no-agent', 'completed');
    });
  });

  describe('getStatus', () => {
    it('returns null for unknown agent', () => {
      expect(tracker.getStatus('unknown')).toBeNull();
    });

    it('returns task info for known agent', () => {
      tracker.startTask('agent-1', 'test');
      const status = tracker.getStatus('agent-1');
      expect(status).toMatchObject({
        command: 'test',
        status: 'running',
        steps: [],
      });
    });
  });

  describe('formatStatusSummary', () => {
    it('returns idle message for unknown agent', () => {
      expect(tracker.formatStatusSummary('unknown', 'Claude')).toBe('Claude is idle.');
    });

    it('returns completed message', () => {
      tracker.startTask('agent-1', 'cmd');
      tracker.completeTask('agent-1', 'completed');
      expect(tracker.formatStatusSummary('agent-1', 'Claude')).toBe('Claude finished successfully.');
    });

    it('returns failed message', () => {
      tracker.startTask('agent-1', 'cmd');
      tracker.completeTask('agent-1', 'failed');
      expect(tracker.formatStatusSummary('agent-1', 'Claude')).toBe('Claude finished with an error.');
    });

    it('returns running message with time and last step', () => {
      tracker.startTask('agent-1', 'fix the bug');
      tracker.addStep('agent-1', { type: 'tool-use', summary: 'Using Bash: npm test' });
      vi.advanceTimersByTime(45_000);
      const summary = tracker.formatStatusSummary('agent-1', 'Claude');
      expect(summary).toContain('Claude has been working for 45 seconds');
      expect(summary).toContain('fix the bug');
      expect(summary).toContain('Using Bash: npm test');
    });

    it('returns running message with minutes', () => {
      tracker.startTask('agent-1', 'big task');
      tracker.addStep('agent-1', { type: 'text', summary: 'Writing code' });
      vi.advanceTimersByTime(120_000);
      const summary = tracker.formatStatusSummary('agent-1', 'Agent');
      expect(summary).toContain('2 minutes');
    });

    it('shows starting up for < 10 seconds with no steps', () => {
      tracker.startTask('agent-1', 'cmd');
      vi.advanceTimersByTime(5_000);
      const summary = tracker.formatStatusSummary('agent-1', 'Claude');
      expect(summary).toContain('Starting up');
    });

    it('shows loading context for 10-30 seconds with no steps', () => {
      tracker.startTask('agent-1', 'cmd');
      vi.advanceTimersByTime(15_000);
      const summary = tracker.formatStatusSummary('agent-1', 'Claude');
      expect(summary).toContain('Loading context');
    });

    it('shows check terminal for > 30 seconds with no steps', () => {
      tracker.startTask('agent-1', 'cmd');
      vi.advanceTimersByTime(35_000);
      const summary = tracker.formatStatusSummary('agent-1', 'Claude');
      expect(summary).toContain('check the terminal');
    });

    it('truncates long command to 60 chars', () => {
      const longCmd = 'x'.repeat(100);
      tracker.startTask('agent-1', longCmd);
      const summary = tracker.formatStatusSummary('agent-1', 'Claude');
      expect(summary).toContain('x'.repeat(60) + '...');
    });
  });
});
