/**
 * WhatsApp Adapter
 * Uses Baileys for WhatsApp Web API
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  downloadMediaMessage,
  AnyMessageContent,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { homedir } from 'os';
import { Message, Attachment, ChannelType } from '@octpus/types';
import { ChannelAdapter, SendOptions, MessageButton } from '../index';

export interface WhatsAppConfig {
  sessionPath?: string;
  allowedNumbers?: string[];
  pairingCode?: boolean;
  phoneNumber?: string;
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'whatsapp';
  status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

  private socket: WASocket | null = null;
  private config: WhatsAppConfig;
  private messageHandlers: ((message: Message) => void)[] = [];
  private errorHandlers: ((error: Error) => void)[] = [];
  private sessionPath: string;

  constructor(config: WhatsAppConfig) {
    this.config = config;
    this.sessionPath = config.sessionPath || join(homedir(), '.octpus', 'whatsapp-session');
  }

  async connect(): Promise<void> {
    this.status = 'connecting';

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: !this.config.pairingCode,
        browser: ['Octpus', 'Chrome', '120.0.0'],
      });

      // Handle connection updates
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !this.config.pairingCode) {
          console.log('🐙 WhatsApp: Scan QR code to connect');
        }

        if (connection === 'close') {
          const shouldReconnect =
            (lastDisconnect?.error as Boom)?.output?.statusCode !==
            DisconnectReason.loggedOut;

          if (shouldReconnect) {
            console.log('🐙 WhatsApp: Reconnecting...');
            await this.connect();
          } else {
            this.status = 'disconnected';
            console.log('🐙 WhatsApp: Logged out');
          }
        } else if (connection === 'open') {
          this.status = 'connected';
          console.log('🐙 WhatsApp: Connected!');

          // Request pairing code if configured
          if (this.config.pairingCode && this.config.phoneNumber) {
            const code = await this.socket!.requestPairingCode(this.config.phoneNumber);
            console.log(`🐙 WhatsApp: Pairing code: ${code}`);
          }
        }
      });

      // Save credentials on update
      this.socket.ev.on('creds.update', saveCreds);

      // Handle incoming messages
      this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          // Skip status updates and self messages
          if (msg.key.remoteJid === 'status@broadcast') continue;
          if (msg.key.fromMe) continue;

          // Check if number is allowed
          const jid = msg.key.remoteJid!;
          const number = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');

          if (
            this.config.allowedNumbers &&
            !this.config.allowedNumbers.some((n) => jid.includes(n))
          ) {
            continue;
          }

          const message = await this.transformMessage(msg);
          this.messageHandlers.forEach((handler) => handler(message));
        }
      });
    } catch (error) {
      this.status = 'error';
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      await this.socket.logout();
      this.socket = null;
    }
    this.status = 'disconnected';
  }

  async sendMessage(
    chatId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    if (!this.socket) {
      throw new Error('WhatsApp not connected');
    }

    // Ensure JID format
    const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;

    const messageContent: AnyMessageContent = { text: content };

    // Add buttons if provided (WhatsApp buttons)
    if (options?.buttons && options.buttons.length > 0) {
      // WhatsApp has limited button support, so we'll add them as text
      const buttonText = options.buttons
        .map((btn, i) => `${i + 1}. ${btn.text}`)
        .join('\n');
      messageContent.text = `${content}\n\n${buttonText}`;
    }

    const result = await this.socket.sendMessage(jid, messageContent);

    return {
      id: result?.key.id || nanoid(),
      channel: 'whatsapp',
      chatId: jid,
      userId: 'octpus',
      content: content,
      timestamp: new Date(),
      role: 'assistant',
    };
  }

  async sendReply(
    chatId: string,
    replyToId: string,
    content: string,
    options?: SendOptions
  ): Promise<Message> {
    if (!this.socket) {
      throw new Error('WhatsApp not connected');
    }

    const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;

    const result = await this.socket.sendMessage(jid, {
      text: content,
      // Note: Baileys doesn't support quoted message reply without the original message
      // This is a limitation - would need message caching
    });

    return {
      id: result?.key.id || nanoid(),
      channel: 'whatsapp',
      chatId: jid,
      userId: 'octpus',
      content: content,
      timestamp: new Date(),
      role: 'assistant',
      replyToId: replyToId,
    };
  }

  async sendAttachment(
    chatId: string,
    attachment: Attachment,
    caption?: string
  ): Promise<Message> {
    if (!this.socket) {
      throw new Error('WhatsApp not connected');
    }

    const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;

    let messageContent: AnyMessageContent;

    if (attachment.type === 'image') {
      messageContent = {
        image: attachment.url ? { url: attachment.url } : attachment.data!,
        caption,
        mimetype: attachment.mimeType,
      };
    } else if (attachment.type === 'audio') {
      messageContent = {
        audio: attachment.url ? { url: attachment.url } : attachment.data!,
        mimetype: attachment.mimeType,
        ptt: true, // Voice note
      };
    } else if (attachment.type === 'video') {
      messageContent = {
        video: attachment.url ? { url: attachment.url } : attachment.data!,
        caption,
        mimetype: attachment.mimeType,
      };
    } else {
      messageContent = {
        document: attachment.url ? { url: attachment.url } : attachment.data!,
        caption,
        mimetype: attachment.mimeType,
        fileName: attachment.filename,
      };
    }

    const result = await this.socket.sendMessage(jid, messageContent);

    return {
      id: result?.key.id || nanoid(),
      channel: 'whatsapp',
      chatId: jid,
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
   * Send a reaction to a message
   */
  async sendReaction(
    chatId: string,
    messageId: string,
    emoji: string
  ): Promise<void> {
    if (!this.socket) {
      throw new Error('WhatsApp not connected');
    }

    const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;

    await this.socket.sendMessage(jid, {
      react: {
        text: emoji,
        key: {
          remoteJid: jid,
          id: messageId,
        },
      },
    });
  }

  /**
   * Get profile picture URL
   */
  async getProfilePicture(jid: string): Promise<string | null> {
    if (!this.socket) return null;

    try {
      return await this.socket.profilePictureUrl(jid, 'image');
    } catch {
      return null;
    }
  }

  /**
   * Check if a number is on WhatsApp
   */
  async isOnWhatsApp(phoneNumber: string): Promise<boolean> {
    if (!this.socket) return false;

    try {
      const [result] = await this.socket.onWhatsApp(phoneNumber);
      return result?.exists || false;
    } catch {
      return false;
    }
  }

  private async transformMessage(
    msg: proto.IWebMessageInfo
  ): Promise<Message> {
    const jid = msg.key.remoteJid!;
    const isGroup = jid.endsWith('@g.us');

    // Extract text content
    let content = '';
    const msgContent = msg.message;

    if (msgContent?.conversation) {
      content = msgContent.conversation;
    } else if (msgContent?.extendedTextMessage?.text) {
      content = msgContent.extendedTextMessage.text;
    } else if (msgContent?.imageMessage?.caption) {
      content = msgContent.imageMessage.caption;
    } else if (msgContent?.videoMessage?.caption) {
      content = msgContent.videoMessage.caption;
    } else if (msgContent?.documentMessage?.caption) {
      content = msgContent.documentMessage.caption;
    }

    // Extract attachments
    const attachments: Attachment[] = [];

    if (msgContent?.imageMessage) {
      attachments.push({
        id: nanoid(),
        type: 'image',
        mimeType: msgContent.imageMessage.mimetype || 'image/jpeg',
        size: msgContent.imageMessage.fileLength as number,
      });
    } else if (msgContent?.audioMessage) {
      attachments.push({
        id: nanoid(),
        type: 'audio',
        mimeType: msgContent.audioMessage.mimetype || 'audio/ogg',
        size: msgContent.audioMessage.fileLength as number,
      });
    } else if (msgContent?.videoMessage) {
      attachments.push({
        id: nanoid(),
        type: 'video',
        mimeType: msgContent.videoMessage.mimetype || 'video/mp4',
        size: msgContent.videoMessage.fileLength as number,
      });
    } else if (msgContent?.documentMessage) {
      attachments.push({
        id: nanoid(),
        type: 'file',
        mimeType: msgContent.documentMessage.mimetype || 'application/octet-stream',
        filename: msgContent.documentMessage.fileName || undefined,
        size: msgContent.documentMessage.fileLength as number,
      });
    }

    // Get sender info
    const participant = isGroup ? msg.key.participant : jid;
    const userId = participant?.replace('@s.whatsapp.net', '') || '';

    return {
      id: msg.key.id || nanoid(),
      channel: 'whatsapp',
      chatId: jid,
      userId: userId,
      content: content,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: new Date((msg.messageTimestamp as number) * 1000),
      role: 'user',
      metadata: {
        isGroup,
        pushName: msg.pushName,
        participant: participant,
      },
    };
  }

  /**
   * Download media from a message
   */
  async downloadMedia(msg: proto.IWebMessageInfo): Promise<Buffer | null> {
    if (!this.socket) return null;

    try {
      return await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          reuploadRequest: this.socket.updateMediaMessage,
        }
      ) as Buffer;
    } catch {
      return null;
    }
  }
}
