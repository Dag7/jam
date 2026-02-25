import React, { useState, useEffect, useRef, useMemo } from 'react';

interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  data?: unknown;
  agentId?: string;
}

const MAX_LOGS = 500;

const LEVEL_COLOR: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-yellow-400',
  debug: 'text-zinc-500',
  info: 'text-zinc-400',
};

const LEVEL_DOT: Record<string, string> = {
  error: 'bg-red-400',
  warn: 'bg-yellow-400',
  debug: 'bg-zinc-600',
  info: 'bg-zinc-400',
};

/** Memoized log entry to avoid re-rendering all entries on new log */
const LogEntryRow: React.FC<{ entry: LogEntry }> = React.memo(({ entry }) => (
  <div className="py-1 px-1.5 hover:bg-zinc-800/40 rounded group">
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${LEVEL_DOT[entry.level] ?? 'bg-zinc-400'}`} />
      <span className="text-zinc-600">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
      <span className={LEVEL_COLOR[entry.level] ?? 'text-zinc-400'}>
        {entry.level}
      </span>
      <span className="text-purple-400/70">{entry.scope}</span>
      {entry.agentId && (
        <span className="text-blue-400/50">{entry.agentId.slice(0, 8)}</span>
      )}
    </div>
    <div className="text-zinc-300 mt-0.5 pl-3 break-words whitespace-pre-wrap leading-relaxed">
      {entry.message}
      {entry.data !== undefined && (
        <span className="text-zinc-500 block mt-0.5 text-[10px]">
          {typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)}
        </span>
      )}
    </div>
  </div>
));
LogEntryRow.displayName = 'LogEntryRow';

export const LogsContainer: React.FC = () => {
  const logsRef = useRef<LogEntry[]>([]);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<'all' | 'debug' | 'info' | 'warn' | 'error'>('all');
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.jam.logs.get().then((entries) => {
      logsRef.current = entries as LogEntry[];
      setVersion((v) => v + 1);
    });

    // Batch incoming logs — accumulate and flush at 200ms intervals
    let pendingEntries: LogEntry[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      if (pendingEntries.length === 0) return;
      const logs = logsRef.current;
      const combined = logs.length + pendingEntries.length > MAX_LOGS
        ? [...logs.slice(-(MAX_LOGS - pendingEntries.length)), ...pendingEntries]
        : [...logs, ...pendingEntries];
      logsRef.current = combined;
      pendingEntries = [];
      setVersion((v) => v + 1);
    };

    const unsub = window.jam.logs.onEntry((entry) => {
      pendingEntries.push(entry as LogEntry);
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 200);
      }
    });

    return () => {
      unsub();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, []);

  // Auto-scroll to bottom — only if already near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 100) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [version]);

  const logs = logsRef.current;
  const filtered = useMemo(
    () => filter === 'all' ? logs : logs.filter((l) => l.level === filter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, version],
  );

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-1.5 font-mono text-[11px] space-y-px">
        {filtered.length === 0 ? (
          <div className="text-zinc-600 text-center py-8">No logs yet</div>
        ) : (
          filtered.map((entry, i) => (
            <LogEntryRow key={i} entry={entry} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
