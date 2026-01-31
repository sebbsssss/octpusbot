/**
 * Octpus Model Router
 *
 * Unified interface for multiple LLM providers:
 * - Anthropic (Claude)
 * - OpenAI (GPT-4, GPT-4o)
 * - Ollama (Local models: Llama, Mistral, etc.)
 *
 * Features:
 * - Automatic failover between providers
 * - Cost optimization routing
 * - Streaming support
 * - Tool/function calling normalization
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// =============================================================================
// TYPES
// =============================================================================

export type ModelProvider = 'anthropic' | 'openai' | 'ollama';

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ModelResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  provider: ModelProvider;
  finishReason: 'stop' | 'tool_use' | 'length' | 'error';
}

export interface ThinkRequest {
  messages: Message[];
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: ToolCall;
}

// =============================================================================
// MODEL ROUTER
// =============================================================================

export class ModelRouter {
  private providers: Map<ModelProvider, ProviderAdapter> = new Map();
  private defaultProvider: ModelProvider = 'anthropic';
  private fallbackOrder: ModelProvider[] = ['anthropic', 'openai', 'ollama'];

  constructor(configs: Partial<Record<ModelProvider, ModelConfig>> = {}) {
    // Initialize configured providers
    if (configs.anthropic) {
      this.providers.set('anthropic', new AnthropicAdapter(configs.anthropic));
    }
    if (configs.openai) {
      this.providers.set('openai', new OpenAIAdapter(configs.openai));
    }
    if (configs.ollama) {
      this.providers.set('ollama', new OllamaAdapter(configs.ollama));
    }

    // Set default to first available
    for (const provider of this.fallbackOrder) {
      if (this.providers.has(provider)) {
        this.defaultProvider = provider;
        break;
      }
    }
  }

  /**
   * Add a provider configuration
   */
  addProvider(config: ModelConfig): void {
    switch (config.provider) {
      case 'anthropic':
        this.providers.set('anthropic', new AnthropicAdapter(config));
        break;
      case 'openai':
        this.providers.set('openai', new OpenAIAdapter(config));
        break;
      case 'ollama':
        this.providers.set('ollama', new OllamaAdapter(config));
        break;
    }
  }

  /**
   * Get available providers
   */
  async getAvailableProviders(): Promise<ModelProvider[]> {
    const available: ModelProvider[] = [];

    for (const [provider, adapter] of this.providers) {
      if (await adapter.isAvailable()) {
        available.push(provider);
      }
    }

    return available;
  }

  /**
   * Think - main inference method
   */
  async think(request: ThinkRequest, provider?: ModelProvider): Promise<ModelResponse> {
    const targetProvider = provider || this.defaultProvider;
    const adapter = this.providers.get(targetProvider);

    if (!adapter) {
      throw new Error(`Provider not configured: ${targetProvider}`);
    }

    try {
      return await adapter.complete(request);
    } catch (error: any) {
      // Try fallback providers
      for (const fallback of this.fallbackOrder) {
        if (fallback === targetProvider) continue;

        const fallbackAdapter = this.providers.get(fallback);
        if (fallbackAdapter && await fallbackAdapter.isAvailable()) {
          console.log(`Falling back from ${targetProvider} to ${fallback}`);
          return await fallbackAdapter.complete(request);
        }
      }

      throw error;
    }
  }

  /**
   * Stream - streaming inference
   */
  async *stream(request: ThinkRequest, provider?: ModelProvider): AsyncGenerator<StreamChunk> {
    const targetProvider = provider || this.defaultProvider;
    const adapter = this.providers.get(targetProvider);

    if (!adapter) {
      throw new Error(`Provider not configured: ${targetProvider}`);
    }

    yield* adapter.stream(request);
  }

  /**
   * Get the default provider
   */
  getDefaultProvider(): ModelProvider {
    return this.defaultProvider;
  }

  /**
   * Set the default provider
   */
  setDefaultProvider(provider: ModelProvider): void {
    if (!this.providers.has(provider)) {
      throw new Error(`Provider not configured: ${provider}`);
    }
    this.defaultProvider = provider;
  }
}

// =============================================================================
// PROVIDER ADAPTERS
// =============================================================================

interface ProviderAdapter {
  complete(request: ThinkRequest): Promise<ModelResponse>;
  stream(request: ThinkRequest): AsyncGenerator<StreamChunk>;
  isAvailable(): Promise<boolean>;
}

// -----------------------------------------------------------------------------
// ANTHROPIC ADAPTER
// -----------------------------------------------------------------------------

