# Configuration

## Config File

Location: `~/.octpus/config.json`

```json
{
  "anthropicApiKey": "sk-ant-...",
  "model": "claude-sonnet-4-20250514",
  "integrations": {
    "telegram": {
      "botToken": "123456:ABC..."
    },
    "discord": {
      "botToken": "..."
    },
    "whatsapp": {
      "phoneId": "...",
      "accessToken": "..."
    },
    "slack": {
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  },
  "onboardingComplete": true
}
```

## Environment Variables

Override config with environment variables:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OCTPUS_MODEL` | Model to use |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_BOT_TOKEN` | Discord bot token |

## Integrations

### Telegram

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow prompts
3. Copy the bot token
4. Run `octpus setup` or add to config:

```json
{
  "integrations": {
    "telegram": {
      "botToken": "123456789:ABCdefGHI..."
    }
  }
}
```

### Discord

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create New Application
3. Go to Bot → Add Bot
4. Copy token
5. Enable Message Content Intent
6. Add to config:

```json
{
  "integrations": {
    "discord": {
      "botToken": "..."
    }
  }
}
```

### WhatsApp

1. Set up [Meta Business Suite](https://business.facebook.com/)
2. Create WhatsApp Business App
3. Get Phone Number ID and Access Token
4. Add to config:

```json
{
  "integrations": {
    "whatsapp": {
      "phoneId": "123456789",
      "accessToken": "EAA..."
    }
  }
}
```

### Slack

1. Go to [Slack API](https://api.slack.com/apps)
2. Create New App → From scratch
3. Add Bot Token Scopes: `chat:write`, `channels:read`, `im:read`
4. Install to workspace
5. Enable Socket Mode, create App Token
6. Add to config:

```json
{
  "integrations": {
    "slack": {
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }
}
```

## Models

Default: `claude-sonnet-4-20250514`

Available models:

| Model | Best For |
|-------|----------|
| `claude-sonnet-4-20250514` | General use (default) |
| `claude-opus-4-20250514` | Complex reasoning |
| `claude-haiku-3-20240307` | Fast, simple tasks |

Change model:

```json
{
  "model": "claude-opus-4-20250514"
}
```

## Data Storage

| Path | Content |
|------|---------|
| `~/.octpus/config.json` | Configuration |
| `~/.octpus/data/` | Persistent data |
| `~/.octpus/octpus.pid` | Daemon PID |
| `~/.octpus/octpus.log` | Daemon logs |
