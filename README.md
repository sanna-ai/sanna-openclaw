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

The plugin replaces core OpenClaw tools with governance-aware `sanna_*` wrappers. The agent sees only the wrappers (via `tools.allow`); each wrapper enforces the constitution before forwarding execution through the gateway.

| Tier | Core Tool | Wrapper | Purpose |
|---|---|---|---|
| 1 | `exec` | `sanna_exec` | Shell command execution |
| 1 | `bash` | `sanna_bash` | Shell (bash variant) |
| 1 | `write` | `sanna_write` | File creation |
| 1 | `edit` | `sanna_edit` | File modification |
| 1 | `apply_patch` | `sanna_apply_patch` | Patch application |
| 1 | `process` | `sanna_process` | Process management |
| 2 | `browser` | `sanna_browser` | Browser actions (composite) |
| 2 | `message` | `sanna_message` | External messaging (composite) |
| 2 | `nodes` | `sanna_nodes` | Node management (composite) |
| 3 | `web_search` | `sanna_web_search` | Web search |
| 3 | `web_fetch` | `sanna_web_fetch` | Web fetch |
| 3 | `cron` | `sanna_cron` | Task scheduling (composite) |
| 3 | `gateway` | `sanna_gateway` | Gateway calls (composite) |
| 3 | `sessions_send` | `sanna_sessions_send` | Session messaging |
| 3 | `sessions_spawn` | `sanna_sessions_spawn` | Session spawning |

## Three Enforcement Layers

1. **Wrapper tools** — Each governed tool gets a `sanna_*` replacement that calls the sidecar's `/enforce` endpoint before execution. If the verdict is `halt`, the action is blocked. If `escalate`, the agent must get human approval.

2. **`before_tool_call` hook** — A structural safety net. If a governed core tool is called directly (bypassing the wrapper), this hook blocks it. Defense in depth.

3. **Audit receipts** — After every tool execution, the `tool_result_persist` hook generates a signed receipt via the sidecar. Every governed tool gets two receipts: one from enforcement, one from audit.

## CLI Commands

| Command | Description |
|---|---|
| `openclaw sanna status` | Sidecar health, constitution, enforcement stats |
| `openclaw sanna audit` | Recent enforcement decisions (`--limit N`) |
| `openclaw sanna verify <hash>` | Verify a receipt by hash |

## Constitution Templates

Three starter templates in `constitutions/` for different use cases:

| Template | Profile |
|---|---|
| `personal.yaml` | Lenient — broad execution and browsing, messaging escalated |
| `developer.yaml` | Balanced — full workspace access, communication escalated |
| `team.yaml` | Strict — narrow execution, broad escalation requirements |

See [docs/CONSTITUTION_GUIDE.md](docs/CONSTITUTION_GUIDE.md) for customization.

## Configuration

In `openclaw.json`:

```json
{
  "tools": {
    "allow": [
      "sanna_exec", "sanna_bash", "sanna_write", "sanna_edit",
      "sanna_apply_patch", "sanna_process", "sanna_browser",
      "sanna_message", "sanna_nodes", "sanna_web_search",
      "sanna_web_fetch", "sanna_cron", "sanna_gateway",
      "sanna_sessions_send", "sanna_sessions_spawn",
      "group:sessions", "group:memory", "image", "read",
      "canvas", "agents_list", "session_status"
    ]
  },
  "plugin": "@sanna/openclaw",
  "config": {
    "constitutionPath": "./constitutions",
    "sidecarPort": 18890,
    "gatewayPort": 18789,
    "enforcementMode": "enforce"
  }
}
```

## Requirements

- Node.js 22+
- Python 3.10+
- OpenClaw Gateway
- `sanna` ~= 0.13.6 (installed automatically by `openclaw sanna setup`)

## Development

```bash
# TypeScript tests (106 tests)
npm test

# Python sidecar tests (24 tests)
cd sidecar && python -m pytest tests/ -v

# Type check
npm run lint
```

## License

AGPL-3.0 — see [LICENSE](LICENSE)
