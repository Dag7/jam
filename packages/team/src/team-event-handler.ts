import type { IEventBus, IStatsStore, IRelationshipStore, ITaskStore } from '@jam/core';
import { Events } from '@jam/core';
import type { ITaskAssigner } from './task-assigner.js';

/**
 * Wires existing events to team stores — listens for agent completions,
 * task updates, etc. and keeps stats/relationships in sync.
 */
export class TeamEventHandler {
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly eventBus: IEventBus,
    private readonly statsStore: IStatsStore,
    private readonly relationshipStore: IRelationshipStore,
    private readonly taskStore: ITaskStore,
    private readonly taskAssigner: ITaskAssigner,
    private readonly getAgentProfiles: () => Array<{ id: string; name: string; runtime: string; model?: string; color: string; voice: { ttsVoiceId: string } }>,
  ) {}

  start(): void {
    this.unsubscribers.push(
      this.eventBus.on(Events.TASK_CREATED, (payload: unknown) => {
        this.onTaskCreated(payload as { task: { id: string; assignedTo?: string } });
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on(Events.TASK_COMPLETED, (payload: unknown) => {
        this.onTaskCompleted(
          payload as {
            task: { id: string; assignedTo?: string; createdBy: string; status: string };
            durationMs: number;
          },
        );
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on(Events.AGENT_RESPONSE_COMPLETE, (payload: unknown) => {
        const p = payload as { agentId: string };
        this.statsStore.recordExecution(p.agentId, 0, true).catch(() => {});
      }),
    );
  }

  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  private async onTaskCreated(payload: {
    task: { id: string; assignedTo?: string };
  }): Promise<void> {
    const { task } = payload;

    // Auto-assign if no assignee
    if (!task.assignedTo) {
      const agents = this.getAgentProfiles();
      const runningCounts = new Map<string, number>();

      // Count running tasks per agent
      const allTasks = await this.taskStore.list({ status: 'running' });
      for (const t of allTasks) {
        if (t.assignedTo) {
          runningCounts.set(t.assignedTo, (runningCounts.get(t.assignedTo) ?? 0) + 1);
        }
      }

      const fullTask = await this.taskStore.get(task.id);
      if (!fullTask) return;

      const assignee = this.taskAssigner.assign(
        fullTask,
        agents as Parameters<typeof this.taskAssigner.assign>[1],
        new Map(),
        new Map(),
        new Map(),
        runningCounts,
      );

      if (assignee) {
        await this.taskStore.update(task.id, {
          assignedTo: assignee,
          status: 'assigned',
        });
      }
    }
  }

  private async onTaskCompleted(payload: {
    task: { id: string; assignedTo?: string; createdBy: string; status: string };
    durationMs: number;
  }): Promise<void> {
    const { task, durationMs } = payload;
    const success = task.status === 'completed';

    // Update stats
    if (task.assignedTo) {
      await this.statsStore.recordExecution(task.assignedTo, durationMs, success);

      this.eventBus.emit(Events.STATS_UPDATED, {
        agentId: task.assignedTo,
        stats: await this.statsStore.get(task.assignedTo),
      });
    }

    // Update trust if this was a delegated task
    if (task.assignedTo && task.createdBy !== task.assignedTo) {
      const rel = await this.relationshipStore.updateTrust(
        task.createdBy,
        task.assignedTo,
        success ? 'success' : 'failure',
      );

      this.eventBus.emit(Events.TRUST_UPDATED, { relationship: rel });
    }
  }
}
