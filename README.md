# @sanna/openclaw

Constitution enforcement and cryptographic receipts for OpenClaw agents.

## What It Does

sanna-openclaw is an OpenClaw Gateway plugin that enforces governance constitutions on AI agent tool execution. It prevents unauthorized actions before they happen, generates Ed25519-signed cryptographic receipts for every tool call, and provides three layers of enforcement: wrapper tools that gate execution, a `before_tool_call` safety net hook, and post-execution audit receipts.

## Architecture

```
  Agent                  OpenClaw Gateway              Python Sidecar
 ┌──────┐              ┌───────────────────┐         ┌──────────────────┐
 │      │─ tool call ─>│  sanna-openclaw   │─ HTTP ─>│  FastAPI server  │
 │      │              │  plugin           │         │  (localhost only) │
 │      │              │                   │         │                  │
 │      │              │  1. Wrapper tool   │         │  sanna library   │
 │      │              │     intercepts    │         │  - enforce()     │
 │      │              │  2. POST /enforce │────────>│  - audit()       │
 │      │              │  3. allow/halt?   │<────────│  - Ed25519 sign  │
 │      │              │  4. Forward or    │         │                  │
 │      │<─ result ────│     block         │         └──────────────────┘
 └──────┘              │  5. POST /audit   │─────────────────>│
                       └───────────────────┘
```

The plugin runs in-process with the Gateway. The Python sidecar wraps the `sanna` enforcement library as a localhost HTTP service, managed as a child process with automatic health checks and crash recovery.

## Quick Start

```bash
# Install the plugin
npm install @sanna/openclaw

# Set up the sidecar (creates venv, installs sanna, generates keys)
openclaw sanna setup

# Restart the Gateway to load the plugin
openclaw restart

# Verify in chat
/sanna
```

See [docs/SETUP.md](docs/SETUP.md) for detailed installation steps.

## Governed Tools

The plugin replaces core OpenClaw tools with governance-aware wrappers. The agent calls the wrapper; the wrapper enforces the constitution before forwarding.

| Core Tool | Wrapper | Purpose |
|---|---|---|
| `exec` | `sanna_exec` | Shell command execution |
| `write` | `sanna_write` | File creation |
| `edit` | `sanna_edit` | File modification |
| `apply_patch` | `sanna_patch` | Patch application |
| `browser_navigate` | `sanna_browse` | Browser navigation |
| `browser_click` | `sanna_click` | Browser click actions |
| `browser_type` | `sanna_type` | Browser text input |
| `message` | `sanna_message` | External messaging |
| `cron` | `sanna_cron` | Task scheduling |

## Three Enforcement Layers

1. **Wrapper tools** — Each governed tool gets a `sanna_*` replacement that calls the sidecar's `/enforce` endpoint before execution. If the verdict is `halt`, the action is blocked. If `escalate`, the agent must get human approval.

2. **`before_tool_call` hook** — A structural safety net. If a governed core tool is called directly (bypassing the wrapper), this hook blocks it. Defense in depth.

3. **Audit receipts** — After every tool execution, the `tool_result_persist` hook generates a signed receipt via the sidecar. Every governed tool gets two receipts: one from enforcement, one from audit.

## Agent Tools

| Tool | Description |
|---|---|
| `sanna_check` | Dry-run a tool call against the constitution without executing it |
| `sanna_status` | View loaded constitution, enforcement stats, sidecar version |

## Slash Commands

| Command | Description |
|---|---|
| `/sanna` | Governance dashboard |
| `/sanna receipts` | Browse audit receipts (supports `--tool`, `--verdict`, `--limit`) |
| `/sanna constitution` | View active constitution and boundary counts |

## Constitution Templates

Three templates in `constitutions/` for different use cases:

| Template | Profile |
|---|---|
| `openclaw-personal.yaml` | Conservative — read-only autonomous, everything else escalates |
| `openclaw-developer.yaml` | Developer — broad workspace access, restricted system ops |
| `openclaw-team.yaml` | Team — shared agent with escalation workflows for deployment |

See [docs/CONSTITUTION_GUIDE.md](docs/CONSTITUTION_GUIDE.md) for customization.

## Configuration

In `openclaw.plugin.json`:

```json
{
  "plugin": "@sanna/openclaw",
  "config": {
    "constitutionPath": "./constitutions",
    "sidecarHost": "127.0.0.1",
    "sidecarPort": 18791,
    "governedTools": ["exec", "write", "edit", "apply_patch",
      "browser_navigate", "browser_click", "browser_type",
      "message", "cron"]
  }
}
```

## Requirements

- Node.js 22+
- Python 3.10+
- OpenClaw Gateway
- `sanna` >= 0.13.4 (installed automatically by `openclaw sanna setup`)

## Development

```bash
# TypeScript tests
npm test

# Python sidecar tests
cd sidecar && python -m pytest tests/ -v

# Type check
npm run lint
```

## License

Apache-2.0
