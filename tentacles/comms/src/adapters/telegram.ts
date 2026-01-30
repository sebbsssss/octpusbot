/**
 * Telegram Adapter
 * Uses grammY for Telegram Bot API
 */

import { Bot, Context, session, SessionFlavor } from 'grammy';
import { nanoid } from 'nanoid';
import { Message, Attachment, ChannelType } from '@octpus/types';
import { ChannelAdapter, SendOptions, MessageButton } from '../index';

interface SessionData {
  userId: string;
  lastActivity: Date;
}

type BotContext = Context & SessionFlavor<SessionData>;

export interface TelegramConfig {
  botToken: string;
  allowedUsers?: string[];
  webhookUrl?: string;
  webhookPort?: number;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'telegram';
  status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

  private bot: Bot<BotContext>;
  private config: TelegramConfig;
  private messageHandlers: ((message: Message) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];

  constructor(config: TelegramConfig) {
    this.config = config;
    this.bot = new Bot<BotContext>(config.botToken);

    // Setup session middleware
    this.bot.use(
      session({
        initial: (): SessionData => ({
          userId: '',
          lastActivity: new Date(),
        }),
      })
    );

    // Setup message handler
    this.bot.on('message:text', async (ctx) => {
      // Check if user is allowed
      if (
        this.config.allowedUsers &&
        !this.config.allowedUsers.includes(ctx.from?.id.toString() || '')
      ) {
        await ctx.reply('🐙 Sorry, you are not authorized to use this bot.');
        return;
      }

      const message = this.transformMessage(ctx);
      this.messageHandlers.forEach((handler) => handler(message));
    });

    // Handle callback queries (button clicks)
    this.bot.on('callback_query:data', async (ctx) => {
      const [action, ...dataParts] = ctx.callbackQuery.data.split(':');
      const data = dataParts.join(':');

      // Create a synthetic message for the callback
      const message: Message = {
        id: nanoid(),
        channel: 'telegram',
        chatId: ctx.chat?.id.toString() || '',
        userId: ctx.from.id.toString(),
        content: `/${action} ${data}`,
        timestamp: new Date(),
        role: 'user',
        metadata: {
          isCallback: true,
          callbackAction: action,
          callbackData: data,
        },
      };

      this.messageHandlers.forEach((handler) => handler(message));
      await ctx.answerCallbackQuery();
    });

    // Handle photos
    this.bot.on('message:photo', async (ctx) => {
      const message = this.transformMessage(ctx);
      const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Get largest

      message.attachments = [
        {
          id: photo.file_id,
          type: 'image',
          mimeType: 'image/jpeg',
          size: photo.file_size,
        },
      ];

      this.messageHandlers.forEach((handler) => handler(message));
    });

    // Handle documents
    this.bot.on('message:document', async (ctx) => {
      const message = this.transformMessage(ctx);
      const doc = ctx.message.document;

      message.attachments = [
        {
          id: doc.file_id,
          type: 'file',
          mimeType: doc.mime_type || 'application/octet-stream',
          filename: doc.file_name,
          size: doc.file_size,
        },
      ];

      this.messageHandlers.forEach((handler) => handler(message));
    });

    // Handle voice messages
    this.bot.on('message:voice', async (ctx) => {
      const message = this.transformMessage(ctx);
      const voice = ctx.message.voice;

      message.attachments = [
        {
          id: voice.file_id,
          type: 'audio',
          mimeType: voice.mime_type || 'audio/ogg',
          size: voice.file_size,
        },
      ];

      this.messageHandlers.forEach((handler) => handler(message));
    });

    // Error handling
    this.bot.catch((err) => {
      this.status = 'error';
      this.errorHandlers.forEach((handler) => handler(err.error as Error));
    });
  }

  async connect(): Promise<void> {
    this.status = 'connecting';

    try {
      if (this.config.webhookUrl) {
        // Use webhook mode
        await this.bot.api.setWebhook(this.config.webhookUrl);
        console.log('🐙 Telegram: Webhook mode enabled');
      } else {
        // Use long polling
        await this.bot.start({
          onStart: (botInfo) => {
            console.log(`🐙 Telegram: Connected as @${botInfo.username}`);
          },
        });
      }

      this.status = 'connected';
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.bot.stop();
    this.status = 'disconnected';
  }

  async sendMessage(
    chatId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    const parseMode = options?.parseMode === 'markdown' ? 'MarkdownV2' :
                      options?.parseMode === 'html' ? 'HTML' : undefined;

    const keyboard = options?.buttons
      ? {
          inline_keyboard: [
            options.buttons.map((btn) => ({
              text: btn.text,
              callback_data: `${btn.action}:${btn.data || ''}`,
            })),
          ],
        }
      : undefined;

    const result = await this.bot.api.sendMessage(chatId, content, {
      parse_mode: parseMode,
      reply_markup: keyboard,
      disable_notification: options?.silent,
    });

    return {
      id: result.message_id.toString(),
      channel: 'telegram',
      chatId: chatId,
      userId: 'octpus',
      content: content,
      timestamp: new Date(result.date * 1000),
      role: 'assistant',
    };
  }

  async sendReply(
    chatId: string,
    replyToId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    const parseMode = options?.parseMode === 'markdown' ? 'MarkdownV2' :
                      options?.parseMode === 'html' ? 'HTML' : undefined;

    const result = await this.bot.api.sendMessage(chatId, content, {
      parse_mode: parseMode,
      reply_parameters: { message_id: parseInt(replyToId) },
      disable_notification: options?.silent,
    });

    return {
      id: result.message_id.toString(),
      channel: 'telegram',
      chatId: chatId,
      userId: 'octpus',
      content: content,
      timestamp: new Date(result.date * 1000),
      role: 'assistant',
      replyToId: replyToId,
    };
  }

  async sendAttachment(
    chatId: string,
    attachment: Attachment,
    caption?: string
  ): Promise<Message> {
    let result;

    if (attachment.type === 'image') {
      result = await this.bot.api.sendPhoto(
        chatId,
        attachment.url || attachment.data!,
        { caption }
      );
    } else if (attachment.type === 'audio') {
      result = await this.bot.api.sendAudio(
        chatId,
        attachment.url || attachment.data!,
        { caption }
      );
    } else if (attachment.type === 'video') {
      result = await this.bot.api.sendVideo(
        chatId,
        attachment.url || attachment.data!,
        { caption }
      );
    } else {
      result = await this.bot.api.sendDocument(
        chatId,
        attachment.url || attachment.data!,
        { caption }
      );
    }

    return {
      id: result.message_id.toString(),
      channel: 'telegram',
      chatId: chatId,
      userId: 'octpus',
      content: caption || '',
      attachments: [attachment],
      timestamp: new Date(result.date * 1000),
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
   * Download a file from Telegram
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    const file = await this.bot.api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;

    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Get bot info
   */
  async getBotInfo() {
    return this.bot.api.getMe();
  }

  private transformMessage(ctx: Context): Message {
    return {
      id: ctx.message?.message_id.toString() || nanoid(),
      channel: 'telegram',
      chatId: ctx.chat?.id.toString() || '',
      userId: ctx.from?.id.toString() || '',
      content: ctx.message?.text || ctx.message?.caption || '',
      timestamp: new Date((ctx.message?.date || Date.now() / 1000) * 1000),
      role: 'user',
      metadata: {
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        username: ctx.from?.username,
        chatType: ctx.chat?.type,
      },
    };
  }
}
