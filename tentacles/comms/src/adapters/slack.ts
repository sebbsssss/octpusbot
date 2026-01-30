/**
 * Slack Adapter
 * Uses Bolt for Slack API
 */

import { App, LogLevel, SayFn, Block, KnownBlock } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { nanoid } from 'nanoid';
import { Message, Attachment, ChannelType } from '@octpus/types';
import { ChannelAdapter, SendOptions, MessageButton } from '../index';

export interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  allowedWorkspaces?: string[];
  allowedChannels?: string[];
  allowedUsers?: string[];
  port?: number;
}

export class SlackAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'slack';
  status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

  private app: App;
  private client: WebClient;
  private config: SlackConfig;
  private messageHandlers: ((message: Message) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];

  constructor(config: SlackConfig) {
    this.config = config;

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      logLevel: LogLevel.INFO,
    });

    this.client = new WebClient(config.botToken);

    // Handle messages
    this.app.message(async ({ message, say }) => {
      // Type guard for message events with text
      if (!('text' in message) || !('user' in message)) return;

      // Check if user is allowed
      if (
        this.config.allowedUsers &&
        !this.config.allowedUsers.includes(message.user)
      ) {
        return;
      }

      // Check if channel is allowed
      if (
        this.config.allowedChannels &&
        !this.config.allowedChannels.includes(message.channel)
      ) {
        return;
      }

      const octpusMessage = await this.transformMessage(message);
      this.messageHandlers.forEach((handler) => handler(octpusMessage));
    });

    // Handle app mentions
    this.app.event('app_mention', async ({ event, say }) => {
      // Check if user is allowed
      if (
        this.config.allowedUsers &&
        !this.config.allowedUsers.includes(event.user)
      ) {
        return;
      }

      const message = await this.transformMention(event);
      this.messageHandlers.forEach((handler) => handler(message));
    });

    // Handle button clicks
    this.app.action(/^(approve|reject):.*$/, async ({ action, ack, body }) => {
      await ack();

      if (!('action_id' in action)) return;

      const [actionType, actionId] = action.action_id.split(':');

      const message: Message = {
        id: nanoid(),
        channel: 'slack',
        chatId: body.channel?.id || '',
        userId: body.user.id,
        content: `/${actionType} ${actionId}`,
        timestamp: new Date(),
        role: 'user',
        metadata: {
          isCallback: true,
          callbackAction: actionType,
          callbackData: actionId,
        },
      };

      this.messageHandlers.forEach((handler) => handler(message));
    });

    // Error handling
    this.app.error(async (error) => {
      this.status = 'error';
      this.errorHandlers.forEach((handler) => handler(error as Error));
    });
  }

  async connect(): Promise<void> {
    this.status = 'connecting';

    try {
      await this.app.start(this.config.port || 3000);
      this.status = 'connected';
      console.log('🐙 Slack: Connected via Socket Mode');
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.app.stop();
    this.status = 'disconnected';
  }

  async sendMessage(
    chatId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: options?.parseMode === 'markdown' ? 'mrkdwn' : 'plain_text',
          text: content,
        },
      },
    ];

    // Add buttons if provided
    if (options?.buttons && options.buttons.length > 0) {
      blocks.push({
        type: 'actions',
        elements: options.buttons.map((btn) => ({
          type: 'button' as const,
          text: {
            type: 'plain_text' as const,
            text: btn.text,
          },
          action_id: `${btn.action}:${btn.data || ''}`,
          style:
            btn.action === 'approve'
              ? ('primary' as const)
              : btn.action === 'reject'
              ? ('danger' as const)
              : undefined,
        })),
      });
    }

    const result = await this.client.chat.postMessage({
      channel: chatId,
      text: content,
      blocks,
    });

    return {
      id: result.ts || nanoid(),
      channel: 'slack',
      chatId: chatId,
      userId: 'octpus',
      content: content,
      timestamp: new Date(parseFloat(result.ts || '0') * 1000),
      role: 'assistant',
    };
  }

  async sendReply(
    chatId: string,
    replyToId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    const result = await this.client.chat.postMessage({
      channel: chatId,
      text: content,
      thread_ts: replyToId,
      mrkdwn: options?.parseMode === 'markdown',
    });

    return {
      id: result.ts || nanoid(),
      channel: 'slack',
      chatId: chatId,
      userId: 'octpus',
      content: content,
      timestamp: new Date(parseFloat(result.ts || '0') * 1000),
      role: 'assistant',
      replyToId: replyToId,
    };
  }

  async sendAttachment(
    chatId: string,
    attachment: Attachment,
    caption?: string
  ): Promise<Message> {
    const result = await this.client.files.uploadV2({
      channel_id: chatId,
      file: attachment.data,
      filename: attachment.filename || 'file',
      initial_comment: caption,
    });

    return {
      id: nanoid(),
      channel: 'slack',
      chatId: chatId,
      userId: 'octpus',
      content: caption || '',
      attachments: [attachment],
      timestamp: new Date(),
      role: 'assistant',
    };
  }

  onMessage(handler: (message: Message) => void): void {
    this.messageHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Send an ephemeral message (only visible to one user)
   */
  async sendEphemeral(
    chatId: string,
    userId: string,
    content: string
  ): Promise<void> {
    await this.client.chat.postEphemeral({
      channel: chatId,
      user: userId,
      text: content,
    });
  }

  /**
   * Update an existing message
   */
  async updateMessage(
    chatId: string,
    messageId: string,
    content: string
  ): Promise<void> {
    await this.client.chat.update({
      channel: chatId,
      ts: messageId,
      text: content,
    });
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(
    chatId: string,
    messageId: string,
    emoji: string
  ): Promise<void> {
    await this.client.reactions.add({
      channel: chatId,
      timestamp: messageId,
      name: emoji.replace(/:/g, ''),
    });
  }

  /**
   * Get user info
   */
  async getUserInfo(userId: string) {
    const result = await this.client.users.info({ user: userId });
    return result.user;
  }

  /**
   * Get channel info
   */
  async getChannelInfo(channelId: string) {
    const result = await this.client.conversations.info({ channel: channelId });
    return result.channel;
  }

  private async transformMessage(msg: any): Promise<Message> {
    // Extract attachments
    const attachments: Attachment[] = [];

    if (msg.files) {
      for (const file of msg.files) {
        attachments.push({
          id: file.id,
          type: file.mimetype?.startsWith('image/')
            ? 'image'
            : file.mimetype?.startsWith('audio/')
            ? 'audio'
            : file.mimetype?.startsWith('video/')
            ? 'video'
            : 'file',
          url: file.url_private,
          mimeType: file.mimetype || 'application/octet-stream',
          filename: file.name,
          size: file.size,
        });
      }
    }

    return {
      id: msg.ts || nanoid(),
      channel: 'slack',
      chatId: msg.channel,
      userId: msg.user,
      content: msg.text || '',
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: new Date(parseFloat(msg.ts || '0') * 1000),
      role: 'user',
      metadata: {
        threadTs: msg.thread_ts,
        team: msg.team,
      },
    };
  }

  private async transformMention(event: any): Promise<Message> {
    // Remove bot mention from text
    const text = event.text?.replace(/<@[A-Z0-9]+>/g, '').trim() || '';

    return {
      id: event.ts || nanoid(),
      channel: 'slack',
      chatId: event.channel,
      userId: event.user,
      content: text,
      timestamp: new Date(parseFloat(event.ts || '0') * 1000),
      role: 'user',
      metadata: {
        threadTs: event.thread_ts,
        isMention: true,
      },
    };
  }
}
