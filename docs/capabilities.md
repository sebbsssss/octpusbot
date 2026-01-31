# Capabilities

Octpus has 6 specialized tentacles, each providing distinct capabilities.

## comms

Multi-channel messaging.

### Supported Platforms

| Platform | Features |
|----------|----------|
| Telegram | Messages, media, buttons, groups |
| Discord | Messages, embeds, reactions, threads |
| WhatsApp | Messages, media, templates |
| Slack | Messages, blocks, modals |

### Examples

```
Send "Hello" to my Telegram
Post an update to #general on Discord
Message John on WhatsApp with the meeting notes
```

## crypto

DeFi operations across multiple chains.

### Chains

| Chain | DEX |
|-------|-----|
| Ethereum | 1inch |
| Polygon | 1inch |
| Arbitrum | 1inch |
| Base | 1inch |
| Optimism | 1inch |
| Solana | Jupiter |

### Features

- Wallet creation and management
- Balance checking
- Token swaps via DEX aggregators
- Portfolio tracking
- Price monitoring

### Examples

```
What's my ETH balance?
Swap 0.1 ETH for USDC
Show my portfolio
Alert me if SOL drops below $80
```

## browser

Web automation via Playwright.

### Features

- Navigate to URLs
- Click, type, interact
- Take screenshots
- Generate PDFs
- Extract data (tables, text, links)
- Fill forms
- Handle cookies and sessions

### Examples

```
Go to hackernews and get the top 5 stories
Screenshot the homepage of example.com
Fill out the contact form on mysite.com
```

## memory

Persistent knowledge storage.

### Features

- Store facts and information
- Semantic search
- Conversation history
- Knowledge relationships

### Examples

```
Remember that my anniversary is March 15
What do you know about my preferences?
Search for anything related to "project alpha"
```

## shell

Sandboxed command execution.

### Features

- Execute bash commands
- Run Python scripts
- Run Node.js scripts
- File operations
- Process management

### Sandbox Restrictions

- No access to sensitive paths (`/etc`, `/root`, etc.)
- No destructive commands (`rm -rf /`, etc.)
- Resource limits (CPU, memory, time)
- Network filtering

### Examples

```
Run ls -la in my home directory
Execute the build script
What processes are using port 3000?
```

## vision

Image processing, all local.

### Features

- OCR (Tesseract.js) - no API needed
- QR code scanning
- Barcode reading
- Document parsing
- Receipt extraction

### Examples

```
Read the text from this screenshot
Scan the QR code in photo.png
Extract data from this invoice
```

## Permission Levels

Each capability has a permission level:

| Action | Level |
|--------|-------|
| Check price | L0 |
| Store memory | L1 |
| Send message | L2 |
| Execute swap | L3 |
| Delete files | L4 |
| Sign transaction | L5 |

See [Security](./security.md) for details.
