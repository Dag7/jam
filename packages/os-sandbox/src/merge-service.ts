import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '@jam/core';
import type { WorktreeManager } from './worktree-manager.js';
import type { MergeDiff, MergeResult, MergeStatus } from './types.js';

const execFileAsync = promisify(execFile);
const log = createLogger('MergeService');

/**
 * Provides git merge operations for agent worktrees.
 *
 * When multiple agents work on the same repo via worktrees,
 * this service previews and executes merges from agent branches
 * back to the target branch. All merges are user-controlled.
 */
export class MergeService {
  constructor(private readonly worktreeManager: WorktreeManager) {}

  /** Get the merge status of an agent's worktree branch relative to its base */
  async getMergeStatus(agentId: string): Promise<MergeStatus> {
    const info = this.worktreeManager.get(agentId);
    if (!info) return 'unknown';

    try {
      const repo = info.repoRoot;
      const branch = info.branch;

      // Get default branch (main or master)
      const targetBranch = await this.getDefaultBranch(repo);

      // Check if branch has diverged
      const { stdout: aheadBehind } = await execFileAsync(
        'git', ['-C', repo, 'rev-list', '--left-right', '--count', `${targetBranch}...${branch}`],
      );
      const [behind, ahead] = aheadBehind.trim().split(/\s+/).map(Number);

      if (ahead === 0 && behind === 0) return 'clean';
      if (ahead > 0 && behind === 0) return 'ahead';
      if (ahead === 0 && behind > 0) return 'behind';
      return 'diverged';
    } catch {
      return 'unknown';
    }
  }

  /** Preview what a merge of the agent's branch into the target would look like */
  async previewMerge(agentId: string, targetBranch?: string): Promise<MergeDiff> {
    const info = this.worktreeManager.get(agentId);
    if (!info) {
      return { agentId, branch: '', filesChanged: [], conflictsDetected: false };
    }

    const repo = info.repoRoot;
    const branch = info.branch;
    const target = targetBranch ?? await this.getDefaultBranch(repo);

    try {
      // Get diff between target and agent branch
      const { stdout: diffOutput } = await execFileAsync(
        'git', ['-C', repo, 'diff', '--stat', '--patch', `${target}...${branch}`],
        { maxBuffer: 10 * 1024 * 1024 },
      );

      // Parse --stat to get file list
      const { stdout: statOutput } = await execFileAsync(
        'git', ['-C', repo, 'diff', '--name-status', `${target}...${branch}`],
      );

      const filesChanged = statOutput.trim().split('\n').filter(Boolean).map((line) => {
        const [statusChar, ...pathParts] = line.split('\t');
        const path = pathParts.join('\t');
        const status = statusChar === 'A' ? 'added' as const
          : statusChar === 'D' ? 'deleted' as const
          : 'modified' as const;
        return { path, status, diff: '' };
      });

      // Get per-file diffs
      for (const file of filesChanged) {
        try {
          const { stdout: fileDiff } = await execFileAsync(
            'git', ['-C', repo, 'diff', `${target}...${branch}`, '--', file.path],
            { maxBuffer: 1024 * 1024 },
          );
          file.diff = fileDiff;
        } catch {
          file.diff = '(diff unavailable)';
        }
      }

      // Check for merge conflicts via dry-run
      let conflictsDetected = false;
      try {
        await execFileAsync(
          'git', ['-C', repo, 'merge-tree', '--write-tree', target, branch],
        );
      } catch {
        conflictsDetected = true;
      }

      return { agentId, branch, filesChanged, conflictsDetected };
    } catch (err) {
      log.error(`Preview merge failed: ${String(err)}`, undefined, agentId);
      return { agentId, branch, filesChanged: [], conflictsDetected: false };
    }
  }

  /** Execute a merge of the agent's branch into the target branch */
  async executeMerge(agentId: string, targetBranch?: string): Promise<MergeResult> {
    const info = this.worktreeManager.get(agentId);
    if (!info) {
      return { success: false, mergedFiles: 0, error: 'No worktree found for agent' };
    }

    const repo = info.repoRoot;
    const branch = info.branch;
    const target = targetBranch ?? await this.getDefaultBranch(repo);

    try {
      // Get current branch to restore later
      const { stdout: currentBranch } = await execFileAsync(
        'git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'],
      );

      // Checkout target branch
      await execFileAsync('git', ['-C', repo, 'checkout', target]);

      // Merge agent branch
      try {
        await execFileAsync(
          'git', ['-C', repo, 'merge', branch, '--no-edit', '-m', `Merge ${branch} into ${target}`],
        );
      } catch (mergeErr) {
        // Abort the failed merge
        await execFileAsync('git', ['-C', repo, 'merge', '--abort']).catch(() => {});
        // Restore original branch
        await execFileAsync('git', ['-C', repo, 'checkout', currentBranch.trim()]).catch(() => {});
        return { success: false, mergedFiles: 0, error: `Merge conflict: ${String(mergeErr)}` };
      }

      // Count merged files
      const { stdout: diffStat } = await execFileAsync(
        'git', ['-C', repo, 'diff', '--name-only', 'HEAD~1', 'HEAD'],
      );
      const mergedFiles = diffStat.trim().split('\n').filter(Boolean).length;

      log.info(`Merged ${branch} into ${target}: ${mergedFiles} files`, undefined, agentId);
      return { success: true, mergedFiles };
    } catch (err) {
      return { success: false, mergedFiles: 0, error: String(err) };
    }
  }

  /** Abort an in-progress merge */
  async abortMerge(agentId: string): Promise<void> {
    const info = this.worktreeManager.get(agentId);
    if (!info) return;

    try {
      await execFileAsync('git', ['-C', info.repoRoot, 'merge', '--abort']);
      log.info('Merge aborted', undefined, agentId);
    } catch (err) {
      log.warn(`Merge abort failed: ${String(err)}`, undefined, agentId);
    }
  }

  private async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git', ['-C', repoPath, 'symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      );
      return stdout.trim().replace('origin/', '');
    } catch {
      // Fallback: check if main or master exists
      try {
        await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--verify', 'main']);
        return 'main';
      } catch {
        return 'master';
      }
    }
  }
}
