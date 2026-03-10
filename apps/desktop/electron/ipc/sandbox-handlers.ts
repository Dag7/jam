import { ipcMain } from 'electron';
import type { WorktreeManager, MergeService } from '@jam/os-sandbox';
import type { SandboxTier, WorktreeInfo, MergeDiff, MergeResult, MergeStatus } from '@jam/os-sandbox';
import type { JamConfig } from '../config';
import { createLogger } from '@jam/core';

const log = createLogger('SandboxHandlers');

export interface SandboxHandlerDeps {
  worktreeManager: WorktreeManager | null;
  mergeService: MergeService | null;
  config: JamConfig;
}

export function registerSandboxHandlers(deps: SandboxHandlerDeps): void {
  // --- Sandbox tier info ---
  ipcMain.handle('sandbox:getTier', (): SandboxTier => {
    return deps.config.sandboxTier;
  });

  // --- Worktree operations ---
  ipcMain.handle('sandbox:listWorktrees', (): WorktreeInfo[] => {
    return deps.worktreeManager?.list() ?? [];
  });

  ipcMain.handle('sandbox:removeWorktree', async (_e, agentId: string): Promise<{ success: boolean; error?: string }> => {
    if (!deps.worktreeManager) return { success: false, error: 'Worktree manager not available' };
    try {
      await deps.worktreeManager.remove(agentId);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // --- Merge operations ---
  ipcMain.handle('merge:status', async (_e, agentId: string): Promise<MergeStatus> => {
    if (!deps.mergeService) return 'unknown';
    return deps.mergeService.getMergeStatus(agentId);
  });

  ipcMain.handle('merge:preview', async (_e, agentId: string, targetBranch?: string): Promise<MergeDiff> => {
    if (!deps.mergeService) {
      return { agentId, branch: '', filesChanged: [], conflictsDetected: false };
    }
    return deps.mergeService.previewMerge(agentId, targetBranch);
  });

  ipcMain.handle('merge:execute', async (_e, agentId: string, targetBranch?: string): Promise<MergeResult> => {
    if (!deps.mergeService) {
      return { success: false, mergedFiles: 0, error: 'Merge service not available' };
    }
    log.info(`Executing merge for agent ${agentId}`);
    return deps.mergeService.executeMerge(agentId, targetBranch);
  });

  ipcMain.handle('merge:abort', async (_e, agentId: string): Promise<void> => {
    if (!deps.mergeService) return;
    await deps.mergeService.abortMerge(agentId);
  });
}
