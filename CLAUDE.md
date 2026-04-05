# sanna-openclaw

Governance plugin for OpenClaw. Enforces Sanna constitutions on agent tool execution
with cryptographic receipts via `@sanna-ai/core`.

## Architecture

`before_tool_call` hook is the primary enforcement point. Every tool call in the
agent loop passes through the hook, which calls `evaluateAuthority()` from
`@sanna-ai/core` in-process. No sidecar, no HTTP, no Python, no wrapper tools.

Enforcement flow:
1. Agent calls any tool normally (no special prefixes)
2. `before_tool_call` hook fires via `api.on()`
3. Hook calls `evaluateAuthority(toolName, params, constitution)` from `@sanna-ai/core`
4. Invariant checks run via `runAllInvariantChecks()` (+ optional LLM checks)
5. Receipt generated via `generateReceipt()` with `CheckResult[]` checks and `evaluation_coverage`
6. Receipt persisted to `ReceiptSink` (write-ahead) and optionally exported via OTel
7. Hook returns `{ blocked: false }` (allow) or `{ block: true, blockReason }` (deny/escalate)
8. `tool_result_persist` hook annotates results with receipt hash

Fail-closed: evaluation errors or receipt persistence failures block in enforce mode,
log in audit mode.

## Source Layout

```
src/
  index.ts      — plugin entry point (loads constitution, keys, OTel, LLM checks, custom evaluators)
  hooks.ts      — before_tool_call / after_tool_call / tool_result_persist handlers
  config.ts     — config types, defaults, GOVERNED_TOOLS_DEFAULT tiers
  types.ts      — TypeScript interfaces (SannaConfig, PluginAPI, ToolResult)
  gateway.ts    — sanna.status + sanna.audit RPC methods (queries ReceiptStore)
  cli.ts        — openclaw sanna doctor|status|audit|verify CLI commands
  http.ts       — readHooksEnabled() utility (reads ~/.openclaw/openclaw.json)
skills/sanna/
  SKILL.md      — agent-facing governance guidance (injected into system prompt)
constitutions/  — YAML constitution templates (personal, developer, team)
docs/
  SETUP.md      — installation and configuration guide
  CONSTITUTION_GUIDE.md — constitution authoring reference
scripts/
  postinstall.mjs — copies constitutions to extension root on npm install
tests/          — vitest tests (178 tests across 9 files)
```

## Critical Config

`hooks.internal.enabled` must be `true` in `~/.openclaw/openclaw.json` or
`before_tool_call` hooks will not fire. In enforce mode the plugin throws;
in audit/passthrough mode it warns.

```json
{
  "hooks": {
    "internal": {
      "enabled": true
    }
  }
}
```

## Hook Registration

Hooks are registered via `api.on("before_tool_call", handler)` — NOT
`api.registerHook()` which only stores metadata without wiring the callback.

## Constitution Auto-Discovery

Priority when `constitutionPath` is not set in plugin config:
1. `constitutions/default.yaml` (or `.yml`)
2. `constitutions/constitution.yaml`
3. `constitutions/developer.yaml`
4. First `.yaml`/`.yml` file alphabetically in `constitutions/`

## Dependencies

- `@sanna-ai/core` — `^1.0.0` from npm
  - `evaluateAuthority(action, params, constitution)` → `AuthorityDecision`
  - `loadConstitution(path)` → `Constitution`
  - `generateReceipt(params)` → `Receipt`
  - `signReceipt(receipt, privateKey, signedBy)` → signed receipt
  - `verifyReceipt(receipt, publicKey?)` → `VerificationResult`
  - `ReceiptStore(dbPath?)` — `.save()`, `.query()`, `.count()`, `.close()`
  - `loadPrivateKey(path)` → `KeyObject`
  - `loadPublicKey(path)` → `KeyObject`
  - `loadInvariantChecks(constitution)` → invariant check definitions
  - `runAllInvariantChecks(constitution, output, context)` → `CheckResult[]`
  - `enableLlmChecks(opts?)` — enable LLM semantic invariant evaluation
  - `listEvaluators()` → registered evaluator list
  - `SannaSpanExporter(tracer)` — OTel span exporter for receipts
- `@opentelemetry/api` — optional peer dependency for OTel span export

## OpenClaw APIs Used

