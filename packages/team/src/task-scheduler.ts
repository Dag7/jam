import type { Task, ITaskStore, IEventBus } from '@jam/core';
import { Events, createLogger, JAM_SYSTEM_AGENT_ID, IntervalTimer } from '@jam/core';
import { nextCronRun } from './cron-parser.js';
import type { FileScheduleStore, PersistedSchedule } from './stores/file-schedule-store.js';

/** Agent-defined cron entry (from .cron.json files scanned by CronScanner) */
export interface AgentCronEntry {
  agentId: string;
  name: string;
  schedule: string;
  command: string;
  cwd: string;
  enabled: boolean;
}

const log = createLogger('TaskScheduler');

export interface SchedulePattern {
  /** Run every N milliseconds */
  intervalMs?: number;
  /** Run at specific hour (0-23) */
  hour?: number;
  /** Run at specific minute (0-59) */
  minute?: number;
  /** Day of week (0=Sun, 6=Sat). If omitted, runs daily. */
  dayOfWeek?: number;
  /** Standard 5-field cron expression (minute hour dom month dow) */
  cron?: string;
}

export interface ScheduledTask {
  id: string;
  schedule: SchedulePattern;
  taskTemplate: Omit<Task, 'id' | 'createdAt' | 'status'>;
  lastRun: string | null;
  enabled: boolean;
}

/** Default system schedules seeded on first startup */
const SYSTEM_SCHEDULES: Array<{
  name: string;
  pattern: SchedulePattern;
  taskTemplate: Omit<Task, 'id' | 'createdAt' | 'status'>;
  enabled?: boolean;
}> = [
  {
    name: 'Self-Reflection',
    pattern: { cron: '0 */6 * * *' },
    taskTemplate: {
      title: 'Self-Reflection',
      description: 'Analyze recent performance, extract learnings, adjust traits and goals.',
      priority: 'normal',
      source: 'system',
      createdBy: 'system',
      tags: ['self-improvement'],
    },
  },
  {
    name: 'Stats Aggregation',
    pattern: { cron: '0 */12 * * *' },
    taskTemplate: {
      title: 'Stats Aggregation',
      description: 'Aggregate agent performance stats across the team.',
      priority: 'low',
      source: 'system',
      createdBy: 'system',
      tags: ['stats'],
    },
  },
  {
    name: 'Weekly Code Review',
    pattern: { cron: '0 3 * * 0' },
    taskTemplate: {
      title: 'Weekly Code Review',
      description: 'Review recent code changes and suggest improvements.',
      priority: 'normal',
      source: 'system',
      createdBy: 'system',
      tags: ['code-improvement'],
    },
  },
];

export class TaskScheduler {
  private readonly timer = new IntervalTimer();
  /** In-memory fallback for backwards compatibility (used when no store provided) */
  private readonly memorySchedules: Map<string, ScheduledTask> = new Map();
  /** Handlers for system schedules — matched by task tag, called instead of creating a generic task */
  private readonly systemHandlers = new Map<string, () => Promise<void>>();
  /** Set to true once AGENTS_READY fires — ticks are skipped until then */
  private agentsReady = false;
  private readonly unsubscribers: Array<() => void> = [];
  /** Grace period after AGENTS_READY before dispatching — lets the renderer stabilize */
  private readonly startupGraceMs: number;

  constructor(
    private readonly taskStore: ITaskStore,
    private readonly eventBus: IEventBus,
    private readonly scheduleStore?: FileScheduleStore,
    private readonly checkIntervalMs: number = 60_000,
    startupGraceMs?: number,
  ) {
    this.startupGraceMs = startupGraceMs ?? 60_000;
  }

  /** Register a handler for system schedules with a matching tag.
   *  When a schedule fires and its task template has a matching tag,
   *  the handler is called instead of creating a generic task. */
  registerSystemHandler(tag: string, handler: () => Promise<void>): void {
    this.systemHandlers.set(tag, handler);
  }

  /** Register an in-memory schedule (legacy API, used when no persistent store) */
  register(
    schedule: SchedulePattern,
    taskTemplate: Omit<Task, 'id' | 'createdAt' | 'status'>,
  ): string {
    const id = crypto.randomUUID();
    this.memorySchedules.set(id, {
      id,
      schedule,
      taskTemplate,
      lastRun: null,
      enabled: true,
    });
    return id;
  }

  unregister(scheduleId: string): void {
    this.memorySchedules.delete(scheduleId);
  }

  async start(): Promise<void> {
    // Sync system schedules: seed missing, remove stale
    if (this.scheduleStore) {
      await this.syncSystemSchedules();
    }

    // Start ticking, but skip dispatch until agents are ready
    this.timer.cancelAndSet(() => this.tick(), this.checkIntervalMs);

    // Listen for agents to be ready before dispatching scheduled tasks.
    // Delay the first tick by a grace period so the renderer can stabilize
    // before heavy background work (reflection, code review) fires.
    this.unsubscribers.push(
      this.eventBus.on(Events.AGENTS_READY, () => {
        log.info(`Agents ready — scheduler will begin dispatching tasks in ${this.startupGraceMs / 1000}s`);
        setTimeout(() => {
          this.agentsReady = true;
          this.tick();
        }, this.startupGraceMs);
      }),
    );
  }

