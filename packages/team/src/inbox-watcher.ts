import { watch, type FSWatcher } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ITaskStore, IEventBus, AgentProfile } from '@jam/core';
import { Events, createLogger } from '@jam/core';
import { DebouncedFileWriter } from './utils/debounced-writer.js';

const log = createLogger('InboxWatcher');

/**
 * Watches agent inbox files for new task requests.
 * Agents can self-create or delegate tasks by appending JSONL to
 * `{agentCwd}/inbox.jsonl`.
 */
export class InboxWatcher {
  private watchers: Map<string, FSWatcher> = new Map();
  private offsets: Map<string, number> = new Map();
  /** Per-path debounce — coalesces rapid fs events into a single processInbox call */
  private debouncers: Map<string, DebouncedFileWriter> = new Map();
  /** Guard flag to ignore watch events caused by our own writes */
  private processing: Set<string> = new Set();

  constructor(
    private readonly taskStore: ITaskStore,
    private readonly eventBus: IEventBus,
    private readonly onCreateAgent?: (input: Omit<AgentProfile, 'id'>) =>
      { success: boolean; agentId?: string; error?: string },
  ) {}

  watchAgent(agentId: string, cwd: string): void {
    if (this.watchers.has(agentId)) return;

    const inboxPath = join(cwd, 'inbox.jsonl');
    this.offsets.set(inboxPath, 0);

    try {
      const debouncer = new DebouncedFileWriter(100);
      this.debouncers.set(inboxPath, debouncer);

      const watcher = watch(inboxPath, () => {
        // Skip events triggered by our own writes
        if (this.processing.has(inboxPath)) return;
        debouncer.schedule(() => this.processInbox(agentId, inboxPath));
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
    for (const debouncer of this.debouncers.values()) {
      debouncer.cancel();
    }
    this.debouncers.clear();
    this.processing.clear();
  }

  private handleCreateAgent(request: Record<string, unknown>): void {
    if (!this.onCreateAgent) {
      log.warn('create-agent request received but no handler configured');
      return;
    }

    const name = request.name as string | undefined;
    if (!name) {
      log.warn('create-agent: missing required "name" field');
      return;
    }

    const result = this.onCreateAgent({
      name,
      runtime: (request.runtime as string) || 'claude-code',
      model: request.model as string | undefined,
      systemPrompt: request.systemPrompt as string | undefined,
      color: (request.color as string) || '#3b82f6',
      voice: (request.voice as { ttsVoiceId: string }) || { ttsVoiceId: 'onyx' },
      cwd: request.cwd as string | undefined,
      autoStart: request.autoStart as boolean | undefined,
    });

    if (result.success) {
      log.info(`Created agent "${name}" via inbox (${result.agentId})`);
    } else {
      log.warn(`Failed to create agent "${name}" via inbox: ${result.error}`);
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
        // Skip non-JSON lines — agents sometimes write plain text to inbox
        if (!line.startsWith('{')) continue;

        try {
          const request = JSON.parse(line) as {
            type?: string;
            title?: string;
            subject?: string;     // alias for title
            description?: string;
            body?: string;        // alias for description
            content?: string;     // alias for description
            priority?: string;
            assignedTo?: string;
            from?: string;
            tags?: string[];
          };

          // Handle agent creation requests
          if (request.type === 'create-agent') {
            this.handleCreateAgent(request as Record<string, unknown>);
            continue;
          }

          // Handle blackboard publish requests
          if (request.type === 'blackboard:publish') {
            const req = request as Record<string, unknown>;
            this.eventBus.emit('inbox:blackboard:publish', {
              agentId,
              topic: (req.topic as string) || 'default',
              artifactType: (req.artifactType as string) || 'text',
              content: req.content || req.body || req.description || '',
              metadata: req.metadata,
            });
            continue;
          }

          // Handle task negotiation requests
          if (request.type === 'task:negotiate') {
            const req = request as Record<string, unknown>;
            this.eventBus.emit('inbox:task:negotiate', {
              agentId,
              taskId: req.taskId as string,
              action: req.action as string,
              reason: (req.reason as string) || '',
            });
            continue;
          }

          // Accept common aliases so agents using subject/body don't create Untitled tasks
          const description = request.description || request.body || request.content || '';

          // Derive title: use explicit title/subject, or extract first line of description
          let title = request.title || request.subject;
          if (!title || title === 'undefined') {
            const firstLine = description.split('\n')[0]?.trim() ?? '';
            title = firstLine.length > 0
              ? firstLine.slice(0, 100)
              : 'Untitled task';
            log.warn(`Inbox entry missing title, derived: "${title}"`);
          }

          // `from` is the sender agent ID; falls back to inbox owner
          const sender = request.from || agentId;

          // assignedTo defaults to inbox owner — always 'assigned' so TaskExecutor picks it up
          const assignee = request.assignedTo || agentId;
          const task = await this.taskStore.create({
            title,
            description,
            status: 'assigned',
            priority: (request.priority as 'low' | 'normal' | 'high' | 'critical') ?? 'normal',
            source: 'agent',
            createdBy: sender,
            assignedTo: assignee,
            createdAt: new Date().toISOString(),
            tags: request.tags ?? [],
          });

          this.eventBus.emit(Events.TASK_CREATED, { task });

          // Notify UI about the inbox message
          log.info(`Inbox task from ${sender} → ${agentId}: "${title}"`);
          this.eventBus.emit('task:resultReady', {
            taskId: task.id,
            agentId: sender,
            title,
            text: `Delegated task to ${agentId}: "${title}"`,
            success: true,
          });
        } catch (err) {
          // Silently skip — malformed JSON in inbox is expected (agent text output)
        }
      }

      // Clear processed inbox (guard to prevent re-triggering watcher)
      if (lines.length > 0) {
        this.processing.add(inboxPath);
        await writeFile(inboxPath, '', 'utf-8');
        this.offsets.set(inboxPath, 0);
        // Release guard after fs-watcher events from our write settle.
        // Two macrotask ticks via setImmediate is enough for the watcher to fire and be ignored.
        setImmediate(() => {
          setImmediate(() => this.processing.delete(inboxPath));
        });
      }
    } catch (err) {
      log.debug(`Inbox not yet available for ${agentId}: ${String(err)}`);
    }
  }
}
