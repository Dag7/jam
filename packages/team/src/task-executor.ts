import type { ITaskStore, IEventBus, Task } from '@jam/core';
import { Events, createLogger, TimeoutTimer } from '@jam/core';

const log = createLogger('TaskExecutor');

/** Safety-net timeout — only kills truly stuck tasks. Users can stop tasks manually from the UI. */
const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface TaskExecutorDeps {
  taskStore: ITaskStore;
  eventBus: IEventBus;
  /** Send a prompt to an agent and get the result */
  executeOnAgent: (agentId: string, prompt: string) => Promise<{ success: boolean; text?: string; error?: string }>;
  /** Check whether an agent exists and can accept work */
  isAgentAvailable: (agentId: string) => boolean;
  /** Abort a running task on an agent (kills the child process). Optional — timeout still works without it. */
  abortAgent?: (agentId: string) => void;
  /** Max execution time per task in ms (default: 5 min) */
  timeoutMs?: number;
}

/**
 * Bridges assigned tasks to agent execution.
 * Listens for task assignment events and dispatches work to agents
 * via the existing voiceCommand/enqueueCommand pipeline.
 */
export class TaskExecutor {
  private readonly unsubscribers: Array<() => void> = [];
  /** Active task count per agent — limits concurrent detached executions */
  private readonly activeTaskCounts = new Map<string, number>();
  private readonly MAX_CONCURRENT_TASKS_PER_AGENT = 1;
  /** Global limit — prevents spawning too many host-side processes at once.
   *  Each executeDetached() spawns a heavy CLI process (e.g. `claude`), so
   *  allowing 12 concurrent (2 × 6 agents) can OOM the system. */
  private readonly MAX_GLOBAL_CONCURRENT = 3;
  /** Active execution timers — keyed by taskId so we can cancel on completion */
  private readonly executionTimers = new Map<string, TimeoutTimer>();
  private readonly timeoutMs: number;
  /** When true, no new tasks are picked up — running tasks finish naturally */
  private _paused = false;
  /** Total active executions across all agents */
  private globalActiveCount = 0;

  constructor(private readonly deps: TaskExecutorDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get paused(): boolean {
    return this._paused;
  }

  /** Pause task processing — running tasks continue, no new ones start */
  pause(): void {
    this._paused = true;
    log.info('Task processing paused');
  }

  /** Resume task processing and drain any queued assigned tasks */
  resume(): void {
    this._paused = false;
    log.info('Task processing resumed');
    this.drainAssignedTasks();
  }

  start(): void {
    // React to newly assigned tasks (from TeamEventHandler auto-assignment)
    this.unsubscribers.push(
      this.deps.eventBus.on(Events.TASK_CREATED, (payload: unknown) => {
        const p = payload as { task: { id: string; assignedTo?: string; status: string } };
        // TeamEventHandler may have already assigned it synchronously
        if (p.task.assignedTo && p.task.status === 'assigned') {
          this.tryExecute(p.task.id, p.task.assignedTo);
        }
      }),
    );

    this.unsubscribers.push(
      this.deps.eventBus.on(Events.TASK_UPDATED, (payload: unknown) => {
        const p = payload as { task: { id: string; assignedTo?: string; status: string } };
        if (p.task.status === 'assigned' && p.task.assignedTo) {
          this.tryExecute(p.task.id, p.task.assignedTo);
        }
      }),
    );

    // Delay draining tasks from previous sessions — give agents time to fully
    // initialize and let the system stabilize before dispatching work.
    // 2 minutes prevents a resource spike when many tasks are stuck from a crash.
    setTimeout(() => this.drainAssignedTasks(), 120_000);

    log.info('Task executor started');
  }

  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
    this.activeTaskCounts.clear();
    for (const timer of this.executionTimers.values()) {
      timer.dispose();
    }
    this.executionTimers.clear();
  }

  /** Cancel a running task — aborts the agent process and marks the task as cancelled. */
  async cancelTask(taskId: string): Promise<{ success: boolean; error?: string }> {
    const task = await this.deps.taskStore.get(taskId);
    if (!task) return { success: false, error: 'Task not found' };
    if (task.status !== 'running' && task.status !== 'assigned') {
      return { success: false, error: `Task is ${task.status}, not running` };
    }

    // Clear the timeout timer if active
    const timer = this.executionTimers.get(taskId);
    if (timer) {
      timer.dispose();
      this.executionTimers.delete(taskId);
    }

    // Abort the agent process
    if (task.assignedTo) {
      this.deps.abortAgent?.(task.assignedTo);
      const count = (this.activeTaskCounts.get(task.assignedTo) ?? 1) - 1;
      if (count <= 0) this.activeTaskCounts.delete(task.assignedTo);
      else this.activeTaskCounts.set(task.assignedTo, count);
    }

    // Mark as cancelled
    const updated = await this.deps.taskStore.update(taskId, {
      status: 'cancelled',
      completedAt: new Date().toISOString(),
      error: 'Cancelled by user',
    });
    this.deps.eventBus.emit(Events.TASK_COMPLETED, {
      task: updated,
      durationMs: updated?.startedAt
        ? Date.now() - new Date(updated.startedAt).getTime()
        : 0,
    });

    log.info(`Task "${task.title}" cancelled by user`);
    return { success: true };
  }

