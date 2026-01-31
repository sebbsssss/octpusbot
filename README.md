# Octpus

**8 arms. Infinite reach.**

> *The Kraken is rising.*

Octpus is a **fully autonomous AI agent** that figures out how to achieve your goals — including acquiring the tools and services it needs along the way. Unlike traditional assistants that wait for commands, Octpus proactively works toward objectives.

## What Makes Octpus Different?

| Traditional AI Assistants | Octpus |
|--------------------------|--------|
| Wait for commands | Proactively works toward goals |
| Fail if missing tools | Acquires APIs/services as needed |
| Single-step execution | Plans, executes, reflects, adjusts |
| Manual configuration | Self-configuring and resourceful |

**Example:**
```
You: "Wake me up at 7am with a phone call saying the weather"

Octpus thinks:
→ I need to make phone calls → search for telephony APIs
→ Twilio can do this → sign up, get API keys
→ I need weather data → use OpenWeatherMap API
→ I need voice → use text-to-speech
→ Schedule the call for 7am
→ Test it works
```

---

## Quick Start

### One-liner install

```bash
curl -fsSL https://octpus.dev/install.sh | bash
```

Then run `octpus` to start the onboarding wizard.

### Manual installation

```bash
git clone https://github.com/sebbsssss/octpusbot.git ~/.octpus
cd ~/.octpus && bun install
bun run apps/cli/src/index.ts
```

---

## The 6 Tentacles

| Tentacle | Purpose | Capabilities |
|----------|---------|--------------|
| **Comms** | Communication | Telegram, Discord, WhatsApp, Slack |
| **Crypto** | DeFi operations | Wallet management, swaps, portfolio (EVM + Solana) |
| **Browser** | Web automation | Playwright-based navigation, screenshots, scraping |
| **Memory** | Persistent context | Vector embeddings, semantic search, knowledge graph |
| **Shell** | Command execution | Sandboxed bash, Python, Node.js scripts |
| **Vision** | Image understanding | OCR (Tesseract), QR scanning, document parsing |

---

## Autonomy Engine

The brain that makes Octpus truly autonomous:

```
┌─────────────────────────────────────────────────────────┐
│                      OBJECTIVE                           │
│           "Monitor ETH, buy if < $2000"                  │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│                    PLANNER (AI)                          │
│     Breaks goal into steps, identifies needed resources  │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│                   EXECUTOR LOOP                          │
│  1. Pick next task          4. Observe result            │
│  2. Select tools            5. Reflect & adjust          │
│  3. Execute                 6. Repeat until done         │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│                    SCHEDULER                             │
│        Background daemon for persistent objectives       │
└─────────────────────────────────────────────────────────┘
```

### Using the Daemon

```bash
# Start the background daemon
octpus daemon start

# Add an objective
octpus daemon objective "Alert me on Telegram if BTC drops 5% in an hour"

# View what it's doing
octpus daemon logs

# Check status
octpus daemon status
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/setup` | Re-run the setup wizard |
| `/integrations` | Show configured integrations |
| `/status` | Show system status |
| `/balance` | Check wallet balance |
| `/price <symbol>` | Get token price |
| `/swap <from> <to> <amount>` | Get swap quote |
| `/browse <url>` | Open URL in browser |
| `/ocr <image>` | Extract text from image |
| `/remember <text>` | Store in memory |
| `/recall <query>` | Search memories |
| `/exec <cmd>` | Execute shell command |

---

## Security Model

6-level permission system:

```
L0 - Read         → Auto-approved (search, fetch)
L1 - Write Local  → Auto-approved (create files)
L2 - Write Ext    → Confirmation required (send messages)
L3 - Financial    → Confirmation + 2FA (transactions)
L4 - Destructive  → Confirmation + cooldown (delete)
L5 - Irreversible → Human-in-loop always (on-chain, public)
```

**Safety features:**
- Sandboxed shell execution
- AES-256-GCM encrypted secrets
- Immutable audit logging
- 2FA for high-risk actions (TOTP + WebAuthn)
- No telemetry — fully local

---

## Integrations

### Messaging
| Platform | Setup |
|----------|-------|
| Telegram | Create bot via @BotFather |
| Discord | Create app at Discord Developer Portal |
| WhatsApp | Set up via Meta Business Suite |
| Slack | Create app at api.slack.com |

### Crypto
| Chain | DEX |
|-------|-----|
| Ethereum, Polygon, Arbitrum, Base, Optimism | 1inch |
| Solana | Jupiter |

---

## Configuration

Config at `~/.octpus/config.json`:

```json
{
  "anthropicApiKey": "sk-ant-...",
  "integrations": {
    "telegram": { "botToken": "..." },
    "discord": { "botToken": "..." }
  },
  "onboardingComplete": true
}
```

---

## Project Structure

```
octpusbot/
├── apps/
│   ├── cli/           # Command-line interface
│   ├── core/          # Main orchestrator
│   ├── gateway/       # WebSocket + REST API
│   └── web/           # Landing page
├── packages/
│   ├── autonomy/      # Autonomous agent engine
│   └── types/         # Shared TypeScript types
├── tentacles/
│   ├── browser/       # Web automation
│   ├── comms/         # Messaging adapters
│   ├── crypto/        # Wallet + DeFi
│   ├── memory/        # Knowledge storage
│   ├── shell/         # Command execution
│   └── vision/        # Image processing
└── install.sh         # One-line installer
```

---

## Development

```bash
git clone https://github.com/sebbsssss/octpusbot.git
cd octpusbot
bun install
bun run dev
```

---

## License

MIT

---

<p align="center">
  <b>The Kraken is rising.</b><br>
  <sub>Built with 🐙</sub>
</p>
