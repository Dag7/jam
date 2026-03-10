interface ActivityItem {
  id: string;
  type: 'delegation_sent' | 'delegation_received' | 'task_completed' | 'task_failed' | 'broadcast';
  title: string;
  detail?: string;
  counterpart?: string;
  timestamp: string;
}

interface AgentActivityListProps {
  activity: ActivityItem[];
  agents: Record<string, { name: string; color: string }>;
}

export function AgentActivityList({ activity, agents }: AgentActivityListProps) {
  if (activity.length === 0) {
    return <p className="text-sm text-zinc-500 italic">No activity yet.</p>;
  }

  return (
    <div className="space-y-2">
      {activity.map((item) => {
        const counterpartAgent = item.counterpart ? (agents[item.counterpart] ?? agents[item.counterpart.toLowerCase()] ?? null) : null;
        const icon = item.type === 'delegation_sent' ? '\u2192'
          : item.type === 'delegation_received' ? '\u2190'
          : item.type === 'task_completed' ? '\u2713'
          : item.type === 'task_failed' ? '\u2717'
          : '\u25C8';
        const color = item.type === 'task_completed' || item.type === 'broadcast' ? 'text-green-400'
          : item.type === 'task_failed' ? 'text-red-400'
          : item.type === 'delegation_sent' ? 'text-blue-400'
          : 'text-amber-400';
        return (
          <div
            key={item.id}
            className="bg-zinc-800 rounded-lg p-3 border border-zinc-700"
          >
            <div className="flex items-start gap-2">
              <span className={`text-sm font-mono shrink-0 mt-0.5 ${color}`}>{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium truncate">{item.title}</span>
                </div>
                {item.detail && (
                  <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{item.detail}</p>
                )}
                <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                  {counterpartAgent && (
                    <span className="flex items-center gap-1">
                      <span
                        className="w-3 h-3 rounded-full inline-block"
                        style={{ backgroundColor: counterpartAgent.color }}
                      />
                      {counterpartAgent.name}
                    </span>
                  )}
                  <span>{new Date(item.timestamp).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
