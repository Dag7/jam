import { useState } from 'react';

interface WorktreeEntry {
  agentId: string;
  agentName: string;
  worktreePath: string;
  branch: string;
  repoPath: string;
}

interface MergeDiff {
  agentId: string;
  branch: string;
  filesChanged: Array<{ path: string; status: string; diff: string }>;
  conflictsDetected: boolean;
}

interface MergePanelProps {
  worktrees: WorktreeEntry[];
  isLoading: boolean;
  onPreview: (agentId: string) => Promise<MergeDiff>;
  onExecute: (agentId: string) => Promise<{ success: boolean; mergedFiles: number; error?: string }>;
  onRemoveWorktree: (agentId: string) => Promise<{ success: boolean; error?: string }>;
}

export function MergePanel({
  worktrees,
  isLoading,
  onPreview,
  onExecute,
  onRemoveWorktree,
}: MergePanelProps) {
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<MergeDiff | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [mergeResult, setMergeResult] = useState<string | null>(null);

  const handlePreview = async (agentId: string) => {
    setPreviewing(agentId);
    setPreviewData(null);
    try {
      const data = await onPreview(agentId);
      setPreviewData(data);
    } catch {
      setPreviewData(null);
    }
    setPreviewing(null);
  };

  const handleMerge = async (agentId: string) => {
    setMerging(agentId);
    setMergeResult(null);
    try {
      const result = await onExecute(agentId);
      setMergeResult(
        result.success
          ? `Merged ${result.mergedFiles} file(s) successfully`
          : `Merge failed: ${result.error}`,
      );
    } catch (err) {
      setMergeResult(`Merge failed: ${String(err)}`);
    }
    setMerging(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500">
        Loading worktrees...
      </div>
    );
  }

  if (worktrees.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-zinc-500">No agent worktrees found.</p>
        <p className="text-xs text-zinc-600 mt-1">
          Worktrees are created when agents work on git repos with worktree isolation enabled.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Agent Worktrees</h2>

      {mergeResult && (
        <div
          className={`text-sm px-3 py-2 rounded-lg ${
            mergeResult.includes('successfully')
              ? 'bg-green-900/30 text-green-400 border border-green-800'
              : 'bg-red-900/30 text-red-400 border border-red-800'
          }`}
        >
          {mergeResult}
        </div>
      )}

      <div className="space-y-3">
        {worktrees.map((wt) => (
          <div
            key={wt.agentId}
            className="bg-zinc-800 rounded-lg border border-zinc-700 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-sm font-medium text-white">{wt.agentName}</span>
                <span className="text-xs text-zinc-500 ml-2">on branch</span>
                <span className="text-xs text-blue-400 ml-1 font-mono">{wt.branch}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePreview(wt.agentId)}
                  disabled={previewing === wt.agentId}
                  className="px-3 py-1 text-xs font-medium rounded border border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
                >
                  {previewing === wt.agentId ? 'Loading...' : 'Preview Diff'}
                </button>
                <button
                  onClick={() => handleMerge(wt.agentId)}
                  disabled={merging === wt.agentId}
                  className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
                >
                  {merging === wt.agentId ? 'Merging...' : 'Merge'}
                </button>
                <button
                  onClick={() => onRemoveWorktree(wt.agentId)}
                  className="px-2 py-1 text-xs text-zinc-500 hover:text-red-400 transition-colors"
                  title="Remove worktree"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="text-xs text-zinc-500 font-mono truncate">
              {wt.worktreePath}
            </div>

            {/* Diff preview */}
            {previewData && previewData.agentId === wt.agentId && (
              <div className="mt-3 border-t border-zinc-700 pt-3">
                {previewData.conflictsDetected && (
                  <div className="text-xs text-red-400 mb-2 flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Conflicts detected — manual resolution may be needed
                  </div>
                )}

                {previewData.filesChanged.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">No changes to merge</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {previewData.filesChanged.map((f) => {
                      const statusColor =
                        f.status === 'added' ? 'text-green-400'
                        : f.status === 'deleted' ? 'text-red-400'
                        : 'text-yellow-400';
                      return (
                        <div key={f.path} className="text-xs">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`font-medium ${statusColor}`}>
                              {f.status === 'added' ? 'A' : f.status === 'deleted' ? 'D' : 'M'}
                            </span>
                            <span className="text-zinc-300 font-mono">{f.path}</span>
                          </div>
                          {f.diff && (
                            <pre className="bg-zinc-900 rounded p-2 text-[11px] text-zinc-400 overflow-x-auto max-h-32 font-mono whitespace-pre">
                              {f.diff.slice(0, 2000)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
