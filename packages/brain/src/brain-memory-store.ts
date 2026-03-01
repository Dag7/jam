import type { AgentId, AgentMemory, SessionEntry, IMemoryStore } from '@jam/core';
import type { BrainClient, BrainSearchResult } from './brain-client.js';

export interface BrainMemoryStoreConfig {
  inner: IMemoryStore;
  client: BrainClient;
}

/**
 * Decorator around an existing IMemoryStore that also ingests session
 * entries into Kalanu Brain for semantic recall and consolidation.
 *
 * - load/save/getSessionHistory delegate to the inner store unchanged.
 * - appendSession delegates to the inner store AND ingests into Brain.
 * - searchMemory and consolidate are Brain-specific extensions.
 */
export class BrainMemoryStore implements IMemoryStore {
  private readonly inner: IMemoryStore;
  private readonly client: BrainClient;

  constructor(config: BrainMemoryStoreConfig) {
    this.inner = config.inner;
    this.client = config.client;
  }

  async load(agentId: AgentId): Promise<AgentMemory | null> {
    return this.inner.load(agentId);
  }

  async save(agentId: AgentId, memory: AgentMemory): Promise<void> {
    return this.inner.save(agentId, memory);
  }

  async appendSession(agentId: AgentId, entry: SessionEntry): Promise<void> {
    await this.inner.appendSession(agentId, entry);

    // Fire-and-forget: ingest into Brain without blocking the session
    this.client.ingest(agentId, entry.content, entry.type).catch(() => {});
  }

  async getSessionHistory(
    agentId: AgentId,
    limit?: number,
  ): Promise<SessionEntry[]> {
    return this.inner.getSessionHistory(agentId, limit);
  }

  /** Search Brain for semantically relevant memories. */
  async searchMemory(
    agentId: AgentId,
    query: string,
    limit = 5,
  ): Promise<BrainSearchResult[]> {
    return this.client.search(agentId, query, limit);
  }

  /** Trigger consolidation to distill episodic memories into knowledge. */
  async consolidate(agentId: AgentId): Promise<void> {
    return this.client.consolidate(agentId);
  }
}
