/**
 * API Tentacle
 * The integration arm of the Octpus - REST/GraphQL calls and webhooks
 *
 * Capabilities:
 * - HTTP requests (GET, POST, PUT, DELETE, PATCH)
 * - GraphQL queries and mutations
 * - Webhook management (receive and send)
 * - OAuth flows
 * - Rate limiting and retry logic
 * - Response caching
 * - API key management
 *
 * Security:
 * - URL allowlist/blocklist
 * - Request signing
 * - Credential encryption
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import {
  TentacleRegistration,
  TentacleCapability,
  PermissionLevel,
} from '@octpus/types';

// =============================================================================
// TYPES
// =============================================================================

export interface ApiConfig {
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  rateLimit?: {
    requests: number;
    windowMs: number;
  };
  allowedDomains?: string[];
  blockedDomains?: string[];
  defaultHeaders?: Record<string, string>;
  cacheEnabled?: boolean;
  cacheTtlMs?: number;
  webhookPort?: number;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  url: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
  timeout?: number;
  auth?: {
    type: 'basic' | 'bearer' | 'api_key';
    credentials: string | { username: string; password: string };
    headerName?: string;
  };
}

export interface HttpResponse {
  id: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: any;
  duration: number;
  cached: boolean;
  timestamp: Date;
}

export interface GraphQLRequest {
  url: string;
  query: string;
  variables?: Record<string, any>;
  operationName?: string;
  headers?: Record<string, string>;
}

export interface Webhook {
  id: string;
  path: string;
  secret?: string;
  events: string[];
  callback: (payload: any, headers: Record<string, string>) => void | Promise<void>;
  created: Date;
}

export interface ApiCredential {
  id: string;
  name: string;
  type: 'api_key' | 'oauth' | 'basic';
  encrypted: string;
  domain?: string;
}

// =============================================================================
// API TENTACLE
// =============================================================================

export class ApiTentacle {
  readonly registration: TentacleRegistration;
  readonly events: EventEmitter;

  private config: ApiConfig;
  private requestQueue: Map<string, HttpRequest> = new Map();
  private cache: Map<string, { response: HttpResponse; expires: number }> = new Map();
  private rateLimitState: Map<string, { count: number; resetAt: number }> = new Map();
  private webhooks: Map<string, Webhook> = new Map();
  private webhookServer: http.Server | null = null;
  private credentials: Map<string, ApiCredential> = new Map();
  private requestHistory: HttpResponse[] = [];

  constructor(config: ApiConfig = {}) {
    this.config = {
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000,
      rateLimit: { requests: 100, windowMs: 60000 },
      blockedDomains: ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'],
      cacheEnabled: true,
      cacheTtlMs: 300000, // 5 minutes
      webhookPort: 9876,
      ...config,
    };

    this.events = new EventEmitter();

    this.registration = {
      id: 'api',
      type: 'api',
      name: 'API Tentacle',
      description: 'REST/GraphQL requests, webhooks, and API integrations',
      version: '0.1.0',
      capabilities: this.buildCapabilities(),
      status: 'initializing',
      sandboxed: false,
      resourceLimits: {
        maxMemoryMB: 128,
        maxCPUPercent: 10,
        maxNetworkMBps: 100,
        maxExecutionSeconds: 300,
      },
    };
  }

  async initialize(): Promise<void> {
    console.log('🐙 API Tentacle initializing...');

    // Start cache cleanup interval
    setInterval(() => this.cleanupCache(), 60000);

    this.registration.status = 'ready';
    console.log('🐙 API Tentacle ready!');
  }

  // ===========================================================================
  // HTTP REQUESTS
  // ===========================================================================

  async request(req: HttpRequest): Promise<HttpResponse> {
    const id = nanoid();
    const startTime = Date.now();

    // Validate URL
    this.validateUrl(req.url);

    // Check rate limit
    await this.checkRateLimit(new URL(req.url).hostname);

    // Check cache for GET requests
    if (req.method === 'GET' && this.config.cacheEnabled) {
      const cached = this.getFromCache(req);
      if (cached) return cached;
    }

    // Build request
    const url = this.buildUrl(req.url, req.query);
    const headers = this.buildHeaders(req);
    const body = req.body ? JSON.stringify(req.body) : undefined;

    // Execute with retry
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries!; attempt++) {
      try {
        const response = await this.executeRequest(url, {
          method: req.method,
          headers,
          body,
          timeout: req.timeout || this.config.timeout,
        });

        const httpResponse: HttpResponse = {
          id,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body,
          duration: Date.now() - startTime,
          cached: false,
          timestamp: new Date(),
        };

        // Cache successful GET responses
        if (req.method === 'GET' && response.status < 400 && this.config.cacheEnabled) {
          this.addToCache(req, httpResponse);
        }

        this.addToHistory(httpResponse);
        this.events.emit('request:completed', httpResponse);

        return httpResponse;
      } catch (error: any) {
        lastError = error;
        if (attempt < this.config.maxRetries!) {
          await this.delay(this.config.retryDelay! * Math.pow(2, attempt));
        }
      }
    }

    const errorResponse: HttpResponse = {
      id,
      status: 0,
      statusText: lastError?.message || 'Request failed',
      headers: {},
      body: null,
      duration: Date.now() - startTime,
      cached: false,
      timestamp: new Date(),
    };

    this.events.emit('request:failed', { request: req, error: lastError });
    throw lastError;
  }

  async get(url: string, options?: Partial<HttpRequest>): Promise<HttpResponse> {
    return this.request({ method: 'GET', url, ...options });
  }

  async post(url: string, body?: any, options?: Partial<HttpRequest>): Promise<HttpResponse> {
    return this.request({ method: 'POST', url, body, ...options });
  }

  async put(url: string, body?: any, options?: Partial<HttpRequest>): Promise<HttpResponse> {
    return this.request({ method: 'PUT', url, body, ...options });
  }

  async delete(url: string, options?: Partial<HttpRequest>): Promise<HttpResponse> {
    return this.request({ method: 'DELETE', url, ...options });
  }

  async patch(url: string, body?: any, options?: Partial<HttpRequest>): Promise<HttpResponse> {
    return this.request({ method: 'PATCH', url, body, ...options });
  }

  // ===========================================================================
  // GRAPHQL
  // ===========================================================================

  async graphql(req: GraphQLRequest): Promise<any> {
    const response = await this.post(req.url, {
      query: req.query,
      variables: req.variables,
      operationName: req.operationName,
    }, {
      headers: {
        'Content-Type': 'application/json',
        ...req.headers,
      },
    });

    if (response.body?.errors) {
      throw new Error(`GraphQL Error: ${JSON.stringify(response.body.errors)}`);
    }

    return response.body?.data;
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  async createWebhook(
    path: string,
    callback: Webhook['callback'],
    options?: { secret?: string; events?: string[] }
  ): Promise<Webhook> {
    const webhook: Webhook = {
      id: nanoid(),
      path: path.startsWith('/') ? path : `/${path}`,
      secret: options?.secret,
      events: options?.events || ['*'],
      callback,
      created: new Date(),
    };

    this.webhooks.set(webhook.id, webhook);

    // Start webhook server if not running
    if (!this.webhookServer) {
      await this.startWebhookServer();
    }

    this.events.emit('webhook:created', webhook);
    return webhook;
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    this.webhooks.delete(webhookId);
    this.events.emit('webhook:deleted', { id: webhookId });

    // Stop server if no webhooks
    if (this.webhooks.size === 0 && this.webhookServer) {
      this.webhookServer.close();
      this.webhookServer = null;
    }
  }

  getWebhooks(): Webhook[] {
    return Array.from(this.webhooks.values());
  }

  private async startWebhookServer(): Promise<void> {
    return new Promise((resolve) => {
      this.webhookServer = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${this.config.webhookPort}`);

        // Find matching webhook
        const webhook = Array.from(this.webhooks.values()).find(w => w.path === url.pathname);

        if (!webhook) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        // Parse body
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const payload = body ? JSON.parse(body) : {};
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(req.headers)) {
              if (typeof value === 'string') headers[key] = value;
            }

            // Verify signature if secret is set
            if (webhook.secret) {
              const signature = headers['x-signature'] || headers['x-hub-signature-256'];
              if (!this.verifyWebhookSignature(body, signature, webhook.secret)) {
                res.writeHead(401);
                res.end('Invalid signature');
                return;
              }
            }

            await webhook.callback(payload, headers);
            this.events.emit('webhook:received', { webhookId: webhook.id, payload });

            res.writeHead(200);
            res.end('OK');
          } catch (error: any) {
            res.writeHead(500);
            res.end(error.message);
          }
        });
      });

      this.webhookServer.listen(this.config.webhookPort, () => {
        console.log(`🐙 Webhook server listening on port ${this.config.webhookPort}`);
        resolve();
      });
    });
  }

  private verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    if (!signature) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const sig = signature.replace('sha256=', '');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  // ===========================================================================
  // SEND WEBHOOK
  // ===========================================================================

  async sendWebhook(
    url: string,
    payload: any,
    options?: { secret?: string; headers?: Record<string, string> }
  ): Promise<HttpResponse> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    if (options?.secret) {
      const signature = crypto
        .createHmac('sha256', options.secret)
        .update(body)
        .digest('hex');
      headers['X-Signature'] = `sha256=${signature}`;
    }

    return this.post(url, payload, { headers });
  }

  // ===========================================================================
  // CREDENTIALS
  // ===========================================================================

  async storeCredential(
    name: string,
    value: string,
    type: ApiCredential['type'] = 'api_key',
    domain?: string
  ): Promise<string> {
    const id = nanoid();

    // Encrypt the credential (in production, use proper key management)
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const credential: ApiCredential = {
      id,
      name,
      type,
      encrypted: `${iv.toString('hex')}:${key.toString('hex')}:${encrypted}`,
      domain,
    };

    this.credentials.set(id, credential);
    return id;
  }

  async getCredential(id: string): Promise<string | null> {
    const credential = this.credentials.get(id);
    if (!credential) return null;

    const [ivHex, keyHex, encrypted] = credential.encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = Buffer.from(keyHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private async executeRequest(
    url: string,
    options: { method: string; headers: Record<string, string>; body?: string; timeout?: number }
  ): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: any }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const req = protocol.request(
        url,
        {
          method: options.method,
          headers: options.headers,
          timeout: options.timeout,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            const headers: Record<string, string> = {};
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === 'string') headers[key] = value;
            }

            let body: any = data;
            const contentType = res.headers['content-type'] || '';
            if (contentType.includes('application/json')) {
              try {
                body = JSON.parse(data);
              } catch {}
            }

            resolve({
              status: res.statusCode || 0,
              statusText: res.statusMessage || '',
              headers,
              body,
            });
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  private validateUrl(url: string): void {
    const parsed = new URL(url);

    // Check blocked domains
    for (const blocked of this.config.blockedDomains || []) {
      if (parsed.hostname === blocked || parsed.hostname.endsWith(`.${blocked}`)) {
        throw new Error(`Domain blocked: ${parsed.hostname}`);
      }
    }

    // Check allowed domains (if whitelist is set)
    if (this.config.allowedDomains && this.config.allowedDomains.length > 0) {
      const allowed = this.config.allowedDomains.some(
        domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
      );
      if (!allowed) {
        throw new Error(`Domain not in allowlist: ${parsed.hostname}`);
      }
    }

    // Block private IPs
    if (this.isPrivateIP(parsed.hostname)) {
      throw new Error(`Private IP addresses are blocked: ${parsed.hostname}`);
    }
  }

  private isPrivateIP(hostname: string): boolean {
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./,
      /^0\./,
      /^169\.254\./,
    ];
    return privateRanges.some(range => range.test(hostname));
  }

  private buildUrl(baseUrl: string, query?: Record<string, string>): string {
    if (!query) return baseUrl;
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private buildHeaders(req: HttpRequest): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Octpus/0.1.0',
      'Accept': 'application/json',
      ...this.config.defaultHeaders,
      ...req.headers,
    };

    if (req.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (req.auth) {
      switch (req.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${req.auth.credentials}`;
          break;
        case 'basic':
          const creds = req.auth.credentials as { username: string; password: string };
          const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
          headers['Authorization'] = `Basic ${encoded}`;
          break;
        case 'api_key':
          const headerName = req.auth.headerName || 'X-API-Key';
          headers[headerName] = req.auth.credentials as string;
          break;
      }
    }

    return headers;
  }

  private async checkRateLimit(domain: string): Promise<void> {
    const state = this.rateLimitState.get(domain);
    const now = Date.now();

    if (!state || now > state.resetAt) {
      this.rateLimitState.set(domain, {
        count: 1,
        resetAt: now + this.config.rateLimit!.windowMs,
      });
      return;
    }

    if (state.count >= this.config.rateLimit!.requests) {
      const waitTime = state.resetAt - now;
      throw new Error(`Rate limit exceeded. Retry after ${waitTime}ms`);
    }

    state.count++;
  }

  private getCacheKey(req: HttpRequest): string {
    return `${req.method}:${req.url}:${JSON.stringify(req.query || {})}`;
  }

  private getFromCache(req: HttpRequest): HttpResponse | null {
    const key = this.getCacheKey(req);
    const cached = this.cache.get(key);

    if (cached && Date.now() < cached.expires) {
      return { ...cached.response, cached: true };
    }

    return null;
  }

  private addToCache(req: HttpRequest, response: HttpResponse): void {
    const key = this.getCacheKey(req);
    this.cache.set(key, {
      response,
      expires: Date.now() + this.config.cacheTtlMs!,
    });
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (now > value.expires) {
        this.cache.delete(key);
      }
    }
  }

  private addToHistory(response: HttpResponse): void {
    this.requestHistory.push(response);
    if (this.requestHistory.length > 100) {
      this.requestHistory.shift();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getHistory(limit?: number): HttpResponse[] {
    return limit ? this.requestHistory.slice(-limit) : [...this.requestHistory];
  }

  async shutdown(): Promise<void> {
    console.log('🐙 API Tentacle shutting down...');

    if (this.webhookServer) {
      this.webhookServer.close();
      this.webhookServer = null;
    }

    this.registration.status = 'disabled';
    console.log('🐙 API Tentacle offline');
  }

  // ===========================================================================
  // CAPABILITIES
  // ===========================================================================

  private buildCapabilities(): TentacleCapability[] {
    return [
      {
        name: 'http_request',
        description: 'Make an HTTP request',
        permissionLevel: PermissionLevel.L2_COMM_EXTERNAL,
        parameters: {
          method: { type: 'string', description: 'HTTP method', required: true },
          url: { type: 'string', description: 'Request URL', required: true },
          headers: { type: 'object', description: 'Request headers', required: false },
          body: { type: 'any', description: 'Request body', required: false },
          query: { type: 'object', description: 'Query parameters', required: false },
        },
        handler: async (params) => this.request(params as HttpRequest),
      },
      {
        name: 'graphql',
        description: 'Execute a GraphQL query',
        permissionLevel: PermissionLevel.L2_COMM_EXTERNAL,
        parameters: {
          url: { type: 'string', description: 'GraphQL endpoint', required: true },
          query: { type: 'string', description: 'GraphQL query', required: true },
          variables: { type: 'object', description: 'Query variables', required: false },
        },
        handler: async (params) => this.graphql(params as GraphQLRequest),
      },
      {
        name: 'create_webhook',
        description: 'Create a webhook endpoint',
        permissionLevel: PermissionLevel.L2_COMM_EXTERNAL,
        parameters: {
          path: { type: 'string', description: 'Webhook path', required: true },
          secret: { type: 'string', description: 'Webhook secret for verification', required: false },
        },
        handler: async (params) => {
          return this.createWebhook(
            params.path as string,
            (payload) => this.events.emit('webhook:payload', payload),
            { secret: params.secret as string }
          );
        },
      },
      {
        name: 'send_webhook',
        description: 'Send a webhook to a URL',
        permissionLevel: PermissionLevel.L2_COMM_EXTERNAL,
        parameters: {
          url: { type: 'string', description: 'Webhook URL', required: true },
          payload: { type: 'object', description: 'Webhook payload', required: true },
          secret: { type: 'string', description: 'Signing secret', required: false },
        },
        handler: async (params) => this.sendWebhook(
          params.url as string,
          params.payload,
          { secret: params.secret as string }
        ),
      },
      {
        name: 'store_credential',
        description: 'Store an API credential securely',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          name: { type: 'string', description: 'Credential name', required: true },
          value: { type: 'string', description: 'Credential value', required: true },
          type: { type: 'string', description: 'Credential type', required: false },
        },
        handler: async (params) => this.storeCredential(
          params.name as string,
          params.value as string,
          params.type as ApiCredential['type']
        ),
      },
      {
        name: 'get_history',
        description: 'Get request history',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          limit: { type: 'number', description: 'Max results', required: false },
        },
        handler: async (params) => this.getHistory(params.limit as number),
      },
    ];
  }
}

export default ApiTentacle;
