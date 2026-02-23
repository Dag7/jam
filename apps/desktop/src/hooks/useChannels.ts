import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store';
import type { ChannelEntry, ChannelMessageEntry } from '@/store/teamSlice';

export function useChannels() {
  const channels = useAppStore((s) => s.channels);
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const channelMessages = useAppStore((s) => s.channelMessages);
  const setChannels = useAppStore((s) => s.setChannels);
  const setActiveChannel = useAppStore((s) => s.setActiveChannel);
  const addChannelMessage = useAppStore((s) => s.addChannelMessage);
  const prependChannelMessages = useAppStore((s) => s.prependChannelMessages);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    window.jam.team.channels.list().then((result: unknown) => {
      setChannels(result as ChannelEntry[]);
      setIsLoading(false);
    });

    const cleanup = window.jam.team.channels.onMessageReceived((data) => {
      addChannelMessage(
        (data.channel as unknown as ChannelEntry).id,
        data.message as unknown as ChannelMessageEntry,
      );
    });

    return cleanup;
  }, [setChannels, addChannelMessage]);

  // Load messages when active channel changes
  useEffect(() => {
    if (!activeChannelId) return;
    if (channelMessages[activeChannelId]?.length) return; // already loaded

    window.jam.team.channels
      .getMessages(activeChannelId, 50)
      .then((result: unknown) => {
        prependChannelMessages(
          activeChannelId,
          (result as ChannelMessageEntry[]).reverse(),
        );
      });
  }, [activeChannelId, channelMessages, prependChannelMessages]);

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
    const existing = channelMessages[activeChannelId] ?? [];
    const oldest = existing[0];
    if (!oldest) return;

    const older = await window.jam.team.channels.getMessages(
      activeChannelId,
      50,
      oldest.id,
    );
    prependChannelMessages(
      activeChannelId,
      (older as unknown as ChannelMessageEntry[]).reverse(),
    );
  }, [activeChannelId, channelMessages, prependChannelMessages]);

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
