import React, { useState, useRef, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';

interface MessageThreadProps {
  messages: Array<{
    id: string;
    senderId: string;
    content: string;
    timestamp: string;
  }>;
  agents: Record<string, { name: string; color: string }>;
  onSend: (content: string) => void;
  onLoadMore?: () => void;
  isLoading: boolean;
}

const plugins = { code };

/** Truncate message content to prevent Streamdown from parsing huge markdown blocks */
const MAX_CONTENT_LENGTH = 2000;

const MessageRow = React.memo(function MessageRow({
  msg,
  sender,
}: {
  msg: { id: string; senderId: string; content: string; timestamp: string };
  sender: { name: string; color: string } | undefined;
}) {
  const content =
    msg.content.length > MAX_CONTENT_LENGTH
      ? msg.content.slice(0, MAX_CONTENT_LENGTH) + '\n\n…(truncated)'
      : msg.content;

  return (
    <div className="flex gap-3 px-4 py-2">
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
        style={{ backgroundColor: sender?.color ?? '#6b7280' }}
      >
        {(sender?.name ?? '?').charAt(0).toUpperCase()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className="text-sm font-semibold"
            style={{ color: sender?.color ?? '#9ca3af' }}
          >
            {sender?.name ?? 'Unknown'}
          </span>
          <span className="text-[10px] text-zinc-500">
            {new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 mt-0.5">
          <Streamdown mode="static" plugins={plugins}>
            {content}
          </Streamdown>
        </div>
      </div>
    </div>
  );
});

export const MessageThread = React.memo(function MessageThread({
  messages,
  agents,
  onSend,
  onLoadMore,
  isLoading,
}: MessageThreadProps) {
  const [input, setInput] = useState('');
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput('');
    setAtBottom(true);
  };

  const itemContent = useCallback(
    (index: number) => {
      const msg = messages[index];
      if (!msg) return null;
      return <MessageRow msg={msg} sender={agents[msg.senderId]} />;
    },
    [messages, agents],
  );

  return (
    <div className="flex flex-col h-full bg-zinc-900 relative">
      {/* Virtualized message list */}
      <Virtuoso
        ref={virtuosoRef}
        style={{ flex: 1 }}
        totalCount={messages.length}
        itemContent={itemContent}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        followOutput="smooth"
        atBottomStateChange={setAtBottom}
        atBottomThreshold={80}
        startReached={onLoadMore}
        overscan={200}
      />

      {isLoading && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm px-4 py-2">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" />
            <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.15s]" />
            <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.3s]" />
          </div>
          <span>Typing...</span>
        </div>
      )}

      {/* Scroll to bottom button */}
      {!atBottom && (
        <button
          onClick={() => {
            virtuosoRef.current?.scrollToIndex({
              index: messages.length - 1,
              behavior: 'smooth',
            });
          }}
          className="absolute bottom-20 right-6 w-8 h-8 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center text-zinc-300 hover:bg-zinc-600 hover:text-white transition-colors shadow-lg"
          title="Scroll to bottom"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-zinc-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message..."
            className="flex-1 bg-zinc-800 text-sm text-white rounded-lg px-3 py-2 border border-zinc-700 focus:border-zinc-500 focus:outline-none placeholder-zinc-500"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
});
