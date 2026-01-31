# Autonomy Engine

The autonomy engine enables Octpus to achieve goals without step-by-step instructions.

## How It Works

```
┌──────────────────┐
│    OBJECTIVE     │  "Wake me up at 7am with a call"
└────────┬─────────┘
         ▼
┌──────────────────┐
│     PLANNER      │  Break into tasks, identify resources
└────────┬─────────┘
         ▼
┌──────────────────┐
│    EXECUTOR      │  Run tasks, handle errors
└────────┬─────────┘
         ▼
┌──────────────────┐
│    REFLECTOR     │  Evaluate progress, adjust
└────────┬─────────┘
         ▼
┌──────────────────┐
│   COMPLETION     │  Verify success criteria
└──────────────────┘
```

## Objectives

An objective is a high-level goal:

```typescript
{
  goal: "Wake me up at 7am with a phone call",
  successCriteria: [
    "Phone call made at 7am",
    "Call connects successfully"
  ],
  constraints: [
    "Use Twilio if needed",
    "Cost under $1"
  ]
}
```

## Planning

The planner uses AI to:

1. Understand what needs to happen
2. Identify required resources (APIs, services)
3. Create task sequence
4. Anticipate risks

Example plan for "Wake me up at 7am":

```
Reasoning: Need phone calls + scheduling + maybe TTS

Resources needed:
- Twilio API (for calls)
- TTS service (for voice)

Tasks:
1. Check if Twilio is configured
2. If not, search for Twilio setup docs
3. Acquire Twilio API credentials
4. Create wake-up call script
5. Schedule for 7am
6. Test with a trial call
7. Confirm to user
```

## Execution

The executor runs tasks with:

- **Dependency handling**: Tasks wait for dependencies
- **Tool selection**: Picks appropriate tentacle
- **Error recovery**: Retries, fallbacks
- **Artifact storage**: Saves results for later tasks

## Reflection

Periodically evaluates:

- Is the plan working?
- Should we try a different approach?
- Are there blockers?

Triggers replanning when needed.

## Using the Daemon

Start background daemon:

```bash
octpus daemon start
```

Add objective:

```bash
octpus daemon objective "Monitor ETH price and alert me if it drops below $2000"
```

View progress:

```bash
octpus daemon logs
```

## Example Objectives

### Trading Bot

```
"Buy $100 of SOL if it drops 10% from current price"

Plan:
1. Get current SOL price
2. Calculate target price (-10%)
3. Set up price monitoring
4. When triggered, execute buy via Jupiter
5. Confirm transaction
```

### Research Agent

```
"Find the top 5 competitors to Notion and summarize features"

Plan:
1. Search for "Notion alternatives 2025"
2. Browse top results
3. Extract product names
4. Visit each product website
5. Extract feature lists
6. Compile comparison report
```

### Automation

```
"Every Monday at 9am, send me a summary of my Git commits"

Plan:
1. Set up cron schedule
2. On trigger, run git log
3. Format as summary
4. Send via preferred channel
```

## Resourcefulness

If Octpus needs something it doesn't have, it will try to acquire it:

```
Objective: "Make a phone call"

Octpus:
→ I don't have phone capabilities
→ Search: "how to make phone calls programmatically"
→ Found: Twilio
→ Search: "Twilio API setup"
→ Create Twilio account (with user approval)
→ Get API credentials
→ Implement call functionality
→ Execute objective
```

## Limits

- Requires internet for AI calls
- Cannot bypass permission system
- Will not acquire paid services without approval
- Maximum 5 retry attempts per objective
