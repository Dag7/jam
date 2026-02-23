import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Task, ITaskStore, TaskFilter } from '@jam/core';

export class FileTaskStore implements ITaskStore {
  private readonly filePath: string;
  private cache: Map<string, Task> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, 'tasks', 'tasks.json');
  }

  async create(input: Omit<Task, 'id'>): Promise<Task> {
    const tasks = await this.loadCache();
    const task: Task = { ...input, id: randomUUID() };
    tasks.set(task.id, task);
    this.scheduleFlush();
    return task;
  }

  async get(taskId: string): Promise<Task | null> {
    const tasks = await this.loadCache();
    return tasks.get(taskId) ?? null;
  }

  async update(taskId: string, updates: Partial<Task>): Promise<Task> {
    const tasks = await this.loadCache();
    const existing = tasks.get(taskId);
    if (!existing) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const updated = { ...existing, ...updates, id: taskId };
    tasks.set(taskId, updated);
    this.scheduleFlush();
    return updated;
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    const tasks = await this.loadCache();
    let result = Array.from(tasks.values());

    if (filter) {
      if (filter.status) {
        result = result.filter((t) => t.status === filter.status);
      }
      if (filter.assignedTo) {
        result = result.filter((t) => t.assignedTo === filter.assignedTo);
      }
      if (filter.createdBy) {
        result = result.filter((t) => t.createdBy === filter.createdBy);
      }
      if (filter.source) {
        result = result.filter((t) => t.source === filter.source);
      }
    }

    return result;
  }

  async delete(taskId: string): Promise<void> {
    const tasks = await this.loadCache();
    tasks.delete(taskId);
    this.scheduleFlush();
  }

  private async loadCache(): Promise<Map<string, Task>> {
    if (this.cache) return this.cache;

    try {
      const data = await readFile(this.filePath, 'utf-8');
      const arr: Task[] = JSON.parse(data);
      this.cache = new Map(arr.map((t) => [t.id, t]));
    } catch {
      this.cache = new Map();
    }
    return this.cache;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 500);
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (!this.cache) return;

    const dir = join(this.filePath, '..');
    await mkdir(dir, { recursive: true });
    const arr = Array.from(this.cache.values());
    await writeFile(this.filePath, JSON.stringify(arr, null, 2), 'utf-8');
  }
}
