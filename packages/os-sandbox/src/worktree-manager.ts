import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { createLogger } from '@jam/core';
import type { WorktreeInfo, WorktreeConfig } from './types.js';

const execFileAsync = promisify(execFile);
const log = createLogger('WorktreeManager');

/**
 * Manages git worktrees for per-agent file isolation.
 *
 * When agents work on a git repository, each gets its own worktree
 * so they can modify files freely without conflicting. Merging is
 * explicit and user-controlled via the MergeService.
 */
export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();

  constructor(private readonly config: WorktreeConfig) {}

  /** Create a worktree for an agent working on a specific repo */
  async create(agentId: string, agentName: string, repoPath: string): Promise<WorktreeInfo> {
    // Check if already exists
    const existing = this.worktrees.get(agentId);
    if (existing) return existing;

    // Verify this is a git repo
    if (!(await this.isGitRepo(repoPath))) {
      throw new Error(`${repoPath} is not a git repository`);
    }

    const sanitized = agentName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const branch = `jam/${sanitized}`;
    const worktreeDir = join(repoPath, this.config.worktreeDir);
    const worktreePath = join(worktreeDir, sanitized);

    // Create worktree directory
    await mkdir(worktreeDir, { recursive: true });

    // If worktree already exists on disk (from previous session), reuse it
    if (existsSync(worktreePath)) {
      log.info(`Reclaiming existing worktree at ${worktreePath}`, undefined, agentId);
      const info: WorktreeInfo = {
        agentId,
        worktreePath,
        branch,
        repoRoot: repoPath,
        createdAt: new Date().toISOString(),
      };
      this.worktrees.set(agentId, info);
      return info;
    }

    // Ensure branch exists (create from HEAD if not)
    await this.ensureBranch(repoPath, branch);

    // Create worktree
    try {
      await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, branch]);
    } catch (err) {
      // If branch is already checked out in another worktree, try force
      const msg = String(err);
      if (msg.includes('already checked out') || msg.includes('already exists')) {
        log.warn(`Branch ${branch} already checked out — attempting force`, undefined, agentId);
        await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', '--force', worktreePath, branch]);
      } else {
        throw err;
      }
    }

    const info: WorktreeInfo = {
      agentId,
      worktreePath,
      branch,
      repoRoot: repoPath,
      createdAt: new Date().toISOString(),
    };
    this.worktrees.set(agentId, info);

    log.info(`Created worktree for "${agentName}" at ${worktreePath} on branch ${branch}`, undefined, agentId);
    return info;
  }

  /** Remove an agent's worktree */
  async remove(agentId: string): Promise<void> {
    const info = this.worktrees.get(agentId);
    if (!info) return;

    try {
      await execFileAsync('git', ['-C', info.repoRoot, 'worktree', 'remove', info.worktreePath, '--force']);
      log.info(`Removed worktree at ${info.worktreePath}`, undefined, agentId);
    } catch (err) {
      log.warn(`Failed to git worktree remove: ${String(err)}. Cleaning up manually.`, undefined, agentId);
      // Manual cleanup
      try {
        await rm(info.worktreePath, { recursive: true, force: true });
        await execFileAsync('git', ['-C', info.repoRoot, 'worktree', 'prune']);
      } catch {
        // Best effort
      }
    }

    this.worktrees.delete(agentId);
  }

  /** List all active worktrees */
  list(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }

  /** Get worktree info for a specific agent */
  get(agentId: string): WorktreeInfo | undefined {
    return this.worktrees.get(agentId);
  }

  /** Clean up all worktrees */
  async removeAll(): Promise<void> {
    const ids = Array.from(this.worktrees.keys());
    for (const agentId of ids) {
      await this.remove(agentId);
    }
  }

  private async isGitRepo(path: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['-C', path, 'rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureBranch(repoPath: string, branch: string): Promise<void> {
    try {
      await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--verify', branch]);
    } catch {
      // Branch doesn't exist — create from HEAD
      await execFileAsync('git', ['-C', repoPath, 'branch', branch]);
      log.info(`Created branch ${branch} from HEAD`);
    }
  }
}
