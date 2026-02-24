import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '@/store';
import { ChatMessageView } from '@/components/chat/ChatMessage';
import { useScrollToBottom } from '@/hooks/useScrollToBottom';
import type { ChatMessage } from '@/store/chatSlice';

const PAGE_SIZE = 30;

interface AgentChatContainerProps {
  agentId: string;
}

export const AgentChatContainer: React.FC<AgentChatContainerProps> = ({
  agentId,
}) => {
  const messages = useAppStore((s) => s.messages);
  const deleteMessage = useAppStore((s) => s.deleteMessage);
  const prevScrollHeightRef = useRef(0);
  const wasLoadingRef = useRef(false);
  const loadingRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const {
    containerRef,
    containerNode,
    endRef,
    showScrollButton,
    scrollToBottom,
    reset,
    onContainerPointerDown,
  } = useScrollToBottom();

  const agentMessages = useMemo(
    () => messages.filter((m) => m.agentId === agentId),
    [messages, agentId],
  );

  // Scroll to bottom on initial load
  useEffect(() => {
    if (agentMessages.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom('instant');
    }
  }, [agentMessages.length, scrollToBottom]);

  // Reset on agent change
  useEffect(() => {
    initialScrollDoneRef.current = false;
    prevScrollHeightRef.current = 0;
    setHasMore(true);
    reset();
  }, [agentId, reset]);

  // Save scroll height when starting to load older messages
  useEffect(() => {
    if (isLoading && !wasLoadingRef.current) {
      const el = containerNode.current;
      if (el) {
        prevScrollHeightRef.current = el.scrollHeight;
      }
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, containerNode]);

  // Preserve scroll position after older messages are loaded
  useEffect(() => {
    const el = containerNode.current;
    if (!el) return;
    if (prevScrollHeightRef.current > 0 && !isLoading) {
      const newScrollHeight = el.scrollHeight;
      const scrollDiff = newScrollHeight - prevScrollHeightRef.current;
      if (scrollDiff > 0) {
        el.scrollTop = scrollDiff;
      }
      prevScrollHeightRef.current = 0;
    }
  }, [agentMessages, isLoading, containerNode]);

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

        prevScrollHeightRef.current = containerNode.current?.scrollHeight ?? 0;
        useAppStore.getState().prependMessages(chatMessages);
      }

      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Failed to load agent history:', err);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [agentId, agentMessages, hasMore, containerNode]);

  // Detect scroll near top
  const handleScroll = useCallback(() => {
    const el = containerNode.current;
    if (!el || isLoading || !hasMore) return;
    if (el.scrollTop < 150) {
      loadMore();
    }
  }, [isLoading, hasMore, loadMore, containerNode]);

  if (agentMessages.length === 0 && !isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-zinc-600 text-xs">No messages yet</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 relative">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto px-3 py-3"
        onScroll={handleScroll}
        onPointerDown={onContainerPointerDown}
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
          <ChatMessageView key={msg.id} message={msg} onDelete={deleteMessage} />
        ))}

        {/* Scroll anchor */}
        <div ref={endRef} className="min-h-[1px] shrink-0" />
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          type="button"
          onClick={() => scrollToBottom('instant')}
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
