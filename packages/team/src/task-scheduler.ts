import type { Task, ITaskStore, IEventBus } from '@jam/core';
import { Events, createLogger, JAM_SYSTEM_AGENT_ID } from '@jam/core';
import { nextCronRun } from './cron-parser.js';
import type { FileScheduleStore, PersistedSchedule } from './stores/file-schedule-store.js';

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
    pattern: { cron: '0 */3 * * *' },
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
    pattern: { cron: '0 */6 * * *' },
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
  {
    name: 'Inbox Check',
    pattern: { cron: '0 */3 * * *' },
    taskTemplate: {
      title: 'Inbox Check',
      description: 'Scan agent inboxes for new commands or messages and process them.',
      priority: 'low',
      source: 'system',
      createdBy: 'system',
      tags: ['inbox'],
    },
    enabled: false,
  },
];

export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** In-memory fallback for backwards compatibility (used when no store provided) */
  private readonly memorySchedules: Map<string, ScheduledTask> = new Map();

  constructor(
    private readonly taskStore: ITaskStore,
    private readonly eventBus: IEventBus,
    private readonly scheduleStore?: FileScheduleStore,
    private readonly checkIntervalMs: number = 60_000,
  ) {}

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
    if (this.timer) return;

    // Sync system schedules: seed missing, remove stale
    if (this.scheduleStore) {
      await this.syncSystemSchedules();
    }

    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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

    // Seed any missing system schedules
    const existingNames = new Set(systemSchedules.map((s) => s.name));
    for (const def of SYSTEM_SCHEDULES) {
      if (!existingNames.has(def.name)) {
        log.info(`Seeding system schedule: "${def.name}"`);
        await this.scheduleStore.create({
          name: def.name,
          pattern: def.pattern,
          taskTemplate: def.taskTemplate,
          enabled: def.enabled !== false,
          lastRun: null,
          source: 'system',
        });
      }
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();

    // Process persistent schedules
    if (this.scheduleStore) {
      const schedules = await this.scheduleStore.list();
      for (const entry of schedules) {
        if (!entry.enabled) continue;
        if (!this.isPersistedDue(entry, now)) continue;

        await this.scheduleStore.markRun(entry.id, now.toISOString());
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
