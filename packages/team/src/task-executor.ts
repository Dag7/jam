import type { ITaskStore, IEventBus, Task } from '@jam/core';
import { Events, createLogger } from '@jam/core';

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
  private readonly MAX_CONCURRENT_TASKS_PER_AGENT = 2;
  /** Active execution timers — keyed by taskId so we can cancel on completion */
  private readonly executionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly timeoutMs: number;

  constructor(private readonly deps: TaskExecutorDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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

    // On startup, check for any tasks that were assigned but never executed
    this.drainAssignedTasks();

    log.info('Task executor started');
  }

  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
    this.activeTaskCounts.clear();
    for (const timer of this.executionTimers.values()) {
      clearTimeout(timer);
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
      clearTimeout(timer);
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
    try {
      // Recover stuck running tasks — reset to assigned so they can be re-executed
      const running = await this.deps.taskStore.list({ status: 'running' });
      for (const task of running) {
        if (task.assignedTo) {
          log.warn(`Recovering stuck task "${task.title}" (was running) — resetting to assigned`);
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
      // Check if this agent has more assigned tasks waiting
      this.pickNextForAgent(agentId);
    }
  }

  /** Execute a task with a timeout — rejects if execution exceeds timeoutMs */
  private executeWithTimeout(
    taskId: string,
    agentId: string,
    prompt: string,
  ): Promise<{ success: boolean; text?: string; error?: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.executionTimers.delete(taskId);
        log.warn(`Task ${taskId.slice(0, 8)} timed out after ${Math.round(this.timeoutMs / 1000)}s on agent ${agentId.slice(0, 8)}`);
        // Kill the child process if possible
        this.deps.abortAgent?.(agentId);
        resolve({ success: false, error: `Task timed out after ${Math.round(this.timeoutMs / 1000)} seconds` });
      }, this.timeoutMs);

      this.executionTimers.set(taskId, timer);

      this.deps.executeOnAgent(agentId, prompt).then(
        (result) => {
          clearTimeout(timer);
          this.executionTimers.delete(taskId);
          resolve(result);
        },
        (err) => {
          clearTimeout(timer);
          this.executionTimers.delete(taskId);
          resolve({ success: false, error: String(err) });
        },
      );
    });
  }

  /** After completing a task, check if the same agent has another assigned task */
  private async pickNextForAgent(agentId: string): Promise<void> {
    try {
      const assigned = await this.deps.taskStore.list({ status: 'assigned', assignedTo: agentId });
      if (assigned.length > 0) {
        this.tryExecute(assigned[0].id, agentId);
      }
    } catch {
      // Non-critical — next tick or event will retry
    }
  }

  private buildPrompt(task: Task): string {
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
