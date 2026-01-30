/**
 * Octpus Core
 * The brain that coordinates all tentacles
 * 
 * 🐙 8 arms. Infinite reach.
 */

import {
  OctpusConfig,
  TentacleType,
  ThinkRequest,
  ThinkResponse,
  Message,
  ConversationContext,
  PermissionLevel,
  ToolDefinition,
} from '@octpus/types';
import { PermissionManager, SecretsManager, AuditLogger } from '@octpus/security';
import { ModelRouter } from '@octpus/models';
import { TentacleRegistry, Tentacle } from './registry';
import { ActionExecutor } from './executor';
import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { homedir } from 'os';

const DEFAULT_CONFIG: OctpusConfig = {
  version: '0.1.0',
  instance: {
    id: nanoid(),
    name: 'octpus',
    description: 'Personal AI agent',
  },
  security: {
    allowedTentacles: ['comms', 'memory', 'shell', 'browser', 'crypto', 'vision'],
    sandboxByDefault: true,
    auditLogPath: join(homedir(), '.octpus', 'audit.log'),
  },
  channels: {},
  models: {
    default: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    },
  },
  memory: {
    provider: 'sqlite',
    vectorDimensions: 1536,
  },
  skills: {
    enabled: [],
    disabled: [],
    customPaths: [],
  },
};

export class Octpus {
  readonly config: OctpusConfig;
  readonly events: EventEmitter;
  readonly registry: TentacleRegistry;
  readonly permissions: PermissionManager;
  readonly secrets: SecretsManager;
  readonly audit: AuditLogger;
  readonly executor: ActionExecutor;

  private modelRouter: ModelRouter | null = null;
  private conversations: Map<string, ConversationContext> = new Map();
  private systemPrompt: string;

  constructor(config: Partial<OctpusConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.events = new EventEmitter();

    // Initialize security components
    this.permissions = new PermissionManager(this.config.security.permissionOverrides);
    this.secrets = new SecretsManager(
      join(homedir(), '.octpus', 'secrets.enc')
    );
    this.audit = new AuditLogger(this.config.security.auditLogPath);

    // Initialize tentacle registry
    this.registry = new TentacleRegistry(this.events);

    // Initialize action executor
    this.executor = new ActionExecutor(
      this.registry,
      this.permissions,
      this.audit,
      this.events
    );

    // Set default system prompt
    this.systemPrompt = this.buildSystemPrompt();

    console.log(`
    🐙 ╔═══════════════════════════════════════╗
       ║           O C T P U S                  ║
       ║     8 arms. Infinite reach.           ║
       ║                                       ║
       ║   The Kraken is rising.               ║
       ╚═══════════════════════════════════════╝
    `);
  }

  /**
   * Initialize Octpus with API keys
   */
  async initialize(masterPassword: string): Promise<void> {
    // Unlock secrets
    this.secrets.unlock(masterPassword);

    // Initialize model router with available keys
    const configs: Record<string, any> = {};

    if (this.secrets.exists('ANTHROPIC_API_KEY')) {
      configs.anthropic = {
        provider: 'anthropic',
        model: this.config.models.default.model,
        apiKey: this.secrets.get('ANTHROPIC_API_KEY', 'comms'),
      };
    }

    if (this.secrets.exists('OPENAI_API_KEY')) {
      configs.openai = {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: this.secrets.get('OPENAI_API_KEY', 'comms'),
      };
    }

    // Always try Ollama (no key needed)
    configs.ollama = {
      provider: 'ollama',
      model: 'llama3.2',
    };

    this.modelRouter = new ModelRouter(configs);

    // Log available providers
    const available = await this.modelRouter.getAvailableProviders();
    console.log(`🐙 Available model providers: ${available.join(', ')}`);
  }

