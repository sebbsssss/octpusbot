# Security

## Permission Levels

Octpus uses a 6-level permission system:

| Level | Name | Approval | Examples |
|-------|------|----------|----------|
| L0 | Read | Auto | Web search, price check, file read |
| L1 | Write Local | Auto | Create file, store memory |
| L2 | Write External | Confirm | Send message, API call |
| L3 | Financial | Confirm + 2FA | Token swap, transaction |
| L4 | Destructive | Confirm + Cooldown | Delete files, revoke access |
| L5 | Irreversible | Human-in-loop | Sign transaction, public post |

### How It Works

Every action is assigned a permission level. The system:

1. Checks action's required level
2. If L0-L1: Auto-approve
3. If L2+: Request confirmation
4. If L3+: Require 2FA
5. Log to audit trail

### Configuring Permissions

Override defaults in config:

```json
{
  "permissions": {
    "shell.execute": "L3",
    "crypto.swap": "L4"
  }
}
```

## Sandbox

Shell commands run in a sandbox:

### Restricted

- `/etc`, `/root`, `/var` - System directories
- `rm -rf /`, `mkfs` - Destructive commands
- Network access to internal IPs
- Unlimited resource usage

### Allowed

- User's home directory
- Temp directories
- Specified project paths
- Outbound HTTPS

### Resource Limits

| Resource | Limit |
|----------|-------|
| CPU | 1 core |
| Memory | 512 MB |
| Time | 60 seconds |
| Disk | 100 MB |

## Secrets

### Storage

Secrets are encrypted at rest:

- Algorithm: AES-256-GCM
- Key derivation: PBKDF2
- Per-tentacle access control

### Never Logged

Secrets are:
- Never included in LLM prompts
- Never written to logs
- Never sent over network (except to target API)

### Managing Secrets

```bash
# List secrets (names only)
octpus secret list

# Add secret
octpus secret set TWILIO_SID xxx --tentacles comms

# Remove secret
octpus secret delete TWILIO_SID
```

## Audit Log

Every action is logged:

```json
{
  "id": "act_123",
  "timestamp": "2025-02-01T10:30:00Z",
  "action": "crypto.swap",
  "tentacle": "crypto",
  "level": "L3",
  "approved": true,
  "userId": "user_1",
  "details": {
    "from": "ETH",
    "to": "USDC",
    "amount": "0.1"
  },
  "hash": "sha256:abc..."
}
```

### Viewing Logs

```bash
# Recent logs
octpus audit

# Last 100 entries
octpus audit -n 100

# Filter by tentacle
octpus audit --tentacle crypto

# Filter by level
octpus audit --level L3+
```

### Immutability

Logs are:
- Append-only
- Hash-chained (each entry includes previous hash)
- Verifiable

## 2FA

For L3+ actions:

### TOTP

Standard time-based codes (Google Authenticator, etc.):

```bash
octpus 2fa setup totp
```

### WebAuthn

Hardware keys (YubiKey, etc.):

```bash
octpus 2fa setup webauthn
```

## Network Security

### Outbound Only

Octpus only makes outbound connections:
- Anthropic API (required)
- Integration APIs (as configured)
- No inbound listeners in CLI mode

### TLS

All connections use TLS 1.2+.

### No Telemetry

Octpus sends no telemetry, analytics, or crash reports. Fully local except:
- LLM API calls
- Configured integration APIs

## Best Practices

1. **Use minimal permissions** - Only configure integrations you need
2. **Enable 2FA** - For anything involving money
3. **Review audit logs** - Check what Octpus has done
4. **Rotate secrets** - Periodically update API keys
5. **Run in container** - For additional isolation
