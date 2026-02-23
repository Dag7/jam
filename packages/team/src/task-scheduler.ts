import { randomUUID } from 'node:crypto';
import type { Task, ITaskStore, IEventBus } from '@jam/core';
import { Events } from '@jam/core';

export interface SchedulePattern {
  /** Run every N milliseconds */
  intervalMs?: number;
  /** Run at specific hour (0-23) */
  hour?: number;
  /** Run at specific minute (0-59) */
  minute?: number;
  /** Day of week (0=Sun, 6=Sat). If omitted, runs daily. */
  dayOfWeek?: number;
}

export interface ScheduledTask {
  id: string;
  schedule: SchedulePattern;
  taskTemplate: Omit<Task, 'id' | 'createdAt' | 'status'>;
  lastRun: string | null;
  enabled: boolean;
}

const CHECK_INTERVAL_MS = 60_000; // check every minute

export class TaskScheduler {
  private readonly schedules: Map<string, ScheduledTask> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly taskStore: ITaskStore,
    private readonly eventBus: IEventBus,
  ) {}

  register(
    schedule: SchedulePattern,
    taskTemplate: Omit<Task, 'id' | 'createdAt' | 'status'>,
  ): string {
    const id = randomUUID();
    this.schedules.set(id, {
      id,
      schedule,
      taskTemplate,
      lastRun: null,
      enabled: true,
    });
    return id;
  }

  unregister(scheduleId: string): void {
    this.schedules.delete(scheduleId);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL_MS);
    // also run immediately
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSchedules(): ScheduledTask[] {
    return Array.from(this.schedules.values());
  }

  private async tick(): Promise<void> {
    const now = new Date();

    for (const entry of this.schedules.values()) {
      if (!entry.enabled) continue;
      if (!this.isDue(entry, now)) continue;

      entry.lastRun = now.toISOString();

      const task = await this.taskStore.create({
        ...entry.taskTemplate,
        status: 'pending',
        createdAt: now.toISOString(),
      });

      this.eventBus.emit(Events.TASK_CREATED, { task });
    }
  }

  private isDue(entry: ScheduledTask, now: Date): boolean {
    const { schedule, lastRun } = entry;

    if (schedule.intervalMs) {
      if (!lastRun) return true;
      const elapsed = now.getTime() - new Date(lastRun).getTime();
      return elapsed >= schedule.intervalMs;
    }

    if (schedule.hour !== undefined && schedule.minute !== undefined) {
      // Time-based schedule
      if (schedule.dayOfWeek !== undefined && now.getDay() !== schedule.dayOfWeek) {
        return false;
      }

      if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) {
        return false;
      }

      // Already ran this minute?
      if (lastRun) {
        const lastDate = new Date(lastRun);
        if (
          lastDate.getFullYear() === now.getFullYear() &&
          lastDate.getMonth() === now.getMonth() &&
          lastDate.getDate() === now.getDate() &&
          lastDate.getHours() === now.getHours() &&
          lastDate.getMinutes() === now.getMinutes()
        ) {
          return false;
        }
      }

      return true;
    }

    return false;
  }
}
