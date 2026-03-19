import React, { useEffect, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { useAppStore } from '@/store';
import type { ExecutionSegment } from '@/store/terminalSlice';
import { useShallow } from 'zustand/react/shallow';

interface ThreadDrawerProps {
  agentId: string;
  onClose: () => void;
}

const plugins = { code };

/** Collapsible card for a single execution segment */
const SegmentCard: React.FC<{
  segment: ExecutionSegment;
  defaultExpanded: boolean;
}> = React.memo(({ segment, defaultExpanded }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const statusColor =
    segment.status === 'running'
      ? 'text-amber-400'
      : segment.status === 'error'
        ? 'text-red-400'
        : 'text-emerald-400';

  const statusIcon =
    segment.status === 'running' ? (
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
    ) : segment.status === 'error' ? (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ) : (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );

  const timeStr = new Date(segment.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      {/* Card header — clickable to toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors text-left"
      >
        {/* Expand/collapse chevron */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-zinc-500 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        {/* Status icon */}
        <span className={`shrink-0 flex items-center ${statusColor}`}>
          {statusIcon}
        </span>

        {/* Command preview */}
        <span className="flex-1 min-w-0 text-xs font-mono text-zinc-300 truncate">
          {segment.command || 'Execution'}
        </span>

        {/* Timestamp */}
        <span className="text-[10px] text-zinc-600 shrink-0">{timeStr}</span>
      </button>

      {/* Card body — collapsible markdown content */}
      {expanded && (
        <div className="px-3 py-2 border-t border-zinc-800/50 max-h-[60vh] overflow-y-auto">
          {segment.content ? (
            <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <Streamdown
                mode={segment.status === 'running' ? 'streaming' : 'static'}
                plugins={plugins}
              >
                {segment.content}
              </Streamdown>
            </div>
          ) : (
            <div className="text-xs text-zinc-600 italic">
              {segment.status === 'running' ? 'Waiting for output...' : 'No output'}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

SegmentCard.displayName = 'SegmentCard';

export const ThreadDrawer: React.FC<ThreadDrawerProps> = React.memo(({ agentId, onClose }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Narrow selectors — only re-render when these specific values change
  const { agentName, agentColor, isWorking } = useAppStore(
    useShallow((s) => {
      const agent = s.agents[agentId];
      const vs = agent?.visualState ?? 'offline';
      return {
        agentName: (agent?.profile.name as string) ?? 'Agent',
        agentColor: (agent?.profile.color as string) ?? '#6b7280',
        isWorking: vs === 'thinking' || vs === 'listening',
      };
    }),
  );

  // Execution segments — each segment is one execute() invocation
  const segments = useAppStore((s) => s.executeSegments[agentId] ?? []);

  // Auto-scroll to bottom when new segments arrive or latest segment updates
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 100) {
      el.scrollTop = el.scrollHeight;
    }
  }, [segments]);

  return (
    <div className="w-[480px] shrink-0 flex flex-col border-l border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
        {/* Agent indicator */}
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{
            backgroundColor: `${agentColor}25`,
            color: agentColor,
          }}
        >
          {agentName.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200 truncate">
              {agentName}
            </span>
            {isWorking && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-[10px] text-amber-400/80">Working</span>
              </span>
            )}
          </div>
          <span className="text-[10px] text-zinc-500">
            {segments.length > 0
              ? `${segments.length} execution${segments.length !== 1 ? 's' : ''}`
              : 'Live output'}
          </span>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          title="Close thread"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Execution segments */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2"
      >
        {segments.length > 0 ? (
          segments.map((segment, i) => (
            <SegmentCard
              key={segment.id}
              segment={segment}
              defaultExpanded={i === segments.length - 1}
            />
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            {isWorking ? 'Waiting for output...' : 'No output yet'}
          </div>
        )}
      </div>
    </div>
  );
});

ThreadDrawer.displayName = 'ThreadDrawer';