- `api.on(event, handler, opts)` — hook registration (before_tool_call, after_tool_call, tool_result_persist)
- `api.registerGatewayMethod(name, handler)` — RPC method registration
- `api.registerCli(fn, { commands })` — CLI command registration
- `api.config` — plugin configuration from openclaw.plugin.json
- `api.logger` — structured logging (info, warn, error)

## Tool Tiers (GOVERNED_TOOLS_DEFAULT)

| Tier | Tools | Risk |
|---|---|---|
| 1 | exec, bash, write, edit, apply_patch, process | Modifies system state |
| 2 | browser, message, nodes | Composite tools with high-risk actions |
| 3 | web_search, web_fetch, cron, gateway, sessions_send, sessions_spawn | Audit trail |

Tier 4 tools (read, image, canvas, sessions_list, sessions_history,
session_status, memory_search, memory_get, agents_list) are NOT governed.

## CLI Commands

- `openclaw sanna status` — mode, constitution info, governed tools, receipt stats
- `openclaw sanna audit` — formatted color-coded table of enforcement receipts (--limit N, --json)
- `openclaw sanna verify <receipt-id>` — 5-stage receipt verification (--strict, --json)
- `openclaw sanna doctor` — check hooks, constitution, receipt store, keys, LLM checks, evaluators

## Gateway RPC Methods

- `sanna.status` — enforcement status, constitution info, receipt stats
- `sanna.audit` — recent enforcement receipts from ReceiptStore

## Constitution Templates

Three starter templates in constitutions/:
- personal.yaml — lenient: broad execution, messaging/process control require escalation
- developer.yaml — balanced: full workspace, communication escalated, dangerous command patterns (sudo, rm -rf, crontab, systemctl, etc.) escalated via parameter-level conditions
- team.yaml — strict: narrow execution, broad escalation requirements, process control prohibited

All templates include 14 invariants (regex_deny rules evaluated in-process) covering:
external comms bypass, HTTP tunneling, scripted outbound, AppleScript, app launching,
DNS exfiltration, bash TCP/UDP, encoded exec, persistence writes, data exfil endpoints,
destructive ops, credential harvesting, keychain access, script file execution.

All templates document evaluation order and matching asymmetry in header comments.
Key: cannot_execute/can_execute match tool names only; must_escalate matches full
action context including parameters. YAML key order matches evaluation priority:
cannot_execute → must_escalate → can_execute.

All validated via `@sanna-ai/core loadConstitution()`. See docs/CONSTITUTION_GUIDE.md.

## Build and Install

```bash
npm run build          # prebuild cleans dist/, then tsc
npm pack               # creates sanna-0.2.0.tgz (respects files field)
openclaw plugins install sanna-0.2.0.tgz
```

Do NOT use `openclaw plugins install .` — it copies everything and ignores
the `files` field in package.json.

## Test Commands

```bash
npx vitest run         # 178 TypeScript tests (9 files)
```

## Plugin Config (openclaw.plugin.json)

| Field | Type | Default | Description |
|---|---|---|---|
| `constitutionPath` | string | auto-discover | Path to YAML constitution |
| `privateKeyPath` | string | none | Ed25519 key PEM for receipt signing |
| `publicKeyPath` | string | none | Ed25519 key PEM for receipt verification |
| `receiptStorePath` | string | `~/.sanna/receipts/openclaw.db` | SQLite receipt store |
| `governedTools` | string[] | tier 1+2+3 | Tool names to govern |
| `enforcementMode` | enum | `enforce` | `enforce`, `audit`, or `passthrough` |
| `otelExport` | boolean | `false` | Enable OTel span export for receipts |
| `otelServiceName` | string | `sanna-openclaw` | OTel service name |
| `llmChecks` | boolean | `false` | Enable LLM semantic invariant checks |
| `llmChecksModel` | string | none | Model for LLM checks |
| `customEvaluatorsPath` | string | none | JS module registering custom evaluators |
| `sinkType` | enum | `local_sqlite` | `local_sqlite`, `null`, or `composite` |
| `contentMode` | enum | `full` | `full`, `redacted`, or `hashes_only` |

## DO NOT

- Add wrapper tools or sanna_* prefixed tools (architecture uses hooks, not wrappers)
- Use `api.registerHook()` for hook registration (use `api.on()` instead)
- Touch constitutions/ templates without running tests
- Assume hooks fire without `hooks.internal.enabled: true`
- Split composite tools (browser is ONE tool with an action parameter)
