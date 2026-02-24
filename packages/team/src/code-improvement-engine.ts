import type { CodeImprovement, ICodeImprovementEngine, ImprovementFilter, ImprovementHealth, IEventBus } from '@jam/core';
import { Events, createLogger } from '@jam/core';
import type { ITeamExecutor } from './team-executor.js';
import type { FileImprovementStore } from './stores/file-improvement-store.js';
import {
  getCurrentBranch,
  gitBranchExists,
  gitCreateBranch,
  gitCheckout,
  gitCommit,
  gitRevert,
  gitStash,
  gitStashPop,
  gitIsClean,
  gitTag,
} from './git-utils.js';
import { execFile } from 'node:child_process';

const log = createLogger('CodeImprovement');

/** Max consecutive failures before auto-pause */
const MAX_CONSECUTIVE_FAILURES = 3;

export class CodeImprovementEngine implements ICodeImprovementEngine {
  private consecutiveFailures = 0;
  private paused = false;

  constructor(
    private readonly repoDir: string,
    private readonly improvementBranch: string,
    private readonly teamExecutor: ITeamExecutor,
    private readonly improvementStore: FileImprovementStore,
    private readonly eventBus: IEventBus,
    private readonly executeOnAgent: (agentId: string, prompt: string, cwd: string) => Promise<string>,
    private readonly testCommand: string,
    private readonly maxPerDay: number,
  ) {}

  async propose(
    agentId: string,
    title: string,
    description: string,
  ): Promise<CodeImprovement> {
    // Rate limit check
    const todayCount = await this.improvementStore.countToday();
    if (todayCount >= this.maxPerDay) {
      throw new Error(`Rate limit reached: ${this.maxPerDay} improvements per day`);
    }

    if (this.paused) {
      throw new Error(
        `Improvement engine paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. ` +
        'Check health and resolve issues before resuming.',
      );
    }

    const improvement = await this.improvementStore.create({
      title,
      description,
      agentId,
      branch: this.improvementBranch,
      status: 'pending',
    });

    this.eventBus.emit(Events.CODE_PROPOSED, { improvement });
    return improvement;
  }

  async execute(improvementId: string): Promise<CodeImprovement> {
    let improvement = await this.improvementStore.get(improvementId);
    if (!improvement) throw new Error(`Improvement not found: ${improvementId}`);

    const originalBranch = await getCurrentBranch(this.repoDir);
    let stashed = false;

    try {
      // Step 1: Health check before proceeding
      const health = await this.getHealth();
      if (!health.healthy) {
        throw new Error(`Health check failed: ${health.issues.join(', ')}`);
      }

      // Step 2: Stash working changes and switch to improvement branch
      stashed = await gitStash(this.repoDir);
      improvement = await this.improvementStore.update(improvementId, { status: 'branched' });

      const branchExists = await gitBranchExists(this.repoDir, this.improvementBranch);
      if (branchExists) {
        await gitCheckout(this.repoDir, this.improvementBranch);
      } else {
        await gitCreateBranch(this.repoDir, this.improvementBranch);
      }

      // Tag the last known good state
      const tagName = `jam-lkg-${Date.now()}`;
      await gitTag(this.repoDir, tagName);
      log.info(`Tagged last-known-good: ${tagName}`);

      // Step 3: Execute agent work
      improvement = await this.improvementStore.update(improvementId, { status: 'executing' });

      const prompt = this.buildImprovementPrompt(improvement);
      await this.executeOnAgent(improvement.agentId, prompt, this.repoDir);

      // Step 4: Commit changes
      const isClean = await gitIsClean(this.repoDir);
      if (isClean) {
        throw new Error('Agent made no file changes');
      }

      const commitMessage = [
        `improve: ${improvement.title}`,
        '',
        `Agent: ${improvement.agentId}`,
        `Improvement: ${improvement.id}`,
      ].join('\n');

      const commitHash = await gitCommit(this.repoDir, commitMessage);
      improvement = await this.improvementStore.update(improvementId, { commitHash });

      // Step 5: Run tests
      improvement = await this.improvementStore.update(improvementId, { status: 'testing' });

      const testResult = await this.runTests();
      improvement = await this.improvementStore.update(improvementId, { testResult });

      if (testResult.passed) {
        // Step 6a: Tests passed — improvement is merged on the branch
        improvement = await this.improvementStore.update(improvementId, {
          status: 'merged',
          completedAt: new Date().toISOString(),
        });
        this.consecutiveFailures = 0;
        this.eventBus.emit(Events.CODE_IMPROVED, { improvement });
        log.info(`Improvement merged: ${improvement.title} (${commitHash})`);
      } else {
        // Step 6b: Tests failed — revert the commit
        log.warn(`Tests failed for ${improvement.title}, reverting ${commitHash}`);
        await gitRevert(this.repoDir, commitHash);

        improvement = await this.improvementStore.update(improvementId, {
          status: 'failed',
          error: 'Tests failed after applying changes',
          completedAt: new Date().toISOString(),
        });

        this.consecutiveFailures++;
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.paused = true;
          log.error(`Auto-paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
        }

        this.eventBus.emit(Events.CODE_FAILED, {
          improvement,
          error: testResult.output.slice(0, 2000),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Improvement execution failed: ${message}`);

      improvement = await this.improvementStore.update(improvementId, {
        status: 'failed',
        error: message,
        completedAt: new Date().toISOString(),
      });

      this.consecutiveFailures++;
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.paused = true;
      }

      this.eventBus.emit(Events.CODE_FAILED, { improvement, error: message });
    } finally {
      // Always return to original branch and restore stash
      try {
        await gitCheckout(this.repoDir, originalBranch);
        if (stashed) await gitStashPop(this.repoDir);
      } catch (restoreError) {
        log.error(`Failed to restore branch: ${String(restoreError)}`);
      }
    }

    return improvement;
  }

