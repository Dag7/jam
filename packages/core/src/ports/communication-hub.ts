import type { Channel, ChannelMessage, ChannelType } from '../models/communication.js';

export interface ICommunicationHub {
  createChannel(name: string, type: ChannelType, participants: string[]): Promise<Channel>;
  getChannel(channelId: string): Promise<Channel | null>;
  listChannels(agentId?: string): Promise<Channel[]>;
  sendMessage(
    channelId: string,
    senderId: string,
    content: string,
    replyTo?: string,
  ): Promise<ChannelMessage>;
  getMessages(channelId: string, limit?: number, before?: string): Promise<ChannelMessage[]>;
  getUnreadCount(channelId: string, agentId: string, since: string): Promise<number>;
}
