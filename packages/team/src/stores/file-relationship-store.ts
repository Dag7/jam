import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentRelationship, IRelationshipStore } from '@jam/core';

const TRUST_ALPHA = 0.15;

export class FileRelationshipStore implements IRelationshipStore {
  private readonly baseDir: string;
  private cache: Map<string, AgentRelationship[]> = new Map();

  constructor(baseDir: string) {
    this.baseDir = join(baseDir, 'relationships');
  }

  async get(
    sourceAgentId: string,
    targetAgentId: string,
  ): Promise<AgentRelationship | null> {
    const rels = await this.loadForAgent(sourceAgentId);
    return rels.find((r) => r.targetAgentId === targetAgentId) ?? null;
  }

  async set(relationship: AgentRelationship): Promise<void> {
    const rels = await this.loadForAgent(relationship.sourceAgentId);
    const idx = rels.findIndex(
      (r) => r.targetAgentId === relationship.targetAgentId,
    );
    if (idx >= 0) {
      rels[idx] = relationship;
    } else {
      rels.push(relationship);
    }
    await this.saveForAgent(relationship.sourceAgentId, rels);
  }

  async getAll(agentId: string): Promise<AgentRelationship[]> {
    return this.loadForAgent(agentId);
  }

  async updateTrust(
    sourceAgentId: string,
    targetAgentId: string,
    outcome: 'success' | 'failure',
    weight = 1.0,
  ): Promise<AgentRelationship> {
    let rel = await this.get(sourceAgentId, targetAgentId);

    if (!rel) {
      rel = {
        sourceAgentId,
        targetAgentId,
        trustScore: 0.5,
        interactionCount: 0,
        lastInteraction: new Date().toISOString(),
        delegationCount: 0,
        delegationSuccessRate: 0,
        notes: [],
      };
    }

    const outcomeValue = outcome === 'success' ? 1.0 : 0.0;
    const alpha = TRUST_ALPHA * weight;
    rel.trustScore = Math.max(
      0,
      Math.min(1, alpha * outcomeValue + (1 - alpha) * rel.trustScore),
    );
    rel.interactionCount++;
    rel.lastInteraction = new Date().toISOString();

    if (outcome === 'success' || outcome === 'failure') {
      rel.delegationCount++;
      const successes = Math.round(
        rel.delegationSuccessRate * (rel.delegationCount - 1),
      );
      rel.delegationSuccessRate =
        (successes + (outcome === 'success' ? 1 : 0)) / rel.delegationCount;
    }

    await this.set(rel);
    return rel;
  }

  private async loadForAgent(agentId: string): Promise<AgentRelationship[]> {
    if (this.cache.has(agentId)) {
      return this.cache.get(agentId)!;
    }

    const filePath = join(this.baseDir, `${agentId}.json`);
    try {
      const data = await readFile(filePath, 'utf-8');
      const rels: AgentRelationship[] = JSON.parse(data);
      this.cache.set(agentId, rels);
      return rels;
    } catch {
      const empty: AgentRelationship[] = [];
      this.cache.set(agentId, empty);
      return empty;
    }
  }

  private async saveForAgent(
    agentId: string,
    rels: AgentRelationship[],
  ): Promise<void> {
    this.cache.set(agentId, rels);
    await mkdir(this.baseDir, { recursive: true });
    const filePath = join(this.baseDir, `${agentId}.json`);
    await writeFile(filePath, JSON.stringify(rels, null, 2), 'utf-8');
  }
}
