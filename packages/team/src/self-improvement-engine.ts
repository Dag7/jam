import type { ITaskStore, IStatsStore, IEventBus, AgentStats, Task } from '@jam/core';
import { Events, createLogger } from '@jam/core';
import type { SoulManager } from './soul-manager.js';
import type { ITeamExecutor } from './team-executor.js';

const log = createLogger('SelfImprovement');

/** Minimal conversation entry for reflection — no coupling to @jam/agent-runtime */
export interface ReflectionConversation {
  timestamp: string;
  role: 'user' | 'agent';
  content: string;
}

/** Callback to load recent conversations for an agent */
export type ConversationLoader = (agentId: string, limit: number) => Promise<ReflectionConversation[]>;

/** Summary of an agent's workspace directory */
export interface WorkspaceSummary {
  /** Top-level files and directories (name + type) */
  entries: Array<{ name: string; type: 'file' | 'dir' }>;
  /** Services found in .services.json files (including subdirs) */
  services: Array<{ name: string; port?: number; alive: boolean }>;
  /** Notable files content (e.g., README, status docs — truncated) */
  notableFiles: Array<{ name: string; content: string }>;
}

/** Callback to scan an agent's workspace for reflection context */
export type WorkspaceScanner = (agentId: string) => Promise<WorkspaceSummary | null>;

export interface ReflectionContext {
  stats: AgentStats | null;
  recentTasks: Task[];
  recentConversations: ReflectionConversation[];
  soul: Awaited<ReturnType<SoulManager['load']>>;
  workspace: WorkspaceSummary | null;
  /** All proactive tasks ever created for this agent (any status) */
  pastProactiveTasks: Task[];
}

export interface ReflectionResult {
  /** Updated role identity based on work patterns */
  role: string;
  newLearnings: string[];
  traitAdjustments: Record<string, number>;
  newGoals: string[];
  proactiveTasks: Array<{ title: string; description: string }>;
}

/**
 * Gathers metrics/context for an agent and triggers self-reflection.
 * When a TeamExecutor is provided, reflection is fully self-contained —
 * the engine resolves the model tier, executes the LLM call, parses the
 * result, and applies it (soul evolution + proactive task creation).
 */
export class SelfImprovementEngine {
  private teamExecutor: ITeamExecutor | null = null;
  private conversationLoader: ConversationLoader | null = null;
  private workspaceScanner: WorkspaceScanner | null = null;

  constructor(
    private readonly taskStore: ITaskStore,
    private readonly statsStore: IStatsStore,
    private readonly soulManager: SoulManager,
    private readonly eventBus: IEventBus,
  ) {}

  /** Inject the team executor after construction (avoids circular deps in orchestrator) */
  setTeamExecutor(executor: ITeamExecutor): void {
    this.teamExecutor = executor;
  }

  /** Inject a conversation loader to include chat history in reflections */
  setConversationLoader(loader: ConversationLoader): void {
    this.conversationLoader = loader;
  }

  /** Inject a workspace scanner to include workspace context in reflections */
  setWorkspaceScanner(scanner: WorkspaceScanner): void {
    this.workspaceScanner = scanner;
  }