  stop(): void {
    this.timer.cancel();
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
  }

  async getSchedules(): Promise<ScheduledTask[]> {
    if (this.scheduleStore) {
      const persisted = await this.scheduleStore.list();
      return persisted.map((p) => ({
        id: p.id,
        schedule: p.pattern,
        taskTemplate: p.taskTemplate,
        lastRun: p.lastRun,
        enabled: p.enabled,
      }));
    }
    return Array.from(this.memorySchedules.values());
  }

  /**
   * Sync system schedules with the canonical SYSTEM_SCHEDULES list.
   * - Seeds missing schedules on first run
   * - Removes stale system schedules that no longer exist in code
   * - Preserves user-created and agent-created schedules untouched
   */
  private async syncSystemSchedules(): Promise<void> {
    if (!this.scheduleStore) return;

    const persisted = await this.scheduleStore.list();
    const systemSchedules = persisted.filter((s) => s.source === 'system');
    const expectedNames = new Set(SYSTEM_SCHEDULES.map((s) => s.name));

    // Remove stale system schedules (e.g., "Inbox Check" was removed from code)
    for (const existing of systemSchedules) {
      if (!expectedNames.has(existing.name)) {
        log.info(`Removing stale system schedule: "${existing.name}"`);
        // Force-delete by filtering directly (bypass the "cannot delete system" guard)
        await this.scheduleStore.forceDelete(existing.id);
      }
    }

    // Seed missing and update drifted system schedules
    const existingByName = new Map(systemSchedules.map((s) => [s.name, s]));
    for (const def of SYSTEM_SCHEDULES) {
      const existing = existingByName.get(def.name);
      if (!existing) {
        log.info(`Seeding system schedule: "${def.name}"`);
        await this.scheduleStore.create({
          name: def.name,
          pattern: def.pattern,
          taskTemplate: def.taskTemplate,
          enabled: def.enabled !== false,
          // Set lastRun to now so newly seeded schedules wait for the next
          // cron window instead of firing immediately on startup.
          lastRun: new Date().toISOString(),
          source: 'system',
        });
      } else if (JSON.stringify(existing.pattern) !== JSON.stringify(def.pattern)) {
        // Code-side pattern changed — update the persisted schedule to match
        log.info(`Updating system schedule pattern: "${def.name}" → ${def.pattern.cron ?? JSON.stringify(def.pattern)}`);
        await this.scheduleStore.update(existing.id, { pattern: def.pattern });
      }
    }
  }

  /**
   * Sync agent-defined cron entries from .cron.json into the schedule store.
   * - Creates new schedules for entries not yet persisted
   * - Updates schedules whose cron expression changed
   * - Removes schedules for entries no longer in .cron.json
   * - Respects enable/disable state from .cron.json
   */
  async syncAgentCronEntries(cronEntries: AgentCronEntry[]): Promise<void> {
    if (!this.scheduleStore) return;

    const persisted = await this.scheduleStore.list();
    const agentSchedules = persisted.filter((s) => s.source === 'agent');

    // Build lookup: "agentId:name" → persisted schedule
    const existingByKey = new Map(agentSchedules.map((s) => {
      // Extract agentId from taskTemplate.createdBy
      const key = `${s.taskTemplate.createdBy}:${s.name}`;
      return [key, s];
    }));

    // Track which persisted schedules are still active
    const activeKeys = new Set<string>();

    for (const entry of cronEntries) {
      const key = `${entry.agentId}:${entry.name}`;
      activeKeys.add(key);

      const existing = existingByKey.get(key);
      const pattern = { cron: entry.schedule };
      const taskTemplate = {
        title: `[cron] ${entry.name}`,
        description: `Run: ${entry.command}\nCwd: ${entry.cwd}`,
        priority: 'normal' as const,
        source: 'agent' as const,
        createdBy: entry.agentId,
        assignedTo: entry.agentId,
        tags: ['agent-cron'],
      };

      if (!existing) {
        log.info(`Syncing agent cron "${entry.name}" from ${entry.agentId}`);
        await this.scheduleStore.create({
          name: entry.name,
          pattern,
          taskTemplate,
          enabled: entry.enabled,
          lastRun: new Date().toISOString(), // don't fire immediately on first sync
          source: 'agent',
        });
      } else {
        // Update if schedule or enabled state changed
        const updates: Partial<Pick<PersistedSchedule, 'pattern' | 'enabled' | 'taskTemplate'>> = {};
        if (JSON.stringify(existing.pattern) !== JSON.stringify(pattern)) {
          updates.pattern = pattern;
        }
        if (existing.enabled !== entry.enabled) {
          updates.enabled = entry.enabled;
        }
        if (existing.taskTemplate.description !== taskTemplate.description) {
          updates.taskTemplate = { ...existing.taskTemplate, description: taskTemplate.description };
        }
        if (Object.keys(updates).length > 0) {
          log.info(`Updating agent cron "${entry.name}" from ${entry.agentId}`);
          await this.scheduleStore.update(existing.id, updates);
        }
      }
    }

    // Remove persisted agent schedules that are no longer in any .cron.json
    for (const existing of agentSchedules) {
      const key = `${existing.taskTemplate.createdBy}:${existing.name}`;
      if (!activeKeys.has(key)) {
        log.info(`Removing stale agent cron "${existing.name}" from ${existing.taskTemplate.createdBy}`);
        await this.scheduleStore.forceDelete(existing.id);
      }
    }
  }

