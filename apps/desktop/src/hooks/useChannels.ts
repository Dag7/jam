import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store';
import type { ChannelEntry, ChannelMessageEntry } from '@/store/teamSlice';

export function useChannels() {
  const channels = useAppStore((s) => s.channels);
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const channelMessages = useAppStore((s) => s.channelMessages);
  const setActiveChannel = useAppStore((s) => s.setActiveChannel);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const store = () => useAppStore.getState();

    window.jam.team.channels.list().then((result: unknown) => {
      store().setChannels(result as ChannelEntry[]);
      setIsLoading(false);
    });

    const cleanup = window.jam.team.channels.onMessageReceived((data) => {
      store().addChannelMessage(
        (data.channel as unknown as ChannelEntry).id,
        data.message as unknown as ChannelMessageEntry,
      );
    });

    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load messages when active channel changes
  useEffect(() => {
    if (!activeChannelId) return;
    const existing = useAppStore.getState().channelMessages[activeChannelId];
    if (existing?.length) return; // already loaded

    window.jam.team.channels
      .getMessages(activeChannelId, 50)
      .then((result: unknown) => {
        useAppStore.getState().prependChannelMessages(
          activeChannelId,
          (result as ChannelMessageEntry[]).reverse(),
        );
      });
  }, [activeChannelId]);

  const sendMessage = useCallback(
    async (content: string, senderId: string) => {
      if (!activeChannelId) return;
      return window.jam.team.channels.sendMessage(
        activeChannelId,
        senderId,
        content,
      );
    },
    [activeChannelId],
  );

  const loadMore = useCallback(async () => {
    if (!activeChannelId) return;
    const existing = useAppStore.getState().channelMessages[activeChannelId] ?? [];
    const oldest = existing[0];
    if (!oldest) return;

    const older = await window.jam.team.channels.getMessages(
      activeChannelId,
      50,
      oldest.id,
    );
    useAppStore.getState().prependChannelMessages(
      activeChannelId,
      (older as unknown as ChannelMessageEntry[]).reverse(),
    );
  }, [activeChannelId]);

  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null;
  const activeMessages = activeChannelId
    ? channelMessages[activeChannelId] ?? []
    : [];

  return {
    channels,
    activeChannel,
    activeChannelId,
    messages: activeMessages,
    setActiveChannel,
    sendMessage,
    loadMore,
    isLoading,
  };
}
