/**
 * Browser Tentacle
 * The eyes and hands of the Octpus - web automation and scraping
 *
 * Capabilities:
 * - Web page navigation and interaction
 * - Screenshots and PDF generation
 * - Form filling and submission
 * - Data extraction and scraping
 * - Cookie and session management
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import {
  chromium,
  firefox,
  webkit,
  Browser,
  BrowserContext,
  Page,
  ElementHandle,
  BrowserType,
} from 'playwright';
import {
  TentacleRegistration,
  TentacleCapability,
  PermissionLevel,
} from '@octpus/types';

// =============================================================================
// TYPES
// =============================================================================

export interface BrowserConfig {
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  userDataDir?: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  viewport?: { width: number; height: number };
  timeout?: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  html: string;
  text: string;
  screenshot?: Buffer;
  timestamp: Date;
}

export interface ElementInfo {
  selector: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  visible: boolean;
  clickable: boolean;
}

// =============================================================================
// BROWSER TENTACLE
// =============================================================================

export class BrowserTentacle {
  readonly registration: TentacleRegistration;
  readonly events: EventEmitter;

  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();
  private pages: Map<string, Page> = new Map();
  private config: BrowserConfig;

  constructor(config: BrowserConfig = {}) {
    this.config = {
      headless: true,
      browser: 'chromium',
      viewport: { width: 1280, height: 720 },
      timeout: 30000,
      ...config,
    };

    this.events = new EventEmitter();

    this.registration = {
      id: 'browser',
      type: 'browser',
      name: 'Browser Tentacle',
      description: 'Web automation, scraping, screenshots, and form interaction',
      version: '0.1.0',
      capabilities: this.buildCapabilities(),
      status: 'initializing',
      sandboxed: true,
      resourceLimits: {
        maxMemoryMB: 1024,
        maxCPUPercent: 50,
        maxNetworkMBps: 100,
        maxExecutionSeconds: 300,
      },
    };
  }

  /**
   * Initialize the browser
   */
  async initialize(): Promise<void> {
    console.log('🐙 Browser Tentacle initializing...');

    const browserType = this.getBrowserType();

    this.browser = await browserType.launch({
      headless: this.config.headless,
      proxy: this.config.proxy,
    });

    this.registration.status = 'ready';
    console.log('🐙 Browser Tentacle ready!');
  }

  // ==========================================================================
  // PAGE MANAGEMENT
  // ==========================================================================

  /**
   * Create a new browser context (isolated session)
   */
  async createContext(name: string): Promise<string> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const context = await this.browser.newContext({
      viewport: this.config.viewport,
      userAgent: 'Octpus/0.1.0 (Browser Tentacle)',
    });

    const contextId = `ctx_${nanoid(8)}`;
    this.contexts.set(contextId, context);

    this.events.emit('context:created', { id: contextId, name });
    return contextId;
  }

  /**
   * Create a new page in a context
   */
  async createPage(contextId?: string): Promise<string> {
    let context: BrowserContext;

    if (contextId) {
      context = this.contexts.get(contextId)!;
      if (!context) {
        throw new Error(`Context not found: ${contextId}`);
      }
    } else {
      // Create default context
      const defaultContextId = await this.createContext('default');
      context = this.contexts.get(defaultContextId)!;
    }

    const page = await context.newPage();
    page.setDefaultTimeout(this.config.timeout!);

    const pageId = `page_${nanoid(8)}`;
    this.pages.set(pageId, page);

    // Setup event listeners
    page.on('console', (msg) => {
      this.events.emit('page:console', { pageId, type: msg.type(), text: msg.text() });
    });

    page.on('pageerror', (error) => {
      this.events.emit('page:error', { pageId, error: error.message });
    });

    this.events.emit('page:created', { id: pageId });
    return pageId;
  }

  /**
   * Close a page
   */
  async closePage(pageId: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (page) {
      await page.close();
      this.pages.delete(pageId);
      this.events.emit('page:closed', { id: pageId });
    }
  }

  // ==========================================================================
  // NAVIGATION
  // ==========================================================================

  /**
   * Navigate to a URL
   */
  async goto(pageId: string, url: string): Promise<PageSnapshot> {
    const page = this.getPage(pageId);

    await page.goto(url, { waitUntil: 'networkidle' });

    return this.getSnapshot(pageId);
  }

  /**
   * Go back in history
   */
  async goBack(pageId: string): Promise<PageSnapshot> {
    const page = this.getPage(pageId);
    await page.goBack();
    return this.getSnapshot(pageId);
  }

  /**
   * Go forward in history
   */
  async goForward(pageId: string): Promise<PageSnapshot> {
    const page = this.getPage(pageId);
    await page.goForward();
    return this.getSnapshot(pageId);
  }

  /**
   * Reload the page
   */
  async reload(pageId: string): Promise<PageSnapshot> {
    const page = this.getPage(pageId);
    await page.reload();
    return this.getSnapshot(pageId);
  }

  // ==========================================================================
  // INTERACTION
  // ==========================================================================

  /**
   * Click an element
   */
  async click(pageId: string, selector: string): Promise<void> {
    const page = this.getPage(pageId);
    await page.click(selector);
    this.events.emit('page:action', { pageId, action: 'click', selector });
  }

  /**
   * Type text into an element
   */
  async type(pageId: string, selector: string, text: string): Promise<void> {
    const page = this.getPage(pageId);
    await page.fill(selector, text);
    this.events.emit('page:action', { pageId, action: 'type', selector });
  }

  /**
   * Press a key
   */
  async press(pageId: string, key: string): Promise<void> {
    const page = this.getPage(pageId);
    await page.keyboard.press(key);
  }

  /**
   * Select an option from a dropdown
   */
  async select(pageId: string, selector: string, value: string): Promise<void> {
    const page = this.getPage(pageId);
    await page.selectOption(selector, value);
  }

  /**
   * Check/uncheck a checkbox
   */
  async check(pageId: string, selector: string, checked: boolean = true): Promise<void> {
    const page = this.getPage(pageId);
    if (checked) {
      await page.check(selector);
    } else {
      await page.uncheck(selector);
    }
  }

  /**
   * Hover over an element
   */
  async hover(pageId: string, selector: string): Promise<void> {
    const page = this.getPage(pageId);
    await page.hover(selector);
  }

  /**
   * Scroll the page
   */
  async scroll(pageId: string, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<void> {
    const page = this.getPage(pageId);

    switch (direction) {
      case 'up':
        await page.evaluate(() => window.scrollBy(0, -500));
        break;
      case 'down':
        await page.evaluate(() => window.scrollBy(0, 500));
        break;
      case 'top':
        await page.evaluate(() => window.scrollTo(0, 0));
        break;
      case 'bottom':
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        break;
    }
  }

  // ==========================================================================
  // DATA EXTRACTION
  // ==========================================================================

  /**
   * Get current page snapshot
   */
  async getSnapshot(pageId: string, includeScreenshot: boolean = false): Promise<PageSnapshot> {
    const page = this.getPage(pageId);

    const [url, title, html, text] = await Promise.all([
      page.url(),
      page.title(),
      page.content(),
      page.evaluate(() => document.body.innerText),
    ]);

    let screenshot: Buffer | undefined;
    if (includeScreenshot) {
      screenshot = await page.screenshot({ type: 'png' });
    }

    return {
      url,
      title,
      html,
      text,
      screenshot,
      timestamp: new Date(),
    };
  }

  /**
   * Take a screenshot
   */
  async screenshot(
    pageId: string,
    options?: { fullPage?: boolean; selector?: string }
  ): Promise<Buffer> {
    const page = this.getPage(pageId);

    if (options?.selector) {
      const element = await page.$(options.selector);
      if (!element) {
        throw new Error(`Element not found: ${options.selector}`);
      }
      return await element.screenshot({ type: 'png' });
    }

    return await page.screenshot({
      type: 'png',
      fullPage: options?.fullPage,
    });
  }

  /**
   * Generate PDF
   */
  async pdf(pageId: string): Promise<Buffer> {
    const page = this.getPage(pageId);
    return await page.pdf({ format: 'A4' });
  }

  /**
   * Extract text from element(s)
   */
  async extractText(pageId: string, selector: string): Promise<string[]> {
    const page = this.getPage(pageId);
    const elements = await page.$$(selector);

    const texts: string[] = [];
    for (const element of elements) {
      const text = await element.textContent();
      if (text) texts.push(text.trim());
    }

    return texts;
  }

  /**
   * Extract element information
   */
  async extractElements(pageId: string, selector: string): Promise<ElementInfo[]> {
    const page = this.getPage(pageId);
    const elements = await page.$$(selector);

    const infos: ElementInfo[] = [];
    for (const element of elements) {
      const info = await element.evaluate((el) => ({
        tag: el.tagName.toLowerCase(),
        text: el.textContent?.trim() || '',
        attributes: Object.fromEntries(
          Array.from(el.attributes).map((a) => [a.name, a.value])
        ),
      }));

      const visible = await element.isVisible();
      const clickable = await element.isEnabled();

      infos.push({
        selector,
        ...info,
        visible,
        clickable,
      });
    }

    return infos;
  }

  /**
   * Evaluate JavaScript in the page
   */
  async evaluate<T>(pageId: string, script: string): Promise<T> {
    const page = this.getPage(pageId);
    return await page.evaluate(script) as T;
  }

  /**
   * Wait for a selector
   */
  async waitForSelector(pageId: string, selector: string, timeout?: number): Promise<void> {
    const page = this.getPage(pageId);
    await page.waitForSelector(selector, { timeout });
  }

  /**
   * Wait for navigation
   */
  async waitForNavigation(pageId: string): Promise<void> {
    const page = this.getPage(pageId);
    await page.waitForNavigation();
  }

  // ==========================================================================
  // COOKIES & STORAGE
  // ==========================================================================

  /**
   * Get cookies
   */
  async getCookies(pageId: string): Promise<any[]> {
    const page = this.getPage(pageId);
    const context = page.context();
    return await context.cookies();
  }

  /**
   * Set cookies
   */
  async setCookies(pageId: string, cookies: any[]): Promise<void> {
    const page = this.getPage(pageId);
    const context = page.context();
    await context.addCookies(cookies);
  }

  /**
   * Clear cookies
   */
  async clearCookies(pageId: string): Promise<void> {
    const page = this.getPage(pageId);
    const context = page.context();
    await context.clearCookies();
  }

  /**
   * Get local storage
   */
  async getLocalStorage(pageId: string): Promise<Record<string, string>> {
    const page = this.getPage(pageId);
    return await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          items[key] = localStorage.getItem(key) || '';
        }
      }
      return items;
    });
  }

  // ==========================================================================
  // SHUTDOWN
  // ==========================================================================

  async shutdown(): Promise<void> {
    console.log('🐙 Browser Tentacle shutting down...');

    // Close all pages
    for (const page of this.pages.values()) {
      await page.close();
    }
    this.pages.clear();

    // Close all contexts
    for (const context of this.contexts.values()) {
      await context.close();
    }
    this.contexts.clear();

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.registration.status = 'disabled';
    console.log('🐙 Browser Tentacle offline');
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private getBrowserType(): BrowserType {
    switch (this.config.browser) {
      case 'firefox':
        return firefox;
      case 'webkit':
        return webkit;
      default:
        return chromium;
    }
  }

  private getPage(pageId: string): Page {
    const page = this.pages.get(pageId);
    if (!page) {
      throw new Error(`Page not found: ${pageId}`);
    }
    return page;
  }

  // ==========================================================================
  // CAPABILITIES
  // ==========================================================================

  private buildCapabilities(): TentacleCapability[] {
    return [
      {
        name: 'navigate',
        description: 'Navigate to a URL and get page content',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          url: { type: 'string', description: 'The URL to navigate to', required: true },
        },
        handler: async (params) => {
          const pageId = await this.createPage();
          const snapshot = await this.goto(pageId, params.url as string);
          return { pageId, snapshot };
        },
      },
      {
        name: 'click',
        description: 'Click an element on the page',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          pageId: { type: 'string', description: 'The page ID', required: true },
          selector: { type: 'string', description: 'CSS selector of element to click', required: true },
        },
        handler: async (params) => {
          await this.click(params.pageId as string, params.selector as string);
          return this.getSnapshot(params.pageId as string);
        },
      },
      {
        name: 'type',
        description: 'Type text into an input field',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          pageId: { type: 'string', description: 'The page ID', required: true },
          selector: { type: 'string', description: 'CSS selector of input', required: true },
          text: { type: 'string', description: 'Text to type', required: true },
        },
        handler: async (params) => {
          await this.type(params.pageId as string, params.selector as string, params.text as string);
        },
      },
      {
        name: 'screenshot',
        description: 'Take a screenshot of the page',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          pageId: { type: 'string', description: 'The page ID', required: true },
          fullPage: { type: 'boolean', description: 'Capture full page', required: false },
        },
        handler: async (params) => {
          return this.screenshot(params.pageId as string, { fullPage: params.fullPage as boolean });
        },
      },
      {
        name: 'extract_text',
        description: 'Extract text from elements matching a selector',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          pageId: { type: 'string', description: 'The page ID', required: true },
          selector: { type: 'string', description: 'CSS selector', required: true },
        },
        handler: async (params) => {
          return this.extractText(params.pageId as string, params.selector as string);
        },
      },
      {
        name: 'get_snapshot',
        description: 'Get current page state (URL, title, content)',
        permissionLevel: PermissionLevel.L0_READ,
        parameters: {
          pageId: { type: 'string', description: 'The page ID', required: true },
        },
        handler: async (params) => {
          return this.getSnapshot(params.pageId as string);
        },
      },
      {
        name: 'close_page',
        description: 'Close a browser page',
        permissionLevel: PermissionLevel.L1_WRITE_LOCAL,
        parameters: {
          pageId: { type: 'string', description: 'The page ID', required: true },
        },
        handler: async (params) => {
          await this.closePage(params.pageId as string);
        },
      },
    ];
  }
}

export default BrowserTentacle;
