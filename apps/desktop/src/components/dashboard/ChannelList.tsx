interface ChannelListProps {
  channels: Array<{ id: string; name: string; type: string }>;
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
}

const typeIcons: Record<string, string> = {
  team: '\u{1F465}',
  direct: '\u{27A1}\u{FE0F}',
  broadcast: '\u{1F4E2}',
};

export function ChannelList({ channels, activeChannelId, onSelect }: ChannelListProps) {
  return (
    <div className="flex flex-col py-2">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-3 mb-2">
        Channels
      </h3>
      <div className="space-y-0.5">
        {channels.map((channel) => {
          const isActive = channel.id === activeChannelId;
          return (
            <button
              key={channel.id}
              onClick={() => onSelect(channel.id)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors ${
                isActive
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              <span className="text-xs">{typeIcons[channel.type] ?? '#'}</span>
              <span className="truncate"># {channel.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
