import React, { useEffect, useRef } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { useAppStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';

interface ThreadDrawerProps {
  agentId: string;
  onClose: () => void;
}

const plugins = { code };

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

  // Execute output — streamed markdown from the agent's command execution
  const content = useAppStore((s) => s.executeOutput[agentId] ?? '');

  // Auto-scroll to bottom when new content arrives — only if already near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 100) {
      el.scrollTop = el.scrollHeight;
    }
  }, [content]);

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
          <span className="text-[10px] text-zinc-500">Live output</span>
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

      {/* Streaming output */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3"
      >
        {content ? (
          <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <Streamdown
              mode="streaming"
              plugins={plugins}
            >
              {content}
            </Streamdown>
          </div>
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
