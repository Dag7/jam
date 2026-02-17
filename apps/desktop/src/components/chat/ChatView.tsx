import React, { useRef, useEffect } from 'react';
import { ChatMessageView } from './ChatMessage';
import type { ChatMessage } from '@/store/chatSlice';

interface ChatViewProps {
  messages: ChatMessage[];
}

export const ChatView: React.FC<ChatViewProps> = ({ messages }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  if (messages.length === 0) {
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
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
      {messages.map((msg) => (
        <ChatMessageView key={msg.id} message={msg} />
      ))}
    </div>
  );
};
