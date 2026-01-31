#!/usr/bin/env bun
/**
 * Octpus - Lightweight CLI
 *
 * A minimal, fast CLI that lazy-loads capabilities as needed.
 * This is the main entry point for the `octpus` command.
 *
 * Usage:
 *   octpus              → Interactive chat
 *   octpus "message"    → Quick query
 *   octpus daemon start → Background agent
 *   octpus setup        → Configure integrations
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

// =============================================================================
// CONFIG
// =============================================================================

const VERSION = '0.1.2';
const CONFIG_DIR = path.join(os.homedir(), '.octpus');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface Config {
  anthropicApiKey?: string;
  model?: string;
  integrations?: Record<string, any>;
  onboardingComplete?: boolean;
}

// =============================================================================
// COLORS
// =============================================================================

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

// =============================================================================
// HELPERS
// =============================================================================

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// =============================================================================
// COMMANDS
// =============================================================================

async function setup(): Promise<void> {
  console.log(`\n${c.cyan}${c.bold}Octpus Setup${c.reset}\n`);

  const config = loadConfig();

  // API Key
  const key = await prompt(`Anthropic API Key${config.anthropicApiKey ? ' (press Enter to keep current)' : ''}: `);
  if (key) config.anthropicApiKey = key;

  // Integrations (optional)
  console.log(`\n${c.dim}Optional integrations (press Enter to skip):${c.reset}\n`);

  // Telegram setup with pairing
  const setupTelegram = await prompt('Setup Telegram? (y/N): ');
  if (setupTelegram.toLowerCase() === 'y') {
    await setupTelegramIntegration(config);
  }

  // Discord setup
  const discord = await prompt('Discord Bot Token: ');
  if (discord) config.integrations = { ...config.integrations, discord: { botToken: discord } };

  config.onboardingComplete = true;
  saveConfig(config);

  console.log(`\n${c.green}✓${c.reset} Config saved to ${CONFIG_FILE}\n`);
}

async function setupTelegramIntegration(config: Config): Promise<void> {
  console.log(`\n${c.cyan}Telegram Setup${c.reset}`);
  console.log(`${c.dim}Create a bot via @BotFather on Telegram first.${c.reset}\n`);

  const botToken = await prompt('Bot Token: ');
  if (!botToken) return;

  // Validate token by calling getMe
  console.log(`${c.dim}Verifying bot token...${c.reset}`);

  try {
    const meResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meData = await meResponse.json() as any;

    if (!meData.ok) {
      console.log(`${c.red}Invalid bot token.${c.reset} Please check and try again.\n`);
      return;
    }

    const botUsername = meData.result.username;
    console.log(`${c.green}✓${c.reset} Connected to @${botUsername}\n`);

    // Now wait for user to pair
    console.log(`${c.bold}Pairing:${c.reset}`);
    console.log(`1. Open Telegram and search for @${botUsername}`);
    console.log(`2. Send ${c.cyan}/start${c.reset} to the bot`);
    console.log(`\n${c.dim}Waiting for your message...${c.reset}\n`);

    // Long-poll for updates
    let chatId: string | null = null;
    let userId: string | null = null;
    let username: string | null = null;
    let offset = 0;

    // Clear any pending updates first
    await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=-1`);

    const timeout = setTimeout(() => {
      if (!chatId) {
        console.log(`\n${c.yellow}Timeout.${c.reset} You can pair later by running: octpus setup\n`);
        process.exit(0);
      }
    }, 120000); // 2 minute timeout

    while (!chatId) {
      try {
        const updatesResponse = await fetch(
          `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=30`
        );
        const updatesData = await updatesResponse.json() as any;

        if (updatesData.ok && updatesData.result.length > 0) {
          for (const update of updatesData.result) {
            offset = update.update_id + 1;

            if (update.message) {
              chatId = update.message.chat.id.toString();
              userId = update.message.from.id.toString();
              username = update.message.from.username || update.message.from.first_name;

              // Send welcome message
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: chatId,
                  text: `🐙 *Octpus paired successfully!*\n\nI'll send you messages here. You can also chat with me directly.`,
                  parse_mode: 'Markdown'
                })
              });

              break;
            }
          }
        }
      } catch (e) {
        // Ignore polling errors, retry
      }
    }

    clearTimeout(timeout);

    console.log(`${c.green}✓${c.reset} Paired with ${username} (Chat ID: ${chatId})\n`);

    // Save to config
    config.integrations = {
      ...config.integrations,
      telegram: {
        botToken,
        botUsername,
        chatId,
        userId,
        username,
        pairedAt: new Date().toISOString()
      }
    };

  } catch (error: any) {
    console.log(`${c.red}Error:${c.reset} ${error.message}\n`);
  }
}

async function chat(initialMessage?: string): Promise<void> {
  const config = loadConfig();

  if (!config.anthropicApiKey) {
    console.log(`${c.yellow}No API key configured.${c.reset} Run: octpus setup\n`);
    await setup();
    return chat(initialMessage);
  }

  // Lazy-load Anthropic SDK
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const send = async (content: string): Promise<string> => {
    messages.push({ role: 'user', content });

    const response = await client.messages.create({
      model: config.model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are Octpus, an autonomous AI agent. You are helpful, concise, and capable.
You have access to these capabilities (lazy-loaded when needed):
- Comms: Send messages via Telegram, Discord, WhatsApp, Slack
- Crypto: Manage wallets, check prices, execute swaps
- Browser: Navigate websites, take screenshots, extract data
- Memory: Remember information, search semantically
- Shell: Execute commands (sandboxed)
- Vision: Read text from images, scan QR codes

Be direct and efficient. If the user asks for something you can do, do it.`,
      messages,
    });

    const reply = response.content[0];
    const text = reply.type === 'text' ? reply.text : '';
    messages.push({ role: 'assistant', content: text });
    return text;
  };

  // Handle single message mode
  if (initialMessage) {
    console.log(`${c.dim}Thinking...${c.reset}`);
    const response = await send(initialMessage);
    console.log(`\n${response}\n`);
    return;
  }

  // Interactive mode
  console.log(`\n${c.cyan}🐙 Octpus${c.reset} ${c.dim}v${VERSION}${c.reset}`);
  console.log(`${c.dim}Type a message or /help for commands. Ctrl+C to exit.${c.reset}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const promptUser = (): void => {
    rl.question(`${c.cyan}>${c.reset} `, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        promptUser();
        return;
      }

      // Commands
      if (trimmed.startsWith('/')) {
        const cmd = trimmed.slice(1).split(' ')[0];

        switch (cmd) {
          case 'help':
            console.log(`
${c.bold}Commands:${c.reset}
  /help       Show this help
  /setup      Configure integrations
  /status     Show status
  /clear      Clear conversation
  /exit       Exit

${c.dim}Or just type a message to chat.${c.reset}
`);
            break;

          case 'setup':
            rl.close();
            await setup();
            return chat();

          case 'status':
            const cfg = loadConfig();
            console.log(`
${c.bold}Status:${c.reset}
  API Key: ${cfg.anthropicApiKey ? c.green + '✓' + c.reset : c.red + '✗' + c.reset}
  Telegram: ${cfg.integrations?.telegram ? c.green + '✓' + c.reset : c.dim + '○' + c.reset}
  Discord: ${cfg.integrations?.discord ? c.green + '✓' + c.reset : c.dim + '○' + c.reset}
`);
            break;

          case 'clear':
            messages.length = 0;
            console.log(`${c.dim}Conversation cleared.${c.reset}\n`);
            break;

          case 'exit':
          case 'quit':
            console.log(`\n${c.dim}Goodbye!${c.reset}\n`);
            process.exit(0);

          default:
            console.log(`${c.red}Unknown command.${c.reset} Type /help\n`);
        }

        promptUser();
        return;
      }

      // Chat
      try {
        console.log(`${c.dim}Thinking...${c.reset}`);
        const response = await send(trimmed);
        console.log(`\n${response}\n`);
      } catch (error: any) {
        console.log(`${c.red}Error:${c.reset} ${error.message}\n`);
      }

      promptUser();
    });
  };

  rl.on('close', () => {
    console.log(`\n${c.dim}Goodbye!${c.reset}\n`);
    process.exit(0);
  });

  promptUser();
}

async function daemon(args: string[]): Promise<void> {
  const cmd = args[0];

  switch (cmd) {
    case 'start':
      console.log(`${c.dim}Starting daemon...${c.reset}`);
      // Lazy-load daemon
      const { OctpusDaemon } = await import('../packages/autonomy/src/daemon');
      const config = loadConfig();
      if (!config.anthropicApiKey) {
        console.log(`${c.red}No API key.${c.reset} Run: octpus setup`);
        process.exit(1);
      }
      const d = new OctpusDaemon({ anthropicApiKey: config.anthropicApiKey });
      await d.start();
      break;

    case 'stop':
      const pidFile = path.join(CONFIG_DIR, 'octpus.pid');
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim());
        try {
          process.kill(pid, 'SIGTERM');
          console.log(`${c.green}Daemon stopped.${c.reset}`);
        } catch {
          console.log(`${c.dim}Daemon not running.${c.reset}`);
        }
      } else {
        console.log(`${c.dim}Daemon not running.${c.reset}`);
      }
      break;

    case 'status':
      const pf = path.join(CONFIG_DIR, 'octpus.pid');
      if (fs.existsSync(pf)) {
        const pid = parseInt(fs.readFileSync(pf, 'utf-8').trim());
        try {
          process.kill(pid, 0);
          console.log(`${c.green}Daemon running${c.reset} (PID: ${pid})`);
        } catch {
          console.log(`${c.dim}Daemon not running${c.reset}`);
        }
      } else {
        console.log(`${c.dim}Daemon not running${c.reset}`);
      }
      break;

    case 'logs':
      const logFile = path.join(CONFIG_DIR, 'octpus.log');
      if (fs.existsSync(logFile)) {
        const { spawn } = await import('child_process');
        spawn('tail', ['-f', logFile], { stdio: 'inherit' });
      } else {
        console.log(`${c.dim}No logs yet.${c.reset}`);
      }
      break;

    case 'objective':
      const goal = args.slice(1).join(' ');
      if (!goal) {
        console.log(`Usage: octpus daemon objective "Your goal here"`);
        break;
      }
      // TODO: Send to running daemon via IPC
      console.log(`${c.green}Added objective:${c.reset} ${goal}`);
      break;

    default:
      console.log(`
${c.bold}Octpus Daemon${c.reset}

Usage: octpus daemon <command>

Commands:
  start              Start background daemon
  stop               Stop daemon
  status             Check if running
  logs               Tail daemon logs
  objective <goal>   Add an objective
`);
  }
}

function version(): void {
  console.log(`octpus v${VERSION}`);
}

async function telegram(args: string[]): Promise<void> {
  const config = loadConfig();
  const tg = config.integrations?.telegram;

  if (!tg?.botToken || !tg?.chatId) {
    console.log(`${c.yellow}Telegram not configured.${c.reset} Run: octpus setup\n`);
    return;
  }

  const cmd = args[0];

  switch (cmd) {
    case 'send':
      const message = args.slice(1).join(' ');
      if (!message) {
        console.log(`Usage: octpus telegram send "Your message"`);
        return;
      }

      try {
        const response = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: tg.chatId,
            text: message
          })
        });
        const data = await response.json() as any;

        if (data.ok) {
          console.log(`${c.green}✓${c.reset} Message sent to ${tg.username || tg.chatId}`);
        } else {
          console.log(`${c.red}Error:${c.reset} ${data.description}`);
        }
      } catch (error: any) {
        console.log(`${c.red}Error:${c.reset} ${error.message}`);
      }
      break;

    case 'status':
      console.log(`\n${c.bold}Telegram Status:${c.reset}`);
      console.log(`  Bot: @${tg.botUsername || 'unknown'}`);
      console.log(`  Paired with: ${tg.username || 'unknown'}`);
      console.log(`  Chat ID: ${tg.chatId}`);
      console.log(`  Paired at: ${tg.pairedAt || 'unknown'}\n`);
      break;

    case 'test':
      console.log(`${c.dim}Sending test message...${c.reset}`);
      try {
        const response = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: tg.chatId,
            text: `🐙 Test message from Octpus!\n\nTimestamp: ${new Date().toISOString()}`
          })
        });
        const data = await response.json() as any;

        if (data.ok) {
          console.log(`${c.green}✓${c.reset} Test message sent! Check your Telegram.`);
        } else {
          console.log(`${c.red}Error:${c.reset} ${data.description}`);
        }
      } catch (error: any) {
        console.log(`${c.red}Error:${c.reset} ${error.message}`);
      }
      break;

    case 'unpair':
      delete config.integrations?.telegram;
      saveConfig(config);
      console.log(`${c.green}✓${c.reset} Telegram unpaired.`);
      break;

    default:
      console.log(`
${c.bold}Octpus Telegram${c.reset}

Usage: octpus telegram <command>

Commands:
  status             Show Telegram connection status
  test               Send a test message
  send "message"     Send a message to your Telegram
  unpair             Remove Telegram integration
`);
  }
}

function help(): void {
  console.log(`
${c.cyan}🐙 Octpus${c.reset} - 8 arms. Infinite reach.

${c.bold}Usage:${c.reset}
  octpus                    Interactive chat
  octpus "your message"     Quick query
  octpus setup              Configure API keys & integrations
  octpus telegram <cmd>     Telegram commands
  octpus daemon <cmd>       Background agent
  octpus version            Show version
  octpus help               Show this help

${c.bold}Examples:${c.reset}
  octpus "What's the price of ETH?"
  octpus telegram test
  octpus telegram send "Hello from Octpus!"
  octpus daemon start

${c.dim}Config: ~/.octpus/config.json${c.reset}
`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // No args → check if first run
  if (!command) {
    const config = loadConfig();
    if (!config.onboardingComplete) {
      console.log(`\n${c.cyan}${c.bold}Welcome to Octpus!${c.reset}\n`);
      await setup();
    }
    return chat();
  }

  // Commands
  switch (command) {
    case 'setup':
    case 'configure':
    case 'config':
      return setup();

    case 'daemon':
    case 'd':
      return daemon(args.slice(1));

    case 'telegram':
    case 'tg':
      return telegram(args.slice(1));

    case 'version':
    case '-v':
    case '--version':
      return version();

    case 'help':
    case '-h':
    case '--help':
      return help();

    default:
      // Treat as message
      if (!command.startsWith('-')) {
        return chat(args.join(' '));
      }
      console.log(`Unknown option: ${command}`);
      help();
  }
}

main().catch(console.error);
