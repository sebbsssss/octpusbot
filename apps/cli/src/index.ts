#!/usr/bin/env node
/**
 * Octpus CLI
 * Command-line interface for local interaction with Octpus
 *
 * Features:
 * - Interactive chat mode
 * - Direct command execution
 * - Tentacle management
 * - Configuration management
 * - Status and monitoring
 *
 * Usage:
 *   octpus              - Start interactive chat
 *   octpus chat "msg"   - Send a single message
 *   octpus status       - Show system status
 *   octpus exec <cmd>   - Execute a shell command
 *   octpus crypto       - Crypto operations
 */

import * as readline from 'readline';
import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import { Message, TentacleType, ChannelType } from '@octpus/types';

// =============================================================================
// TYPES
// =============================================================================

interface CLIConfig {
  prompt?: string;
  historyFile?: string;
  maxHistory?: number;
  colors?: boolean;
  silent?: boolean;
}

interface Command {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  handler: (args: string[]) => Promise<void>;
}

type MessageHandler = (message: Message) => Promise<Message>;

// =============================================================================
// COLORS (ANSI escape codes)
// =============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

// =============================================================================
// CLI APPLICATION
// =============================================================================

export class OctpusCLI {
  readonly events: EventEmitter;

  private config: CLIConfig;
  private rl: readline.Interface | null = null;
  private messageHandler?: MessageHandler;
  private commands: Map<string, Command> = new Map();
  private history: string[] = [];
  private running: boolean = false;
  private currentUserId: string;

  constructor(config: CLIConfig = {}) {
    this.config = {
      prompt: '🐙 > ',
      maxHistory: 100,
      colors: true,
      silent: false,
      ...config,
    };

    this.events = new EventEmitter();
    this.currentUserId = `cli-${nanoid(8)}`;
    this.setupCommands();
  }

