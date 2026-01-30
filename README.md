# 🐙 Octpus

**8 arms. Infinite reach.**

> *The Kraken is rising.*

Octpus is a personal AI agent that's smarter and safer than the competition. Built with security-first architecture, multi-agent coordination, and proper permission levels.

## Why Octpus?

Lobsters are tasty. Octopuses are intelligent.

| Feature | Moltbot 🦞 | Octpus 🐙 |
|---------|-----------|-----------|
| **Architecture** | Single bot | Multi-agent swarm (tentacles) |
| **Permission System** | Trust-based | 6-level granular permissions |
| **Secrets Management** | User responsibility | Encrypted at rest, never logged |
| **Audit Trail** | Basic | Immutable, queryable audit log |
| **Sandboxing** | Optional | Default, enforced |
| **Model Support** | Claude-focused | Hot-swappable (Claude, GPT, Ollama) |
| **Approval Flow** | Per-action | Context-aware with cooldowns |

## Quick Start

```bash
# Install
npm install -g octpus

# Setup
octpus onboard

# Start
octpus start

# Chat
octpus chat
```

## The 8 Tentacles

Octpus operates through specialized tentacles, each with isolated capabilities:

| Tentacle | Purpose | Capabilities |
|----------|---------|--------------|
| 🗣️ **Comms** | Communication | Telegram, Discord, WhatsApp, Slack |
| 💻 **Shell** | Command execution | Sandboxed bash, file operations |
| 🧠 **Memory** | Persistent context | Vector search, long-term recall |
| 🌐 **Browser** | Web automation | Playwright-based, secure |
| 💰 **Crypto** | DeFi operations | Wallet, swaps, on-chain actions |
| 👁️ **Vision** | Screen reading | OCR, image analysis |

## Security Model

Octpus uses a 6-level permission system:

```
L0 - Read       → Auto-approved (search, fetch)
L1 - Write Local → Auto-approved (create files)
L2 - Write External → Confirmation required (send messages)
L3 - Financial    → Confirmation + 2FA (transactions)
L4 - Destructive  → Confirmation + cooldown (delete)
L5 - Irreversible → Human-in-loop always (on-chain, public)
```

Every action is logged to an immutable audit trail.

## Secrets That Stay Secret

Unlike other agents where [200+ API keys leaked](https://blog.gitguardian.com/moltbot-personal-assistant-goes-viral-and-so-do-your-secrets/), Octpus encrypts secrets at rest:

```bash
# Store a secret
octpus secret set ANTHROPIC_API_KEY sk-ant-... --tentacles comms,memory

# Secrets are:
# ✓ Encrypted with AES-256-GCM
# ✓ Never logged or sent to LLM context
# ✓ Access-controlled by tentacle
# ✓ Rotatable via CLI
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OCTPUS CORE                          │
│                   (Coordinator)                         │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Tentacle  │  │   Tentacle  │  │    Tentacle     │  │
│  │   (Comms)   │  │   (Crypto)  │  │   (Computer)    │  │
│  │ TG/WA/Disc  │  │ Wallet/DeFi │  │  Browser/Shell  │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│                         │                               │
│              ┌──────────▼──────────┐                    │
│              │    Brain (Opus)     │                    │
│              │  + Memory + Skills  │                    │
│              └──────────┬──────────┘                    │
│                         │                               │
│              ┌──────────▼──────────┐                    │
│              │   Security Layer    │                    │
│              │ Permissions/Audit   │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

## CLI Reference

```bash
# Onboarding
octpus onboard              # First-time setup wizard

# Running
octpus start                # Start the daemon
octpus start -f             # Run in foreground
octpus chat                 # Interactive terminal chat

# Tentacles
octpus tentacle list        # Show available tentacles
octpus tentacle status      # Health check all tentacles

# Secrets
octpus secret list          # List stored secrets (not values)
octpus secret set KEY VALUE # Store encrypted secret
octpus secret delete KEY    # Remove a secret

# Audit
octpus audit                # View recent audit log
octpus audit -n 100         # Show last 100 entries
```

## Configuration

Config lives at `~/.octpus/config.json`:

```json
{
  "version": "0.1.0",
  "instance": {
    "name": "octpus",
    "description": "My personal AI agent"
  },
  "security": {
    "allowedTentacles": ["comms", "shell", "memory"],
    "sandboxByDefault": true
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "allowedUsers": ["your_username"]
    }
  },
  "models": {
    "default": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514"
    }
  }
}
```

## Project Structure

```
octpus/
├── apps/
│   ├── core/              # Main coordinator
│   ├── gateway/           # HTTP/WebSocket API
│   └── cli/               # CLI tool
├── tentacles/
│   ├── comms/             # Telegram, Discord, etc.
│   ├── crypto/            # Wallet, DeFi
│   ├── browser/           # Playwright automation
│   ├── shell/             # Sandboxed bash
│   ├── memory/            # Vector store
│   └── vision/            # Screen reading
├── packages/
│   ├── types/             # Shared TypeScript types
│   ├── security/          # Permissions, secrets, audit
│   └── models/            # LLM provider abstraction
└── skills/                # Extensible skills
```

## Development

```bash
# Clone
git clone https://github.com/octpusbot/octpus.git
cd octpus

# Install
bun install

# Build
bun run build

# Dev mode
bun run dev
```

## Roadmap

### v0.1.0 (Current)
- [x] Core coordinator
- [x] Permission system (6 levels)
- [x] Secrets management (encrypted)
- [x] Audit logging (immutable)
- [x] Shell tentacle (sandboxed)
- [x] Telegram channel
- [x] CLI tool

### v0.2.0
- [ ] Browser tentacle (Playwright)
- [ ] Memory tentacle (vector search)
- [ ] Discord channel
- [ ] WhatsApp channel

### v0.3.0
- [ ] Crypto tentacle (wallet, DeFi)
- [ ] Skills system
- [ ] Web dashboard

### v1.0.0
- [ ] Multi-agent coordination
- [ ] Skill marketplace
- [ ] Enterprise features

## Philosophy

1. **Security is not optional** - Every action is permission-checked and logged
2. **Secrets stay secret** - Encrypted, access-controlled, never logged
3. **Tentacles are isolated** - Failures don't cascade
4. **Humans approve** - High-risk actions require explicit confirmation
5. **Audit everything** - Full traceability for forensics

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

---

<p align="center">
  <b>The Kraken is rising.</b><br>
  <sub>Built with 🐙 by the Octpus community</sub>
</p>
