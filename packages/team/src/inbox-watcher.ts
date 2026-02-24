import { watch, type FSWatcher } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ITaskStore, IEventBus } from '@jam/core';
import { Events, createLogger } from '@jam/core';

const log = createLogger('InboxWatcher');

/**
 * Watches agent inbox files for new task requests.
 * Agents can self-create or delegate tasks by appending JSONL to
 * `{agentCwd}/inbox.jsonl`.
 */
export class InboxWatcher {
  private watchers: Map<string, FSWatcher> = new Map();
  private offsets: Map<string, number> = new Map();

  constructor(
    private readonly taskStore: ITaskStore,
    private readonly eventBus: IEventBus,
  ) {}

  watchAgent(agentId: string, cwd: string): void {
    if (this.watchers.has(agentId)) return;

    const inboxPath = join(cwd, 'inbox.jsonl');
    this.offsets.set(inboxPath, 0);

    try {
      const watcher = watch(inboxPath, () => {
        this.processInbox(agentId, inboxPath);
      });
      this.watchers.set(agentId, watcher);
    } catch {
      // File may not exist yet — that's fine, we'll create on first write
    }
  }

  unwatchAgent(agentId: string): void {
    const watcher = this.watchers.get(agentId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(agentId);
    }
  }

  stopAll(): void {
    for (const [id] of this.watchers) {
      this.unwatchAgent(id);
    }
  }

  private async processInbox(
    agentId: string,
    inboxPath: string,
  ): Promise<void> {
    try {
      const content = await readFile(inboxPath, 'utf-8');
      const offset = this.offsets.get(inboxPath) ?? 0;
      const newContent = content.slice(offset);
      this.offsets.set(inboxPath, content.length);

      const lines = newContent.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const request = JSON.parse(line) as {
            title: string;
            description: string;
            priority?: string;
            assignedTo?: string;
            from?: string;
            tags?: string[];
          };

          // `from` is the sender agent ID; falls back to inbox owner
          const sender = request.from || agentId;

          const task = await this.taskStore.create({
            title: request.title,
            description: request.description || '',
            status: request.assignedTo ? 'assigned' : 'pending',
            priority: (request.priority as 'low' | 'normal' | 'high' | 'critical') ?? 'normal',
            source: 'agent',
            createdBy: sender,
            assignedTo: request.assignedTo || agentId,
            createdAt: new Date().toISOString(),
            tags: request.tags ?? [],
          });

          this.eventBus.emit(Events.TASK_CREATED, { task });

          // Notify UI about the inbox message
          log.info(`Inbox task from ${sender} → ${agentId}: "${request.title}"`);
          this.eventBus.emit('task:resultReady', {
            taskId: task.id,
            agentId: sender,
            title: request.title,
            text: `Delegated task to ${agentId}: "${request.title}"`,
            success: true,
          });
        } catch {
          // skip malformed lines
        }
      }

      // Clear processed inbox
      if (lines.length > 0) {
        await writeFile(inboxPath, '', 'utf-8');
        this.offsets.set(inboxPath, 0);
      }
    } catch {
      // inbox file may not exist yet
    }
  }
}
