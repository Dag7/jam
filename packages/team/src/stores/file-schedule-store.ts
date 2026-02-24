import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger } from '@jam/core';
import type { SchedulePattern } from '../task-scheduler.js';
import type { Task } from '@jam/core';

const log = createLogger('FileScheduleStore');

export type ScheduleSource = 'system' | 'user' | 'agent';

export interface PersistedSchedule {
  id: string;
  name: string;
  pattern: SchedulePattern;
  taskTemplate: Omit<Task, 'id' | 'createdAt' | 'status'>;
  enabled: boolean;
  lastRun: string | null;
  source: ScheduleSource;
  createdAt: string;
}

/**
 * File-based persistence for schedules.
 * Follows the same pattern as FileTaskStore: in-memory cache + debounced writes.
 */
export class FileScheduleStore {
  private schedules: PersistedSchedule[] = [];
  private loaded = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, 'schedules', 'schedules.json');
  }

  async list(): Promise<PersistedSchedule[]> {
    await this.ensureLoaded();
    return [...this.schedules];
  }

  async get(id: string): Promise<PersistedSchedule | null> {
    await this.ensureLoaded();
    return this.schedules.find((s) => s.id === id) ?? null;
  }

  async create(
    data: Omit<PersistedSchedule, 'id' | 'createdAt'>,
  ): Promise<PersistedSchedule> {
    await this.ensureLoaded();

    const schedule: PersistedSchedule = {
      ...data,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    this.schedules.push(schedule);
    this.debouncedWrite();
    return schedule;
  }

  async update(
    id: string,
    updates: Partial<Pick<PersistedSchedule, 'pattern' | 'enabled' | 'lastRun' | 'name'>>,
  ): Promise<PersistedSchedule> {
    await this.ensureLoaded();

    const idx = this.schedules.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`Schedule not found: ${id}`);

    this.schedules[idx] = { ...this.schedules[idx], ...updates };
    this.debouncedWrite();
    return this.schedules[idx];
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded();

    const schedule = this.schedules.find((s) => s.id === id);
    if (!schedule) return;
    if (schedule.source === 'system') {
      throw new Error('Cannot delete system schedules — disable them instead');
    }

    this.schedules = this.schedules.filter((s) => s.id !== id);
    this.debouncedWrite();
  }

  /** Remove a schedule regardless of source. Used by TaskScheduler to sync stale system schedules. */
  async forceDelete(id: string): Promise<void> {
    await this.ensureLoaded();
    this.schedules = this.schedules.filter((s) => s.id !== id);
    this.debouncedWrite();
  }

  async isEmpty(): Promise<boolean> {
    await this.ensureLoaded();
    return this.schedules.length === 0;
  }

  /** Update lastRun without the full update overhead */
  async markRun(id: string, timestamp: string): Promise<void> {
    await this.ensureLoaded();
    const schedule = this.schedules.find((s) => s.id === id);
    if (schedule) {
      schedule.lastRun = timestamp;
      this.debouncedWrite();
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    if (existsSync(this.filePath)) {
      try {
        const raw = await readFile(this.filePath, 'utf-8');
        this.schedules = JSON.parse(raw);
      } catch (error) {
        log.warn(`Failed to load schedules: ${String(error)}`);
        this.schedules = [];
      }
    }

    this.loaded = true;
  }

  private debouncedWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 500);
  }

  private async flush(): Promise<void> {
    try {
      const dir = join(this.filePath, '..');
      await mkdir(dir, { recursive: true });
      await writeFile(this.filePath, JSON.stringify(this.schedules, null, 2), 'utf-8');
    } catch (error) {
      log.error(`Failed to write schedules: ${String(error)}`);
    }
  }
}
