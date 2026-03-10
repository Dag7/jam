import { readFile, appendFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger } from '@jam/core';
import type { IEventBus } from '@jam/core';
import { Events } from '@jam/core';
import { randomBytes } from 'node:crypto';

const log = createLogger('FileBlackboard');

/** An artifact published to the team blackboard */
export interface BlackboardArtifact {
  id: string;
  agentId: string;
  topic: string;
  type: 'text' | 'diff' | 'json' | 'file-ref';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * File-based blackboard for inter-agent artifact sharing.
 *
 * Agents publish artifacts to named topics. Other agents can read
 * artifacts from topics they're interested in. Storage is append-only
 * JSONL files organized by topic.
 *
 * Storage layout: `{baseDir}/blackboard/{topic}/artifacts.jsonl`
 */
export class FileBlackboard {
  private readonly baseDir: string;
  private readonly watchers = new Map<string, Array<(artifact: BlackboardArtifact) => void>>();

  constructor(
    teamDir: string,
    private readonly eventBus?: IEventBus,
  ) {
    this.baseDir = join(teamDir, 'blackboard');
  }

  /** Publish an artifact to a topic */
  async publish(agentId: string, topic: string, artifact: Omit<BlackboardArtifact, 'id' | 'agentId' | 'topic' | 'timestamp'>): Promise<BlackboardArtifact> {
    const topicDir = join(this.baseDir, this.sanitizeTopic(topic));
    await mkdir(topicDir, { recursive: true });

    const full: BlackboardArtifact = {
      id: randomBytes(8).toString('hex'),
      agentId,
      topic,
      timestamp: new Date().toISOString(),
      ...artifact,
    };

    const filePath = join(topicDir, 'artifacts.jsonl');
    await appendFile(filePath, JSON.stringify(full) + '\n', 'utf-8');

    log.info(`Published to "${topic}" by ${agentId.slice(0, 8)}: ${artifact.type}`);

    // Emit event for reactive listeners
    this.eventBus?.emit(Events.BLACKBOARD_PUBLISHED, {
      agentId,
      topic,
      artifactId: full.id,
    });

    // Notify topic watchers
    const handlers = this.watchers.get(topic);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(full); } catch { /* ignore handler errors */ }
      }
    }

    return full;
  }

  /** Read artifacts from a topic (most recent first) */
  async read(topic: string, limit = 50): Promise<BlackboardArtifact[]> {
    const filePath = join(this.baseDir, this.sanitizeTopic(topic), 'artifacts.jsonl');
    if (!existsSync(filePath)) return [];

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      const artifacts: BlackboardArtifact[] = [];
      for (const line of lines) {
        try {
          artifacts.push(JSON.parse(line));
        } catch { /* skip malformed lines */ }
      }

      // Return most recent first, limited
      return artifacts.reverse().slice(0, limit);
    } catch {
      return [];
    }
  }

  /** Watch a topic for new artifacts. Returns unsubscribe function. */
  watch(topic: string, handler: (artifact: BlackboardArtifact) => void): () => void {
    const handlers = this.watchers.get(topic) ?? [];
    handlers.push(handler);
    this.watchers.set(topic, handlers);

    return () => {
      const current = this.watchers.get(topic);
      if (current) {
        const idx = current.indexOf(handler);
        if (idx >= 0) current.splice(idx, 1);
        if (current.length === 0) this.watchers.delete(topic);
      }
    };
  }

  /** List all topics that have artifacts */
  async listTopics(): Promise<string[]> {
    if (!existsSync(this.baseDir)) return [];

    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /** Sanitize topic name for filesystem use */
  private sanitizeTopic(topic: string): string {
    return topic
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'default';
  }
}