  /** Process any tasks stuck in `assigned` status (e.g., from a previous session).
   *  Also recovers tasks stuck in `running` — these were mid-flight when the app restarted. */
  private async drainAssignedTasks(): Promise<void> {
    if (this._paused) return;
    try {
      // Recover stuck running tasks — reset to assigned so they can be re-executed
      const running = await this.deps.taskStore.list({ status: 'running' });
      for (const task of running) {
        if (task.assignedTo) {
          log.warn(`Recovering stuck task "${task.title}" (was running) — resetting to assigned`);
          await this.deps.taskStore.update(task.id, { status: 'assigned' });
        }
      }

      // Recover pending tasks that already have an assignee (InboxWatcher bug left them stuck)
      const pending = await this.deps.taskStore.list({ status: 'pending' });
      for (const task of pending) {
        if (task.assignedTo) {
          log.warn(`Recovering stuck task "${task.title}" (pending with assignee) — setting to assigned`);
          await this.deps.taskStore.update(task.id, { status: 'assigned' });
        }
      }

      const assigned = await this.deps.taskStore.list({ status: 'assigned' });
      for (const task of assigned) {
        if (task.assignedTo) {
          this.tryExecute(task.id, task.assignedTo);
        }
      }
    } catch (err) {
      log.error(`Failed to drain assigned tasks: ${String(err)}`);
    }
  }

  /** Attempt to execute a task on an agent (non-blocking, fires and forgets) */
  private tryExecute(taskId: string, agentId: string): void {
    if (this._paused) {
      log.debug(`Paused — skipping task ${taskId.slice(0, 8)}`);
      return;
    }

    // Global limit — prevents spawning too many heavy CLI processes at once
    if (this.globalActiveCount >= this.MAX_GLOBAL_CONCURRENT) {
      log.debug(`Global limit reached (${this.globalActiveCount}/${this.MAX_GLOBAL_CONCURRENT}), task ${taskId.slice(0, 8)} will wait`);
      return;
    }

    const active = this.activeTaskCounts.get(agentId) ?? 0;
    if (active >= this.MAX_CONCURRENT_TASKS_PER_AGENT) {
      log.debug(`Agent ${agentId.slice(0, 8)} at max concurrent tasks (${active}), task ${taskId.slice(0, 8)} will wait`);
      return;
    }

    if (!this.deps.isAgentAvailable(agentId)) {
      log.warn(`Agent ${agentId.slice(0, 8)} not available for task ${taskId.slice(0, 8)}`);
      return;
    }

    // Fire and forget — don't await, just track via busyAgents
    this.executeTask(taskId, agentId).catch((err) => {
      log.error(`Task execution error: ${String(err)}`);
    });
  }

