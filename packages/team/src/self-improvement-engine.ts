import type { ITaskStore, IStatsStore, IEventBus, AgentStats, Task } from '@jam/core';
import { Events } from '@jam/core';
import type { SoulManager } from './soul-manager.js';

export interface ReflectionContext {
  stats: AgentStats | null;
  recentTasks: Task[];
  soul: Awaited<ReturnType<SoulManager['load']>>;
}

export interface ReflectionResult {
  newLearnings: string[];
  traitAdjustments: Record<string, number>;
  newGoals: string[];
  improvementTasks: Array<{ title: string; description: string }>;
}

/**
 * Gathers metrics/context for an agent and triggers self-reflection.
 * The actual LLM call is delegated to the caller (desktop layer)
 * via the `onReflect` callback, keeping this package runtime-agnostic.
 */
export class SelfImprovementEngine {
  constructor(
    private readonly taskStore: ITaskStore,
    private readonly statsStore: IStatsStore,
    private readonly soulManager: SoulManager,
    private readonly eventBus: IEventBus,
  ) {}

  async gatherContext(agentId: string): Promise<ReflectionContext> {
    const [stats, recentTasks, soul] = await Promise.all([
      this.statsStore.get(agentId),
      this.taskStore.list({ assignedTo: agentId }),
      this.soulManager.load(agentId),
    ]);

    // Sort by most recent, limit to last 20
    const sorted = recentTasks
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 20);

    return { stats, recentTasks: sorted, soul };
  }

  async applyReflection(
    agentId: string,
    result: ReflectionResult,
  ): Promise<void> {
    // Evolve soul with reflection results
    await this.soulManager.evolve(agentId, {
      newLearnings: result.newLearnings,
      traitAdjustments: result.traitAdjustments,
      newGoals: result.newGoals,
    });

    // Create improvement tasks
    for (const taskDef of result.improvementTasks) {
      const task = await this.taskStore.create({
        title: taskDef.title,
        description: taskDef.description,
        status: 'pending',
        priority: 'normal',
        source: 'agent',
        createdBy: agentId,
        createdAt: new Date().toISOString(),
        tags: ['self-improvement'],
      });

      this.eventBus.emit(Events.TASK_CREATED, { task });
    }
  }

  buildReflectionPrompt(context: ReflectionContext): string {
    const { stats, recentTasks, soul } = context;

    const lines: string[] = [
      'Reflect on your recent performance and suggest improvements.',
      '',
      '## Current Stats',
    ];

    if (stats) {
      const total = stats.tasksCompleted + stats.tasksFailed;
      const successRate = total > 0 ? ((stats.tasksCompleted / total) * 100).toFixed(1) : 'N/A';
      lines.push(`- Tasks completed: ${stats.tasksCompleted}`);
      lines.push(`- Tasks failed: ${stats.tasksFailed}`);
      lines.push(`- Success rate: ${successRate}%`);
      lines.push(`- Average response time: ${stats.averageResponseMs.toFixed(0)}ms`);
      lines.push(`- Current streak: ${stats.streaks.current}`);
    } else {
      lines.push('- No stats available yet');
    }

    lines.push('');
    lines.push('## Recent Tasks');
    for (const task of recentTasks.slice(0, 10)) {
      lines.push(`- [${task.status}] ${task.title}${task.error ? ` (error: ${task.error})` : ''}`);
    }

    lines.push('');
    lines.push('## Current Soul');
    lines.push(`- Persona: ${soul.persona || 'not set'}`);
    if (soul.goals.length > 0) {
      lines.push(`- Goals: ${soul.goals.join(', ')}`);
    }
    if (soul.learnings.length > 0) {
      lines.push(`- Recent learnings: ${soul.learnings.slice(-5).join(', ')}`);
    }

    lines.push('');
    lines.push('Respond with a JSON object containing:');
    lines.push('- newLearnings: string[] — what you learned');
    lines.push('- traitAdjustments: Record<string, number> — trait deltas (-0.1 to +0.1)');
    lines.push('- newGoals: string[] — new goals to add');
    lines.push('- improvementTasks: { title, description }[] — tasks to improve yourself');

    return lines.join('\n');
  }
}
