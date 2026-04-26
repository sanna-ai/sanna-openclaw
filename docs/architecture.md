# @sanna-ai/openclaw — Architecture

Sanna governance plugin for the OpenClaw Gateway. Intercepts every tool call
through the gateway's `before_tool_call` hook, evaluates it against a YAML
constitution, generates a cryptographic receipt, and returns allow or block to
the gateway — all before the tool executes.

---

## What OpenClaw Is

OpenClaw is an AI agent gateway that runs a local plugin system. Plugins
register hooks (`before_tool_call`, `after_tool_call`, `tool_result_persist`)
against named gateway events. The gateway calls registered hooks in order for
every tool call that flows through the agent loop. sanna-openclaw is a plugin
in this system.

The plugin is loaded by OpenClaw's plugin loader via `src/index.ts`, which is
the single entry point declared in `openclaw.extensions` in `package.json`.

---

## Constitution Enforcement Model

Constitutions are YAML files defining three authority tiers:

| Tier | Key | Meaning |
|---|---|---|
| 1 | `cannot_execute` | Permanently blocked — no override |
| 2 | `must_escalate` | Requires human approval before execution |
| 3 | `can_execute` | Agent may execute freely |

Evaluation order is `cannot_execute → must_escalate → can_execute`. First match
wins. Tool calls that match no tier produce an implicit allow.

Beyond tier matching, constitutions also define **invariants** — regex or
semantic rules evaluated against the full parameter context of every tool call.
An invariant can fire on a tool that would otherwise be in `can_execute`. Halt-
enforcement invariants override the tier verdict and block the tool.

Three starter templates ship with the plugin (`constitutions/`): `personal.yaml`
(lenient), `developer.yaml` (balanced), `team.yaml` (strict). Auto-discovery
at load time: first match from `default.yaml` → `constitution.yaml` →
`developer.yaml` → first `.yaml` alphabetically.

---

## Hook Architecture

### `before_tool_call` — primary enforcement

Fires for every tool call before execution. Steps:

1. Extract `toolName` and `params` from the gateway event.
2. Call `evaluateAuthority(toolName, params, constitution)` via `@sanna-ai/core`.
3. Call `runAllInvariantChecks(constitution, output, context)` via `@sanna-ai/core`.
4. For `exec`/`bash`/`browser`/`web_fetch`/`web_search`/`read`/`write`: run
   in-process regex fallback for `regex_deny` invariants (core returns
   `UNKNOWN_TYPE` for these; `hooks.ts` evaluates them directly).
5. Apply built-in shell injection check for exec/bash tools (defense in depth,
   fires even without a constitution invariant).
6. If verdict is `halt` or `escalate`: generate receipt immediately, persist
   via `ReceiptSink.store()` (write-ahead), return `{ block: true }` to gateway.
7. If verdict is `allow`: store partial triad state in `pendingReceipts` map,
   return `{ blocked: false }` to gateway (tool executes).

The asymmetric response keys (`block` vs `blocked`) are OpenClaw's hook API,
not a bug.

### `after_tool_call` — Receipt Triad completion

Fires after an allowed tool returns its result. Retrieves the pending state by
`correlationId` (or by `toolName` FIFO fallback), computes `action_hash` from
the actual tool result, generates the complete receipt, and persists it.

Receipts for blocked tools are already complete and persisted at
`before_tool_call` time. Receipts for allowed tools are completed here where
the actual output is available.

### `tool_result_persist` — receipt annotation

Optionally stamps receipt metadata onto tool results for transcript inclusion.
Only fires if `_sanna_receipt_hash` is present on the result object.

---

## Receipt Triad

Every governance receipt carries three content-addressed hashes that together
prove what the agent asked for, why, and what happened:

| Field | Source | Present when |
|---|---|---|
| `input_hash` | SHA-256 of `{ tool, args }` (params minus `_justification`) | Always |
| `reasoning_hash` | SHA-256 of `_justification` param value | Agent provides justification |
| `action_hash` | SHA-256 of actual tool result | Tool executed (after_tool_call) |

For blocked tools, `action_hash` is `EMPTY_HASH` (tool never ran). For allowed
tools, `action_hash` is computed from the real result in `after_tool_call`.

`assurance` is `"full"` when all three hashes are meaningful, `"partial"` when
`reasoning_hash` or `action_hash` is `EMPTY_HASH`.

---

## Receipt Protocol

Receipts use Sanna protocol v1.1 (`SPEC_VERSION: "1.1"`, `CHECKS_VERSION: "6"`).
Key fields:

- **14-field fingerprint** — includes `parent_receipts_hash` and `workflow_id_hash`
- **Receipt chaining** — `parent_receipts` links to the prior receipt's fingerprint.
  Must be `null` (not `[]`) when no parent — the two produce different fingerprints.
- **Workflow tracking** — `workflow_id` (UUID) is generated once at plugin load time
  and attached to every receipt for session-level grouping.
- **Content mode** — `full`, `redacted`, or `hashes_only` controls what the receipt
  records about inputs/outputs. Configured via `contentMode` in `openclaw.json`.

Receipts are Ed25519-signed when `privateKeyPath` is configured. Signature
verification uses `publicKeyPath` via `openclaw sanna verify <id>`.

