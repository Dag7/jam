import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '@jam/eventbus';
import { Events } from '@jam/core';
import type { ITaskStore, Task } from '@jam/core';
import { TaskExecutor } from '../task-executor.js';

type ExecuteOnAgent = (agentId: string, prompt: string) => Promise<{ success: boolean; text?: string; error?: string }>;
type IsAgentAvailable = (agentId: string) => boolean;
type AbortAgent = (agentId: string) => void;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    description: 'A test task',
    status: 'pending',
    priority: 'normal',
    source: 'user',
    createdBy: 'user',
    createdAt: new Date().toISOString(),
    tags: [],
    ...overrides,
  };
}

function createMockTaskStore(tasks: Task[] = []): ITaskStore {
  const store = new Map<string, Task>(tasks.map((t) => [t.id, t]));

  return {
    get: vi.fn(async (id: string) => store.get(id) ?? null),
    create: vi.fn(async (input: Omit<Task, 'id'>) => {
      const task = { ...input, id: crypto.randomUUID() } as Task;
      store.set(task.id, task);
      return task;
    }),
    update: vi.fn(async (id: string, updates: Partial<Task>) => {
      const task = store.get(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      const updated = { ...task, ...updates, id };
      store.set(id, updated);
      return updated;
    }),
    list: vi.fn(async (filter?: { status?: string }) => {
      const all = Array.from(store.values());
      if (filter?.status) return all.filter((t) => t.status === filter.status);
      return all;
    }),
    delete: vi.fn(async (id: string) => { store.delete(id); }),
  };
}

describe('TaskExecutor', () => {
  let eventBus: EventBus;
  let taskStore: ITaskStore;
  let executeOnAgent: ExecuteOnAgent;
  let isAgentAvailable: IsAgentAvailable;
  let abortAgent: AbortAgent;
  let executor: TaskExecutor;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    taskStore = createMockTaskStore();
    executeOnAgent = vi.fn<ExecuteOnAgent>().mockResolvedValue({ success: true, text: 'Done' });
    isAgentAvailable = vi.fn<IsAgentAvailable>().mockReturnValue(true);
    abortAgent = vi.fn<AbortAgent>();

    executor = new TaskExecutor({
      taskStore,
      eventBus,
      executeOnAgent,
      isAgentAvailable,
      abortAgent,
      timeoutMs: 5000,
    });
  });

  afterEach(() => {
    executor.stop();
    vi.useRealTimers();
  });

  describe('AGENTS_READY event-driven drain', () => {
    it('should NOT drain assigned tasks before AGENTS_READY fires', async () => {
      const task = makeTask({ id: 't1', status: 'assigned', assignedTo: 'agent-1' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
      });
      executor.start();

      // No AGENTS_READY emitted — executeOnAgent should not be called
      await vi.advanceTimersByTimeAsync(1000);
      expect(executeOnAgent).not.toHaveBeenCalled();
    });

    it('should drain assigned tasks when AGENTS_READY fires', async () => {
      const task = makeTask({ id: 't1', status: 'assigned', assignedTo: 'agent-1' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
        timeoutMs: 60_000,
        drainGraceMs: 0,
      });
      executor.start();

      // Fire AGENTS_READY
      eventBus.emit(Events.AGENTS_READY, { agentCount: 1 });
      await vi.advanceTimersByTimeAsync(100);

      expect(executeOnAgent).toHaveBeenCalledWith('agent-1', expect.stringContaining('Test task'));
    });

    it('should recover stuck running tasks on AGENTS_READY', async () => {
      // A task that was "running" when app restarted — should be reset to assigned
      const stuckTask = makeTask({ id: 't-stuck', status: 'running', assignedTo: 'agent-1' });
      taskStore = createMockTaskStore([stuckTask]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
        timeoutMs: 60_000,
        drainGraceMs: 0,
      });
      executor.start();

      eventBus.emit(Events.AGENTS_READY, { agentCount: 1 });
      await vi.advanceTimersByTimeAsync(100);

      // Should have been reset to assigned first
      expect(taskStore.update).toHaveBeenCalledWith('t-stuck', { status: 'assigned' });
    });
  });

  describe('event subscriptions', () => {
    it('should execute on TASK_CREATED when task is already assigned', async () => {
      const task = makeTask({ id: 't2', status: 'assigned', assignedTo: 'agent-2' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
        timeoutMs: 60_000,
      });
      executor.start();

      eventBus.emit(Events.TASK_CREATED, {
        task: { id: 't2', assignedTo: 'agent-2', status: 'assigned' },
      });
      await vi.advanceTimersByTimeAsync(100);

      expect(executeOnAgent).toHaveBeenCalled();
    });

    it('should execute on TASK_UPDATED when status becomes assigned', async () => {
      const task = makeTask({ id: 't3', status: 'assigned', assignedTo: 'agent-3' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
        timeoutMs: 60_000,
      });
      executor.start();

      eventBus.emit(Events.TASK_UPDATED, {
        task: { id: 't3', assignedTo: 'agent-3', status: 'assigned' },
      });
      await vi.advanceTimersByTimeAsync(100);

      expect(executeOnAgent).toHaveBeenCalled();
    });
  });

  describe('pause / resume', () => {
    it('should not process tasks when paused', async () => {
      const task = makeTask({ id: 't4', status: 'assigned', assignedTo: 'agent-4' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
      });
      executor.start();
      executor.pause();

      eventBus.emit(Events.AGENTS_READY, { agentCount: 1 });
      await vi.advanceTimersByTimeAsync(100);

      expect(executeOnAgent).not.toHaveBeenCalled();
    });

    it('should drain tasks when resumed', async () => {
      const task = makeTask({ id: 't5', status: 'assigned', assignedTo: 'agent-5' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
        timeoutMs: 60_000,
      });
      executor.start();
      executor.pause();

      eventBus.emit(Events.AGENTS_READY, { agentCount: 1 });
      await vi.advanceTimersByTimeAsync(100);
      expect(executeOnAgent).not.toHaveBeenCalled();

      executor.resume();
      await vi.advanceTimersByTimeAsync(100);

      expect(executeOnAgent).toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('should unsubscribe all event listeners', () => {
      executor.start();

      const spy = vi.fn();
      // Tap into the bus to check if TaskExecutor is still listening
      const origEmit = eventBus.emit.bind(eventBus);

      executor.stop();

      // After stop, emitting AGENTS_READY should not trigger drain
      eventBus.emit(Events.AGENTS_READY, { agentCount: 1 });
      // executeOnAgent should not have been called since stop() removed all listeners
      expect(executeOnAgent).not.toHaveBeenCalled();
    });
  });

  describe('concurrency limits', () => {
    it('should respect per-agent limit of 1 concurrent task', async () => {
      // Create a never-resolving executeOnAgent for the first call
      let resolveFirst: ((v: { success: boolean; text: string }) => void) | undefined;
      const slowExec = vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValue({ success: true, text: 'Done 2' });

      const task1 = makeTask({ id: 't-a', status: 'assigned', assignedTo: 'agent-x' });
      const task2 = makeTask({ id: 't-b', status: 'assigned', assignedTo: 'agent-x' });
      taskStore = createMockTaskStore([task1, task2]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent: slowExec,
        isAgentAvailable,
        abortAgent,
        timeoutMs: 60_000,
      });
      executor.start();

      // First task starts
      eventBus.emit(Events.TASK_CREATED, {
        task: { id: 't-a', assignedTo: 'agent-x', status: 'assigned' },
      });
      await vi.advanceTimersByTimeAsync(100);

      // Second task for same agent — should NOT start (agent busy)
      eventBus.emit(Events.TASK_CREATED, {
        task: { id: 't-b', assignedTo: 'agent-x', status: 'assigned' },
      });
      await vi.advanceTimersByTimeAsync(100);

      expect(slowExec).toHaveBeenCalledTimes(1);

      // Complete the first task
      resolveFirst!({ success: true, text: 'Done 1' });
      await vi.advanceTimersByTimeAsync(100);
    });
  });

  describe('cancelTask()', () => {
    it('should mark a running task as cancelled', async () => {
      const task = makeTask({ id: 't-cancel', status: 'running', assignedTo: 'agent-c' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
      });

      const result = await executor.cancelTask('t-cancel');

      expect(result.success).toBe(true);
      expect(taskStore.update).toHaveBeenCalledWith('t-cancel', expect.objectContaining({
        status: 'cancelled',
        error: 'Cancelled by user',
      }));
    });

    it('should call abortAgent on cancel', async () => {
      const task = makeTask({ id: 't-abort', status: 'running', assignedTo: 'agent-a' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
      });

      await executor.cancelTask('t-abort');

      expect(abortAgent).toHaveBeenCalledWith('agent-a');
    });

    it('should reject cancel for non-existent task', async () => {
      const result = await executor.cancelTask('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Task not found');
    });

    it('should reject cancel for already completed task', async () => {
      const task = makeTask({ id: 't-done', status: 'completed' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent,
        isAgentAvailable,
        abortAgent,
      });

      const result = await executor.cancelTask('t-done');
      expect(result.success).toBe(false);
      expect(result.error).toContain('completed');
    });
  });

  describe('task execution lifecycle', () => {
    it('should transition task: assigned → running → completed', async () => {
      const task = makeTask({ id: 't-life', status: 'assigned', assignedTo: 'agent-l' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent: vi.fn().mockResolvedValue({ success: true, text: 'Result' }),
        isAgentAvailable,
        abortAgent,
        timeoutMs: 60_000,
      });
      executor.start();

      eventBus.emit(Events.TASK_CREATED, {
        task: { id: 't-life', assignedTo: 'agent-l', status: 'assigned' },
      });
      await vi.advanceTimersByTimeAsync(100);

      // Should have transitioned to running then completed
      expect(taskStore.update).toHaveBeenCalledWith('t-life', expect.objectContaining({ status: 'running' }));
      expect(taskStore.update).toHaveBeenCalledWith('t-life', expect.objectContaining({ status: 'completed' }));
    });

    it('should mark task as failed when execution fails', async () => {
      const task = makeTask({ id: 't-fail', status: 'assigned', assignedTo: 'agent-f' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent: vi.fn().mockResolvedValue({ success: false, error: 'Agent error' }),
        isAgentAvailable,
        abortAgent,
        timeoutMs: 60_000,
      });
      executor.start();

      eventBus.emit(Events.TASK_CREATED, {
        task: { id: 't-fail', assignedTo: 'agent-f', status: 'assigned' },
      });
      await vi.advanceTimersByTimeAsync(100);

      expect(taskStore.update).toHaveBeenCalledWith('t-fail', expect.objectContaining({ status: 'failed' }));
    });

    it('should emit TASK_COMPLETED event on success', async () => {
      const completedSpy = vi.fn();
      eventBus.on(Events.TASK_COMPLETED, completedSpy);

      const task = makeTask({ id: 't-evt', status: 'assigned', assignedTo: 'agent-e' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent: vi.fn().mockResolvedValue({ success: true, text: 'OK' }),
        isAgentAvailable,
        abortAgent,
        timeoutMs: 60_000,
      });
      executor.start();

      eventBus.emit(Events.TASK_CREATED, {
        task: { id: 't-evt', assignedTo: 'agent-e', status: 'assigned' },
      });
      await vi.advanceTimersByTimeAsync(100);

      expect(completedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ durationMs: expect.any(Number) }),
      );
    });
  });

  describe('timeout handling', () => {
    it('should fail task when execution exceeds timeoutMs', async () => {
      const neverResolve = vi.fn().mockImplementation(() => new Promise(() => {}));

      const task = makeTask({ id: 't-timeout', status: 'assigned', assignedTo: 'agent-t' });
      taskStore = createMockTaskStore([task]);
      executor = new TaskExecutor({
        taskStore,
        eventBus,
        executeOnAgent: neverResolve,
        isAgentAvailable,
        abortAgent,
        timeoutMs: 3000,
      });
      executor.start();

      eventBus.emit(Events.TASK_CREATED, {
        task: { id: 't-timeout', assignedTo: 'agent-t', status: 'assigned' },
      });
      await vi.advanceTimersByTimeAsync(100);

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(4000);

      expect(abortAgent).toHaveBeenCalledWith('agent-t');
      expect(taskStore.update).toHaveBeenCalledWith('t-timeout', expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('timed out'),
      }));
    });
  });
});
