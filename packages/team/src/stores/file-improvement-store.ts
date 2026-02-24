import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger } from '@jam/core';
import type { CodeImprovement, ImprovementStatus } from '@jam/core';

const log = createLogger('FileImprovementStore');

export interface ImprovementFilter {
  status?: ImprovementStatus;
  agentId?: string;
}

/**
 * File-based persistence for code improvement history.
 * Stores all improvements (including failed/rolled-back) for learning.
 */
export class FileImprovementStore {
  private improvements: CodeImprovement[] = [];
  private loaded = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, 'improvements', 'improvements.json');
  }

  async list(filter?: ImprovementFilter): Promise<CodeImprovement[]> {
    await this.ensureLoaded();
    let results = [...this.improvements];

    if (filter?.status) {
      results = results.filter((i) => i.status === filter.status);
    }
    if (filter?.agentId) {
      results = results.filter((i) => i.agentId === filter.agentId);
    }

    return results.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async get(id: string): Promise<CodeImprovement | null> {
    await this.ensureLoaded();
    return this.improvements.find((i) => i.id === id) ?? null;
  }

  async create(
    data: Omit<CodeImprovement, 'id' | 'createdAt'>,
  ): Promise<CodeImprovement> {
    await this.ensureLoaded();

    const improvement: CodeImprovement = {
      ...data,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };

    this.improvements.push(improvement);
    this.debouncedWrite();
    return improvement;
  }

  async update(
    id: string,
    updates: Partial<CodeImprovement>,
  ): Promise<CodeImprovement> {
    await this.ensureLoaded();

    const idx = this.improvements.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`Improvement not found: ${id}`);

    this.improvements[idx] = { ...this.improvements[idx], ...updates };
    this.debouncedWrite();
    return this.improvements[idx];
  }

  /** Count improvements created today (for rate limiting) */
  async countToday(): Promise<number> {
    await this.ensureLoaded();
    const today = new Date().toISOString().slice(0, 10);
    return this.improvements.filter((i) => i.createdAt.startsWith(today)).length;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    if (existsSync(this.filePath)) {
      try {
        const raw = await readFile(this.filePath, 'utf-8');
        this.improvements = JSON.parse(raw);
      } catch (error) {
        log.warn(`Failed to load improvements: ${String(error)}`);
        this.improvements = [];
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
      await writeFile(this.filePath, JSON.stringify(this.improvements, null, 2), 'utf-8');
    } catch (error) {
      log.error(`Failed to write improvements: ${String(error)}`);
    }
  }
}
