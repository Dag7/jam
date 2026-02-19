import React, { useRef, useEffect, useCallback } from 'react';
import { ChatMessageView } from './ChatMessage';
import type { ChatMessage } from '@/store/chatSlice';

interface ChatViewProps {
  messages: ChatMessage[];
  isLoadingHistory?: boolean;
  hasMoreHistory?: boolean;
  onLoadMore?: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isLoadingHistory,
  hasMoreHistory,
  onLoadMore,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(messages.length);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);

  // Track whether user is near bottom
  const updateIsAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  // Reset refs when messages are cleared (prevents stale scroll state)
  useEffect(() => {
    if (messages.length === 0) {
      prevMessageCountRef.current = 0;
      prevScrollHeightRef.current = 0;
      isAtBottomRef.current = true;
    }
  }, [messages.length]);

  // Auto-scroll to bottom on new messages (only if already at bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const prevCount = prevMessageCountRef.current;
    const newCount = messages.length;
    prevMessageCountRef.current = newCount;

    if (newCount > prevCount) {
      // Messages were added at the end — scroll down if we were at bottom
      if (isAtBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    } else if (newCount > 0 && prevCount === 0) {
      // Initial load — scroll to bottom
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // Preserve scroll position when prepending history
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevScrollHeightRef.current > 0) {
      const heightDiff = el.scrollHeight - prevScrollHeightRef.current;
      if (heightDiff > 0) {
        el.scrollTop += heightDiff;
      }
    }
    prevScrollHeightRef.current = el.scrollHeight;
  }, [messages]);

  // Detect scroll near top for infinite scroll
  const handleScroll = useCallback(() => {
    updateIsAtBottom();
    const el = scrollRef.current;
    if (!el || !onLoadMore || !hasMoreHistory || isLoadingHistory) return;
    if (el.scrollTop < 200) {
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  }, [onLoadMore, hasMoreHistory, isLoadingHistory, updateIsAtBottom]);

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
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-4"
      onScroll={handleScroll}
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
        <ChatMessageView key={msg.id} message={msg} />
      ))}
    </div>
  );
};