  private async tick(): Promise<void> {
    // Skip dispatching until agents have fully initialized
    if (!this.agentsReady) {
      log.debug('Agents not ready — skipping tick');
      return;
    }

    const now = new Date();

    // Process persistent schedules
    if (this.scheduleStore) {
      const schedules = await this.scheduleStore.list();
      for (const entry of schedules) {
        if (!entry.enabled) continue;
        if (!this.isPersistedDue(entry, now)) continue;

        await this.scheduleStore.markRun(entry.id, now.toISOString());

        // Check for a registered handler (matched by task tag)
        const handlerTag = entry.taskTemplate.tags?.find((t) => this.systemHandlers.has(t));
        if (handlerTag) {
          const handler = this.systemHandlers.get(handlerTag)!;
          log.info(`Dispatching system handler for "${entry.name}" (tag: ${handlerTag})`);
          handler().catch((err) => log.error(`System handler "${handlerTag}" failed: ${String(err)}`));
          continue;
        }

        await this.createTaskFromTemplate(entry.taskTemplate, now);
      }
    }

    // Process in-memory schedules (backwards compat)
    for (const entry of this.memorySchedules.values()) {
      if (!entry.enabled) continue;
      if (!this.isMemoryDue(entry, now)) continue;

      entry.lastRun = now.toISOString();
      await this.createTaskFromTemplate(entry.taskTemplate, now);
    }
  }

  private async createTaskFromTemplate(
    template: Omit<Task, 'id' | 'createdAt' | 'status'>,
    now: Date,
  ): Promise<void> {
    // Skip if an active task with the same title already exists (prevents accumulation)
    const active = await this.taskStore.list({ status: 'pending' });
    const assigned = await this.taskStore.list({ status: 'assigned' });
    const running = await this.taskStore.list({ status: 'running' });
    const allActive = [...active, ...assigned, ...running];
    if (allActive.some((t) => t.title === template.title)) {
      log.debug(`Skipping "${template.title}" — active task with same title exists`);
      return;
    }

    const isSystemTask = template.source === 'system';
    const task = await this.taskStore.create({
      ...template,
      status: isSystemTask ? 'assigned' : 'pending',
      assignedTo: isSystemTask ? JAM_SYSTEM_AGENT_ID : template.assignedTo,
      createdAt: now.toISOString(),
    });
    this.eventBus.emit(Events.TASK_CREATED, { task });
  }

  private isPersistedDue(entry: PersistedSchedule, now: Date): boolean {
    return this.checkPattern(entry.pattern, entry.lastRun, now);
  }

  private isMemoryDue(entry: ScheduledTask, now: Date): boolean {
    return this.checkPattern(entry.schedule, entry.lastRun, now);
  }

  private checkPattern(
    pattern: SchedulePattern,
    lastRun: string | null,
    now: Date,
  ): boolean {
    // Cron expression takes priority
    if (pattern.cron) {
      if (!lastRun) return true; // Never run — fire immediately
      // Check if there was a scheduled run between lastRun and now that we missed
      const from = new Date(lastRun);
      const next = nextCronRun(pattern.cron, from);
      return next !== null && next.getTime() <= now.getTime();
    }

    // Interval-based
    if (pattern.intervalMs) {
      if (!lastRun) return true;
      const elapsed = now.getTime() - new Date(lastRun).getTime();
      return elapsed >= pattern.intervalMs;
    }

    // Time-based (hour + minute) — build an equivalent cron and use the same logic
    if (pattern.hour !== undefined && pattern.minute !== undefined) {
      const dow = pattern.dayOfWeek !== undefined ? String(pattern.dayOfWeek) : '*';
      const cron = `${pattern.minute} ${pattern.hour} * * ${dow}`;
      if (!lastRun) return true;
      const from = new Date(lastRun);
      const next = nextCronRun(cron, from);
      return next !== null && next.getTime() <= now.getTime();
    }

    return false;
  }
}
