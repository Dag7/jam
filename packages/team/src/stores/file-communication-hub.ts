import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Channel,
  ChannelMessage,
  ChannelType,
  ICommunicationHub,
  IEventBus,
} from '@jam/core';
import { Events } from '@jam/core';

export class FileCommunicationHub implements ICommunicationHub {
  private readonly channelsDir: string;
  private channelCache: Map<string, Channel> | null = null;

  constructor(
    baseDir: string,
    private readonly eventBus: IEventBus,
  ) {
    this.channelsDir = join(baseDir, 'channels');
  }

  async createChannel(
    name: string,
    type: ChannelType,
    participants: string[],
  ): Promise<Channel> {
    const channel: Channel = {
      id: randomUUID(),
      name,
      type,
      participants,
      createdAt: new Date().toISOString(),
    };

    const dir = join(this.channelsDir, channel.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'meta.json'), JSON.stringify(channel, null, 2), 'utf-8');

    if (this.channelCache) {
      this.channelCache.set(channel.id, channel);
    }

    return channel;
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    const channels = await this.loadChannels();
    return channels.get(channelId) ?? null;
  }

  async listChannels(agentId?: string): Promise<Channel[]> {
    const channels = await this.loadChannels();
    const all = Array.from(channels.values());
    if (!agentId) return all;
    return all.filter((c) => c.participants.includes(agentId));
  }

  async sendMessage(
    channelId: string,
    senderId: string,
    content: string,
    replyTo?: string,
  ): Promise<ChannelMessage> {
    const channel = await this.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    const message: ChannelMessage = {
      id: randomUUID(),
      channelId,
      senderId,
      content,
      timestamp: new Date().toISOString(),
      replyTo,
    };

    const msgFile = join(this.channelsDir, channelId, 'messages.jsonl');
    await appendFile(msgFile, JSON.stringify(message) + '\n', 'utf-8');

    this.eventBus.emit(Events.MESSAGE_RECEIVED, { message, channel });

    return message;
  }

  async getMessages(
    channelId: string,
    limit = 50,
    before?: string,
  ): Promise<ChannelMessage[]> {
    const msgFile = join(this.channelsDir, channelId, 'messages.jsonl');

    let lines: string[];
    try {
      const data = await readFile(msgFile, 'utf-8');
      lines = data.split('\n').filter((l) => l.trim());
    } catch {
      return [];
    }

    let messages: ChannelMessage[] = [];
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }

    // Reverse chronological
    messages.reverse();

    if (before) {
      const idx = messages.findIndex((m) => m.id === before);
      if (idx >= 0) {
        messages = messages.slice(idx + 1);
      }
    }

    return messages.slice(0, limit);
  }

  async getUnreadCount(
    channelId: string,
    _agentId: string,
    since: string,
  ): Promise<number> {
    const messages = await this.getMessages(channelId, 1000);
    const sinceDate = new Date(since).getTime();
    return messages.filter((m) => new Date(m.timestamp).getTime() > sinceDate).length;
  }

  private async loadChannels(): Promise<Map<string, Channel>> {
    if (this.channelCache) return this.channelCache;

    this.channelCache = new Map();

    let entries: string[];
    try {
      const { readdir } = await import('node:fs/promises');
      entries = await readdir(this.channelsDir).then((e) =>
        e.filter((name) => !name.startsWith('.')),
      );
    } catch {
      return this.channelCache;
    }

    for (const entry of entries) {
      try {
        const metaPath = join(this.channelsDir, entry, 'meta.json');
        const data = await readFile(metaPath, 'utf-8');
        const channel: Channel = JSON.parse(data);
        this.channelCache.set(channel.id, channel);
      } catch {
        // skip invalid
      }
    }

    return this.channelCache;
  }
}
