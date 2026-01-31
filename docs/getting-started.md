# Getting Started

## Installation

### Option 1: npx (recommended)

Run without installing:

```bash
npx octpus
```

### Option 2: npm

Install globally:

```bash
npm install -g octpus
octpus
```

### Option 3: curl

Download standalone binary:

```bash
curl -fsSL octpus.dev/install.sh | bash
octpus
```

### Option 4: Homebrew

```bash
brew install sebbsssss/tap/octpus
octpus
```

### Option 5: Docker

```bash
docker run -it -e ANTHROPIC_API_KEY=sk-... octpus/octpus
```

## First Run

On first run, Octpus starts the setup wizard:

```
$ octpus

Welcome to Octpus!

Step 1: AI Brain
Anthropic API Key: sk-ant-...
✓ API key saved

Step 2: Messaging (optional)
Telegram Bot Token: [Enter to skip]
Skipped

Setup complete!

🐙 >
```

## Configuration

Config is stored at `~/.octpus/config.json`:

```json
{
  "anthropicApiKey": "sk-ant-...",
  "model": "claude-sonnet-4-20250514",
  "integrations": {
    "telegram": { "botToken": "..." }
  },
  "onboardingComplete": true
}
```

Re-run setup anytime:

```bash
octpus setup
```

## Basic Usage

### Interactive Chat

```bash
octpus
```

```
🐙 > What's the price of ETH?
Thinking...

ETH is currently $2,847.32

🐙 > Remember that I'm interested in ETH
Stored in memory.

🐙 > /exit
```

### Quick Query

```bash
octpus "What time is it in Tokyo?"
```

### Commands

| Command | Description |
|---------|-------------|
| `/help` | Show commands |
| `/setup` | Run setup wizard |
| `/status` | Show status |
| `/clear` | Clear conversation |
| `/exit` | Exit |

## Background Daemon

For persistent objectives:

```bash
# Start daemon
octpus daemon start

# Add objective
octpus daemon objective "Monitor BTC and alert if it drops 5%"

# View logs
octpus daemon logs

# Check status
octpus daemon status

# Stop
octpus daemon stop
```

## Next Steps

- [Configure integrations](./configuration.md)
- [Learn capabilities](./capabilities.md)
- [Use autonomy engine](./autonomy.md)
