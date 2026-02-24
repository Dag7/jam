import React, { useCallback, useRef, useEffect } from 'react';
import { ChatMessageView } from './ChatMessage';
import { useScrollToBottom } from '@/hooks/useScrollToBottom';
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

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isLoadingHistory,
  hasMoreHistory,
  onLoadMore,
  onViewOutput,
  onDeleteMessage,
  threadAgentId,
}) => {
  const {
    containerRef,
    containerNode,
    endRef,
    showScrollButton,
    scrollToBottom,
    reset,
    onContainerPointerDown,
  } = useScrollToBottom();

  const prevScrollHeightRef = useRef(0);
  const wasLoadingRef = useRef(false);
  const initialScrollDoneRef = useRef(false);

  // Scroll to bottom on initial message load
  useEffect(() => {
    if (messages.length > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom('instant');
    }
  }, [messages.length, scrollToBottom]);

  // Reset when messages are cleared
  useEffect(() => {
    if (messages.length === 0) {
      initialScrollDoneRef.current = false;
      prevScrollHeightRef.current = 0;
      reset();
    }
  }, [messages.length, reset]);

  // Save scroll height when starting to load older messages
  useEffect(() => {
    if (isLoadingHistory && !wasLoadingRef.current) {
      const el = containerNode.current;
      if (el) {
        prevScrollHeightRef.current = el.scrollHeight;
      }
    }
    wasLoadingRef.current = !!isLoadingHistory;
  }, [isLoadingHistory, containerNode]);

  // Preserve scroll position after older messages are loaded
  useEffect(() => {
    const el = containerNode.current;
    if (!el) return;
    if (prevScrollHeightRef.current > 0 && !isLoadingHistory) {
      const newScrollHeight = el.scrollHeight;
      const scrollDiff = newScrollHeight - prevScrollHeightRef.current;
      if (scrollDiff > 0) {
        el.scrollTop = scrollDiff;
      }
      prevScrollHeightRef.current = 0;
    }
  }, [messages, isLoadingHistory, containerNode]);

  // Detect scroll near top for infinite scroll
  const handleScroll = useCallback(() => {
    const el = containerNode.current;
    if (!el || !onLoadMore || !hasMoreHistory || isLoadingHistory) return;
    if (el.scrollTop < 200) {
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  }, [onLoadMore, hasMoreHistory, isLoadingHistory, containerNode]);

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
      <div
        ref={containerRef}
        className="h-full overflow-y-auto px-4 py-4"
        onScroll={handleScroll}
        onPointerDown={onContainerPointerDown}
      >
        {/* Loading indicator at top */}
        {isLoadingHistory && (
          <div className="flex justify-center py-3">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <div className="w-3 h-3 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
              Loading older messages...
            </div>
          </div>
        )}

        {/* "Beginning of history" marker */}
        {!hasMoreHistory && messages.length > 0 && (
          <div className="flex justify-center py-3 mb-2">
            <span className="text-[10px] text-zinc-600 bg-zinc-800/50 px-3 py-1 rounded-full">
              Beginning of conversation history
            </span>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessageView
            key={msg.id}
            message={msg}
            onViewOutput={onViewOutput}
            isThreadOpen={!!msg.agentId && msg.agentId === threadAgentId}
            onDelete={onDeleteMessage}
          />
        ))}

        {/* Scroll anchor */}
        <div ref={endRef} className="min-h-[1px] shrink-0" />
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          type="button"
          onClick={() => scrollToBottom('instant')}
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
};
