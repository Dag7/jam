import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle, type Components } from 'react-virtuoso';
import { ChatMessageView } from './ChatMessage';
import type { ChatMessage } from '@/store/chatSlice';

interface ChatViewProps {
  messages: ChatMessage[];
  isLoadingHistory?: boolean;
  hasMoreHistory?: boolean;
  onLoadMore?: () => void;
  onViewOutput?: (agentId: string) => void;
  onDeleteMessage?: (id: string) => void;
  threadAgentId?: string | null;
}

const VirtuosoFooter = () => <div className="h-4" />;

export const ChatView: React.FC<ChatViewProps> = React.memo(({
  messages,
  isLoadingHistory,
  hasMoreHistory,
  onLoadMore,
  onViewOutput,
  onDeleteMessage,
  threadAgentId,
}) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Load older messages when scrolling near the top
  const handleStartReached = useCallback(() => {
    if (hasMoreHistory && !isLoadingHistory && onLoadMore) {
      onLoadMore();
    }
  }, [hasMoreHistory, isLoadingHistory, onLoadMore]);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'auto' });
  }, []);

  // Stable key function — uses message ID so Virtuoso preserves height cache across prepends
  const computeItemKey = useCallback(
    (_index: number, msg: ChatMessage) => msg.id,
    [],
  );

  // Render each message row — padding applied here, not on Virtuoso container
  const itemContent = useCallback(
    (_index: number, msg: ChatMessage) => (
      <div className="px-4 overflow-hidden">
        <ChatMessageView
          key={msg.id}
          message={msg}
          onViewOutput={onViewOutput}
          isThreadOpen={!!msg.agentId && msg.agentId === threadAgentId}
          onDelete={onDeleteMessage}
        />
      </div>
    ),
    [onViewOutput, onDeleteMessage, threadAgentId],
  );

  // Stable components object — prevents Virtuoso from remounting internals
  const components = useMemo<Components<ChatMessage>>(
    () => ({
      Header: () =>
        isLoadingHistory ? (
          <div className="flex justify-center py-3">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <div className="w-3 h-3 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
              Loading older messages...
            </div>
          </div>
        ) : !hasMoreHistory && messages.length > 0 ? (
          <div className="flex justify-center py-3 mb-2">
            <span className="text-[10px] text-zinc-600 bg-zinc-800/50 px-3 py-1 rounded-full">
              Beginning of conversation history
            </span>
          </div>
        ) : null,
      Footer: VirtuosoFooter,
    }),
    [isLoadingHistory, hasMoreHistory, messages.length],
  );

  if (messages.length === 0 && !isLoadingHistory) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="mx-auto text-zinc-700 mb-4"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <p className="text-zinc-500 text-sm">
            Start a conversation. Type a command or use voice.
          </p>
          <p className="text-zinc-600 text-xs mt-1">
            Address agents by name, e.g. &quot;Hey Sue, refactor the login page&quot;
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 relative">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        computeItemKey={computeItemKey}
        defaultItemHeight={120}
        itemContent={itemContent}
        className="h-full"
        followOutput="auto"
        atBottomStateChange={setAtBottom}
        startReached={handleStartReached}
        initialTopMostItemIndex={messages.length - 1}
        increaseViewportBy={{ top: 1500, bottom: 800 }}
        firstItemIndex={Math.max(0, 1000000 - messages.length)}
        components={components}
      />

      {/* Scroll to bottom button */}
      {!atBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 text-zinc-200 rounded-full shadow-lg hover:bg-zinc-600 transition-all text-xs font-medium"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
          </svg>
          Scroll to bottom
        </button>
      )}
    </div>
  );
});

ChatView.displayName = 'ChatView';
