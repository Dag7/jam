import type { ITaskStore, IEventBus } from '@jam/core';
import { Events, createLogger } from '@jam/core';

const log = createLogger('TaskNegotiationHandler');

/**
 * Handles task negotiation requests from agents.
 *
 * Agents can request to reassign tasks they can't handle or block tasks
 * that have unmet prerequisites. This enables autonomous task routing
 * without human intervention.
 */
export class TaskNegotiationHandler {
  constructor(
    private readonly taskStore: ITaskStore,
    private readonly eventBus: IEventBus,
  ) {}

  /** Handle a request from an agent to reassign a task */
  async handleReassignRequest(taskId: string, agentId: string, reason: string): Promise<void> {
    const task = await this.taskStore.get(taskId);
    if (!task) {
      log.warn(`Reassign request for unknown task ${taskId}`);
      return;
    }

    log.info(`Agent ${agentId.slice(0, 8)} requesting reassign of "${task.title}": ${reason}`);

    // Unassign the task — SmartTaskAssigner will pick it up
    const updated = await this.taskStore.update(taskId, {
      status: 'pending',
      assignedTo: undefined,
      error: `Reassigned by ${agentId.slice(0, 8)}: ${reason}`,
    });

    this.eventBus.emit(Events.TASK_UPDATED, {
      task: updated,
      previousStatus: task.status,
    });

    this.eventBus.emit(Events.TASK_NEGOTIATED, {
      taskId,
      agentId,
      action: 'reassign',
      reason,
    });
  }

  /** Handle a request from an agent to block a task */
  async handleBlockRequest(taskId: string, agentId: string, reason: string): Promise<void> {
    const task = await this.taskStore.get(taskId);
    if (!task) {
      log.warn(`Block request for unknown task ${taskId}`);
      return;
    }

    log.info(`Agent ${agentId.slice(0, 8)} blocking "${task.title}": ${reason}`);

    const updated = await this.taskStore.update(taskId, {
      status: 'blocked',
      blockReason: reason,
    });

    this.eventBus.emit(Events.TASK_UPDATED, {
      task: updated,
      previousStatus: task.status,
    });

    this.eventBus.emit(Events.TASK_NEGOTIATED, {
      taskId,
      agentId,
      action: 'block',
      reason,
    });
  }
}