  async rollback(improvementId: string): Promise<void> {
    const improvement = await this.improvementStore.get(improvementId);
    if (!improvement) throw new Error(`Improvement not found: ${improvementId}`);
    if (!improvement.commitHash) throw new Error('No commit to rollback');

    const originalBranch = await getCurrentBranch(this.repoDir);
    const stashed = await gitStash(this.repoDir);

    try {
      await gitCheckout(this.repoDir, this.improvementBranch);
      await gitRevert(this.repoDir, improvement.commitHash);

      await this.improvementStore.update(improvementId, {
        status: 'rolled-back',
        completedAt: new Date().toISOString(),
      });

      this.eventBus.emit(Events.CODE_ROLLED_BACK, { improvement });
      log.info(`Rolled back: ${improvement.title} (${improvement.commitHash})`);
    } finally {
      await gitCheckout(this.repoDir, originalBranch);
      if (stashed) await gitStashPop(this.repoDir);
    }
  }

  async list(filter?: ImprovementFilter): Promise<CodeImprovement[]> {
    return this.improvementStore.list(filter);
  }

  async getHealth(): Promise<ImprovementHealth> {
    const issues: string[] = [];

    try {
      // Check repo is accessible
      await getCurrentBranch(this.repoDir);
    } catch {
      issues.push('Cannot access git repository');
    }

    // Check if improvement branch exists and is clean
    const branchExists = await gitBranchExists(this.repoDir, this.improvementBranch);
    if (branchExists) {
      const originalBranch = await getCurrentBranch(this.repoDir);
      try {
        await gitCheckout(this.repoDir, this.improvementBranch);
        const clean = await gitIsClean(this.repoDir);
        if (!clean) {
          issues.push('Improvement branch has uncommitted changes');
        }
      } catch (error) {
        issues.push(`Cannot checkout improvement branch: ${String(error)}`);
      } finally {
        try {
          await gitCheckout(this.repoDir, originalBranch);
        } catch { /* best effort */ }
      }
    }

    if (this.paused) {
      issues.push(`Engine paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`);
    }

    return {
      healthy: issues.length === 0,
      lastCheck: new Date().toISOString(),
      issues,
    };
  }

  /** Resume after being auto-paused */
  resume(): void {
    this.paused = false;
    this.consecutiveFailures = 0;
    log.info('Improvement engine resumed');
  }

  private buildImprovementPrompt(improvement: CodeImprovement): string {
    return [
      `# Code Improvement: ${improvement.title}`,
      '',
      improvement.description,
      '',
      '## Constraints',
      '- Do NOT break existing port interfaces in @jam/core',
      '- All changes must pass typecheck and tests',
      '- Keep changes focused — do one thing well',
      '- Write clean, maintainable code following existing patterns',
      '',
      '## Verification',
      `After making changes, run: ${this.testCommand}`,
      'If tests fail, fix the issues before finishing.',
      '',
      '## Important',
      '- You are working on a dedicated improvement branch',
      '- Make targeted changes — avoid sweeping refactors',
      '- If you are unsure about a change, skip it',
    ].join('\n');
  }

  private runTests(): Promise<{ passed: boolean; output: string }> {
    return new Promise((resolve) => {
      const [cmd, ...args] = this.testCommand.split(' ');
      execFile(
        cmd,
        args,
        { cwd: this.repoDir, maxBuffer: 10 * 1024 * 1024, timeout: 300_000 },
        (error, stdout, stderr) => {
          const output = `${stdout}\n${stderr}`.trim();
          resolve({ passed: !error, output });
        },
      );
    });
  }
}
