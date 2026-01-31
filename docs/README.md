# Octpus Documentation

## Quick Links

- [Getting Started](./getting-started.md)
- [Configuration](./configuration.md)
- [Capabilities](./capabilities.md)
- [Autonomy Engine](./autonomy.md)
- [Security](./security.md)
- [API Reference](./api.md)

## What is Octpus?

Octpus is an autonomous AI agent that achieves goals without step-by-step instructions. Give it an objective, and it figures out how — including acquiring any APIs or services it needs.

```
You: "Alert me on Telegram when ETH drops below $2000"

Octpus:
→ Checks if Telegram is configured
→ Sets up price monitoring
→ Creates alert trigger
→ Confirms when ready
```

## Install

```bash
npx octpus
```

That's it. Run it, set your Anthropic API key, start chatting.

## Core Concepts

### Tentacles

Octpus has 6 specialized capabilities:

| Tentacle | Purpose |
|----------|---------|
| comms | Messaging (Telegram, Discord, WhatsApp, Slack) |
| crypto | DeFi (wallets, swaps, portfolios) |
| browser | Web automation (Playwright) |
| memory | Knowledge storage (vector search) |
| shell | Command execution (sandboxed) |
| vision | Image processing (OCR, QR) |

### Autonomy

The autonomy engine enables goal-directed behavior:

1. **Objective** → What you want to achieve
2. **Planning** → AI breaks it into tasks
3. **Execution** → Tasks run with error handling
4. **Reflection** → Progress evaluation, replanning if needed

### Permissions

6-level system from read-only to irreversible:

```
L0  Read         Auto-approved
L1  Write Local  Auto-approved
L2  Write Ext    Confirmation
L3  Financial    Confirmation + 2FA
L4  Destructive  Confirmation + Cooldown
L5  Irreversible Human-in-loop
```

## Next Steps

1. [Install and configure](./getting-started.md)
2. [Learn the capabilities](./capabilities.md)
3. [Set up integrations](./configuration.md)
4. [Use the autonomy engine](./autonomy.md)
