import React, { useState, useEffect, useRef } from 'react';

interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  data?: unknown;
  agentId?: string;
}

export const LogsContainer: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'debug' | 'info' | 'warn' | 'error'>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load existing logs
    window.jam.logs.get().then((entries) => {
      setLogs(entries as LogEntry[]);
    });

    // Subscribe to new logs
    const unsub = window.jam.logs.onEntry((entry) => {
      setLogs((prev) => [...prev.slice(-499), entry as LogEntry]);
    });

    return unsub;
  }, []);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const filtered = filter === 'all' ? logs : logs.filter((l) => l.level === filter);

  const levelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warn': return 'text-yellow-400';
      case 'debug': return 'text-zinc-500';
      default: return 'text-zinc-400';
    }
  };

  const levelDot = (level: string) => {
    switch (level) {
      case 'error': return 'bg-red-400';
      case 'warn': return 'bg-yellow-400';
      case 'debug': return 'bg-zinc-600';
      default: return 'bg-zinc-400';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-1 p-2 border-b border-zinc-800">
        {(['all', 'debug', 'info', 'warn', 'error'] as const).map((level) => (
          <button
            key={level}
            onClick={() => setFilter(level)}
            className={`
              px-2 py-1 rounded text-xs font-medium transition-colors
              ${filter === level
                ? 'bg-zinc-700 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }
            `}
          >
            {level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1)}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-xs text-zinc-600">{filtered.length}</span>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto p-1.5 font-mono text-[11px] space-y-px">
        {filtered.length === 0 ? (
          <div className="text-zinc-600 text-center py-8">No logs yet</div>
        ) : (
          filtered.map((entry, i) => (
            <div
              key={i}
              className="py-1 px-1.5 hover:bg-zinc-800/40 rounded group"
            >
              {/* Header: dot + time + scope + agentId */}
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${levelDot(entry.level)}`} />
                <span className="text-zinc-600">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className={`${levelColor(entry.level)}`}>
                  {entry.level}
                </span>
                <span className="text-purple-400/70">{entry.scope}</span>
                {entry.agentId && (
                  <span className="text-blue-400/50">{entry.agentId.slice(0, 8)}</span>
                )}
              </div>
              {/* Message: full width, proper word wrap */}
              <div className="text-zinc-300 mt-0.5 pl-3 break-words whitespace-pre-wrap leading-relaxed">
                {entry.message}
                {entry.data !== undefined && (
                  <span className="text-zinc-500 block mt-0.5 text-[10px]">
                    {JSON.stringify(entry.data, null, 2)}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
