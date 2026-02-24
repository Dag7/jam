import type { Task, AgentRelationship, AgentStats, SoulStructure, AgentProfile } from '@jam/core';

export interface ITaskAssigner {
  assign(
    task: Task,
    agents: AgentProfile[],
    relationships: Map<string, AgentRelationship[]>,
    stats: Map<string, AgentStats>,
    souls: Map<string, SoulStructure>,
    runningTaskCounts: Map<string, number>,
  ): string | null;
}

export class SmartTaskAssigner implements ITaskAssigner {
  assign(
    task: Task,
    agents: AgentProfile[],
    relationships: Map<string, AgentRelationship[]>,
    stats: Map<string, AgentStats>,
    _souls: Map<string, SoulStructure>,
    runningTaskCounts: Map<string, number>,
  ): string | null {
    if (agents.length === 0) return null;

    // Collect all candidates with scores for fair tiebreaking
    const candidates: Array<{ id: string; score: number }> = [];

    for (const agent of agents) {
      const agentStats = stats.get(agent.id);
      const runningTasks = runningTaskCounts.get(agent.id) ?? 0;

      // Skip agents that are already busy (max 2 concurrent tasks)
      if (runningTasks >= 2) continue;

      let score = 0;

      // Success rate factor (0-40 points)
      if (agentStats) {
        const total = agentStats.tasksCompleted + agentStats.tasksFailed;
        const successRate = total > 0 ? agentStats.tasksCompleted / total : 0.5;
        score += successRate * 40;
      } else {
        score += 20; // neutral for new agents
      }

      // Trust factor (0-30 points) — average trust from all relationships
      const rels = relationships.get(agent.id);
      if (rels && rels.length > 0) {
        const avgTrust =
          rels.reduce((sum, r) => sum + r.trustScore, 0) / rels.length;
        score += avgTrust * 30;
      } else {
        score += 15; // neutral for new agents
      }

      // Load factor (0-20 points) — prefer less busy agents
      score += Math.max(0, (2 - runningTasks) * 10);

      // Streak bonus (0-10 points)
      if (agentStats?.streaks.current) {
        score += Math.min(10, agentStats.streaks.current * 2);
      }

      candidates.push({ id: agent.id, score });
    }

    if (candidates.length === 0) return null;

    // Find max score, then randomly pick among tied candidates
    const maxScore = Math.max(...candidates.map((c) => c.score));
    const tied = candidates.filter((c) => c.score === maxScore);
    return tied[Math.floor(Math.random() * tied.length)].id;
  }
}