---

## Relationship to `@sanna-ai/core`

`@sanna-ai/core` is the sole production dependency. It provides:

- `evaluateAuthority()` — constitution tier evaluation
- `runAllInvariantChecks()` / `loadInvariantChecks()` — invariant evaluation
- `generateReceipt()` / `signReceipt()` — receipt construction and signing
- `verifyReceipt()` — 5-stage receipt verification pipeline
- `LocalSQLiteSink` / `NullSink` / `ReceiptSink` — receipt persistence abstractions
- `ReceiptStore` — SQLite receipt query interface
- `hashObj()` / `hashContent()` / `EMPTY_HASH` — content-addressable hashing
- `loadConstitution()` / `loadPrivateKey()` / `loadPublicKey()` — file loaders
- `SannaSpanExporter` — OpenTelemetry span export

The plugin never calls the receipt store directly — it always goes through a
`ReceiptSink` for writes and a `ReceiptStore` for reads (obtained from
`LocalSQLiteSink.getStore()`).

---

## Gateway and CLI Architecture

`src/gateway.ts` — registers RPC methods callable by the gateway UI:
`sanna.status` (constitution info, enforcement stats), `sanna.audit` (recent
decisions), `sanna.verify` (receipt integrity check).

`src/cli.ts` — registers `openclaw sanna` subcommands: `doctor` (readiness
check), `status`, `audit`, `verify`.

`src/config.ts` — reads plugin config from the gateway's plugin block in
`~/.openclaw/openclaw.json`. Validates and supplies defaults.

`src/http.ts` — reads `hooks.internal.enabled` from `openclaw.json` via the
gateway's HTTP interface at plugin load time.

`src/types.ts` — shared type definitions (`SannaConfig`, `PluginAPI`).

---

## Security Hardening Notes

**`hooks.internal.enabled` is load-bearing.** Without it, `before_tool_call`
never fires and governance is silently bypassed. In enforce mode, the plugin
throws on startup if this flag is not set. In audit mode, it warns. This is
a deliberately hard failure — silent bypass is worse than a crash.

**Fail-closed in enforce mode.** If `evaluateAuthority()` throws, the tool is
blocked. If `ReceiptSink.store()` fails, the tool is blocked. If invariant
evaluation throws, the tool is blocked. The system does not degrade to allow.

**Write-ahead receipts.** Receipts for blocked/escalated tools are persisted
before the gateway response is returned. There is no window where a governance
decision exists but no receipt.

**Ed25519 signing.** When `privateKeyPath` is configured, every receipt is
signed with Ed25519. The signature covers the receipt fingerprint; tampering
with any field invalidates the fingerprint, which invalidates the signature.

**`better-sqlite3` native module.** OpenClaw installs plugin dependencies with
`--ignore-scripts`, which skips native compilation. The SQLite module requires
a one-time rebuild: `cd ~/.openclaw/extensions/sanna && npm rebuild better-sqlite3`.
The doctor command surfaces this failure explicitly.

---

## Tribal-Knowledge Gotchas

**`before_tool_call` response asymmetry.** Blocked responses use `{ block: true }`;
allowed responses use `{ blocked: false }`. The asymmetric key names are the
OpenClaw hook API contract. Changing to `{ blocked: true }` for blocks would
silently stop enforcement.

**`parent_receipts` must be `null`, not `[]`.** An empty array and `null` produce
different 14-field fingerprints. Always set `parent_receipts: null` when no
prior receipt exists in a session.

**Core returns `UNKNOWN_TYPE` for `regex_deny` invariants.** The core invariant
runner does not have a regex evaluator. `hooks.ts` runs regex evaluation in-
process for the tools in `REGEX_EVAL_TOOLS`. If a new tool type needs regex
invariant coverage, add it to that list.

**`evaluateAuthority` matching asymmetry.** The first matching tier wins; later
tiers are not evaluated. A tool in both `cannot_execute` and `can_execute`
(e.g. via wildcard overlap) will always be blocked — `cannot_execute` is checked
first.

**OTel export is fire-and-forget.** Failures in span export are swallowed. This
is intentional — OTel failures must never block enforcement. Do not add error
recovery that could introduce latency into the hook return path.

**`customEvaluatorsPath` is `require()`'d.** Custom evaluator modules must be
CommonJS or handle dual-module requirements themselves. ESM-only evaluators
loaded via `require()` will fail at load time.

---

## Key Modules

| File | Role |
|---|---|
| `src/index.ts` | Plugin entry point — loads constitution, sink, keys; registers all hooks and CLI |
| `src/hooks.ts` | `before_tool_call`, `after_tool_call`, `tool_result_persist` enforcement logic |
| `src/config.ts` | Config resolution and validation |
| `src/gateway.ts` | Gateway RPC methods (`sanna.status`, `sanna.audit`, `sanna.verify`) |
| `src/cli.ts` | CLI commands (`doctor`, `status`, `audit`, `verify`) |
| `src/http.ts` | `hooks.internal.enabled` read from openclaw.json |
| `src/types.ts` | `SannaConfig`, `PluginAPI` type definitions |
| `constitutions/` | YAML constitution templates (`developer.yaml`, `personal.yaml`, `team.yaml`) |
