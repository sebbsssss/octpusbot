/**
 * Comms Tentacle
 * The voice of the Octpus - handles all communication channels
 *
 * Supported channels:
 * - Telegram (via grammY)
 * - Discord (via discord.js)
 * - WhatsApp (via Baileys)
 * - Slack (via Bolt)
 * - CLI (built-in)
 * - API (WebSocket/REST)
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import {
  TentacleRegistration,
  TentacleCapability,
  TentacleStatus,
  PermissionLevel,
  Message,
  ChannelType,
  Attachment,
} from '@octpus/types';

import { TelegramAdapter } from './adapters/telegram';
import { DiscordAdapter } from './adapters/discord';
import { WhatsAppAdapter } from './adapters/whatsapp';
import { SlackAdapter } from './adapters/slack';

// =============================================================================
// CHANNEL ADAPTER INTERFACE
// =============================================================================

export interface ChannelAdapter {
  type: ChannelType;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  sendMessage(chatId: string, content: string, options?: SendOptions): Promise<Message>;
  sendReply(chatId: string, replyToId: string, content: string, options?: SendOptions): Promise<Message>;
  sendAttachment(chatId: string, attachment: Attachment, caption?: string): Promise<Message>;

  onMessage(handler: (message: Message) => void): void;
  onError(handler: (error: Error) => void): void;
}

export interface SendOptions {
  parseMode?: 'text' | 'markdown' | 'html';
  buttons?: MessageButton[];
  silent?: boolean;
}

export interface MessageButton {
  text: string;
  action: string;
  data?: string;
}

// =============================================================================
// COMMS TENTACLE
// =============================================================================

export interface CommsConfig {
  telegram?: {
    botToken: string;
    allowedUsers?: string[];
    webhookUrl?: string;
  };
  discord?: {
    botToken: string;
    allowedGuilds?: string[];
    allowedUsers?: string[];
  };
  whatsapp?: {
    sessionPath?: string;
    allowedNumbers?: string[];
  };
  slack?: {
    botToken: string;
    appToken: string;
    signingSecret: string;
    allowedWorkspaces?: string[];
  };
}

export class CommsTentacle {
  readonly registration: TentacleRegistration;
  readonly events: EventEmitter;

  private adapters: Map<ChannelType, ChannelAdapter> = new Map();
  private messageHandler?: (message: Message) => Promise<Message>;
  private config: CommsConfig;

  constructor(config: CommsConfig) {
    this.config = config;
    this.events = new EventEmitter();

    this.registration = {
      id: 'comms',
      type: 'comms',
      name: 'Communications Tentacle',
      description: 'Handles all messaging channels - Telegram, Discord, WhatsApp, Slack',
      version: '0.1.0',
      capabilities: this.buildCapabilities(),
      status: 'initializing',
      sandboxed: false,
    };
  }

  /**
   * Initialize all configured channels
   */
  async initialize(): Promise<void> {
    console.log('🐙 Comms Tentacle initializing...');

    // Initialize Telegram if configured
    if (this.config.telegram?.botToken) {
      const telegram = new TelegramAdapter(this.config.telegram);
      this.adapters.set('telegram', telegram);
      telegram.onMessage((msg) => this.handleIncomingMessage(msg));
      telegram.onError((err) => this.handleError('telegram', err));
    }

    // Initialize Discord if configured
    if (this.config.discord?.botToken) {
      const discord = new DiscordAdapter(this.config.discord);
      this.adapters.set('discord', discord);
      discord.onMessage((msg) => this.handleIncomingMessage(msg));
      discord.onError((err) => this.handleError('discord', err));
    }

    // Initialize WhatsApp if configured
    if (this.config.whatsapp) {
      const whatsapp = new WhatsAppAdapter(this.config.whatsapp);
      this.adapters.set('whatsapp', whatsapp);
      whatsapp.onMessage((msg) => this.handleIncomingMessage(msg));
      whatsapp.onError((err) => this.handleError('whatsapp', err));
    }

    // Initialize Slack if configured
    if (this.config.slack?.botToken) {
      const slack = new SlackAdapter(this.config.slack);
      this.adapters.set('slack', slack);
      slack.onMessage((msg) => this.handleIncomingMessage(msg));
      slack.onError((err) => this.handleError('slack', err));
    }

    // Connect all adapters
    const connectPromises = Array.from(this.adapters.entries()).map(
      async ([type, adapter]) => {
        try {
          await adapter.connect();
          console.log(`🐙 Connected to ${type}`);
        } catch (error) {
          console.error(`🐙 Failed to connect to ${type}:`, error);
        }
      }
    );

    await Promise.all(connectPromises);

    this.registration.status = 'ready';
    console.log('🐙 Comms Tentacle ready!');
  }

  /**
   * Set the message handler (called by Octpus core)
   */
  onMessage(handler: (message: Message) => Promise<Message>): void {
    this.messageHandler = handler;
  }

  /**
   * Send a message to a specific channel
   */
  async sendMessage(
    channel: ChannelType,
    chatId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`Channel not configured: ${channel}`);
    }

    const message = await adapter.sendMessage(chatId, content, options);
    this.events.emit('message:sent', message);
    return message;
  }

  /**
   * Reply to a specific message
   */
  async sendReply(
    channel: ChannelType,
    chatId: string,
    replyToId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`Channel not configured: ${channel}`);
    }

    const message = await adapter.sendReply(chatId, replyToId, content, options);
    this.events.emit('message:sent', message);
    return message;
  }

  /**
   * Send an attachment
   */
  async sendAttachment(
    channel: ChannelType,
    chatId: string,
    attachment: Attachment,
    caption?: string
  ): Promise<Message> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`Channel not configured: ${channel}`);
    }

    const message = await adapter.sendAttachment(chatId, attachment, caption);
    this.events.emit('message:sent', message);
    return message;
  }

  /**
   * Broadcast a message to all connected channels (for a specific user)
   */
  async broadcast(
    userId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message[]> {
    const messages: Message[] = [];

    for (const [type, adapter] of this.adapters) {
      try {
        const msg = await adapter.sendMessage(userId, content, options);
        messages.push(msg);
      } catch (error) {
        console.error(`Failed to broadcast to ${type}:`, error);
      }
    }

    return messages;
  }

  /**
   * Get connected channels
   */
  getConnectedChannels(): ChannelType[] {
    return Array.from(this.adapters.entries())
      .filter(([_, adapter]) => adapter.status === 'connected')
      .map(([type]) => type);
  }

  /**
   * Request approval via a channel
   */
  async requestApproval(
    channel: ChannelType,
    chatId: string,
    actionDescription: string,
    actionId: string
  ): Promise<void> {
    const content = `🐙 **Action Approval Required**

${actionDescription}

Reply with:
• \`/approve ${actionId}\` to approve
• \`/reject ${actionId}\` to reject`;

    await this.sendMessage(channel, chatId, content, {
      parseMode: 'markdown',
      buttons: [
        { text: '✅ Approve', action: 'approve', data: actionId },
        { text: '❌ Reject', action: 'reject', data: actionId },
      ],
    });
  }

  /**
   * Shutdown all channels
   */
  async shutdown(): Promise<void> {
    console.log('🐙 Comms Tentacle shutting down...');

    const disconnectPromises = Array.from(this.adapters.values()).map(
      (adapter) => adapter.disconnect()
    );

    await Promise.all(disconnectPromises);
    this.registration.status = 'disabled';
    console.log('🐙 Comms Tentacle offline');
  }

  // Private methods

  private async handleIncomingMessage(message: Message): Promise<void> {
    this.events.emit('message:received', message);

    if (this.messageHandler) {
      try {
        const response = await this.messageHandler(message);

        // Send the response back through the same channel
        const adapter = this.adapters.get(message.channel);
        if (adapter) {
          await adapter.sendReply(message.chatId, message.id, response.content);
        }
      } catch (error) {
        console.error('Error handling message:', error);

        // Send error message back
        const adapter = this.adapters.get(message.channel);
        if (adapter) {
          await adapter.sendReply(
            message.chatId,
            message.id,
            '🐙 Sorry, I encountered an error processing your message.'
          );
        }
      }
    }
  }

  private handleError(channel: ChannelType, error: Error): void {
    console.error(`🐙 Error in ${channel}:`, error);
    this.events.emit('error', { channel, error });
  }

  private buildCapabilities(): TentacleCapability[] {
    return [
      {
        name: 'send_message',
        description: 'Send a message to a user via any connected channel',
        permissionLevel: PermissionLevel.L2_WRITE_EXTERNAL,
        parameters: {
          channel: {
            type: 'string',
            description: 'The channel to send through (telegram, discord, whatsapp, slack)',
            required: true,
            enum: ['telegram', 'discord', 'whatsapp', 'slack'],
          },
          chatId: {
            type: 'string',
            description: 'The chat/user ID to send to',
            required: true,
          },
          content: {
            type: 'string',
            description: 'The message content',
            required: true,
          },
        },
        handler: async (params) => {
          return this.sendMessage(
            params.channel as ChannelType,
            params.chatId as string,
            params.content as string
          );
        },
      },
      {
        name: 'send_reply',
        description: 'Reply to a specific message',
        permissionLevel: PermissionLevel.L2_WRITE_EXTERNAL,
        parameters: {
          channel: {
            type: 'string',
            description: 'The channel',
            required: true,
          },
          chatId: {
            type: 'string',
            description: 'The chat ID',
            required: true,
          },
          replyToId: {
            type: 'string',
            description: 'The message ID to reply to',
            required: true,
          },
          content: {
            type: 'string',
            description: 'The reply content',
            required: true,
          },
        },
        handler: async (params) => {
          return this.sendReply(
            params.channel as ChannelType,
            params.chatId as string,
            params.replyToId as string,
            params.content as string
          );
        },
      },
      {
        name: 'send_attachment',
        description: 'Send a file or image',
        permissionLevel: PermissionLevel.L2_WRITE_EXTERNAL,
        parameters: {
          channel: {
            type: 'string',
            description: 'The channel',
            required: true,
          },
          chatId: {
            type: 'string',
            description: 'The chat ID',
            required: true,
          },
          filePath: {
            type: 'string',
            description: 'Path to the file to send',
            required: true,
          },
          caption: {
            type: 'string',
            description: 'Optional caption',
            required: false,
          },
        },
      },
      {
        name: 'broadcast',
        description: 'Send a message to all connected channels for a user',
        permissionLevel: PermissionLevel.L2_WRITE_EXTERNAL,
        parameters: {
          userId: {
            type: 'string',
            description: 'The user ID',
            required: true,
          },
          content: {
            type: 'string',
            description: 'The message content',
            required: true,
          },
        },
        handler: async (params) => {
          return this.broadcast(
            params.userId as string,
            params.content as string
          );
        },
      },
      {
        name: 'get_channels',
        description: 'Get list of connected channels',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {},
        handler: async () => {
          return this.getConnectedChannels();
        },
      },
      {
        name: 'request_approval',
        description: 'Request user approval for an action via their preferred channel',
        permissionLevel: PermissionLevel.L2_WRITE_EXTERNAL,
        parameters: {
          channel: {
            type: 'string',
            description: 'The channel to send approval request',
            required: true,
          },
          chatId: {
            type: 'string',
            description: 'The chat ID',
            required: true,
          },
          actionDescription: {
            type: 'string',
            description: 'Description of the action requiring approval',
            required: true,
          },
          actionId: {
            type: 'string',
            description: 'The action ID for reference',
            required: true,
          },
        },
        handler: async (params) => {
          return this.requestApproval(
            params.channel as ChannelType,
            params.chatId as string,
            params.actionDescription as string,
            params.actionId as string
          );
        },
      },
    ];
  }
}

// Re-export adapters for direct use
export { TelegramAdapter } from './adapters/telegram';
export { DiscordAdapter } from './adapters/discord';
export { WhatsAppAdapter } from './adapters/whatsapp';
export { SlackAdapter } from './adapters/slack';