  /**
   * Start the CLI
   */
  async start(): Promise<void> {
    this.running = true;

    // Print banner
    this.printBanner();

    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.config.prompt!,
      historySize: this.config.maxHistory,
    });

    // Handle line input
    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl!.prompt();
        return;
      }

      // Add to history
      this.history.push(trimmed);

      try {
        await this.processInput(trimmed);
      } catch (error: any) {
        this.printError(error.message);
      }

      if (this.running) {
        this.rl!.prompt();
      }
    });

    // Handle close
    this.rl.on('close', () => {
      this.running = false;
      this.print('\n👋 Goodbye!');
      process.exit(0);
    });

    // Handle SIGINT
    process.on('SIGINT', () => {
      this.print('\n');
      this.rl!.close();
    });

    // Start prompting
    this.rl.prompt();
  }

  /**
   * Stop the CLI
   */
  stop(): void {
    this.running = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Set message handler (called by Octpus core)
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Register a custom command
   */
  registerCommand(command: Command): void {
    this.commands.set(command.name, command);
    for (const alias of command.aliases) {
      this.commands.set(alias, command);
    }
  }

  /**
   * Send a message and get response (for programmatic use)
   */
  async sendMessage(content: string): Promise<string> {
    if (!this.messageHandler) {
      throw new Error('Message handler not configured');
    }

    const message: Message = {
      id: nanoid(),
      channel: 'cli' as ChannelType,
      chatId: 'cli',
      userId: this.currentUserId,
      content,
      timestamp: new Date(),
      role: 'user',
    };

    const response = await this.messageHandler(message);
    return response.content;
  }

  // ==========================================================================
  // INPUT PROCESSING
  // ==========================================================================

  private async processInput(input: string): Promise<void> {
    // Check for command
    if (input.startsWith('/')) {
      const [cmdName, ...args] = input.slice(1).split(/\s+/);
      const command = this.commands.get(cmdName.toLowerCase());

      if (command) {
        await command.handler(args);
        return;
      }

      this.printError(`Unknown command: /${cmdName}. Type /help for available commands.`);
      return;
    }

    // Regular chat message
    if (!this.messageHandler) {
      this.printError('Octpus not connected. Use /connect first.');
      return;
    }

    this.print(`${colors.dim}Thinking...${colors.reset}`);

    try {
      const response = await this.sendMessage(input);
      this.printResponse(response);
    } catch (error: any) {
      this.printError(`Error: ${error.message}`);
    }
  }

  // ==========================================================================
  // COMMANDS
  // ==========================================================================

  private setupCommands(): void {
    // Help command
    this.registerCommand({
      name: 'help',
      aliases: ['h', '?'],
      description: 'Show available commands',
      usage: '/help [command]',
      handler: async (args) => {
        if (args[0]) {
          const cmd = this.commands.get(args[0]);
          if (cmd) {
            this.print(`${colors.bold}${cmd.name}${colors.reset}`);
            this.print(`  ${cmd.description}`);
            this.print(`  Usage: ${cmd.usage}`);
            this.print(`  Aliases: ${cmd.aliases.join(', ') || 'none'}`);
          } else {
            this.printError(`Unknown command: ${args[0]}`);
          }
          return;
        }

        this.print(`${colors.bold}Available Commands:${colors.reset}\n`);

        const uniqueCommands = new Map<string, Command>();
        for (const [name, cmd] of this.commands) {
          if (!uniqueCommands.has(cmd.name)) {
            uniqueCommands.set(cmd.name, cmd);
          }
        }

        for (const cmd of uniqueCommands.values()) {
          this.print(`  ${colors.cyan}/${cmd.name}${colors.reset} - ${cmd.description}`);
        }

        this.print(`\nType a message to chat with Octpus, or use /command for specific actions.`);
      },
    });

    // Status command
    this.registerCommand({
      name: 'status',
      aliases: ['s', 'info'],
      description: 'Show Octpus status',
      usage: '/status',
      handler: async () => {
        this.print(`${colors.bold}Octpus Status${colors.reset}\n`);
        this.print(`  User ID: ${this.currentUserId}`);
        this.print(`  Connected: ${this.messageHandler ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
        this.print(`  History: ${this.history.length} messages`);
        this.print(`  Uptime: ${Math.floor(process.uptime())}s`);
      },
    });

    // Clear command
    this.registerCommand({
      name: 'clear',
      aliases: ['cls', 'c'],
      description: 'Clear the screen',
      usage: '/clear',
      handler: async () => {
        console.clear();
        this.printBanner();
      },
    });

    // History command
    this.registerCommand({
      name: 'history',
      aliases: ['hist'],
      description: 'Show command history',
      usage: '/history [count]',
      handler: async (args) => {
        const count = parseInt(args[0]) || 10;
        const recent = this.history.slice(-count);

        this.print(`${colors.bold}Recent History (${recent.length}):${colors.reset}\n`);
        recent.forEach((item, i) => {
          this.print(`  ${colors.dim}${this.history.length - recent.length + i + 1}.${colors.reset} ${item}`);
        });
      },
    });

    // Exit command
    this.registerCommand({
      name: 'exit',
      aliases: ['quit', 'q'],
      description: 'Exit Octpus CLI',
      usage: '/exit',
      handler: async () => {
        this.stop();
      },
    });

    // Exec command (shell)
    this.registerCommand({
      name: 'exec',
      aliases: ['!', 'shell', 'sh'],
      description: 'Execute a shell command',
      usage: '/exec <command>',
      handler: async (args) => {
        if (args.length === 0) {
          this.printError('Usage: /exec <command>');
          return;
        }

        const command = args.join(' ');
        this.print(`${colors.dim}Executing: ${command}${colors.reset}`);

        try {
          const response = await this.sendMessage(`Execute this shell command: ${command}`);
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });

    // Crypto commands
    this.registerCommand({
      name: 'balance',
      aliases: ['bal', 'wallet'],
      description: 'Check wallet balance',
      usage: '/balance [address] [chain]',
      handler: async (args) => {
        const address = args[0] || 'default';
        const chain = args[1] || 'ethereum';

        this.print(`${colors.dim}Checking balance...${colors.reset}`);

        try {
          const response = await this.sendMessage(
            `Check my wallet balance on ${chain}${address !== 'default' ? ` for address ${address}` : ''}`
          );
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });

    this.registerCommand({
      name: 'price',
      aliases: ['p'],
      description: 'Get token price',
      usage: '/price <symbol>',
      handler: async (args) => {
        if (args.length === 0) {
          this.printError('Usage: /price <symbol> (e.g., /price ETH)');
          return;
        }

        const symbol = args[0].toUpperCase();
        this.print(`${colors.dim}Fetching ${symbol} price...${colors.reset}`);

        try {
          const response = await this.sendMessage(`What is the current price of ${symbol}?`);
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });

    this.registerCommand({
      name: 'swap',
      aliases: ['trade'],
      description: 'Get swap quote',
      usage: '/swap <from> <to> <amount>',
      handler: async (args) => {
        if (args.length < 3) {
          this.printError('Usage: /swap <from> <to> <amount> (e.g., /swap ETH USDC 1)');
          return;
        }

        const [from, to, amount] = args;
        this.print(`${colors.dim}Getting swap quote...${colors.reset}`);

        try {
          const response = await this.sendMessage(
            `Get me a swap quote to trade ${amount} ${from} for ${to}`
          );
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });

    // Browse command
    this.registerCommand({
      name: 'browse',
      aliases: ['open', 'goto'],
      description: 'Open a URL in browser',
      usage: '/browse <url>',
      handler: async (args) => {
        if (args.length === 0) {
          this.printError('Usage: /browse <url>');
          return;
        }

        const url = args[0];
        this.print(`${colors.dim}Opening ${url}...${colors.reset}`);

        try {
          const response = await this.sendMessage(`Open ${url} in the browser and tell me what you see`);
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });

    // Screenshot command
    this.registerCommand({
      name: 'screenshot',
      aliases: ['ss', 'snap'],
      description: 'Take a screenshot of current page',
      usage: '/screenshot [path]',
      handler: async (args) => {
        const path = args[0] || './screenshot.png';
        this.print(`${colors.dim}Taking screenshot...${colors.reset}`);

        try {
          const response = await this.sendMessage(`Take a screenshot and save it to ${path}`);
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });

    // OCR command
    this.registerCommand({
      name: 'ocr',
      aliases: ['read', 'extract'],
      description: 'Extract text from image',
      usage: '/ocr <image-path>',
      handler: async (args) => {
        if (args.length === 0) {
          this.printError('Usage: /ocr <image-path>');
          return;
        }

        const imagePath = args[0];
        this.print(`${colors.dim}Extracting text from ${imagePath}...${colors.reset}`);

        try {
          const response = await this.sendMessage(`Extract all text from the image at ${imagePath}`);
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });

    // Remind command
    this.registerCommand({
      name: 'remind',
      aliases: ['reminder', 'alarm'],
      description: 'Set a reminder',
      usage: '/remind <time> <message>',
      handler: async (args) => {
        if (args.length < 2) {
          this.printError('Usage: /remind <time> <message> (e.g., /remind 5m Check email)');
          return;
        }

        const time = args[0];
        const message = args.slice(1).join(' ');

        try {
          const response = await this.sendMessage(`Remind me in ${time}: ${message}`);
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });

    // Memory commands
    this.registerCommand({
      name: 'remember',
      aliases: ['memo', 'note'],
      description: 'Store something in memory',
      usage: '/remember <content>',
      handler: async (args) => {
        if (args.length === 0) {
          this.printError('Usage: /remember <content>');
          return;
        }

        const content = args.join(' ');

        try {
          const response = await this.sendMessage(`Remember this: ${content}`);
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });

    this.registerCommand({
      name: 'recall',
      aliases: ['search', 'find'],
      description: 'Search memories',
      usage: '/recall <query>',
      handler: async (args) => {
        if (args.length === 0) {
          this.printError('Usage: /recall <query>');
          return;
        }

        const query = args.join(' ');
        this.print(`${colors.dim}Searching memories...${colors.reset}`);

        try {
          const response = await this.sendMessage(`What do you remember about: ${query}`);
          this.printResponse(response);
        } catch (error: any) {
          this.printError(error.message);
        }
      },
    });
  }

  // ==========================================================================
  // OUTPUT HELPERS
  // ==========================================================================

  private printBanner(): void {
    if (this.config.silent) return;

    const banner = `
${colors.cyan}
    ____       __
   / __ \\____/ /_____  __  _______
  / / / / __/ __/ __ \\/ / / / ___/
 / /_/ / /_/ /_/ /_/ / /_/ (__  )
 \\____/\\__/\\__/ .___/\\__,_/____/
             /_/
${colors.reset}
${colors.bold}8 arms. Infinite reach.${colors.reset}
${colors.dim}Type /help for commands, or just start chatting.${colors.reset}
`;

    console.log(banner);
  }

  private print(message: string): void {
    if (!this.config.silent) {
      console.log(message);
    }
  }

  private printResponse(response: string): void {
    this.print(`\n${colors.green}🐙 Octpus:${colors.reset}`);
    this.print(response);
    this.print('');
  }

  private printError(message: string): void {
    this.print(`${colors.red}Error:${colors.reset} ${message}`);
  }
}

// =============================================================================
// MAIN
// =============================================================================

// If run directly
if (require.main === module) {
  const cli = new OctpusCLI();

  // In standalone mode, print instructions
  console.log(`${colors.yellow}Note: Running in standalone mode.${colors.reset}`);
  console.log(`${colors.dim}Connect to Octpus core for full functionality.${colors.reset}\n`);

  cli.start().catch(console.error);
}

export default OctpusCLI;
