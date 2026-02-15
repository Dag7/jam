import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, AgentMemory, SessionEntry, IMemoryStore } from '@jam/core';

export class FileMemoryStore implements IMemoryStore {
  constructor(private baseDir: string) {}

  async load(agentId: AgentId): Promise<AgentMemory | null> {
    const filePath = join(this.baseDir, agentId, 'memory.json');
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as AgentMemory;
    } catch {
      return null;
    }
  }

  async save(agentId: AgentId, memory: AgentMemory): Promise<void> {
    const dir = join(this.baseDir, agentId);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, 'memory.json');
    await writeFile(filePath, JSON.stringify(memory, null, 2), 'utf-8');
  }

  async appendSession(
    agentId: AgentId,
    entry: SessionEntry,
  ): Promise<void> {
    const dir = join(this.baseDir, agentId, 'sessions');
    await mkdir(dir, { recursive: true });

    const today = new Date().toISOString().split('T')[0];
    const filePath = join(dir, `${today}.jsonl`);
    const line = JSON.stringify(entry) + '\n';

    const { appendFile } = await import('node:fs/promises');
    await appendFile(filePath, line, 'utf-8');
  }

  async getSessionHistory(
    agentId: AgentId,
    limit = 100,
  ): Promise<SessionEntry[]> {
    const { readdir } = await import('node:fs/promises');
    const dir = join(this.baseDir, agentId, 'sessions');

    try {
      const files = await readdir(dir);
      const jsonlFiles = files
        .filter((f) => f.endsWith('.jsonl'))
        .sort()
        .reverse();

      const entries: SessionEntry[] = [];

      for (const file of jsonlFiles) {
        if (entries.length >= limit) break;

        const content = await readFile(join(dir, file), 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);

        for (const line of lines.reverse()) {
          if (entries.length >= limit) break;
          try {
            entries.push(JSON.parse(line));
          } catch {
            // Skip malformed lines
          }
        }
      }

      return entries;
    } catch {
      return [];
    }
  }
}
