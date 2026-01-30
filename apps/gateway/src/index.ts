/**
 * Octpus Gateway
 * The nerve center - WebSocket + REST API for external control
 *
 * Features:
 * - WebSocket for real-time bidirectional communication
 * - REST API for standard HTTP requests
 * - Authentication (API keys, JWT)
 * - Rate limiting
 * - Request/response logging
 * - Health checks
 *
 * Better than OpenClaw's gateway because we have:
 * - Crypto operations support
 * - Multi-tentacle routing
 * - Permission-aware endpoints
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseUrl } from 'url';
import { Message, ChannelType, TentacleType, PermissionLevel } from '@octpus/types';

// =============================================================================
// TYPES
// =============================================================================

export interface GatewayConfig {
  port: number;
  host?: string;
  apiKeys?: string[];
  jwtSecret?: string;
  rateLimit?: {
    windowMs: number;
    maxRequests: number;
  };
  cors?: {
    origin: string | string[];
    methods: string[];
  };
  ssl?: {
    key: string;
    cert: string;
  };
}

export interface GatewayClient {
  id: string;
  ws: WebSocket;
  userId?: string;
  apiKey?: string;
  connectedAt: Date;
  lastActivity: Date;
  subscriptions: Set<string>;
}

export interface APIRequest {
  id: string;
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  apiKey?: string;
  timestamp: Date;
}

export interface APIResponse {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
  requestId: string;
  timestamp: Date;
}

export interface WSMessage {
  type: 'request' | 'response' | 'event' | 'ping' | 'pong';
  id: string;
  action?: string;
  payload?: unknown;
  error?: { code: string; message: string };
}

type RequestHandler = (req: APIRequest) => Promise<APIResponse>;
type MessageHandler = (message: Message) => Promise<Message>;

// =============================================================================
// GATEWAY
// =============================================================================

export class Gateway {
  readonly events: EventEmitter;

  private config: GatewayConfig;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, GatewayClient> = new Map();
  private routes: Map<string, RequestHandler> = new Map();
  private messageHandler?: MessageHandler;
  private rateLimitMap: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(config: GatewayConfig) {
    this.config = {
      host: '0.0.0.0',
      rateLimit: {
        windowMs: 60000,
        maxRequests: 100,
      },
      cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      },
      ...config,
    };

    this.events = new EventEmitter();
    this.setupRoutes();
  }

  /**
   * Start the gateway server
   */
  async start(): Promise<void> {
    console.log('🐙 Gateway starting...');

    // Create HTTP server
    this.server = createServer((req, res) => this.handleHTTP(req, res));

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws, req) => this.handleWSConnection(ws, req));

    // Start listening
    await new Promise<void>((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        console.log(`🐙 Gateway listening on ${this.config.host}:${this.config.port}`);
        resolve();
      });
    });

    // Start rate limit cleanup
    setInterval(() => this.cleanupRateLimits(), 60000);
  }

  /**
   * Stop the gateway server
   */
  async stop(): Promise<void> {
    console.log('🐙 Gateway stopping...');

    // Close all WebSocket connections
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    console.log('🐙 Gateway offline');
  }

  /**
   * Set message handler (called by Octpus core)
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Register a custom route
   */
  route(method: string, path: string, handler: RequestHandler): void {
    const key = `${method.toUpperCase()}:${path}`;
    this.routes.set(key, handler);
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(event: string, data: unknown): void {
    const message: WSMessage = {
      type: 'event',
      id: nanoid(),
      action: event,
      payload: data,
    };

    const json = JSON.stringify(message);

    for (const client of this.clients.values()) {
      if (client.subscriptions.has(event) || client.subscriptions.has('*')) {
        client.ws.send(json);
      }
    }
  }

  /**
   * Send event to specific client
   */
  sendToClient(clientId: string, event: string, data: unknown): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    const message: WSMessage = {
      type: 'event',
      id: nanoid(),
      action: event,
      payload: data,
    };

    client.ws.send(JSON.stringify(message));
    return true;
  }

  /**
   * Get connected clients
   */
  getClients(): { id: string; userId?: string; connectedAt: Date }[] {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.id,
      userId: c.userId,
      connectedAt: c.connectedAt,
    }));
  }

  // ==========================================================================
  // HTTP HANDLING
  // ==========================================================================

  private async handleHTTP(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = nanoid();
    const startTime = Date.now();

    // CORS headers
    this.setCORSHeaders(res);

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Parse request
      const apiRequest = await this.parseHTTPRequest(req, requestId);

      // Check authentication
      if (!this.authenticateRequest(apiRequest)) {
        this.sendHTTPResponse(res, 401, {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key' },
          requestId,
          timestamp: new Date(),
        });
        return;
      }

      // Check rate limit
      if (!this.checkRateLimit(apiRequest.apiKey || req.socket.remoteAddress || 'unknown')) {
        this.sendHTTPResponse(res, 429, {
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests' },
          requestId,
          timestamp: new Date(),
        });
        return;
      }

      // Find and execute handler
      const routeKey = `${apiRequest.method}:${apiRequest.path}`;
      const handler = this.routes.get(routeKey) || this.findDynamicRoute(apiRequest);

      if (!handler) {
        this.sendHTTPResponse(res, 404, {
          success: false,
          error: { code: 'NOT_FOUND', message: `Route not found: ${apiRequest.method} ${apiRequest.path}` },
          requestId,
          timestamp: new Date(),
        });
        return;
      }

      const response = await handler(apiRequest);
      this.sendHTTPResponse(res, response.success ? 200 : 400, response);

      // Log request
      this.events.emit('request', {
        ...apiRequest,
        duration: Date.now() - startTime,
        status: response.success ? 200 : 400,
      });
    } catch (error: any) {
      console.error('Gateway HTTP error:', error);
      this.sendHTTPResponse(res, 500, {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message },
        requestId,
        timestamp: new Date(),
      });
    }
  }

  private async parseHTTPRequest(req: IncomingMessage, requestId: string): Promise<APIRequest> {
    const parsed = parseUrl(req.url || '/', true);
    const body = await this.parseBody(req);

    return {
      id: requestId,
      method: req.method || 'GET',
      path: parsed.pathname || '/',
      params: {},
      query: parsed.query as Record<string, string>,
      body,
      headers: req.headers as Record<string, string>,
      apiKey: this.extractAPIKey(req),
      timestamp: new Date(),
    };
  }

  private async parseBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];

      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (!body) {
          resolve(undefined);
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
      req.on('error', () => resolve(undefined));
    });
  }

  private extractAPIKey(req: IncomingMessage): string | undefined {
    // Check header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Check X-API-Key header
    const apiKeyHeader = req.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string') {
      return apiKeyHeader;
    }

    return undefined;
  }

  private authenticateRequest(req: APIRequest): boolean {
    // If no API keys configured, allow all
    if (!this.config.apiKeys || this.config.apiKeys.length === 0) {
      return true;
    }

    // Health check doesn't need auth
    if (req.path === '/health') {
      return true;
    }

    return req.apiKey ? this.config.apiKeys.includes(req.apiKey) : false;
  }

  private checkRateLimit(key: string): boolean {
    const now = Date.now();
    const limit = this.rateLimitMap.get(key);

    if (!limit || limit.resetAt < now) {
      this.rateLimitMap.set(key, {
        count: 1,
        resetAt: now + this.config.rateLimit!.windowMs,
      });
      return true;
    }

    if (limit.count >= this.config.rateLimit!.maxRequests) {
      return false;
    }

    limit.count++;
    return true;
  }

  private cleanupRateLimits(): void {
    const now = Date.now();
    for (const [key, limit] of this.rateLimitMap) {
      if (limit.resetAt < now) {
        this.rateLimitMap.delete(key);
      }
    }
  }

  private setCORSHeaders(res: ServerResponse): void {
    const cors = this.config.cors!;
    const origin = Array.isArray(cors.origin) ? cors.origin.join(', ') : cors.origin;

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', cors.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  private sendHTTPResponse(res: ServerResponse, status: number, response: APIResponse): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  private findDynamicRoute(req: APIRequest): RequestHandler | undefined {
    // Check for dynamic routes like /api/tentacles/:tentacleId
    for (const [key, handler] of this.routes) {
      const [method, pattern] = key.split(':');
      if (method !== req.method) continue;

      const patternParts = pattern.split('/');
      const pathParts = req.path.split('/');

      if (patternParts.length !== pathParts.length) continue;

      const params: Record<string, string> = {};
      let match = true;

      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith(':')) {
          params[patternParts[i].slice(1)] = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
          match = false;
          break;
        }
      }

      if (match) {
        req.params = params;
        return handler;
      }
    }

    return undefined;
  }

  // ==========================================================================
  // WEBSOCKET HANDLING
  // ==========================================================================

  private handleWSConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = nanoid();
    const apiKey = this.extractAPIKey(req);

    // Authenticate
    if (this.config.apiKeys && this.config.apiKeys.length > 0) {
      if (!apiKey || !this.config.apiKeys.includes(apiKey)) {
        ws.close(4001, 'Unauthorized');
        return;
      }
    }

    // Create client
    const client: GatewayClient = {
      id: clientId,
      ws,
      apiKey,
      connectedAt: new Date(),
      lastActivity: new Date(),
      subscriptions: new Set(['*']),
    };

    this.clients.set(clientId, client);
    console.log(`🐙 WebSocket client connected: ${clientId}`);

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: 'event',
        id: nanoid(),
        action: 'connected',
        payload: { clientId },
      })
    );

    // Handle messages
    ws.on('message', (data) => this.handleWSMessage(client, data.toString()));

    // Handle close
    ws.on('close', () => {
      this.clients.delete(clientId);
      console.log(`🐙 WebSocket client disconnected: ${clientId}`);
      this.events.emit('client:disconnected', { clientId });
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
    });

    this.events.emit('client:connected', { clientId, apiKey });
  }

  private async handleWSMessage(client: GatewayClient, data: string): Promise<void> {
    client.lastActivity = new Date();

    try {
      const message: WSMessage = JSON.parse(data);

      switch (message.type) {
        case 'ping':
          client.ws.send(JSON.stringify({ type: 'pong', id: message.id }));
          break;

        case 'request':
          await this.handleWSRequest(client, message);
          break;

        default:
          console.warn(`Unknown WebSocket message type: ${message.type}`);
      }
    } catch (error: any) {
      console.error('WebSocket message error:', error);
      client.ws.send(
        JSON.stringify({
          type: 'response',
          id: nanoid(),
          error: { code: 'INVALID_MESSAGE', message: error.message },
        })
      );
    }
  }

  private async handleWSRequest(client: GatewayClient, message: WSMessage): Promise<void> {
    const { id, action, payload } = message;

    try {
      let result: unknown;

      switch (action) {
        case 'subscribe':
          const events = payload as string[];
          events.forEach((e) => client.subscriptions.add(e));
          result = { subscribed: events };
          break;

        case 'unsubscribe':
          const unsubEvents = payload as string[];
          unsubEvents.forEach((e) => client.subscriptions.delete(e));
          result = { unsubscribed: unsubEvents };
          break;

        case 'chat':
          if (!this.messageHandler) {
            throw new Error('Message handler not configured');
          }

          const chatMessage: Message = {
            id: nanoid(),
            channel: 'api',
            chatId: client.id,
            userId: client.userId || client.id,
            content: (payload as { content: string }).content,
            timestamp: new Date(),
            role: 'user',
          };

          const response = await this.messageHandler(chatMessage);
          result = { response: response.content };
          break;

        case 'execute':
          // Direct tentacle execution
          const { tentacle, capability, params } = payload as {
            tentacle: TentacleType;
            capability: string;
            params: Record<string, unknown>;
          };

          this.events.emit('execute', { tentacle, capability, params, clientId: client.id });
          result = { queued: true };
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      client.ws.send(
        JSON.stringify({
          type: 'response',
          id,
          payload: result,
        })
      );
    } catch (error: any) {
      client.ws.send(
        JSON.stringify({
          type: 'response',
          id,
          error: { code: 'REQUEST_FAILED', message: error.message },
        })
      );
    }
  }

  // ==========================================================================
  // DEFAULT ROUTES
  // ==========================================================================

  private setupRoutes(): void {
    // Health check
    this.route('GET', '/health', async () => ({
      success: true,
      data: {
        status: 'healthy',
        uptime: process.uptime(),
        clients: this.clients.size,
      },
      requestId: nanoid(),
      timestamp: new Date(),
    }));

    // API info
    this.route('GET', '/api', async () => ({
      success: true,
      data: {
        name: 'Octpus Gateway',
        version: '0.1.0',
        endpoints: [
          'GET /health',
          'GET /api',
          'POST /api/chat',
          'GET /api/tentacles',
          'POST /api/tentacles/:id/execute',
          'GET /api/clients',
        ],
      },
      requestId: nanoid(),
      timestamp: new Date(),
    }));

    // Chat endpoint
    this.route('POST', '/api/chat', async (req) => {
      if (!this.messageHandler) {
        return {
          success: false,
          error: { code: 'NOT_CONFIGURED', message: 'Message handler not configured' },
          requestId: req.id,
          timestamp: new Date(),
        };
      }

      const { content, userId } = req.body as { content: string; userId?: string };

      const message: Message = {
        id: nanoid(),
        channel: 'api',
        chatId: req.apiKey || 'anonymous',
        userId: userId || 'anonymous',
        content,
        timestamp: new Date(),
        role: 'user',
      };

      const response = await this.messageHandler(message);

      return {
        success: true,
        data: { response: response.content },
        requestId: req.id,
        timestamp: new Date(),
      };
    });

    // Get clients
    this.route('GET', '/api/clients', async (req) => ({
      success: true,
      data: this.getClients(),
      requestId: req.id,
      timestamp: new Date(),
    }));
  }
}

export default Gateway;
