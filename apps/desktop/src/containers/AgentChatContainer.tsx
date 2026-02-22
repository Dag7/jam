import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '@/store';
import { ChatMessageView } from '@/components/chat/ChatMessage';
import type { ChatMessage } from '@/store/chatSlice';

const PAGE_SIZE = 30;

interface AgentChatContainerProps {
  agentId: string;
}

export const AgentChatContainer: React.FC<AgentChatContainerProps> = ({
  agentId,
}) => {
  const messages = useAppStore((s) => s.messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const loadingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const agentMessages = useMemo(
    () => messages.filter((m) => m.agentId === agentId),
    [messages, agentId],
  );

  // Track whether user is near bottom
  const updateIsAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Auto-scroll to bottom on new messages (only if at bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [agentMessages.length]);

  // Preserve scroll position when prepending
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevScrollHeightRef.current > 0) {
      const diff = el.scrollHeight - prevScrollHeightRef.current;
      if (diff > 0) el.scrollTop += diff;
    }
    prevScrollHeightRef.current = el.scrollHeight;
  }, [agentMessages]);

  // Load older messages for this agent
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setIsLoading(true);

    try {
      const oldest = agentMessages[0];
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

        prevScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0;
        useAppStore.getState().prependMessages(chatMessages);
      }

      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Failed to load agent history:', err);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [agentId, agentMessages, hasMore]);

  // Detect scroll near top
  const handleScroll = useCallback(() => {
    updateIsAtBottom();
    const el = scrollRef.current;
    if (!el || isLoading || !hasMore) return;
    if (el.scrollTop < 150) {
      loadMore();
    }
  }, [isLoading, hasMore, loadMore, updateIsAtBottom]);

  if (agentMessages.length === 0 && !isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-zinc-600 text-xs">No messages yet</p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-3 py-3"
      onScroll={handleScroll}
    >
      {isLoading && (
        <div className="flex justify-center py-2">
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <div className="w-2.5 h-2.5 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
            Loading...
          </div>
        </div>
      )}
      {!hasMore && agentMessages.length > 0 && (
        <div className="flex justify-center py-2 mb-1">
          <span className="text-[9px] text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded-full">
            Start of history
          </span>
        </div>
      )}
      {agentMessages.map((msg) => (
        <ChatMessageView key={msg.id} message={msg} />
      ))}
    </div>
  );
};
