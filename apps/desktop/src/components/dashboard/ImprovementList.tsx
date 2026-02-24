import { useState, useEffect, useCallback } from 'react';

interface ImprovementEntry {
  id: string;
  title: string;
  description: string;
  agentId: string;
  branch: string;
  commitHash?: string;
  testResult?: { passed: boolean; output: string };
  status: 'pending' | 'branched' | 'executing' | 'testing' | 'merged' | 'failed' | 'rolled-back';
  error?: string;
  createdAt: string;
  completedAt?: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-zinc-700 text-zinc-300',
  branched: 'bg-yellow-500/20 text-yellow-400',
  executing: 'bg-blue-500/20 text-blue-400',
  testing: 'bg-blue-500/20 text-blue-400',
  merged: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  'rolled-back': 'bg-zinc-600/30 text-zinc-400',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ImprovementList() {
  const [improvements, setImprovements] = useState<ImprovementEntry[]>([]);
  const [health, setHealth] = useState<{ healthy: boolean; issues: string[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [result, healthResult] = await Promise.all([
      window.jam.team.improvements.list(),
      window.jam.team.improvements.health(),
    ]);
    setImprovements(result as unknown as ImprovementEntry[]);
    setHealth(healthResult);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rollback = async (id: string) => {
    await window.jam.team.improvements.rollback(id);
    load();
  };

  const execute = async (id: string) => {
    await window.jam.team.improvements.execute(id);
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
        Loading improvements...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Health status */}
      {health && (
        <div
          className={`px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
            health.healthy
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${health.healthy ? 'bg-green-400' : 'bg-red-400'}`} />
          {health.healthy ? 'Engine healthy' : `Issues: ${health.issues.join(', ')}`}
        </div>
      )}

      {improvements.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
          No code improvements yet. Enable in Settings to get started.
        </div>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-[1fr_80px_100px_80px_80px] gap-2 px-3 py-2 text-xs text-zinc-500 font-medium border-b border-zinc-800">
            <span>Improvement</span>
            <span>Status</span>
            <span>Commit</span>
            <span>When</span>
            <span>Actions</span>
          </div>
          {improvements.map((imp) => (
            <div
              key={imp.id}
              className="grid grid-cols-[1fr_80px_100px_80px_80px] gap-2 px-3 py-2 text-xs rounded hover:bg-zinc-800/50"
            >
              <div className="truncate">
                <span className="text-zinc-200 font-medium">{imp.title}</span>
                {imp.error && (
                  <span className="ml-2 text-red-400" title={imp.error}>
                    {imp.error.slice(0, 40)}...
                  </span>
                )}
              </div>
              <span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_STYLES[imp.status] ?? ''}`}>
                  {imp.status}
                </span>
              </span>
              <span className="text-zinc-500 font-mono truncate">
                {imp.commitHash?.slice(0, 8) ?? '-'}
              </span>
              <span className="text-zinc-500">
                {timeAgo(imp.createdAt)}
              </span>
              <span className="flex gap-1">
                {imp.status === 'pending' && (
                  <button
                    onClick={() => execute(imp.id)}
                    className="p-1 rounded text-blue-400 hover:bg-blue-500/20 transition-colors"
                    title="Execute"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  </button>
                )}
                {imp.status === 'merged' && (
                  <button
                    onClick={() => rollback(imp.id)}
                    className="p-1 rounded text-yellow-400 hover:bg-yellow-500/20 transition-colors"
                    title="Rollback"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
