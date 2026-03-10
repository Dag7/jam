import { useEffect, useState, useCallback } from 'react';
import { MergePanel } from '@/components/dashboard/MergePanel';

interface WorktreeEntry {
  agentId: string;
  agentName: string;
  worktreePath: string;
  branch: string;
  repoPath: string;
}

export function MergeContainer() {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await window.jam.sandbox.listWorktrees();
      setWorktrees(result);
    } catch {
      setWorktrees([]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handlePreview = useCallback(async (agentId: string) => {
    return window.jam.merge.preview(agentId);
  }, []);

  const handleExecute = useCallback(async (agentId: string) => {
    const result = await window.jam.merge.execute(agentId);
    // Refresh worktrees after merge (worktree may be removed)
    await refresh();
    return result;
  }, [refresh]);

  const handleRemoveWorktree = useCallback(async (agentId: string) => {
    const result = await window.jam.sandbox.removeWorktree(agentId);
    if (result.success) await refresh();
    return result;
  }, [refresh]);

  return (
    <MergePanel
      worktrees={worktrees}
      isLoading={isLoading}
      onPreview={handlePreview}
      onExecute={handleExecute}
      onRemoveWorktree={handleRemoveWorktree}
    />
  );
}