  async gatherContext(agentId: string): Promise<ReflectionContext> {
    const [stats, allTasks, soul, recentConversations, workspace] = await Promise.all([
      this.statsStore.get(agentId),
      this.taskStore.list({ assignedTo: agentId }),
      this.soulManager.load(agentId),
      this.conversationLoader
        ? this.conversationLoader(agentId, 30)
        : Promise.resolve([]),
      this.workspaceScanner
        ? this.workspaceScanner(agentId).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Sort by most recent, limit to last 20
    const sorted = allTasks
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 20);

    // Collect all proactive tasks (any status) so the LLM knows not to recreate them
    const pastProactiveTasks = allTasks.filter(t => t.tags?.includes('proactive'));

    return { stats, recentTasks: sorted, recentConversations, soul, workspace, pastProactiveTasks };
  }

  /**
   * Self-contained reflection: gather context, call LLM via TeamExecutor,
   * parse response, and apply results. Requires `setTeamExecutor()` first.
   */
  async triggerReflection(agentId: string): Promise<ReflectionResult | null> {
    if (!this.teamExecutor) {
      log.warn('No TeamExecutor set — cannot trigger reflection autonomously');
      return null;
    }

    const context = await this.gatherContext(agentId);
    const prompt = this.buildReflectionPrompt(context);

    try {
      const raw = await this.teamExecutor.execute('self:reflect', prompt);
      const result = this.parseReflectionResult(raw);
      await this.applyReflection(agentId, result);
      log.info(`Reflection complete for ${agentId}: ${result.newLearnings.length} learnings, ${result.proactiveTasks.length} tasks`);
      return result;
    } catch (error) {
      log.error(`Reflection failed for ${agentId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async applyReflection(
    agentId: string,
    result: ReflectionResult,
  ): Promise<void> {
    // Evolve soul with reflection results
    await this.soulManager.evolve(agentId, {
      role: result.role || undefined,
      newLearnings: result.newLearnings,
      traitAdjustments: result.traitAdjustments,
      newGoals: result.newGoals,
    });

    // Deduplicate proactive tasks against existing ones (any status)
    const existingTasks = await this.taskStore.list({ assignedTo: agentId });
    const existingProactiveTitles = new Set(
      existingTasks
        .filter(t => t.tags?.includes('proactive'))
        .map(t => t.title.toLowerCase().trim()),
    );

    // Create proactive tasks — assigned back to the reflecting agent.
    // These are actions the agent identified it should take to help the user.
    for (const taskDef of result.proactiveTasks) {
      const normalizedTitle = taskDef.title.toLowerCase().trim();
      if (existingProactiveTitles.has(normalizedTitle)) {
        log.debug(`Skipping duplicate proactive task: "${taskDef.title}"`);
        continue;
      }
      existingProactiveTitles.add(normalizedTitle);

      const task = await this.taskStore.create({
        title: taskDef.title,
        description: taskDef.description,
        status: 'assigned',
        priority: 'normal',
        source: 'agent',
        assignedTo: agentId,
        createdBy: agentId,
        createdAt: new Date().toISOString(),
        tags: ['proactive'],
      });

      this.eventBus.emit(Events.TASK_CREATED, { task });
    }
  }

  buildReflectionPrompt(context: ReflectionContext): string {
    const { stats, recentTasks, recentConversations, soul, workspace, pastProactiveTasks } = context;

    const lines: string[] = [
      'You are reflecting on your recent work to improve yourself and help the user proactively.',
      '',
      '## What to do',
      '1. Define or refine your ROLE — based on the work you have done and conversations with the user, what role best describes you?',
      '   - Examples: "Frontend Developer", "Marketing Analyst", "DevOps Engineer", "Sales Strategist"',
      '   - This should emerge naturally from your conversations and task history, not be aspirational',
      '   - Keep it concise (2-5 words). If you have no history, leave it empty.',
      '2. Analyze your conversations and task history — what did the user ask you to do? What patterns emerge?',
      '3. Extract specific learnings from your interactions and task outcomes',
      '4. Adjust your traits based on evidence (not aspirationally)',
      '5. Identify proactive actions YOU can take next to help the user, based on what they have been asking for',
      '',
      '## Rules for proactive tasks',
      '- Tasks are things YOU will execute autonomously — be specific and actionable',
      '- Base them on real patterns: repeated user requests, failed tasks worth retrying, gaps you noticed',
      '- Examples: "Run test coverage on src/ and report gaps", "Refactor the auth module that failed last time"',
      '- Do NOT create meta-tasks about yourself (no "create checklist", "write documentation", "build validator")',
      '- Do NOT create tasks you have no context for — only things related to your actual work',
      '- Do NOT recreate tasks that already exist in "Your Past Proactive Tasks" below — check the list carefully',
      '- If you have no meaningful history yet, return empty arrays for everything',
      '',
      '## Your Stats',
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
      lines.push('- No stats available yet — return empty arrays');
    }

    lines.push('');
    lines.push('## Your Recent Tasks');
    if (recentTasks.length === 0) {
      lines.push('- No tasks yet — return empty arrays');
    }
    for (const task of recentTasks.slice(0, 10)) {
      const parts = [`[${task.status}] ${task.title}`];
      if (task.description) parts.push(`  Description: ${task.description.slice(0, 200)}`);
      if (task.error) parts.push(`  Error: ${task.error}`);
      lines.push(`- ${parts.join('\n  ')}`);
    }

    lines.push('');
    lines.push('## Your Past Proactive Tasks (DO NOT recreate these)');
    if (pastProactiveTasks.length === 0) {
      lines.push('- None yet');
    } else {
      for (const task of pastProactiveTasks) {
        lines.push(`- [${task.status}] ${task.title}`);
      }
    }

    lines.push('');
    lines.push('## Your Recent Conversations with the User');
    if (recentConversations.length === 0) {
      lines.push('- No conversations yet');
    } else {
      for (const entry of recentConversations.slice(-20)) {
        const prefix = entry.role === 'user' ? 'User' : 'You';
        // Truncate long messages to keep prompt manageable
        const text = entry.content.length > 300
          ? entry.content.slice(0, 300) + '...'
          : entry.content;
        lines.push(`- **${prefix}**: ${text}`);
      }
    }

    lines.push('');
    lines.push('## Your Workspace');
    if (workspace && (workspace.entries.length > 0 || workspace.services.length > 0)) {
      if (workspace.entries.length > 0) {
        lines.push('Files and directories in your workspace:');
        for (const entry of workspace.entries) {
          lines.push(`- ${entry.type === 'dir' ? `${entry.name}/` : entry.name}`);
        }
      }
      if (workspace.services.length > 0) {
        lines.push('');
        lines.push('Running services you created:');
        for (const svc of workspace.services) {
          const portStr = svc.port ? `:${svc.port}` : '';
          const status = svc.alive ? 'running' : 'stopped';
          lines.push(`- ${svc.name}${portStr} (${status})`);
        }
      }
      if (workspace.notableFiles.length > 0) {
        lines.push('');
        for (const file of workspace.notableFiles) {
          lines.push(`### ${file.name}`);
          lines.push(file.content);
        }
      }
    } else {
      lines.push('- Empty workspace — no files created yet');
    }

    lines.push('');
    lines.push('## Your Current Soul');
    lines.push(`- Role: ${soul.role || 'not yet defined — define one based on your work'}`);
    lines.push(`- Persona: ${soul.persona || 'not set'}`);
    if (soul.goals.length > 0) {
      lines.push(`- Goals: ${soul.goals.join(', ')}`);
    }
    if (soul.learnings.length > 0) {
      lines.push(`- Recent learnings: ${soul.learnings.slice(-5).join(', ')}`);
    }

    lines.push('');
    lines.push('Respond with a JSON object:');
    lines.push('```json');
    lines.push('{');
    lines.push('  "role": "Your Role Title (2-5 words)",');
    lines.push('  "newLearnings": ["specific lesson from task X", ...],');
    lines.push('  "traitAdjustments": { "traitName": 0.05, ... },');
    lines.push('  "newGoals": ["goal based on observed pattern", ...],');
    lines.push('  "proactiveTasks": [{ "title": "...", "description": "..." }, ...]');
    lines.push('}');
    lines.push('```');

    return lines.join('\n');
  }

  /** Parse LLM JSON response, extracting from markdown code fences if needed */
  private parseReflectionResult(raw: string): ReflectionResult {
    // Strip markdown code fences if present
    let json = raw.trim();
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      json = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(json) as Record<string, unknown>;

    return {
      role: typeof parsed.role === 'string' ? parsed.role : '',
      newLearnings: Array.isArray(parsed.newLearnings) ? parsed.newLearnings : [],
      traitAdjustments: parsed.traitAdjustments && typeof parsed.traitAdjustments === 'object'
        ? parsed.traitAdjustments as Record<string, number>
        : {},
      newGoals: Array.isArray(parsed.newGoals) ? parsed.newGoals : [],
      // Support both old "improvementTasks" and new "proactiveTasks" key
      proactiveTasks: Array.isArray(parsed.proactiveTasks)
        ? parsed.proactiveTasks
        : Array.isArray(parsed.improvementTasks)
          ? parsed.improvementTasks as Array<{ title: string; description: string }>
          : [],
    };
  }
}
