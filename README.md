# sanna

**[sanna.dev](https://sanna.dev)**

## The Problem

OpenClaw gives your agent powerful tools — `exec`, `bash`, `browser`, `web_fetch`, `write`. Nothing in the default setup stops the agent from sending emails through exec, hitting external APIs, reading credentials, or exfiltrating data through URL parameters. There's no audit trail, no approval workflow, no receipt proving what happened. The agent does what it thinks will accomplish the task.

Sanna is a governance plugin for OpenClaw. It intercepts every tool call through the gateway's `before_tool_call` hook and evaluates it against a YAML constitution before execution.

### Without Sanna

```
> exec(command="curl -X POST https://slack.com/api/chat.postMessage -d 'channel=#prod&text=deployed'")
→ Executed. No audit trail. No receipt. No one was asked.
```

### With Sanna

```
> exec(command="curl -X POST https://slack.com/api/chat.postMessage -d 'channel=#prod&text=deployed'")
✗ Blocked by Sanna governance: Block network/messaging commands routed
  through exec to prevent escalation bypass (receipt: r_528f…a3e1)
```

The `curl` in the command matched `INV_NO_EXTERNAL_COMMS_VIA_EXEC`. The decision was signed, persisted, and returned before the tool executed. The agent never touched the network.

## What Sanna Does

Sanna is a governance layer for AI agents. It has two pillars:

**Constitution enforcement.** YAML constitutions define three tiers of authority: tools the agent can execute freely, actions that require human approval, and operations that are permanently blocked. But tier matching alone isn't enough — invariants inspect the full parameter context of every tool call, catching dangerous patterns regardless of which tool executes them.

**Cryptographic receipts.** Every governance decision — allow, escalate, or halt — produces an Ed25519-signed receipt persisted via a `ReceiptSink` *before* the response returns to the agent. Receipts use the Sanna v1.1 protocol with 14-field fingerprints, receipt chaining (`parent_receipts`), and per-session `workflow_id` tracking. Receipts are tamper-evident and independently verifiable. If it happened, there's a receipt.

The system is fail-closed. If evaluation throws or receipt persistence fails, the action is blocked in enforce mode.

## Architecture

```
  Agent Loop                 OpenClaw Gateway
 ┌──────────┐              ┌─────────────────────────────────────┐
 │           │─ tool call ─>│  before_tool_call hook (sanna)      │
 │           │              │                                     │
 │           │              │  1. evaluateAuthority(tool, params)  │
 │           │              │     via @sanna-ai/core (in-process)  │
 │           │              │  2. Run invariant checks             │
 │           │              │  3. generateReceipt() + signReceipt()│
 │           │              │  4. ReceiptSink.store() (write-ahead)│
 │           │              │  5. OTel span export (optional)      │
 │           │              │  6. Return allow / block to Gateway  │
 │           │<─ result ────│                                     │
 └──────────┘              │  after_tool_call (observability)     │
                           └─────────────────────────────────────┘
```

The `before_tool_call` hook is the primary enforcement point. It fires for every tool call in the agent loop, evaluates authority via `@sanna-ai/core`, and returns `{ block: true }` or `{ blocked: false }` to the Gateway. (Yes, the asymmetric key names are OpenClaw's hook API, not a typo.) No wrapper tools, no tool renaming — native tools execute normally and the hook gates them transparently.

## Quick Start

```bash
# Build the plugin
npm run build

# Pack and install
npm pack
openclaw plugins install @sanna-ai/openclaw

# Enable hooks in ~/.openclaw/openclaw.json
# hooks.internal.enabled must be true for governance to fire

# Restart the gateway
openclaw gateway restart

# Check readiness
openclaw sanna doctor
```

Constitution files are auto-discovered from `constitutions/` — no manual path configuration needed. The postinstall script copies templates automatically on `npm install`.

See [docs/SETUP.md](docs/SETUP.md) for detailed installation steps.

## Governed Tools

All tool calls pass through the `before_tool_call` hook. The default governed tools are organized by tier:

| Tier | Tools | Risk Level |
|---|---|---|
| 1 | `exec`, `bash`, `write`, `edit`, `apply_patch`, `process` | Modifies system state |
| 2 | `browser`, `message`, `nodes` | Composite tools with high-risk actions |
| 3 | `web_search`, `web_fetch`, `cron`, `gateway`, `sessions_send`, `sessions_spawn` | Audit trail |

Tier 4 tools (`read`, `image`, `canvas`, `sessions_list`, `sessions_history`, `session_status`, `memory_search`, `memory_get`, `agents_list`) are not governed by default.

## Enforcement Layers

Each tool call is evaluated through multiple layers:

1. **Authority evaluation** — `evaluateAuthority()` checks tool name and parameters against the constitution's `authority_boundaries` (cannot_execute, must_escalate, can_execute)
2. **Invariant checks** — `runAllInvariantChecks()` evaluates constitution invariants against the action context, with in-process regex fallback for `regex_deny` rules
3. **LLM semantic checks** (optional) — AI-powered invariant evaluation via `enableLlmChecks()`
4. **Custom evaluators** (optional) — user-defined evaluator modules loaded at startup

Results from all layers are collected as `CheckResult[]` in the receipt, with `evaluation_coverage` tracking which checks ran and passed.

## Enforcement Modes

| Mode | Behavior |
|---|---|
| `enforce` | Block on deny/escalate, fail-closed on errors |
| `audit` | Log decisions but never block — for monitoring and tuning |
| `passthrough` | No enforcement |

## CLI Commands

| Command | Description |
|---|---|
| `openclaw sanna doctor` | Check governance readiness (hooks, constitution, receipt store, keys, LLM checks) |
| `openclaw sanna status` | Constitution info, enforcement stats |
| `openclaw sanna audit` | Recent enforcement decisions as a formatted table (`--limit N`, `--json`) |
| `openclaw sanna verify <id>` | Verify a receipt's integrity (`--strict`, `--json`) |

### Audit Output

The `audit` command displays a color-coded table with timestamps, tool names, verdicts (green ALLOW, yellow ESCALATE, red HALT), and reasons. Use `--json` for machine-readable output.

### Receipt Verification

The `verify` command runs a 5-stage verification pipeline via `verifyReceipt()` from `@sanna-ai/core`:

1. **Schema** — receipt structure validation
2. **Integrity** — content hash verification
3. **Fingerprint** — receipt fingerprint check
4. **Signature** — Ed25519 signature verification (requires public key)
5. **Strict** — all receipt checks passed (with `--strict` flag)

## Constitution Templates

Three starter templates in `constitutions/` for different use cases:

| Template | Profile |
|---|---|
| `personal.yaml` | Lenient — broad execution and browsing, messaging escalated |
| `developer.yaml` | Balanced — full workspace access, communication escalated, dangerous commands escalated |
| `team.yaml` | Strict — narrow execution, broad escalation requirements |

All templates include 14 invariants covering: external comms bypass, HTTP request tunneling, scripted outbound connections, AppleScript execution, app launching, DNS exfiltration, bash TCP/UDP, encoded payload execution, persistence mechanisms, data exfiltration endpoints, destructive operations, credential harvesting, keychain access, and script file execution.

All templates document evaluation order and matching asymmetry. Key ordering matches evaluation priority: `cannot_execute` → `must_escalate` → `can_execute`.

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

### Full Configuration Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `constitutionPath` | string | `""` (auto-discover) | Path to YAML constitution file |
| `privateKeyPath` | string | `""` | Ed25519 private key PEM for receipt signing |
| `publicKeyPath` | string | `""` | Ed25519 public key PEM for receipt verification |
| `receiptStorePath` | string | `~/.sanna/receipts/openclaw.db` | SQLite receipt store path |
| `governedTools` | string[] | All tier 1+2+3 | Tool names to govern |
| `enforcementMode` | string | `"enforce"` | `enforce`, `audit`, or `passthrough` |
| `sinkType` | string | `"local_sqlite"` | Receipt sink: `local_sqlite`, `null`, or `composite` |
| `contentMode` | string | `"full"` | Receipt content mode: `full`, `redacted`, or `hashes_only` |
| `otelExport` | boolean | `false` | Enable OpenTelemetry span export for receipts |
| `otelServiceName` | string | `"sanna-openclaw"` | OTel service name for exported spans |
| `llmChecks` | boolean | `false` | Enable LLM semantic checks for invariant evaluation |
| `llmChecksModel` | string | `""` | Model to use for LLM checks |
| `customEvaluatorsPath` | string | `""` | Path to JS module registering custom evaluators |

### OpenTelemetry Integration

Set `otelExport: true` and install `@opentelemetry/api` as a peer dependency. Governance receipts are exported as spans after each tool call decision. The exporter is fire-and-forget — failures are swallowed to avoid blocking enforcement.

### LLM Semantic Checks

Set `llmChecks: true` to enable AI-powered invariant evaluation. Optionally set `llmChecksModel` to specify which model to use. LLM checks are additive — they enhance but do not replace rule-based evaluation. Initialization failures are non-fatal.

### Custom Evaluators

Set `customEvaluatorsPath` to a JS module that registers custom invariant evaluators at load time via `registerInvariantEvaluator()` from `@sanna-ai/core`. The module is `require()`'d at plugin startup.

## Requirements

- Node.js 22+
- OpenClaw Gateway >= 2026.1.26

## Development

```bash
# TypeScript tests (178 tests)
npm test

# Type check
npm run lint

# Build (cleans dist/ first via prebuild)
npm run build
```

See the full red-team writeup at [sanna.dev/blog](https://sanna.dev/blog).

## License

AGPL-3.0 — see [LICENSE](LICENSE)

**[sanna.dev](https://sanna.dev)**
