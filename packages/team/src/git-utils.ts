import { execFile } from 'node:child_process';
import { createLogger } from '@jam/core';

const log = createLogger('GitUtils');

/** Promisified git command runner */
function git(repoDir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr.trim() || error.message;
        log.error(`git ${args[0]} failed: ${msg}`);
        reject(new Error(msg));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export async function getCurrentBranch(repoDir: string): Promise<string> {
  return git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

export async function gitBranchExists(repoDir: string, branch: string): Promise<boolean> {
  try {
    await git(repoDir, ['rev-parse', '--verify', branch]);
    return true;
  } catch {
    return false;
  }
}

export async function gitCreateBranch(repoDir: string, branch: string, from?: string): Promise<void> {
  const args = ['checkout', '-b', branch];
  if (from) args.push(from);
  await git(repoDir, args);
}

export async function gitCheckout(repoDir: string, branch: string): Promise<void> {
  await git(repoDir, ['checkout', branch]);
}

export async function gitCommit(
  repoDir: string,
  message: string,
  files?: string[],
): Promise<string> {
  if (files && files.length > 0) {
    await git(repoDir, ['add', ...files]);
  } else {
    await git(repoDir, ['add', '-A']);
  }
  await git(repoDir, ['commit', '-m', message]);
  return git(repoDir, ['rev-parse', 'HEAD']);
}

export async function gitMerge(
  repoDir: string,
  branch: string,
): Promise<{ success: boolean; conflicts?: string[] }> {
  try {
    await git(repoDir, ['merge', branch]);
    return { success: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('CONFLICT')) {
      const status = await git(repoDir, ['diff', '--name-only', '--diff-filter=U']);
      await git(repoDir, ['merge', '--abort']);
      return { success: false, conflicts: status.split('\n').filter(Boolean) };
    }
    throw error;
  }
}

export async function gitRevert(repoDir: string, commitHash: string): Promise<void> {
  await git(repoDir, ['revert', '--no-edit', commitHash]);
}

export async function gitDiff(repoDir: string, base: string, head: string): Promise<string> {
  return git(repoDir, ['diff', `${base}...${head}`]);
}

export async function gitStash(repoDir: string): Promise<boolean> {
  const result = await git(repoDir, ['stash', 'push', '-m', 'jam-auto-improve-stash']);
  return !result.includes('No local changes');
}

export async function gitStashPop(repoDir: string): Promise<void> {
  await git(repoDir, ['stash', 'pop']);
}

export async function gitLog(
  repoDir: string,
  branch: string,
  limit: number,
): Promise<Array<{ hash: string; message: string; date: string }>> {
  const raw = await git(repoDir, [
    'log', branch, `--max-count=${limit}`,
    '--format=%H|%s|%aI',
  ]);
  if (!raw) return [];

  return raw.split('\n').map((line) => {
    const [hash, message, date] = line.split('|');
    return { hash, message, date };
  });
}

export async function gitIsClean(repoDir: string): Promise<boolean> {
  const status = await git(repoDir, ['status', '--porcelain']);
  return status.length === 0;
}

export async function gitTag(repoDir: string, tag: string): Promise<void> {
  await git(repoDir, ['tag', tag]);
}
