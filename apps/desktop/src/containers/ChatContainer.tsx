import React from 'react';
import { useAppStore } from '@/store';
import { ChatView } from '@/components/chat/ChatView';

export const ChatContainer: React.FC = () => {
  const messages = useAppStore((s) => s.messages);

  return <ChatView messages={messages} />;
};
