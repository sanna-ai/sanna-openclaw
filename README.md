# sanna

Constitution enforcement and cryptographic receipts for OpenClaw agents.

## What It Does

sanna is an OpenClaw Gateway plugin that enforces governance constitutions on AI agent tool execution. Every tool call in the agent loop passes through a `before_tool_call` hook that evaluates the action against a YAML constitution via `@sanna-ai/core` — in-process, with zero external dependencies. Actions are allowed, blocked, or escalated for human approval, and every decision gets an Ed25519-signed cryptographic receipt persisted before the response is returned.

## Architecture

```
  Agent Loop                 OpenClaw Gateway
 ┌──────────┐              ┌─────────────────────────────────────┐
 │           │─ tool call ─>│  before_tool_call hook (sanna)      │
 │           │              │                                     │
 │           │              │  1. evaluateAuthority(tool, params)  │
 │           │              │     via @sanna-ai/core (in-process)     │
 │           │              │  2. generateReceipt() + signReceipt()│
 │           │              │  3. ReceiptStore.save() (write-ahead)│
 │           │              │  4. Return allow / block to Gateway  │
 │           │<─ result ────│                                     │
 └──────────┘              │  after_tool_call (observability)     │
                           └─────────────────────────────────────┘
```

The `before_tool_call` hook is the primary enforcement point. It fires for every tool call in the agent loop, evaluates authority via `@sanna-ai/core`, and returns `{ block: true }` or `{ blocked: false }`. No wrapper tools, no tool renaming — native tools execute normally and the hook gates them transparently.

**Fail-closed**: if evaluation throws or receipt persistence fails, the action is blocked in enforce mode. In audit mode, decisions are logged but execution is not blocked.

## Quick Start

```bash
# Build the plugin
npm run build

# Pack and install
npm pack
openclaw plugins install sanna-0.1.0.tgz

# Ensure hooks are enabled in ~/.openclaw/openclaw.json
# hooks.internal.enabled must be true for governance to fire

# Restart the gateway
openclaw gateway restart

# Check readiness
openclaw sanna doctor
```

Constitution files are auto-discovered from `constitutions/` — no manual path configuration needed.

See [docs/SETUP.md](docs/SETUP.md) for detailed installation steps.

## Governed Tools

All tool calls pass through the `before_tool_call` hook. The default governed tools are organized by tier:

| Tier | Tools | Risk Level |
|---|---|---|
| 1 | `exec`, `bash`, `write`, `edit`, `apply_patch`, `process` | Modifies system state |
| 2 | `browser`, `message`, `nodes` | Composite tools with high-risk actions |
| 3 | `web_search`, `web_fetch`, `cron`, `gateway`, `sessions_send`, `sessions_spawn` | Audit trail |

Tier 4 tools (`read`, `image`, `canvas`, `sessions_list`, `sessions_history`, `session_status`, `memory_search`, `memory_get`, `agents_list`) are not governed by default.

## Enforcement Modes

| Mode | Behavior |
|---|---|
| `enforce` | Block on deny/escalate, fail-closed on errors |
| `audit` | Log decisions but never block — for monitoring and tuning |
| `passthrough` | No enforcement |

## CLI Commands

| Command | Description |
|---|---|
| `openclaw sanna doctor` | Check governance readiness (hooks, constitution, receipt store) |
| `openclaw sanna status` | Constitution info, enforcement stats |
| `openclaw sanna audit` | Recent enforcement decisions (`--limit N`) |
| `openclaw sanna verify <id>` | Look up a receipt by ID |

## Constitution Templates

Three starter templates in `constitutions/` for different use cases:

| Template | Profile |
|---|---|
| `personal.yaml` | Lenient — broad execution and browsing, messaging escalated |
| `developer.yaml` | Balanced — full workspace access, communication escalated |
| `team.yaml` | Strict — narrow execution, broad escalation requirements |

See [docs/CONSTITUTION_GUIDE.md](docs/CONSTITUTION_GUIDE.md) for customization.

## Configuration

In `openclaw.json`, the plugin reads its config from the plugin block:

```json
{
  "plugins": {
    "sanna": {
      "constitutionPath": "./constitutions",
      "enforcementMode": "enforce"
    }
  },
  "hooks": {
    "internal": {
      "enabled": true
    }
  }
}
```

`hooks.internal.enabled` **must be true** — without it, the `before_tool_call` hook never fires and governance is silently bypassed. In enforce mode, the plugin throws on startup if this is not set. In audit mode, it warns.

## Requirements

- Node.js 22+
- OpenClaw Gateway >= 2026.1.26

## Development

```bash
# TypeScript tests (82 tests)
npm test

# Type check
npm run lint

# Build (cleans dist/ first via prebuild)
npm run build
```

## License

AGPL-3.0 — see [LICENSE](LICENSE)
