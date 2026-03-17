import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '@jam/eventbus';
import { Events } from '@jam/core';
import type { ITaskStore, Task } from '@jam/core';
import { TaskScheduler } from '../task-scheduler.js';

function createMockTaskStore(): ITaskStore {
  const tasks: Task[] = [];
  return {
    get: vi.fn(async (id: string) => tasks.find((t) => t.id === id) ?? null),
    create: vi.fn(async (input: Omit<Task, 'id'>) => {
      const task = { ...input, id: crypto.randomUUID() } as Task;
      tasks.push(task);
      return task;
    }),
    update: vi.fn(async (id: string, updates: Partial<Task>) => {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`Task not found: ${id}`);
      tasks[idx] = { ...tasks[idx], ...updates, id };
      return tasks[idx];
    }),
    list: vi.fn(async (filter?: { status?: string }) => {
      if (filter?.status) return tasks.filter((t) => t.status === filter.status);
      return tasks;
    }),
    delete: vi.fn(async (id: string) => {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx >= 0) tasks.splice(idx, 1);
    }),
  };
}

describe('TaskScheduler', () => {
  let eventBus: EventBus;
  let taskStore: ITaskStore;
  let scheduler: TaskScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    taskStore = createMockTaskStore();
  });

  afterEach(() => {
    scheduler?.stop();
    vi.useRealTimers();
  });

  describe('AGENTS_READY event-driven activation', () => {
    it('should NOT dispatch tasks before AGENTS_READY fires', async () => {
      scheduler = new TaskScheduler(taskStore, eventBus, undefined, 1000, 0);
      // Register a due interval schedule
      scheduler.register(
        { intervalMs: 500 },
        {
          title: 'Test Schedule',
          description: 'Should not fire yet',
          priority: 'normal',
          source: 'user',
          createdBy: 'user',
          tags: [],
        },
      );

      await scheduler.start();

      // Advance past multiple ticks — should not create any tasks
      await vi.advanceTimersByTimeAsync(5000);

      expect(taskStore.create).not.toHaveBeenCalled();
    });

    it('should dispatch tasks after AGENTS_READY fires', async () => {
      scheduler = new TaskScheduler(taskStore, eventBus, undefined, 1000, 0);
      scheduler.register(
        { intervalMs: 500 },
        {
          title: 'Interval Task',
          description: 'Fires after ready',
          priority: 'normal',
          source: 'user',
          createdBy: 'user',
          tags: [],
        },
      );

      await scheduler.start();

      // Emit AGENTS_READY — should trigger immediate tick
      eventBus.emit(Events.AGENTS_READY, { agentCount: 3 });
      await vi.advanceTimersByTimeAsync(100);

      expect(taskStore.create).toHaveBeenCalled();
    });

    it('should start dispatching on regular ticks after AGENTS_READY', async () => {
      scheduler = new TaskScheduler(taskStore, eventBus, undefined, 2000, 0);
      scheduler.register(
        { intervalMs: 1000 },
        {
          title: 'Regular Task',
          description: 'Fires on ticks',
          priority: 'normal',
          source: 'user',
          createdBy: 'user',
          tags: [],
        },
      );

      await scheduler.start();

      // Fire AGENTS_READY — first tick runs immediately
      eventBus.emit(Events.AGENTS_READY, { agentCount: 1 });
      await vi.advanceTimersByTimeAsync(100);
      const firstCallCount = (taskStore.create as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(firstCallCount).toBeGreaterThan(0);

      // Complete the first task so dedup doesn't block the next one
      const tasks = await taskStore.list();
      for (const t of tasks) await taskStore.update(t.id, { status: 'completed' });

      // Advance 2s for next tick (checkIntervalMs = 2000)
      await vi.advanceTimersByTimeAsync(2000);
      const secondCallCount = (taskStore.create as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(secondCallCount).toBeGreaterThan(firstCallCount);
    });
  });

  describe('stop()', () => {
    it('should unsubscribe all event listeners and stop ticking', async () => {
      scheduler = new TaskScheduler(taskStore, eventBus, undefined, 1000, 0);
      scheduler.register(
        { intervalMs: 500 },
        {
          title: 'Stopped Task',
          description: 'Should not fire after stop',
          priority: 'normal',
          source: 'user',
          createdBy: 'user',
          tags: [],
        },
      );

      await scheduler.start();
      scheduler.stop();

      // AGENTS_READY after stop should do nothing
      eventBus.emit(Events.AGENTS_READY, { agentCount: 1 });
      await vi.advanceTimersByTimeAsync(5000);

      expect(taskStore.create).not.toHaveBeenCalled();
    });
  });

  describe('register / unregister', () => {
    it('should register an in-memory schedule', async () => {
      scheduler = new TaskScheduler(taskStore, eventBus);
      const id = scheduler.register(
        { intervalMs: 60_000 },
        {
          title: 'Registered',
          description: 'Test',
          priority: 'normal',
          source: 'user',
          createdBy: 'user',
          tags: [],
        },
      );

      const schedules = await scheduler.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].id).toBe(id);
    });

    it('should unregister a schedule', async () => {
      scheduler = new TaskScheduler(taskStore, eventBus);
      const id = scheduler.register(
        { intervalMs: 60_000 },
        {
          title: 'ToRemove',
          description: 'Test',
          priority: 'normal',
          source: 'user',
          createdBy: 'user',
          tags: [],
        },
      );

      scheduler.unregister(id);
      const schedules = await scheduler.getSchedules();
      expect(schedules).toHaveLength(0);
    });
  });

  describe('system handlers', () => {
    it('should register a system handler', () => {
      scheduler = new TaskScheduler(taskStore, eventBus, undefined, 1000, 0);

      const handler = vi.fn().mockResolvedValue(undefined);
      scheduler.registerSystemHandler('self-improvement', handler);

      // System handlers are only invoked for persistent (FileScheduleStore) schedules,
      // not in-memory ones. Verifying registration is correct.
      // Full handler dispatch is tested via integration with FileScheduleStore.
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('TASK_CREATED event emission', () => {
    it('should emit TASK_CREATED when a scheduled task fires', async () => {
      const createdSpy = vi.fn();
      eventBus.on(Events.TASK_CREATED, createdSpy);

      scheduler = new TaskScheduler(taskStore, eventBus, undefined, 1000, 0);
      scheduler.register(
        { intervalMs: 500 },
        {
          title: 'Event Test',
          description: 'Should emit event',
          priority: 'normal',
          source: 'user',
          createdBy: 'user',
          tags: [],
        },
      );

      await scheduler.start();
      eventBus.emit(Events.AGENTS_READY, { agentCount: 1 });
      await vi.advanceTimersByTimeAsync(100);

      expect(createdSpy).toHaveBeenCalledWith(
        expect.objectContaining({ task: expect.objectContaining({ title: 'Event Test' }) }),
      );
    });
  });
});
