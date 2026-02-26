import React, { useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/store';
import { ChatView } from '@/components/chat/ChatView';
import type { ChatMessage } from '@/store/chatSlice';

const HISTORY_PAGE_SIZE = 50;

export const ChatContainer: React.FC = () => {
  // Subscribe to the ID list (changes only on add/delete/prepend) and the map
  const messageIds = useAppStore((s) => s.messageIds);
  const messagesById = useAppStore((s) => s.messagesById);
  const isLoadingHistory = useAppStore((s) => s.isLoadingHistory);
  const hasMoreHistory = useAppStore((s) => s.hasMoreHistory);
  const threadAgentId = useAppStore((s) => s.threadAgentId);
  const setThreadAgent = useAppStore((s) => s.setThreadAgent);
  const deleteMessage = useAppStore((s) => s.deleteMessage);
  const loadingRef = useRef(false);

  // Derive ordered array — only recomputes when IDs or map changes
  const messages = useMemo(
    () => messageIds.map((id) => messagesById[id]).filter(Boolean) as ChatMessage[],
    [messageIds, messagesById],
  );

  const handleLoadMore = useCallback(async () => {
    if (!useAppStore.getState().hasMoreHistory || loadingRef.current) return;
    loadingRef.current = true;

    const { prependMessages, setIsLoadingHistory, setHasMoreHistory, messageIds: ids, messagesById: byId } =
      useAppStore.getState();

    const oldestId = ids[0];
    const oldest = oldestId ? byId[oldestId] : undefined;
    if (!oldest) { loadingRef.current = false; return; }

    setIsLoadingHistory(true);
    try {
      const before = new Date(oldest.timestamp).toISOString();
      const result = await window.jam.chat.loadHistory({
        before,
        limit: HISTORY_PAGE_SIZE,
      });

      if (result.messages.length > 0) {
        const chatMessages: ChatMessage[] = result.messages.map((m, i) => ({
          id: `history-${m.timestamp}-${m.agentId}-${m.role}-${i}`,
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
        prependMessages(chatMessages);
      }

      setHasMoreHistory(result.hasMore);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    } finally {
      setIsLoadingHistory(false);
      loadingRef.current = false;
    }
  }, []);

  const handleViewOutput = useCallback((agentId: string) => {
    const current = useAppStore.getState().threadAgentId;
    setThreadAgent(current === agentId ? null : agentId);
  }, [setThreadAgent]);

  return (
    <ChatView
      messages={messages}
      isLoadingHistory={isLoadingHistory}
      hasMoreHistory={hasMoreHistory}
      onLoadMore={handleLoadMore}
      onViewOutput={handleViewOutput}
      onDeleteMessage={deleteMessage}
      threadAgentId={threadAgentId}
    />
  );
};