  private async executeTask(taskId: string, agentId: string): Promise<void> {
    const task = await this.deps.taskStore.get(taskId);
    if (!task || task.status !== 'assigned') return;

    this.activeTaskCounts.set(agentId, (this.activeTaskCounts.get(agentId) ?? 0) + 1);
    this.globalActiveCount++;
    const startedAt = new Date().toISOString();

    try {
      // Transition: assigned → running
      await this.deps.taskStore.update(taskId, {
        status: 'running',
        startedAt,
      });
      this.deps.eventBus.emit(Events.TASK_UPDATED, {
        task: { ...task, status: 'running', startedAt },
      });

      log.info(`Executing task "${task.title}" on agent ${agentId.slice(0, 8)} (timeout: ${Math.round(this.timeoutMs / 1000)}s)`);

      // Notify chat UI that a background task is starting
      this.deps.eventBus.emit('task:resultReady', {
        taskId,
        agentId,
        title: task.title,
        text: `Starting task: "${task.title}"`,
        success: true,
      });

      const prompt = this.buildPrompt(task);
      const result = await this.executeWithTimeout(taskId, agentId, prompt);
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      if (result.success) {
        // Transition: running → completed
        const updated = await this.deps.taskStore.update(taskId, {
          status: 'completed',
          result: result.text ?? '',
          completedAt,
        });
        this.deps.eventBus.emit(Events.TASK_COMPLETED, {
          task: updated,
          durationMs,
        });
        // Notify chat UI so the result appears in the conversation
        this.deps.eventBus.emit('task:resultReady', {
          taskId,
          agentId,
          title: task.title,
          text: result.text ?? '',
          success: true,
        });
        log.info(`Task "${task.title}" completed (${Math.round(durationMs / 1000)}s)`);
      } else {
        // Transition: running → failed
        const updated = await this.deps.taskStore.update(taskId, {
          status: 'failed',
          error: result.error ?? 'Task execution failed',
          completedAt,
        });
        this.deps.eventBus.emit(Events.TASK_COMPLETED, {
          task: updated,
          durationMs,
        });
        this.deps.eventBus.emit('task:resultReady', {
          taskId,
          agentId,
          title: task.title,
          text: `Task failed: ${result.error ?? 'Unknown error'}`,
          success: false,
        });
        log.warn(`Task "${task.title}" failed: ${result.error}`);
      }
    } catch (err) {
      // Transition: running → failed (unexpected error)
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      const updated = await this.deps.taskStore.update(taskId, {
        status: 'failed',
        error: String(err),
        completedAt,
      });
      this.deps.eventBus.emit(Events.TASK_COMPLETED, {
        task: updated,
        durationMs,
      });
      log.error(`Task "${task.title}" crashed: ${String(err)}`);
    } finally {
      const count = (this.activeTaskCounts.get(agentId) ?? 1) - 1;
      if (count <= 0) this.activeTaskCounts.delete(agentId);
      else this.activeTaskCounts.set(agentId, count);
      this.globalActiveCount = Math.max(0, this.globalActiveCount - 1);
      // A slot freed up — check ALL agents for waiting tasks, not just this one
      this.pickNextGlobally();
    }
  }

  /** Execute a task with a timeout — rejects if execution exceeds timeoutMs */
  private executeWithTimeout(
    taskId: string,
    agentId: string,
    prompt: string,
  ): Promise<{ success: boolean; text?: string; error?: string }> {
    return new Promise((resolve) => {
      const timer = new TimeoutTimer();
      timer.cancelAndSet(() => {
        timer.dispose();
        this.executionTimers.delete(taskId);
        log.warn(`Task ${taskId.slice(0, 8)} timed out after ${Math.round(this.timeoutMs / 1000)}s on agent ${agentId.slice(0, 8)}`);
        // Kill the child process if possible
        this.deps.abortAgent?.(agentId);
        resolve({ success: false, error: `Task timed out after ${Math.round(this.timeoutMs / 1000)} seconds` });
      }, this.timeoutMs);

      this.executionTimers.set(taskId, timer);

      this.deps.executeOnAgent(agentId, prompt).then(
        (result) => {
          timer.dispose();
          this.executionTimers.delete(taskId);
          resolve(result);
        },
        (err) => {
          timer.dispose();
          this.executionTimers.delete(taskId);
          resolve({ success: false, error: String(err) });
        },
      );
    });
  }

  /** After completing a task, check if any agent has an assigned task waiting.
   *  Checks globally because the freed slot may allow a different agent to run. */
  private async pickNextGlobally(): Promise<void> {
    if (this._paused || this.globalActiveCount >= this.MAX_GLOBAL_CONCURRENT) return;
    try {
      const assigned = await this.deps.taskStore.list({ status: 'assigned' });
      for (const task of assigned) {
        if (!task.assignedTo) continue;
        if (this.globalActiveCount >= this.MAX_GLOBAL_CONCURRENT) break;
        const agentActive = this.activeTaskCounts.get(task.assignedTo) ?? 0;
        if (agentActive >= this.MAX_CONCURRENT_TASKS_PER_AGENT) continue;
        if (!this.deps.isAgentAvailable(task.assignedTo)) continue;
        this.tryExecute(task.id, task.assignedTo);
      }
    } catch {
      // Non-critical — next tick or event will retry
    }
  }

  private buildPrompt(task: Task): string {
    // Task result notifications are informational — short acknowledgment, no full execution
    if (task.tags.includes('task-result')) {
      return [
        'You received a task completion notification from a teammate.',
        'Acknowledge this briefly. If relevant to your current work, note it.',
        '',
        task.title,
        task.description,
      ].join('\n');
    }

    const parts = [
      'You have been assigned a task. Complete it and provide a summary of what you did.',
      '',
      `Title: ${task.title}`,
      `Description: ${task.description}`,
    ];

    if (task.priority && task.priority !== 'normal') {
      parts.push(`Priority: ${task.priority}`);
    }

    if (task.tags.length > 0) {
      parts.push(`Tags: ${task.tags.join(', ')}`);
    }

    return parts.join('\n');
  }
}
