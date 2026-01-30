/**
 * Memory Tentacle
 * The brain of the Octpus - persistent memory and vector search
 *
 * Capabilities:
 * - Store and retrieve memories
 * - Semantic search with embeddings
 * - Conversation history
 * - Knowledge graph relationships
 * - Long-term learning
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import {
  TentacleRegistration,
  TentacleCapability,
  PermissionLevel,
  Memory,
  MemoryMetadata,
  MemorySource,
} from '@octpus/types';

// =============================================================================
// TYPES
// =============================================================================

export interface MemoryConfig {
  dbPath?: string;
  embeddingDimensions?: number;
  embeddingProvider?: 'openai' | 'local' | 'ollama';
  embeddingModel?: string;
  maxMemories?: number;
}

export interface SearchResult {
  memory: Memory;
  score: number;
}

export interface MemoryStats {
  totalMemories: number;
  bySource: Record<MemorySource, number>;
  oldestMemory: Date | null;
  newestMemory: Date | null;
  avgImportance: number;
}

// =============================================================================
// MEMORY TENTACLE
// =============================================================================

export class MemoryTentacle {
  readonly registration: TentacleRegistration;
  readonly events: EventEmitter;

  private db: Database.Database | null = null;
  private config: MemoryConfig;
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(config: MemoryConfig = {}) {
    this.config = {
      dbPath: join(homedir(), '.octpus', 'memory.db'),
      embeddingDimensions: 1536,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      maxMemories: 100000,
      ...config,
    };

    this.events = new EventEmitter();

    this.registration = {
      id: 'memory',
      type: 'memory',
      name: 'Memory Tentacle',
      description: 'Persistent memory, semantic search, and long-term learning',
      version: '0.1.0',
      capabilities: this.buildCapabilities(),
      status: 'initializing',
      sandboxed: false,
    };
  }

  /**
   * Initialize the memory database
   */
  async initialize(): Promise<void> {
    console.log('🐙 Memory Tentacle initializing...');

    // Ensure directory exists
    const dbDir = this.config.dbPath!.split('/').slice(0, -1).join('/');
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.config.dbPath!);

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding BLOB,
        source TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        tags TEXT,
        related_memories TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        from_memory TEXT NOT NULL,
        to_memory TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        strength REAL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_memory) REFERENCES memories(id),
        FOREIGN KEY (to_memory) REFERENCES memories(id)
      );

      CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_memory);
      CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_memory);
    `);

    this.registration.status = 'ready';
    console.log('🐙 Memory Tentacle ready!');
  }

  // ==========================================================================
  // MEMORY OPERATIONS
  // ==========================================================================

  /**
   * Store a new memory
   */
  async store(
    content: string,
    metadata: Partial<MemoryMetadata> = {}
  ): Promise<Memory> {
    if (!this.db) throw new Error('Memory not initialized');

    const id = nanoid();
    const now = Date.now();

    const memory: Memory = {
      id,
      content,
      metadata: {
        source: metadata.source || 'system',
        importance: metadata.importance || 0.5,
        tags: metadata.tags || [],
        relatedMemories: metadata.relatedMemories,
        expiresAt: metadata.expiresAt,
      },
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };

    // Generate embedding
    const embedding = await this.generateEmbedding(content);
    memory.embedding = embedding;

    // Store in database
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, content, embedding, source, importance, tags, related_memories, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      content,
      Buffer.from(new Float32Array(embedding).buffer),
      memory.metadata.source,
      memory.metadata.importance,
      JSON.stringify(memory.metadata.tags),
      memory.metadata.relatedMemories ? JSON.stringify(memory.metadata.relatedMemories) : null,
      memory.metadata.expiresAt ? memory.metadata.expiresAt.getTime() : null,
      now,
      now
    );

    this.events.emit('memory:stored', memory);
    return memory;
  }

  /**
   * Retrieve a memory by ID
   */
  async retrieve(id: string): Promise<Memory | null> {
    if (!this.db) throw new Error('Memory not initialized');

    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as any;
    if (!row) return null;

    return this.rowToMemory(row);
  }

  /**
   * Update a memory
   */
  async update(id: string, updates: Partial<Memory>): Promise<Memory | null> {
    if (!this.db) throw new Error('Memory not initialized');

    const existing = await this.retrieve(id);
    if (!existing) return null;

    const now = Date.now();
    const content = updates.content || existing.content;

    // Regenerate embedding if content changed
    let embedding = existing.embedding;
    if (updates.content && updates.content !== existing.content) {
      embedding = await this.generateEmbedding(content);
    }

    const stmt = this.db.prepare(`
      UPDATE memories
      SET content = ?, embedding = ?, importance = ?, tags = ?, updated_at = ?
      WHERE id = ?
    `);

    const importance = updates.metadata?.importance ?? existing.metadata.importance;
    const tags = updates.metadata?.tags ?? existing.metadata.tags;

    stmt.run(
      content,
      embedding ? Buffer.from(new Float32Array(embedding).buffer) : null,
      importance,
      JSON.stringify(tags),
      now,
      id
    );

    return this.retrieve(id);
  }

  /**
   * Delete a memory
   */
  async delete(id: string): Promise<boolean> {
    if (!this.db) throw new Error('Memory not initialized');

    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);

    if (result.changes > 0) {
      // Also delete relationships
      this.db.prepare('DELETE FROM relationships WHERE from_memory = ? OR to_memory = ?').run(id, id);
      this.events.emit('memory:deleted', { id });
      return true;
    }

    return false;
  }

  // ==========================================================================
  // SEARCH
  // ==========================================================================

  /**
   * Semantic search for memories
   */
  async search(query: string, limit: number = 10): Promise<SearchResult[]> {
    if (!this.db) throw new Error('Memory not initialized');

    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);

    // Get all memories with embeddings
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE embedding IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1000
    `).all() as any[];

    // Calculate cosine similarity
    const results: SearchResult[] = [];
    for (const row of rows) {
      const embedding = new Float32Array(row.embedding.buffer);
      const score = this.cosineSimilarity(queryEmbedding, Array.from(embedding));

      results.push({
        memory: this.rowToMemory(row),
        score,
      });
    }

    // Sort by score and return top results
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Search by tags
   */
  async searchByTags(tags: string[], limit: number = 10): Promise<Memory[]> {
    if (!this.db) throw new Error('Memory not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE ${tags.map(() => 'tags LIKE ?').join(' OR ')}
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `).all(...tags.map((t) => `%"${t}"%`), limit) as any[];

    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Search by source
   */
  async searchBySource(source: MemorySource, limit: number = 10): Promise<Memory[]> {
    if (!this.db) throw new Error('Memory not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE source = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(source, limit) as any[];

    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Get recent memories
   */
  async getRecent(limit: number = 10): Promise<Memory[]> {
    if (!this.db) throw new Error('Memory not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM memories
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((row) => this.rowToMemory(row));
  }

  /**
   * Get important memories
   */
  async getImportant(limit: number = 10): Promise<Memory[]> {
    if (!this.db) throw new Error('Memory not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM memories
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((row) => this.rowToMemory(row));
  }

  // ==========================================================================
  // RELATIONSHIPS
  // ==========================================================================

  /**
   * Create a relationship between memories
   */
  async createRelationship(
    fromId: string,
    toId: string,
    type: string,
    strength: number = 1.0
  ): Promise<void> {
    if (!this.db) throw new Error('Memory not initialized');

    const id = nanoid();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO relationships (id, from_memory, to_memory, relationship_type, strength, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, fromId, toId, type, strength, now);

    this.events.emit('relationship:created', { fromId, toId, type });
  }

  /**
   * Get related memories
   */
  async getRelated(memoryId: string): Promise<{ memory: Memory; type: string; strength: number }[]> {
    if (!this.db) throw new Error('Memory not initialized');

    const rows = this.db.prepare(`
      SELECT m.*, r.relationship_type, r.strength
      FROM relationships r
      JOIN memories m ON r.to_memory = m.id
      WHERE r.from_memory = ?
      ORDER BY r.strength DESC
    `).all(memoryId) as any[];

    return rows.map((row) => ({
      memory: this.rowToMemory(row),
      type: row.relationship_type,
      strength: row.strength,
    }));
  }

  // ==========================================================================
  // CONVERSATION HISTORY
  // ==========================================================================

  /**
   * Save conversation history
   */
  async saveConversation(
    userId: string,
    channel: string,
    messages: any[]
  ): Promise<string> {
    if (!this.db) throw new Error('Memory not initialized');

    const id = `conv_${userId}_${Date.now()}`;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO conversations (id, user_id, channel, messages, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, channel, JSON.stringify(messages), now, now);

    return id;
  }

  /**
   * Get conversation history for a user
   */
  async getConversationHistory(userId: string, limit: number = 10): Promise<any[]> {
    if (!this.db) throw new Error('Memory not initialized');

    const rows = this.db.prepare(`
      SELECT * FROM conversations
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      channel: row.channel,
      messages: JSON.parse(row.messages),
      createdAt: new Date(row.created_at),
    }));
  }

  // ==========================================================================
  // MAINTENANCE
  // ==========================================================================

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    if (!this.db) throw new Error('Memory not initialized');

    const total = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as any;
    const bySource = this.db.prepare(`
      SELECT source, COUNT(*) as count FROM memories GROUP BY source
    `).all() as any[];
    const oldest = this.db.prepare('SELECT MIN(created_at) as ts FROM memories').get() as any;
    const newest = this.db.prepare('SELECT MAX(created_at) as ts FROM memories').get() as any;
    const avgImportance = this.db.prepare('SELECT AVG(importance) as avg FROM memories').get() as any;

    return {
      totalMemories: total.count,
      bySource: Object.fromEntries(bySource.map((r) => [r.source, r.count])) as Record<MemorySource, number>,
      oldestMemory: oldest.ts ? new Date(oldest.ts) : null,
      newestMemory: newest.ts ? new Date(newest.ts) : null,
      avgImportance: avgImportance.avg || 0,
    };
  }

  /**
   * Clean up expired memories
   */
  async cleanup(): Promise<number> {
    if (!this.db) throw new Error('Memory not initialized');

    const now = Date.now();
    const result = this.db.prepare(`
      DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?
    `).run(now);

    return result.changes;
  }

  /**
   * Compact the database
   */
  async compact(): Promise<void> {
    if (!this.db) throw new Error('Memory not initialized');
    this.db.exec('VACUUM');
  }

  // ==========================================================================
  // SHUTDOWN
  // ==========================================================================

  async shutdown(): Promise<void> {
    console.log('🐙 Memory Tentacle shutting down...');

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.registration.status = 'disabled';
    console.log('🐙 Memory Tentacle offline');
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private async generateEmbedding(text: string): Promise<number[]> {
    // Check cache
    const cacheKey = text.slice(0, 100);
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!;
    }

    // For now, generate a simple hash-based embedding
    // In production, you would call OpenAI or a local model
    const embedding = this.simpleEmbedding(text, this.config.embeddingDimensions!);

    // Cache it
    this.embeddingCache.set(cacheKey, embedding);
    if (this.embeddingCache.size > 10000) {
      // Clear old entries
      const keys = Array.from(this.embeddingCache.keys());
      for (let i = 0; i < 1000; i++) {
        this.embeddingCache.delete(keys[i]);
      }
    }

    return embedding;
  }

  private simpleEmbedding(text: string, dimensions: number): number[] {
    // Simple hash-based embedding (placeholder)
    // In production, use OpenAI embeddings or local model
    const embedding = new Array(dimensions).fill(0);
    const words = text.toLowerCase().split(/\s+/);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      for (let j = 0; j < word.length; j++) {
        const idx = (word.charCodeAt(j) * (i + 1) * (j + 1)) % dimensions;
        embedding[idx] += 1 / (words.length * word.length);
      }
    }

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dimensions; i++) {
        embedding[i] /= magnitude;
      }
    }

    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude > 0 ? dotProduct / magnitude : 0;
  }

  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      content: row.content,
      embedding: row.embedding ? Array.from(new Float32Array(row.embedding.buffer)) : undefined,
      metadata: {
        source: row.source as MemorySource,
        importance: row.importance,
        tags: row.tags ? JSON.parse(row.tags) : [],
        relatedMemories: row.related_memories ? JSON.parse(row.related_memories) : undefined,
        expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      },
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // ==========================================================================
  // CAPABILITIES
  // ==========================================================================

  private buildCapabilities(): TentacleCapability[] {
    return [
      {
        name: 'store',
        description: 'Store a new memory',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          content: { type: 'string', description: 'The memory content', required: true },
          source: { type: 'string', description: 'Memory source type', required: false },
          importance: { type: 'number', description: 'Importance 0-1', required: false },
          tags: { type: 'array', description: 'Tags for the memory', required: false },
        },
        handler: async (params) => {
          return this.store(params.content as string, {
            source: params.source as MemorySource,
            importance: params.importance as number,
            tags: params.tags as string[],
          });
        },
      },
      {
        name: 'search',
        description: 'Semantic search for relevant memories',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          query: { type: 'string', description: 'Search query', required: true },
          limit: { type: 'number', description: 'Max results', required: false },
        },
        handler: async (params) => {
          return this.search(params.query as string, params.limit as number);
        },
      },
      {
        name: 'retrieve',
        description: 'Retrieve a specific memory by ID',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          id: { type: 'string', description: 'Memory ID', required: true },
        },
        handler: async (params) => {
          return this.retrieve(params.id as string);
        },
      },
      {
        name: 'get_recent',
        description: 'Get recent memories',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          limit: { type: 'number', description: 'Max results', required: false },
        },
        handler: async (params) => {
          return this.getRecent(params.limit as number);
        },
      },
      {
        name: 'delete',
        description: 'Delete a memory',
        permissionLevel: PermissionLevel.L4_DESTRUCTIVE,
        parameters: {
          id: { type: 'string', description: 'Memory ID', required: true },
        },
        handler: async (params) => {
          return this.delete(params.id as string);
        },
      },
      {
        name: 'get_stats',
        description: 'Get memory statistics',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {},
        handler: async () => {
          return this.getStats();
        },
      },
    ];
  }
}

export default MemoryTentacle;