class AnthropicAdapter implements ProviderAdapter {
  private client: Anthropic;
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      baseURL: config.baseUrl,
    });
  }

  async complete(request: ThinkRequest): Promise<ModelResponse> {
    const messages: Anthropic.MessageParam[] = request.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const systemMessage = request.system ||
      request.messages.find(m => m.role === 'system')?.content;

    const tools: Anthropic.Tool[] | undefined = request.tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: request.maxTokens || this.config.maxTokens || 4096,
      temperature: request.temperature ?? this.config.temperature,
      system: systemMessage,
      messages,
      tools,
    });

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, any>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
      provider: 'anthropic',
      finishReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'stop',
    };
  }

  async *stream(request: ThinkRequest): AsyncGenerator<StreamChunk> {
    const messages: Anthropic.MessageParam[] = request.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const systemMessage = request.system ||
      request.messages.find(m => m.role === 'system')?.content;

    const stream = await this.client.messages.stream({
      model: this.config.model,
      max_tokens: request.maxTokens || this.config.maxTokens || 4096,
      temperature: request.temperature ?? this.config.temperature,
      system: systemMessage,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as any;
        if (delta.type === 'text_delta') {
          yield { type: 'text', content: delta.text };
        }
      }
    }

    yield { type: 'done' };
  }

  async isAvailable(): Promise<boolean> {
    try {
      return !!(this.config.apiKey || process.env.ANTHROPIC_API_KEY);
    } catch {
      return false;
    }
  }
}

// -----------------------------------------------------------------------------
// OPENAI ADAPTER
// -----------------------------------------------------------------------------

class OpenAIAdapter implements ProviderAdapter {
  private client: OpenAI;
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseURL: config.baseUrl,
    });
  }

  async complete(request: ThinkRequest): Promise<ModelResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = request.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    if (request.system && !request.messages.find(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: request.system });
    }

    const tools: OpenAI.ChatCompletionTool[] | undefined = request.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      max_tokens: request.maxTokens || this.config.maxTokens,
      temperature: request.temperature ?? this.config.temperature,
      messages,
      tools,
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    })) || [];

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
      model: response.model,
      provider: 'openai',
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'stop',
    };
  }

  async *stream(request: ThinkRequest): AsyncGenerator<StreamChunk> {
    const messages: OpenAI.ChatCompletionMessageParam[] = request.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    if (request.system && !request.messages.find(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: request.system });
    }

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      max_tokens: request.maxTokens || this.config.maxTokens,
      temperature: request.temperature ?? this.config.temperature,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: 'text', content: delta.content };
      }
    }

    yield { type: 'done' };
  }

  async isAvailable(): Promise<boolean> {
    try {
      return !!(this.config.apiKey || process.env.OPENAI_API_KEY);
    } catch {
      return false;
    }
  }
}

// -----------------------------------------------------------------------------
// OLLAMA ADAPTER
// -----------------------------------------------------------------------------

class OllamaAdapter implements ProviderAdapter {
  private config: ModelConfig;
  private baseUrl: string;

  constructor(config: ModelConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }

  async complete(request: ThinkRequest): Promise<ModelResponse> {
    const messages = request.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    if (request.system && !request.messages.find(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: request.system });
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: false,
        options: {
          temperature: request.temperature ?? this.config.temperature,
          num_predict: request.maxTokens || this.config.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      content: data.message?.content || '',
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      },
      model: this.config.model,
      provider: 'ollama',
      finishReason: 'stop',
    };
  }

  async *stream(request: ThinkRequest): AsyncGenerator<StreamChunk> {
    const messages = request.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    if (request.system && !request.messages.find(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: request.system });
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: true,
        options: {
          temperature: request.temperature ?? this.config.temperature,
          num_predict: request.maxTokens || this.config.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            yield { type: 'text', content: data.message.content };
          }
        } catch {}
      }
    }

    yield { type: 'done' };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

let defaultRouter: ModelRouter | null = null;

/**
 * Get or create the default model router
 */
export function getDefaultRouter(): ModelRouter {
  if (!defaultRouter) {
    defaultRouter = new ModelRouter({
      anthropic: process.env.ANTHROPIC_API_KEY ? {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY,
      } : undefined,
      openai: process.env.OPENAI_API_KEY ? {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: process.env.OPENAI_API_KEY,
      } : undefined,
      ollama: {
        provider: 'ollama',
        model: 'llama3.2',
      },
    });
  }
  return defaultRouter;
}

/**
 * Quick think function using default router
 */
export async function think(prompt: string, options?: Partial<ThinkRequest>): Promise<string> {
  const router = getDefaultRouter();
  const response = await router.think({
    messages: [{ role: 'user', content: prompt }],
    ...options,
  });
  return response.content;
}

export default ModelRouter;
