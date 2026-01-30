/**
 * Octpus Core Types
 * 8 arms. Infinite reach.
 */

// =============================================================================
// PERMISSION LEVELS - The heart of our security model
// =============================================================================

export enum PermissionLevel {
  /** Read-only operations: search, fetch, read files */
  L0_READ = 0,
  /** Write to local system: create files, write notes */
  L1_WRITE_LOCAL = 1,
  /** Write to external services: send messages, emails */
  L2_WRITE_EXTERNAL = 2,
  /** Financial operations: transactions, swaps */
  L3_FINANCIAL = 3,
  /** Destructive operations: delete, overwrite, revoke */
  L4_DESTRUCTIVE = 4,
  /** Irreversible operations: on-chain, public posts */
  L5_IRREVERSIBLE = 5,
}

export interface PermissionConfig {
  level: PermissionLevel;
  autoApprove: boolean;
  requireConfirmation: boolean;
  require2FA: boolean;
  cooldownSeconds?: number;
}

export const DEFAULT_PERMISSION_CONFIG: Record<PermissionLevel, PermissionConfig> = {
  [PermissionLevel.L0_READ]: {
    level: PermissionLevel.L0_READ,
    autoApprove: true,
    requireConfirmation: false,
    require2FA: false,
  },
  [PermissionLevel.L1_WRITE_LOCAL]: {
    level: PermissionLevel.L1_WRITE_LOCAL,
    autoApprove: true,
    requireConfirmation: false,
    require2FA: false,
  },
  [PermissionLevel.L2_WRITE_EXTERNAL]: {
    level: PermissionLevel.L2_WRITE_EXTERNAL,
    autoApprove: false,
    requireConfirmation: true,
    require2FA: false,
  },
  [PermissionLevel.L3_FINANCIAL]: {
    level: PermissionLevel.L3_FINANCIAL,
    autoApprove: false,
    requireConfirmation: true,
    require2FA: true,
  },
  [PermissionLevel.L4_DESTRUCTIVE]: {
    level: PermissionLevel.L4_DESTRUCTIVE,
    autoApprove: false,
    requireConfirmation: true,
    require2FA: true,
    cooldownSeconds: 30,
  },
  [PermissionLevel.L5_IRREVERSIBLE]: {
    level: PermissionLevel.L5_IRREVERSIBLE,
    autoApprove: false,
    requireConfirmation: true,
    require2FA: true,
    cooldownSeconds: 60,
  },
};

// =============================================================================
// TENTACLE SYSTEM - Multi-agent architecture
// =============================================================================

export type TentacleType =
  | 'comms'
  | 'crypto'
  | 'browser'
  | 'shell'
  | 'memory'
  | 'vision'
  | 'custom';

export interface TentacleCapability {
  name: string;
  description: string;
  permissionLevel: PermissionLevel;
  parameters: Record<string, ParameterSchema>;
}

export interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: unknown[];
}

export interface TentacleRegistration {
  id: string;
  type: TentacleType;
  name: string;
  description: string;
  version: string;
  capabilities: TentacleCapability[];
  status: TentacleStatus;
  sandboxed: boolean;
  resourceLimits?: ResourceLimits;
}

export type TentacleStatus =
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'error'
  | 'disabled';

export interface ResourceLimits {
  maxMemoryMB: number;
  maxCPUPercent: number;
  maxNetworkMBps: number;
  maxExecutionSeconds: number;
}

// =============================================================================
// ACTIONS - Everything the agent can do
// =============================================================================

export interface Action {
  id: string;
  tentacle: TentacleType;
  capability: string;
  parameters: Record<string, unknown>;
  permissionLevel: PermissionLevel;
  createdAt: Date;
  status: ActionStatus;
  approval?: ActionApproval;
  result?: ActionResult;
}

export type ActionStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ActionApproval {
  approved: boolean;
  method: ApprovalMethod;
  userId: string;
  timestamp: Date;
  reason?: string;
}

export type ApprovalMethod =
  | 'auto'
  | 'telegram_confirm'
  | 'discord_confirm'
  | 'cli_confirm'
  | '2fa_totp'
  | '2fa_webauthn';

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: ActionError;
  executionTimeMs: number;
  timestamp: Date;
}

export interface ActionError {
  code: string;
  message: string;
  stack?: string;
  retryable: boolean;
}

// =============================================================================
// AUDIT LOG - Immutable record of everything
// =============================================================================

