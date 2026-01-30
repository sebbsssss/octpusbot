/**
 * Discord Adapter
 * Uses discord.js for Discord Bot API
 */

import {
  Client,
  GatewayIntentBits,
  Message as DiscordMessage,
  TextChannel,
  DMChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  Partials,
} from 'discord.js';
import { nanoid } from 'nanoid';
import { Message, Attachment, ChannelType } from '@octpus/types';
import { ChannelAdapter, SendOptions, MessageButton } from '../index';

export interface DiscordConfig {
  botToken: string;
  allowedGuilds?: string[];
  allowedUsers?: string[];
  allowedChannels?: string[];
}

export class DiscordAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'discord';
  status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

  private client: Client;
  private config: DiscordConfig;
  private messageHandlers: ((message: Message) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];

  constructor(config: DiscordConfig) {
    this.config = config;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    // Setup message handler
    this.client.on('messageCreate', async (msg) => {
      // Ignore bot messages
      if (msg.author.bot) return;

      // Check if guild is allowed
      if (
        msg.guild &&
        this.config.allowedGuilds &&
        !this.config.allowedGuilds.includes(msg.guild.id)
      ) {
        return;
      }

      // Check if user is allowed
      if (
        this.config.allowedUsers &&
        !this.config.allowedUsers.includes(msg.author.id)
      ) {
        return;
      }

      // Check if channel is allowed
      if (
        this.config.allowedChannels &&
        !this.config.allowedChannels.includes(msg.channel.id)
      ) {
        // Only respond if mentioned
        if (!msg.mentions.has(this.client.user!)) {
          return;
        }
      }

      const message = this.transformMessage(msg);
      this.messageHandlers.forEach((handler) => handler(message));
    });

    // Handle button interactions
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;

      const [action, ...dataParts] = interaction.customId.split(':');
      const data = dataParts.join(':');

      // Create a synthetic message for the callback
      const message: Message = {
        id: nanoid(),
        channel: 'discord',
        chatId: interaction.channelId || '',
        userId: interaction.user.id,
        content: `/${action} ${data}`,
        timestamp: new Date(),
        role: 'user',
        metadata: {
          isCallback: true,
          callbackAction: action,
          callbackData: data,
          guildId: interaction.guildId,
        },
      };

      this.messageHandlers.forEach((handler) => handler(message));

      // Acknowledge the interaction
      await interaction.deferUpdate();
    });

    // Ready event
    this.client.on('ready', () => {
      console.log(`🐙 Discord: Connected as ${this.client.user?.tag}`);
      this.status = 'connected';
    });

    // Error handling
    this.client.on('error', (error) => {
      this.status = 'error';
      this.errorHandlers.forEach((handler) => handler(error));
    });
  }

  async connect(): Promise<void> {
    this.status = 'connecting';

    try {
      await this.client.login(this.config.botToken);
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.destroy();
    this.status = 'disconnected';
  }

  async sendMessage(
    chatId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    const channel = await this.client.channels.fetch(chatId);

    if (!channel || !('send' in channel)) {
      throw new Error(`Cannot send to channel: ${chatId}`);
    }

    const components = options?.buttons
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            options.buttons.map((btn) =>
              new ButtonBuilder()
                .setCustomId(`${btn.action}:${btn.data || ''}`)
                .setLabel(btn.text)
                .setStyle(
                  btn.action === 'approve'
                    ? ButtonStyle.Success
                    : btn.action === 'reject'
                    ? ButtonStyle.Danger
                    : ButtonStyle.Primary
                )
            )
          ),
        ]
      : undefined;

    const result = await (channel as TextChannel | DMChannel).send({
      content,
      components,
    });

    return {
      id: result.id,
      channel: 'discord',
      chatId: chatId,
      userId: 'octpus',
      content: content,
      timestamp: result.createdAt,
      role: 'assistant',
    };
  }

  async sendReply(
    chatId: string,
    replyToId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    const channel = await this.client.channels.fetch(chatId);

    if (!channel || !('send' in channel)) {
      throw new Error(`Cannot send to channel: ${chatId}`);
    }

    const textChannel = channel as TextChannel | DMChannel;
    const replyTo = await textChannel.messages.fetch(replyToId);

    const result = await replyTo.reply({
      content,
    });

    return {
      id: result.id,
      channel: 'discord',
      chatId: chatId,
      userId: 'octpus',
      content: content,
      timestamp: result.createdAt,
      role: 'assistant',
      replyToId: replyToId,
    };
  }

  async sendAttachment(
    chatId: string,
    attachment: Attachment,
    caption?: string
  ): Promise<Message> {
    const channel = await this.client.channels.fetch(chatId);

    if (!channel || !('send' in channel)) {
      throw new Error(`Cannot send to channel: ${chatId}`);
    }

    const discordAttachment = new AttachmentBuilder(
      attachment.url || attachment.data!,
      { name: attachment.filename }
    );

    const result = await (channel as TextChannel | DMChannel).send({
      content: caption,
      files: [discordAttachment],
    });

    return {
      id: result.id,
      channel: 'discord',
      chatId: chatId,
      userId: 'octpus',
      content: caption || '',
      attachments: [attachment],
      timestamp: result.createdAt,
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
   * Send a DM to a user
   */
  async sendDM(userId: string, content: string): Promise<Message> {
    const user = await this.client.users.fetch(userId);
    const dm = await user.createDM();

    const result = await dm.send(content);

    return {
      id: result.id,
      channel: 'discord',
      chatId: dm.id,
      userId: 'octpus',
      content: content,
      timestamp: result.createdAt,
      role: 'assistant',
    };
  }

  /**
   * Get bot info
   */
  getBotInfo() {
    return {
      id: this.client.user?.id,
      username: this.client.user?.username,
      tag: this.client.user?.tag,
      guilds: this.client.guilds.cache.size,
    };
  }

  private transformMessage(msg: DiscordMessage): Message {
    const attachments: Attachment[] = msg.attachments.map((att) => ({
      id: att.id,
      type: att.contentType?.startsWith('image/')
        ? 'image'
        : att.contentType?.startsWith('audio/')
        ? 'audio'
        : att.contentType?.startsWith('video/')
        ? 'video'
        : 'file',
      url: att.url,
      mimeType: att.contentType || 'application/octet-stream',
      filename: att.name || undefined,
      size: att.size,
    }));

    // Remove bot mention from content
    let content = msg.content;
    if (this.client.user) {
      content = content.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim();
    }

    return {
      id: msg.id,
      channel: 'discord',
      chatId: msg.channel.id,
      userId: msg.author.id,
      content: content,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: msg.createdAt,
      role: 'user',
      metadata: {
        username: msg.author.username,
        discriminator: msg.author.discriminator,
        guildId: msg.guild?.id,
        guildName: msg.guild?.name,
        channelName: (msg.channel as TextChannel).name,
      },
    };
  }
}
