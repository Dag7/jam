import React, { useRef, useCallback, useMemo, useState } from 'react';
import { Virtuoso, type VirtuosoHandle, type Components } from 'react-virtuoso';
import { useAppStore } from '@/store';
import { ChatMessageView } from '@/components/chat/ChatMessage';
import type { ChatMessage } from '@/store/chatSlice';

const PAGE_SIZE = 30;

interface AgentChatContainerProps {
  agentId: string;
}

const VirtuosoFooter = () => <div className="h-3" />;

export const AgentChatContainer: React.FC<AgentChatContainerProps> = ({
  agentId,
}) => {
  // Use the pre-indexed per-agent ID list — O(1) lookup, no filtering
  const agentMessageIds = useAppStore((s) => s.messageIdsByAgent[agentId]);
  const messagesById = useAppStore((s) => s.messagesById);
  const deleteMessage = useAppStore((s) => s.deleteMessage);

  // Derive ordered messages — only recomputes when this agent's IDs or the map changes
  const agentMessages = useMemo(() => {
    if (!agentMessageIds || agentMessageIds.length === 0) return [];
    return agentMessageIds.map((id) => messagesById[id]).filter(Boolean) as ChatMessage[];
  }, [agentMessageIds, messagesById]);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const loadingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  // Load older messages for this agent
  const handleStartReached = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setIsLoading(true);

    try {
      const state = useAppStore.getState();
      const ids = state.messageIdsByAgent[agentId];
      const oldestId = ids?.[0];
      const oldest = oldestId ? state.messagesById[oldestId] : undefined;
      const before = oldest
        ? new Date(oldest.timestamp).toISOString()
        : undefined;

      const result = await window.jam.chat.loadHistory({
        agentId,
        before,
        limit: PAGE_SIZE,
      });

      if (result.messages.length > 0) {
        const chatMessages: ChatMessage[] = result.messages.map((m) => ({
          id: `history-${m.timestamp}-${m.agentId}-${m.role}`,
          role: m.role === 'user' ? ('user' as const) : ('agent' as const),
          agentId: m.agentId,
          agentName: m.agentName,
          agentRuntime: m.agentRuntime,
          agentColor: m.agentColor,
          content: m.content,
          status: 'complete' as const,
          source: (m.source ?? 'voice') as 'text' | 'voice',
          timestamp: new Date(m.timestamp).getTime(),
        }));

        useAppStore.getState().prependMessages(chatMessages);
      }

      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Failed to load agent history:', err);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [agentId, hasMore]);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'auto' });
  }, []);

  const computeItemKey = useCallback(
    (_index: number, msg: ChatMessage) => msg.id,
    [],
  );

  const itemContent = useCallback(
    (_index: number, msg: ChatMessage) => (
      <div className="px-3 overflow-hidden">
        <ChatMessageView key={msg.id} message={msg} onDelete={deleteMessage} />
      </div>
    ),
    [deleteMessage],
  );

  // Stable components object
  const components = useMemo<Components<ChatMessage>>(
    () => ({
      Header: () =>
        isLoading ? (
          <div className="flex justify-center py-2">
            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <div className="w-2.5 h-2.5 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
              Loading...
            </div>
          </div>
        ) : !hasMore && agentMessages.length > 0 ? (
          <div className="flex justify-center py-2 mb-1">
            <span className="text-[9px] text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded-full">
              Start of history
            </span>
          </div>
        ) : null,
      Footer: VirtuosoFooter,
    }),
    [isLoading, hasMore, agentMessages.length],
  );

  if (agentMessages.length === 0 && !isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-zinc-600 text-xs">No messages yet</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 relative">
      <Virtuoso
        ref={virtuosoRef}
        data={agentMessages}
        computeItemKey={computeItemKey}
        defaultItemHeight={120}
        itemContent={itemContent}
        className="h-full"
        followOutput="auto"
        atBottomStateChange={setAtBottom}
        startReached={handleStartReached}
        initialTopMostItemIndex={agentMessages.length - 1}
        increaseViewportBy={{ top: 1500, bottom: 800 }}
        firstItemIndex={Math.max(0, 1000000 - agentMessages.length)}
        components={components}
      />

      {/* Scroll to bottom button */}
      {!atBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-2.5 py-1 bg-zinc-700 text-zinc-200 rounded-full shadow-lg hover:bg-zinc-600 transition-all text-[10px] font-medium"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
          </svg>
          Scroll to bottom
        </button>
      )}
    </div>
  );
};
