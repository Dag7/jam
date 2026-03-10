import { useState, useMemo } from 'react';

type RelationshipData = {
  targetAgentId: string; trustScore: number; interactionCount: number;
  delegationCount: number; delegationSuccessRate: number; lastInteraction: string; notes: string[];
};

type TaskData = {
  id: string; title: string; description: string; status: string; priority: string;
  source: string; createdBy: string; assignedTo?: string;
  startedAt?: string; completedAt?: string; result?: string; error?: string; tags: string[];
};

interface AgentRelationshipsProps {
  relationships: RelationshipData[];
  tasks: TaskData[];
  agentId: string;
  agents: Record<string, { name: string; color: string }>;
}

export function AgentRelationships({ relationships, tasks, agentId, agents }: AgentRelationshipsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (relationships.length === 0) {
    return <p className="text-sm text-zinc-500 italic">No relationships yet.</p>;
  }

  return (
    <div className="space-y-2">
      {relationships.map((rel) => (
        <RelationshipCard
          key={rel.targetAgentId}
          rel={rel}
          tasks={tasks}
          agentId={agentId}
          agents={agents}
          isExpanded={expandedId === rel.targetAgentId}
          onToggle={() => setExpandedId(expandedId === rel.targetAgentId ? null : rel.targetAgentId)}
        />
      ))}
    </div>
  );
}

function RelationshipCard({ rel, tasks, agentId, agents, isExpanded, onToggle }: {
  rel: RelationshipData;
  tasks: TaskData[];
  agentId: string;
  agents: Record<string, { name: string; color: string }>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const target = agents[rel.targetAgentId] ?? agents[rel.targetAgentId.toLowerCase()] ?? null;
  const trustColor = rel.trustScore > 0.7 ? 'text-green-400'
    : rel.trustScore >= 0.4 ? 'text-yellow-400' : 'text-red-400';

  const taskHistory = useMemo(() => {
    return tasks
      .filter(t =>
        t.source === 'agent' && (
          (t.createdBy === agentId && t.assignedTo === rel.targetAgentId) ||
          (t.createdBy === rel.targetAgentId && t.assignedTo === agentId)
        ),
      )
      .sort((a, b) => (b.completedAt ?? b.startedAt ?? '').localeCompare(a.completedAt ?? a.startedAt ?? ''))
      .slice(0, 10);
  }, [tasks, agentId, rel.targetAgentId]);

  return (
    <div className="bg-zinc-800 rounded-lg border border-zinc-700 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 hover:bg-zinc-750 transition-colors text-left"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
          style={{ backgroundColor: target?.color ?? '#6b7280' }}
        >
          {(target?.name ?? '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white">
            {target?.name ?? rel.targetAgentId}
          </div>
          <div className="text-xs text-zinc-400">
            {rel.interactionCount} interactions
            {rel.delegationCount > 0 && ` \u00b7 ${rel.delegationCount} delegations`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-sm font-semibold ${trustColor}`}>
            {Math.round(rel.trustScore * 100)}%
          </div>
          <div className="text-xs text-zinc-500">Trust</div>
        </div>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`text-zinc-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {isExpanded && (
        <div className="border-t border-zinc-700 px-3 py-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-900/50 rounded px-2.5 py-2">
              <div className="text-xs text-zinc-500">Success Rate</div>
              <div className={`text-sm font-semibold ${
                rel.delegationSuccessRate > 0.7 ? 'text-green-400'
                : rel.delegationSuccessRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {rel.delegationCount > 0 ? `${Math.round(rel.delegationSuccessRate * 100)}%` : 'N/A'}
              </div>
            </div>
            <div className="bg-zinc-900/50 rounded px-2.5 py-2">
              <div className="text-xs text-zinc-500">Delegations</div>
              <div className="text-sm font-semibold text-white">{rel.delegationCount}</div>
            </div>
            <div className="bg-zinc-900/50 rounded px-2.5 py-2">
              <div className="text-xs text-zinc-500">Last Active</div>
              <div className="text-sm font-semibold text-white">
                {rel.lastInteraction ? formatRelativeTime(rel.lastInteraction) : 'Never'}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-500">Trust Level</span>
              <span className={`text-xs font-medium ${trustColor}`}>{Math.round(rel.trustScore * 100)}%</span>
            </div>
            <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  rel.trustScore > 0.7 ? 'bg-green-500' : rel.trustScore >= 0.4 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.round(rel.trustScore * 100)}%` }}
              />
            </div>
          </div>

          {rel.notes.length > 0 && (
            <div>
              <h5 className="text-xs text-zinc-500 font-medium mb-1">Notes</h5>
              <ul className="space-y-0.5">
                {rel.notes.map((note, i) => (
                  <li key={i} className="text-xs text-zinc-400">{note}</li>
                ))}
              </ul>
            </div>
          )}

          {taskHistory.length > 0 && (
            <div>
              <h5 className="text-xs text-zinc-500 font-medium mb-1.5">Interaction History</h5>
              <div className="space-y-1.5">
                {taskHistory.map((task) => {
                  const isSent = task.createdBy === agentId;
                  const statusColor = task.status === 'completed' ? 'text-green-400'
                    : task.status === 'failed' ? 'text-red-400'
                    : task.status === 'running' ? 'text-blue-400'
                    : 'text-zinc-400';
                  return (
                    <div key={task.id} className="flex items-start gap-2 text-xs">
                      <span className={`shrink-0 mt-0.5 font-mono ${isSent ? 'text-blue-400' : 'text-amber-400'}`}>
                        {isSent ? '\u2192' : '\u2190'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-zinc-300 truncate block">{task.title}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`font-medium ${statusColor}`}>{task.status}</span>
                          {task.completedAt && (
                            <span className="text-zinc-600">{formatRelativeTime(task.completedAt)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {taskHistory.length === 0 && rel.notes.length === 0 && (
            <p className="text-xs text-zinc-600 italic">No detailed interaction history available.</p>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
