/**
 * Octpus Core
 * The brain that coordinates all tentacles
 *
 * 8 arms. Infinite reach.
 *
 * This is the main orchestrator that:
 * - Initializes and manages all tentacles
 * - Routes messages to the AI brain
 * - Executes actions with proper permissions
 * - Maintains conversation context
 * - Handles the action approval workflow
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import Anthropic from '@anthropic-ai/sdk';
import {
  TentacleRegistration,
  TentacleCapability,
  PermissionLevel,
  Message,
  ChannelType,
  Action,
  ActionStatus,
  ConversationContext,
  OctpusConfig,
  ToolDefinition,
  ToolCall,
} from '@octpus/types';

// Import tentacles
import { CommsTentacle, CommsConfig } from '@octpus/tentacle-comms';
import { CryptoTentacle, CryptoConfig } from '@octpus/tentacle-crypto';
import { BrowserTentacle, BrowserConfig } from '@octpus/tentacle-browser';
import { MemoryTentacle, MemoryConfig } from '@octpus/tentacle-memory';
import { ShellTentacle, ShellConfig } from '@octpus/tentacle-shell';
import { VisionTentacle, VisionConfig } from '@octpus/tentacle-vision';

// Import apps
import { Gateway, GatewayConfig } from '@octpus/gateway';
import { OctpusCLI, CLIConfig } from '@octpus/cli';

// Import security
import { PermissionManager } from '../../permissions';

// =============================================================================
// TYPES
// =============================================================================

export interface OctpusInitConfig {
  // AI Model config
  anthropicApiKey?: string;
  openaiApiKey?: string;
  model?: string;

  // Tentacle configs
  comms?: CommsConfig;
  crypto?: CryptoConfig;
  browser?: BrowserConfig;
  memory?: MemoryConfig;
  shell?: ShellConfig;
  vision?: VisionConfig;

  // App configs
  gateway?: GatewayConfig;
  cli?: CLIConfig;

  // System
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

interface Tentacle {
  registration: TentacleRegistration;
  instance: any;
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const DEFAULT_SYSTEM_PROMPT = `You are Octpus, a powerful AI assistant with 8 arms (tentacles) that can reach into different systems:

1. **Comms Tentacle** - Send messages via Telegram, Discord, WhatsApp, Slack
2. **Crypto Tentacle** - Manage wallets, check balances, execute swaps, track portfolios
3. **Browser Tentacle** - Browse the web, take screenshots, extract data
4. **Memory Tentacle** - Remember things, search memories, maintain context
5. **Shell Tentacle** - Execute commands, run scripts, manage files
6. **Vision Tentacle** - OCR, image analysis, QR scanning, document parsing

You have access to these capabilities through tool calls. When the user asks you to do something:
1. Determine which tentacle(s) can help
2. Use the appropriate tool to accomplish the task
3. Report the results clearly

Important guidelines:
- Always explain what you're about to do before using high-permission actions
- For financial operations (L3+), summarize the transaction before executing
- For destructive operations (L4+), ask for confirmation
- Keep conversation context to provide personalized responses
- Use memory to remember user preferences and past interactions
- Be proactive but not annoying - suggest helpful actions when appropriate

You are running locally on the user's machine. Respect their privacy and security.
8 arms. Infinite reach. Let's get things done.`;

// =============================================================================
// OCTPUS CORE
// =============================================================================

export class Octpus {
  readonly events: EventEmitter;

  private config: OctpusInitConfig;
  private anthropic: Anthropic | null = null;
  private permissionManager: PermissionManager;
  private tentacles: Map<string, Tentacle> = new Map();
  private conversations: Map<string, ConversationContext> = new Map();
  private gateway: Gateway | null = null;
  private cli: OctpusCLI | null = null;
  private running: boolean = false;

  constructor(config: OctpusInitConfig = {}) {
    this.config = {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      temperature: 0.7,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      ...config,
    };

    this.events = new EventEmitter();
    this.permissionManager = new PermissionManager();
  }

  /**
   * Initialize Octpus and all tentacles
   */
  async initialize(): Promise<void> {
    console.log(`
    ____       __
   / __ \\____/ /_____  __  _______
  / / / / __/ __/ __ \\/ / / / ___/
 / /_/ / /_/ /_/ /_/ / /_/ (__  )
 \\____/\\__/\\__/ .___/\\__,_/____/
             /_/

    8 arms. Infinite reach.
`);

    console.log('🐙 Octpus initializing...\n');

    // Initialize Anthropic client
    if (this.config.anthropicApiKey || process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: this.config.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
      });
      console.log('🧠 AI brain connected (Claude)');
    } else {
      console.warn('⚠️ No Anthropic API key - running in limited mode');
    }

    // Initialize tentacles
    await this.initializeTentacles();

    // Initialize apps
    await this.initializeApps();

    this.running = true;
    console.log('\n🐙 Octpus is ready!\n');
  }

  /**
   * Initialize all configured tentacles
   */
  private async initializeTentacles(): Promise<void> {
    // Comms Tentacle
    if (this.config.comms) {
      const comms = new CommsTentacle(this.config.comms);
      await comms.initialize();
      comms.onMessage((msg) => this.handleMessage(msg));
      this.registerTentacle('comms', comms);
    }

    // Crypto Tentacle
    if (this.config.crypto) {
      const crypto = new CryptoTentacle(this.config.crypto);
      await crypto.initialize();
      this.registerTentacle('crypto', crypto);
    }

    // Browser Tentacle
    if (this.config.browser) {
      const browser = new BrowserTentacle(this.config.browser);
      await browser.initialize();
      this.registerTentacle('browser', browser);
    }

    // Memory Tentacle
    if (this.config.memory) {
      const memory = new MemoryTentacle(this.config.memory);
      await memory.initialize();
      this.registerTentacle('memory', memory);
    }

    // Shell Tentacle
    if (this.config.shell) {
      const shell = new ShellTentacle(this.config.shell);
      await shell.initialize();
      this.registerTentacle('shell', shell);
    }

    // Vision Tentacle
    if (this.config.vision) {
      const vision = new VisionTentacle(this.config.vision);
      await vision.initialize();
      this.registerTentacle('vision', vision);
    }

    console.log(`📦 Loaded ${this.tentacles.size} tentacles`);
  }

  /**
   * Initialize apps (Gateway, CLI)
   */
  private async initializeApps(): Promise<void> {
    // Gateway
    if (this.config.gateway) {
      this.gateway = new Gateway(this.config.gateway);
      this.gateway.onMessage((msg) => this.handleMessage(msg));
      await this.gateway.start();
    }

    // CLI (always initialize for local interaction)
    if (this.config.cli !== false) {
      this.cli = new OctpusCLI(this.config.cli || {});
      this.cli.onMessage((msg) => this.handleMessage(msg));
    }
  }

  /**
   * Register a tentacle
   */
  private registerTentacle(id: string, instance: any): void {
    this.tentacles.set(id, {
      registration: instance.registration,
      instance,
    });

    this.events.emit('tentacle:registered', instance.registration);
  }

  /**
   * Handle incoming message
   */
  async handleMessage(message: Message): Promise<Message> {
    // Get or create conversation context
    const context = this.getOrCreateContext(message.userId, message.channel);

    // Add message to history
    context.messages.push(message);

    // Store in memory (if memory tentacle is active)
    const memoryTentacle = this.tentacles.get('memory');
    if (memoryTentacle) {
      await memoryTentacle.instance.addMemory({
        content: message.content,
        source: 'conversation',
        tags: ['chat', message.channel],
        userId: message.userId,
      });
    }

    // Generate AI response
    const response = await this.generateResponse(context, message);

    // Create response message
    const responseMessage: Message = {
      id: nanoid(),
      channel: message.channel,
      chatId: message.chatId,
      userId: 'octpus',
      content: response,
      timestamp: new Date(),
      role: 'assistant',
      replyToId: message.id,
    };

    // Add to context
    context.messages.push(responseMessage);

    // Trim context if too long
    if (context.messages.length > 50) {
      context.messages = context.messages.slice(-40);
    }

    return responseMessage;
  }

  /**
   * Generate AI response
   */
  private async generateResponse(
    context: ConversationContext,
    message: Message
  ): Promise<string> {
    if (!this.anthropic) {
      return "I'm running in limited mode without an AI brain. Please set ANTHROPIC_API_KEY to enable full functionality.";
    }

    // Build tools from tentacles
    const tools = this.buildTools();

    // Build messages
    const messages = context.messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    try {
      // Initial API call
      let response = await this.anthropic.messages.create({
        model: this.config.model!,
        max_tokens: this.config.maxTokens!,
        system: this.config.systemPrompt!,
        messages,
        tools: tools as any,
      });

      // Handle tool use loop
      while (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block) => block.type === 'tool_use'
        );

        const toolResults: any[] = [];

        for (const toolUse of toolUseBlocks) {
          if (toolUse.type !== 'tool_use') continue;

          try {
            const result = await this.executeToolCall({
              id: toolUse.id,
              name: toolUse.name,
              arguments: toolUse.input as Record<string, unknown>,
            }, context);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            });
          } catch (error: any) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify({ error: error.message }),
              is_error: true,
            });
          }
        }

        // Continue conversation with tool results
        response = await this.anthropic.messages.create({
          model: this.config.model!,
          max_tokens: this.config.maxTokens!,
          system: this.config.systemPrompt!,
          messages: [
            ...messages,
            { role: 'assistant', content: response.content },
            { role: 'user', content: toolResults },
          ],
          tools: tools as any,
        });
      }

      // Extract text response
      const textBlocks = response.content.filter(
        (block) => block.type === 'text'
      );

      return textBlocks.map((block) => (block as any).text).join('\n');
    } catch (error: any) {
      console.error('AI response error:', error);
      return `I encountered an error: ${error.message}`;
    }
  }

  /**
   * Build tool definitions from all tentacles
   */
  private buildTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const [tentacleId, tentacle] of this.tentacles) {
      for (const capability of tentacle.registration.capabilities) {
        tools.push({
          name: `${tentacleId}__${capability.name}`,
          description: `[${tentacleId}] ${capability.description}`,
          parameters: capability.parameters,
        });
      }
    }

    return tools;
  }

  /**
   * Execute a tool call
   */
  private async executeToolCall(
    toolCall: ToolCall,
    context: ConversationContext
  ): Promise<unknown> {
    const [tentacleId, capabilityName] = toolCall.name.split('__');

    const tentacle = this.tentacles.get(tentacleId);
    if (!tentacle) {
      throw new Error(`Unknown tentacle: ${tentacleId}`);
    }

    const capability = tentacle.registration.capabilities.find(
      (c) => c.name === capabilityName
    );

    if (!capability) {
      throw new Error(`Unknown capability: ${capabilityName}`);
    }

    // Check permissions
    const action: Action = {
      id: nanoid(),
      tentacle: tentacle.registration.type,
      capability: capabilityName,
      parameters: toolCall.arguments,
      permissionLevel: capability.permissionLevel,
      createdAt: new Date(),
      status: 'pending_approval',
    };

    const permCheck = this.permissionManager.check(action, context.userId);

    if (!permCheck.allowed) {
      throw new Error(permCheck.reason || 'Permission denied');
    }

    if (permCheck.requiresApproval) {
      // Request approval (would be handled by comms tentacle)
      this.events.emit('action:approval_required', action);
      // For now, auto-approve in dev mode
      console.log(`⚠️ Action requires approval: ${tentacleId}.${capabilityName}`);
    }

    // Execute the capability
    if (capability.handler) {
      return capability.handler(toolCall.arguments);
    }

    // Fallback to instance method
    const method = tentacle.instance[capabilityName];
    if (typeof method === 'function') {
      return method.call(tentacle.instance, ...Object.values(toolCall.arguments));
    }

    throw new Error(`No handler for capability: ${capabilityName}`);
  }

  /**
   * Get or create conversation context
   */
  private getOrCreateContext(
    userId: string,
    channel: ChannelType
  ): ConversationContext {
    const key = `${userId}:${channel}`;

    if (!this.conversations.has(key)) {
      this.conversations.set(key, {
        sessionId: nanoid(),
        userId,
        channel,
        messages: [],
        memories: [],
      });
    }

    return this.conversations.get(key)!;
  }

  /**
   * Get a tentacle by ID
   */
  getTentacle<T>(id: string): T | null {
    const tentacle = this.tentacles.get(id);
    return tentacle?.instance || null;
  }

  /**
   * Get all registered tentacles
   */
  getTentacles(): TentacleRegistration[] {
    return Array.from(this.tentacles.values()).map((t) => t.registration);
  }

  /**
   * Start the CLI (interactive mode)
   */
  async startCLI(): Promise<void> {
    if (!this.cli) {
      this.cli = new OctpusCLI();
      this.cli.onMessage((msg) => this.handleMessage(msg));
    }

    await this.cli.start();
  }

  /**
   * Shutdown Octpus
   */
  async shutdown(): Promise<void> {
    console.log('\n🐙 Octpus shutting down...');
    this.running = false;

    // Shutdown all tentacles
    for (const [id, tentacle] of this.tentacles) {
      try {
        if (typeof tentacle.instance.shutdown === 'function') {
          await tentacle.instance.shutdown();
        }
      } catch (error) {
        console.error(`Error shutting down ${id}:`, error);
      }
    }

    // Shutdown gateway
    if (this.gateway) {
      await this.gateway.stop();
    }

    // Stop CLI
    if (this.cli) {
      this.cli.stop();
    }

    console.log('👋 Goodbye!');
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { CommsTentacle } from '@octpus/tentacle-comms';
export { CryptoTentacle } from '@octpus/tentacle-crypto';
export { BrowserTentacle } from '@octpus/tentacle-browser';
export { MemoryTentacle } from '@octpus/tentacle-memory';
export { ShellTentacle } from '@octpus/tentacle-shell';
export { VisionTentacle } from '@octpus/tentacle-vision';
export { Gateway } from '@octpus/gateway';
export { OctpusCLI } from '@octpus/cli';
export { PermissionManager } from '../../permissions';

export default Octpus;