  /**
   * Think about a task and optionally execute actions
   */
  async think(request: ThinkRequest): Promise<ThinkResponse> {
    if (!this.modelRouter) {
      throw new Error('Octpus not initialized. Call initialize() first.');
    }

    // Build tools from available capabilities
    const tools = this.buildTools();

    // Add tools and system prompt to request
    const fullRequest: ThinkRequest = {
      ...request,
      systemPrompt: request.systemPrompt || this.systemPrompt,
      tools: request.tools || tools,
    };

    const response = await this.modelRouter.think(fullRequest);

    // If there are tool calls, execute them
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const toolCall of response.toolCalls) {
        try {
          // Parse tentacle and capability from tool name
          const [tentacleType, capability] = this.parseToolName(toolCall.name);

          // Execute through the action executor
          await this.executor.execute(
            tentacleType,
            capability,
            toolCall.arguments,
            {
              userId: request.context?.userId || 'system',
              timeout: 60000,
            }
          );
        } catch (error) {
          console.error(`Tool execution failed: ${toolCall.name}`, error);
        }
      }
    }

    return response;
  }

  /**
   * Handle an incoming message from any channel
   */
  async handleMessage(message: Message): Promise<Message> {
    // Get or create conversation context
    let context = this.conversations.get(message.userId);
    if (!context) {
      context = {
        sessionId: nanoid(),
        userId: message.userId,
        channel: message.channel,
        messages: [],
        memories: [],
      };
      this.conversations.set(message.userId, context);
    }

    // Add message to context
    context.messages.push(message);

    // Keep only last 20 messages
    if (context.messages.length > 20) {
      context.messages = context.messages.slice(-20);
    }

    // Think about the message
    const response = await this.think({
      task: message.content,
      context,
    });

    // Create response message
    const responseMessage: Message = {
      id: nanoid(),
      channel: message.channel,
      userId: 'octpus',
      content: response.content,
      timestamp: new Date(),
      role: 'assistant',
    };

    // Add to context
    context.messages.push(responseMessage);

    this.events.emit('message:sent', responseMessage);

    return responseMessage;
  }

  /**
   * Register a tentacle
   */
  registerTentacle(tentacle: Tentacle): void {
    if (!this.config.security.allowedTentacles.includes(tentacle.registration.type)) {
      throw new Error(
        `Tentacle type not allowed: ${tentacle.registration.type}`
      );
    }
    this.registry.register(tentacle);
  }

  /**
   * Get conversation context for a user
   */
  getContext(userId: string): ConversationContext | undefined {
    return this.conversations.get(userId);
  }

  /**
   * Clear conversation context
   */
  clearContext(userId: string): void {
    this.conversations.delete(userId);
  }

  /**
   * Shutdown gracefully
   */
  async shutdown(): Promise<void> {
    console.log('🐙 Octpus shutting down...');
    await this.registry.shutdownAll();
    this.secrets.lock();
    console.log('🐙 Goodbye!');
  }

  // Private methods

  private buildSystemPrompt(): string {
    return `You are Octpus, an intelligent AI assistant with 8 tentacles (specialized capabilities).

Your core traits:
- You are smart, capable, and slightly menacing (in a helpful way)
- You can execute actions through your tentacles
- You always explain what you're about to do before doing it
- You respect user privacy and security
- You ask for confirmation before taking high-risk actions

Your tentacles (capabilities):
${this.registry
  .allCapabilities()
  .map((c) => `- ${c.name}: ${c.description}`)
  .join('\n')}

Security levels you respect:
- L0 (Read): Auto-approved
- L1 (Write Local): Auto-approved
- L2 (Write External): Requires confirmation
- L3 (Financial): Requires confirmation + 2FA
- L4 (Destructive): Requires confirmation + cooldown
- L5 (Irreversible): Always human-in-loop

The Kraken is rising. 🐙`;
  }

  private buildTools(): ToolDefinition[] {
    const capabilities = this.registry.allCapabilities();
    return capabilities.map((cap) => ({
      name: `${cap.tentacleId}__${cap.name}`,
      description: cap.description,
      parameters: cap.parameters,
    }));
  }

  private parseToolName(toolName: string): [TentacleType, string] {
    const parts = toolName.split('__');
    if (parts.length !== 2) {
      throw new Error(`Invalid tool name format: ${toolName}`);
    }

    const tentacle = this.registry.get(parts[0]);
    if (!tentacle) {
      throw new Error(`Unknown tentacle: ${parts[0]}`);
    }

    return [tentacle.registration.type, parts[1]];
  }
}

export { TentacleRegistry, Tentacle } from './registry';
export { ActionExecutor, formatAction } from './executor';