export interface AuditEntry {
  id: string;
  timestamp: Date;
  tentacle: TentacleType;
  action: string;
  parameters: Record<string, unknown>;
  permissionLevel: PermissionLevel;
  approval?: ActionApproval;
  result?: ActionResult;
  userId?: string;
  sessionId: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// SECRETS - Secure credential management
// =============================================================================

export interface SecretMetadata {
  key: string;
  createdAt: Date;
  updatedAt: Date;
  rotatedAt?: Date;
  expiresAt?: Date;
  description?: string;
  tentacleAccess: TentacleType[];
}

// Never include the actual value in types - it's only in memory
export interface SecretReference {
  key: string;
  exists: boolean;
  metadata: SecretMetadata;
}

// =============================================================================
// MEMORY & CONTEXT
// =============================================================================

export interface Memory {
  id: string;
  content: string;
  embedding?: number[];
  metadata: MemoryMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryMetadata {
  source: MemorySource;
  importance: number; // 0-1
  tags: string[];
  relatedMemories?: string[];
  expiresAt?: Date;
}

export type MemorySource =
  | 'conversation'
  | 'skill'
  | 'observation'
  | 'user_input'
  | 'system';

export interface ConversationContext {
  sessionId: string;
  userId: string;
  channel: ChannelType;
  messages: Message[];
  memories: Memory[];
  activeAction?: Action;
}

// =============================================================================
// CHANNELS - Where users interact
// =============================================================================

export type ChannelType =
  | 'telegram'
  | 'discord'
  | 'whatsapp'
  | 'slack'
  | 'signal'
  | 'imessage'
  | 'cli'
  | 'api';

export interface Channel {
  type: ChannelType;
  id: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface Message {
  id: string;
  channel: ChannelType;
  userId: string;
  content: string;
  attachments?: Attachment[];
  timestamp: Date;
  role: 'user' | 'assistant' | 'system';
  metadata?: Record<string, unknown>;
}

export interface Attachment {
  id: string;
  type: 'image' | 'file' | 'audio' | 'video';
  url?: string;
  data?: Buffer;
  mimeType: string;
  filename?: string;
  size?: number;
}

// =============================================================================
// MODELS - LLM provider abstraction
// =============================================================================

export type ModelProvider = 'anthropic' | 'openai' | 'ollama' | 'custom';

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey?: string; // Reference to secret, not actual key
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ThinkRequest {
  task: string;
  context?: ConversationContext;
  model?: string | 'auto';
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface ThinkResponse {
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  model: string;
  finishReason: 'complete' | 'tool_use' | 'max_tokens' | 'error';
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number;
}

// =============================================================================
// SKILLS - Extensible capabilities
// =============================================================================

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  repository?: string;
  capabilities: SkillCapability[];
  dependencies?: string[];
  trusted: boolean;
  sandboxed: boolean;
  resourceLimits?: ResourceLimits;
}

export interface SkillCapability {
  name: string;
  description: string;
  permissionLevel: PermissionLevel;
  handler: string; // Path to handler function
  parameters: Record<string, ParameterSchema>;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface OctpusConfig {
  version: string;
  instance: {
    id: string;
    name: string;
    description?: string;
  };
  security: {
    permissionOverrides?: Partial<Record<PermissionLevel, PermissionConfig>>;
    allowedTentacles: TentacleType[];
    sandboxByDefault: boolean;
    auditLogPath: string;
  };
  channels: Partial<Record<ChannelType, Channel>>;
  models: {
    default: ModelConfig;
    overrides?: Record<string, ModelConfig>;
  };
  memory: {
    provider: 'sqlite' | 'postgres' | 'custom';
    connectionString?: string;
    vectorDimensions: number;
  };
  skills: {
    enabled: string[];
    disabled: string[];
    customPaths: string[];
  };
}

// =============================================================================
// EVENTS - Internal communication
// =============================================================================

export type OctpusEvent =
  | { type: 'tentacle:registered'; data: TentacleRegistration }
  | { type: 'tentacle:status'; data: { id: string; status: TentacleStatus } }
  | { type: 'action:created'; data: Action }
  | { type: 'action:approved'; data: Action }
  | { type: 'action:rejected'; data: Action }
  | { type: 'action:completed'; data: Action }
  | { type: 'action:failed'; data: Action }
  | { type: 'message:received'; data: Message }
  | { type: 'message:sent'; data: Message }
  | { type: 'memory:created'; data: Memory }
  | { type: 'secret:accessed'; data: { key: string; tentacle: TentacleType } }
  | { type: 'audit:entry'; data: AuditEntry };

export interface EventEmitter {
  emit(event: OctpusEvent): void;
  on<T extends OctpusEvent['type']>(
    type: T,
    handler: (data: Extract<OctpusEvent, { type: T }>['data']) => void
  ): void;
  off<T extends OctpusEvent['type']>(
    type: T,
    handler: (data: Extract<OctpusEvent, { type: T }>['data']) => void
  ): void;
}
