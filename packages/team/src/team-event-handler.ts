import type { IEventBus, IStatsStore, IRelationshipStore, ITaskStore, ICommunicationHub } from '@jam/core';
import { Events, createLogger } from '@jam/core';
import type { ITaskAssigner } from './task-assigner.js';

const log = createLogger('TeamEventHandler');

/** Well-known channel name for automatic work broadcasts */
const TEAM_FEED_CHANNEL = '#team-feed';

/**
 * Wires existing events to team stores — listens for agent completions,
 * task updates, etc. and keeps stats/relationships in sync.
 */
export class TeamEventHandler {
  private unsubscribers: Array<() => void> = [];

  /** Lazily-resolved ID for the #team-feed broadcast channel */
  private teamFeedChannelId: string | null = null;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly statsStore: IStatsStore,
    private readonly relationshipStore: IRelationshipStore,
    private readonly taskStore: ITaskStore,
    private readonly taskAssigner: ITaskAssigner,
    private readonly getAgentProfiles: () => Array<{ id: string; name: string; runtime: string; model?: string; color: string; voice: { ttsVoiceId: string }; isSystem?: boolean }>,
    private readonly communicationHub?: ICommunicationHub,
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
      const agents = this.getAgentProfiles().filter(a => !a.isSystem);
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

      // Gather real stats and relationships for balanced assignment
      const statsMap = new Map<string, import('@jam/core').AgentStats>();
      const relsMap = new Map<string, import('@jam/core').AgentRelationship[]>();
      for (const agent of agents) {
        const agentStats = await this.statsStore.get(agent.id);
        if (agentStats) statsMap.set(agent.id, agentStats);
        const agentRels = await this.relationshipStore.getAll(agent.id);
        if (agentRels.length > 0) relsMap.set(agent.id, agentRels);
      }

      const assignee = this.taskAssigner.assign(
        fullTask,
        agents as Parameters<typeof this.taskAssigner.assign>[1],
        relsMap,
        statsMap,
        new Map(),
        runningCounts,
      );

      if (assignee) {
        const updated = await this.taskStore.update(task.id, {
          assignedTo: assignee,
          status: 'assigned',
        });
        if (updated) {
          this.eventBus.emit(Events.TASK_UPDATED, { task: updated });
        }
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

    // Broadcast completion to #team-feed so all agents and the UI can see it
    if (task.assignedTo) {
      const fullTask = await this.taskStore.get(task.id);
      const agentName = this.getAgentProfiles().find(a => a.id === task.assignedTo)?.name ?? task.assignedTo;
      const summary = fullTask?.result ?? fullTask?.title ?? 'Task';
      const msg = success
        ? `**${agentName}** completed: ${fullTask?.title ?? 'Task'}\n\n${summary}`
        : `**${agentName}** failed: ${fullTask?.title ?? 'Task'}\n\n${fullTask?.error ?? 'Unknown error'}`;
      this.broadcastToTeamFeed(task.assignedTo, msg).catch(() => {});
    }
  }

  /** Post a message to the #team-feed broadcast channel (creates it lazily). */
  private async broadcastToTeamFeed(senderId: string, content: string): Promise<void> {
    if (!this.communicationHub) return;

    try {
      // Lazily resolve or create the team-feed channel
      if (!this.teamFeedChannelId) {
        const channels = await this.communicationHub.listChannels();
        const existing = channels.find(c => c.name === TEAM_FEED_CHANNEL);
        if (existing) {
          this.teamFeedChannelId = existing.id;
        } else {
          const allAgentIds = this.getAgentProfiles().map(a => a.id);
          const channel = await this.communicationHub.createChannel(
            TEAM_FEED_CHANNEL,
            'broadcast',
            allAgentIds,
          );
          this.teamFeedChannelId = channel.id;
          log.info(`Created ${TEAM_FEED_CHANNEL} broadcast channel`);
        }
      }

      await this.communicationHub.sendMessage(this.teamFeedChannelId, senderId, content);
    } catch (err) {
      log.warn(`Failed to broadcast to team feed: ${String(err)}`);
    }
  }
}
