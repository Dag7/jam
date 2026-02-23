export type ChannelType = 'team' | 'direct' | 'broadcast';

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  participants: string[];
  createdAt: string;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  timestamp: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}
