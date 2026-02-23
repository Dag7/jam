import { useAppStore } from '@/store';
import { useChannels } from '@/hooks/useChannels';
import { ChannelList } from '@/components/dashboard/ChannelList';
import { MessageThread } from '@/components/dashboard/MessageThread';

export function CommunicationsContainer() {
  const agents = useAppStore((s) => s.agents);
  const {
    channels,
    activeChannelId,
    messages,
    setActiveChannel,
    sendMessage,
    isLoading,
  } = useChannels();

  const agentMap = Object.fromEntries(
    Object.values(agents).map((a) => [
      a.profile.id,
      { name: a.profile.name, color: a.profile.color },
    ]),
  );

  // Default sender — use first running agent or first agent
  const defaultSender =
    Object.values(agents).find((a) => a.status === 'running')?.profile.id ??
    Object.values(agents)[0]?.profile.id ??
    'user';

  const handleSend = async (content: string) => {
    await sendMessage(content, defaultSender);
  };

  return (
    <div className="flex h-full gap-4">
      <div className="w-48 shrink-0">
        <ChannelList
          channels={channels}
          activeChannelId={activeChannelId}
          onSelect={setActiveChannel}
        />
      </div>

      <div className="flex-1 flex flex-col bg-zinc-800/30 rounded-lg overflow-hidden">
        {activeChannelId ? (
          <MessageThread
            messages={messages}
            agents={agentMap}
            onSend={handleSend}
            isLoading={isLoading}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500">
            Select a channel to view messages
          </div>
        )}
      </div>
    </div>
  );
}
