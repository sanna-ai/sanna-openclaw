# Security Audit: sanna-openclaw

**Date:** 2026-03-26
**Auditor:** Claude Opus 4.6 (automated deep audit)
**Scope:** Full source review of `sanna-openclaw` v1.0.1
**Mode:** Audit only — no fixes applied

---

## Executive Summary

The sanna-openclaw plugin is a governance enforcement layer for OpenClaw agent tool execution. The codebase is compact (~900 LOC across 6 source files) and generally well-structured. However, this audit identified **5 HIGH**, **6 MEDIUM**, and **5 LOW** severity findings across the audit scope.

The most critical findings involve: (1) a race condition in the pending receipt state machine that can desynchronize receipt attribution under concurrent tool calls, (2) the `governedTools` configuration field being completely unused in the enforcement hook (misleading operators into thinking tools are ungoverned when they are still evaluated), (3) arbitrary code execution via the `customEvaluatorsPath` config with no sandboxing, and (4) regex denial-of-service in user-controlled invariant patterns.

---

## Findings

### HOOKS (src/hooks.ts)

#### [H-01] HIGH: Pending Receipt Race Condition (Single-Slot State Machine)

**Location:** `src/hooks.ts:98`, `src/hooks.ts:471-483`, `src/hooks.ts:506-513`

The `pendingReceipt` variable is a single mutable slot shared across all tool calls in a session. If the OpenClaw runtime fires `before_tool_call` for tool B before `after_tool_call` completes for tool A, the pending state for tool A is silently overwritten:

```typescript
let pendingReceipt: PendingReceipt | null = null;  // line 98 — single slot

// before_tool_call (line 471): unconditionally overwrites
pendingReceipt = { correlationId, toolName, params, ... };

// after_tool_call (line 512): reads whatever is current
const pending = pendingReceipt;
pendingReceipt = null;
```

**Impact:** In concurrent/interleaved tool execution, receipt A's `after_tool_call` may generate a receipt attributed to tool B's parameters, or tool A's receipt may never be generated. This breaks the Receipt Triad integrity guarantee and could allow an unaudited tool execution.

**Note:** Whether this is exploitable depends on OpenClaw's concurrency model (sequential vs. parallel tool dispatch). If strictly sequential, this is a design fragility rather than an active vulnerability.

---

#### [H-02] HIGH: `governedTools` Config Field Is Never Enforced

**Location:** `src/hooks.ts` (entire file — no reference to `governedTools`), `src/config.ts:49`, `src/types.ts:14`

The `governedTools` configuration field is defined in the type system, has a default value (Tier 1+2+3), is displayed in `sanna status` and `sanna.status` RPC, but is **never checked in the `before_tool_call` hook**. Every tool call that enters the hook is evaluated against the constitution regardless of whether it appears in `governedTools`.

**Impact:** Operators who set `governedTools: ["exec", "bash"]` believing other tools are ungoverned are wrong — all tools still pass through enforcement. Conversely, if the intent is to skip evaluation for ungoverned tools (performance optimization), that skip never happens. This is a correctness/trust issue: the config advertises a capability that doesn't exist.

---

#### [H-03] HIGH: Regex Denial of Service (ReDoS) via Constitution Invariants

**Location:** `src/hooks.ts:204-210`

User-authored constitution invariant rules containing `regex_deny pattern:` are compiled into `new RegExp()` and executed against tool parameters on every governed tool call:

```typescript
const regex = new RegExp(parts[1], parts[2]);  // line 210
const hit = regex.exec(testStr);               // line 223
```

There is no timeout, no regex complexity validation, and no safeguard against catastrophic backtracking. A malicious or poorly-written constitution invariant (e.g., `/(a+)+$/`) can hang the enforcement hook indefinitely, blocking all tool execution.

**Impact:** Denial of service. In enforce mode, this blocks all agent operations. The regex is compiled from the constitution YAML which is a local file, so exploitation requires write access to the constitution. However, since constitutions are the primary trust boundary and may be shared/templated, this is a meaningful attack surface.

---

#### [M-01] MEDIUM: Invariant Evaluation Silently Swallowed on Error

**Location:** `src/hooks.ts:243-248`

If `loadInvariantChecks()` or `runAllInvariantChecks()` throws, the error is logged as a warning but enforcement **continues with only the AUTHORITY check**:

```typescript
} catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    api.logger.warn(`[sanna] Invariant check error for ${toolName}: ${msg}`);
}
```

**Impact:** In enforce mode, a constitution with a malformed invariant section silently degrades to authority-only evaluation. The 14 regex_deny invariants (external comms bypass, data exfil, credential harvesting, etc.) would all be skipped. This violates the fail-closed design principle stated in CLAUDE.md.

---

#### [M-02] MEDIUM: `_justification` Parameter Stripping Incomplete

**Location:** `src/hooks.ts:339-340`

The code strips `_justification` from the input hash computation but does NOT strip it from the `params` object passed to `evaluateAuthority()` (line 140) or persisted in the receipt `inputs` field (line 363):

```typescript
const argsClean = { ...params };
delete argsClean._justification;
const inputObj = { args: argsClean, tool: toolName };
```

**Impact:** The `_justification` field content is persisted in plaintext in receipts and passed to the authority evaluator. If an agent uses `_justification` to embed content that influences authority evaluation (e.g., including keywords that match `must_escalate` conditions), it could cause false escalations. Additionally, justification text in receipts may contain sensitive information that operators expect to be excluded.

---

#### [M-03] MEDIUM: Shell Injection Regex Incomplete

**Location:** `src/hooks.ts:296`

The built-in shell injection check uses:
```typescript
const SHELL_OPS = /[;|&`]|\$\(/;
```

This misses several shell metacharacters and injection vectors:
- `$(...)` is caught but `` `...` `` backtick substitution only catches single backtick, not the full pattern
- `\n` (newline) can terminate a command in many shells
- `>` and `>>` (output redirection) are not caught
- `<(...)` process substitution is not caught
- `${...}` variable expansion (only `$(` is matched, not `${`)
- Heredoc `<<` operators
- Glob expansion `*`, `?` are not relevant but `{a,b}` brace expansion may be

**Impact:** An agent could construct a command using uncaught operators (e.g., `echo foo > /etc/cron.d/backdoor` or `cat <<EOF > file`) that bypasses the built-in safety check. The constitution invariants provide defense-in-depth, but the built-in check creates a false sense of security.

---

#### [M-04] MEDIUM: `after_tool_call` Receipt Persistence Failure Is Non-Fatal

**Location:** `src/hooks.ts:583-588`

When receipt persistence fails in `after_tool_call`, it only logs an error:

```typescript
if (!sinkResult.success) {
    api.logger.error(`[sanna] after_tool_call: receipt persistence failed: ${sinkResult.error}`);
}
```

Compared to `before_tool_call` (line 403-428) which blocks on persistence failure in enforce mode, `after_tool_call` allows the tool execution to be unrecorded.

**Impact:** A tool that was allowed can execute without a receipt being persisted. The Receipt Triad is broken: there's an allowed execution with no audit trail. This is inconsistent with the fail-closed design and means an attacker who can cause SQLite write failures (disk full, lock contention) can create unaudited executions.

---

#### [L-01] LOW: `as any` Type Assertions in Security-Critical Receipt Generation

**Location:** `src/hooks.ts:397`, `src/hooks.ts:577`

Both `generateReceipt()` calls use `as any` to bypass TypeScript type checking:

```typescript
} as any) as unknown as Record<string, unknown>;
```

The TODO comments indicate this is intentional pending upstream type updates. However, `as any` suppresses all type checking on the receipt input object, meaning malformed fields (wrong types, missing required fields) would not be caught at compile time.

**Impact:** Low immediate risk since the fields are well-structured in context, but this creates a maintenance hazard where future changes to the receipt structure could introduce silent data integrity issues.

---

#### [L-02] LOW: Log Injection via Tool Name/Parameters

**Location:** `src/hooks.ts:124-125`, `src/hooks.ts:143-144`, `src/hooks.ts:487-488`

Tool names and parameters are interpolated directly into log messages:

```typescript
api.logger.warn("[sanna] before_tool_call: could not extract toolName from event. Args: " + JSON.stringify(args.slice(0, 2)));
api.logger.error(`[sanna] Authority evaluation error for ${toolName}: ${msg}`);
```

If `toolName` contains ANSI escape sequences or newlines, it could manipulate log output in terminal-based log viewers or confuse log aggregation.

**Impact:** Low — primarily a log integrity issue. Tool names are typically controlled by the OpenClaw runtime, not user input.

---

### GATEWAY (src/gateway.ts)

#### [L-03] LOW: No Input Validation on Gateway RPC Methods

**Location:** `src/gateway.ts:29-62`

Both `sanna.status` and `sanna.audit` accept no parameters and perform read-only queries. However, the `sanna.audit` method uses a hardcoded `limit: 20` with no caller-controlled pagination. There is no authentication or authorization check on RPC callers.

**Impact:** Low — these are read-only informational endpoints. The lack of pagination is a usability issue, not a security one. Authorization is presumably handled by the OpenClaw gateway layer.

---

### CLI (src/cli.ts)

#### [M-05] MEDIUM: `verify` Command Fetches All Receipts for Prefix Matching

**Location:** `src/cli.ts:107`

```typescript
const results = store.query({ limit: 1000 });
```

The `verify` command loads up to 1000 receipts into memory to perform prefix matching on receipt IDs. This is inefficient and could cause memory pressure with large receipt stores.

**Impact:** Denial of service against the CLI tool. Not exploitable remotely, but a large receipt store could make `openclaw sanna verify` unusably slow or crash with OOM.

---

#### [L-04] LOW: `parseInt` Without NaN Guard on `--limit`

**Location:** `src/cli.ts:75`

```typescript
const limit = parseInt(opts.limit ?? "20", 10);
```

If `opts.limit` is a non-numeric string (e.g., `--limit abc`), `parseInt` returns `NaN`, which is passed to `store.query()`. The behavior depends on the ReceiptStore implementation — it may return all records, zero records, or throw.

**Impact:** Minor — CLI misuse scenario only. No security impact beyond unexpected behavior.

---

### HTTP (src/http.ts)

No SSRF or header injection vectors found. The module only reads a local JSON file (`~/.openclaw/openclaw.json`) via `readFileSync`. No HTTP requests are made.

**Note:** The module-level cache (`_cachedOpenclawConfig`) means changes to `openclaw.json` after plugin load are not reflected. This is a correctness issue, not a security one, but could confuse operators who toggle hooks mid-session.

---

### CONFIG (src/config.ts)

#### [L-05] LOW: No Validation on Config Field Values

**Location:** `src/config.ts:65-90`

`resolveConfig()` merges user config with defaults using `??` without any validation:

```typescript
enforcementMode: raw.enforcementMode ?? DEFAULT_CONFIG.enforcementMode,
```

If `raw.enforcementMode` is set to an invalid value (e.g., `"enforc"` — a typo), it is accepted without error. The enforcement mode check in hooks (`config.enforcementMode === "enforce"`) would silently fall through to non-enforce behavior.

**Impact:** A typo in `enforcementMode` silently disables enforcement. The default is `"enforce"`, so this only affects explicit (mis)configuration.

---

### CONSTITUTION LOADING (src/index.ts)

#### [H-04] HIGH: No Path Traversal or Symlink Protection on Constitution Path

**Location:** `src/index.ts:52-87`

`resolveConstitutionPath()` accepts an arbitrary `configPath` string and passes it directly to `existsSync()` and then to `loadConstitution()`:

```typescript
if (configPath) {
    if (existsSync(configPath)) return configPath;
    return null;
}
```

There is no:
- Canonicalization or `realpath()` resolution
- Symlink detection (`lstatSync`)
- Directory traversal prevention (no check for `..` segments)
- Allowlist of permitted directories

Similarly, the auto-discovery path resolves files from `constitutions/` without symlink checks.

**Impact:** An attacker who can modify the plugin config (`openclaw.plugin.json`) can point `constitutionPath` to any readable file on the filesystem (e.g., `/etc/passwd`, a symlinked malicious YAML). While `loadConstitution()` would likely fail on non-YAML files, a crafted YAML file placed anywhere on disk could define a permissive constitution that allows all actions. Combined with the postinstall script that copies constitutions to the extension root, a supply-chain attack could place a malicious constitution in the auto-discovery path.

---

#### [H-05] HIGH: Arbitrary Code Execution via `customEvaluatorsPath`

**Location:** `src/index.ts:224-235`

```typescript
if (config.customEvaluatorsPath) {
    try {
        const absPath = resolve(config.customEvaluatorsPath);
        require(absPath);  // line 228 — arbitrary require()
```

The `customEvaluatorsPath` config value is resolved and `require()`-ed with no validation, sandboxing, or integrity checking. Any JavaScript file on the filesystem can be loaded and executed in the plugin's Node.js process.

**Impact:** Full arbitrary code execution in the plugin process context. An attacker who can modify the plugin config can execute arbitrary JavaScript with the permissions of the OpenClaw process. This bypasses all governance enforcement since the loaded code runs before hooks are registered. The `resolve()` call does prevent relative path confusion but does not prevent path traversal.

---

### POSTINSTALL SCRIPT (scripts/postinstall.mjs)

#### [M-06] MEDIUM: Postinstall Overwrites Constitutions Without Backup

**Location:** `scripts/postinstall.mjs:26`

```javascript
cpSync(src, dest, { recursive: true, force: true });
```

The postinstall script copies constitutions to the extension root with `force: true`, silently overwriting any existing user-customized constitutions. No backup is made.

**Impact:** User constitution customizations are silently destroyed on package update. If an attacker can publish a malicious version of the sanna package (supply chain), the postinstall script automatically replaces constitutions with attacker-controlled versions. The `force: true` flag means even read-only constitutions are overwritten.

---

### DEPENDENCIES

#### npm audit Results

```
@hono/node-server  <1.19.10  — HIGH — auth bypass via encoded slashes (transitive via openclaw)
brace-expansion    <5.0.5    — MODERATE — ReDoS via zero-step sequences (transitive via rimraf)
esbuild            <=0.24.2  — MODERATE — dev server request forgery (devDependency only)
```

**Direct dependency `@sanna-ai/core ^1.0.0`**: No known advisories. The caret range (`^1.0.0`) allows any `1.x.y` version, which is standard but means a compromised minor/patch release would be automatically installed.

**Impact:** The `@hono/node-server` vulnerability is in a transitive dependency of the `openclaw` peer — not directly exploitable through this plugin. The `esbuild` issue only affects development. No critical direct dependency vulnerabilities.

---

### SECRETS/CREDENTIALS

No hardcoded secrets, tokens, API keys, or credentials found in source files or test fixtures. Key material paths are loaded from config at runtime. `.gitignore` correctly excludes `.env` and `.env.local`.

The regex patterns in constitutions reference security-sensitive patterns (webhook.site, credential paths) but these are denial rules, not secrets.

---

### TYPE SAFETY

Four `as any` assertions found, all in `src/hooks.ts` (lines 397, 577) at `generateReceipt()` call sites. These are documented with TODO comments and exist because `@sanna-ai/core` types don't yet include triad fields. The double-cast pattern (`as any) as unknown as Record<string, unknown>`) completely erases type information.

Additional `as Record<string, unknown>` casts are used extensively throughout `hooks.ts`, `cli.ts`, and `gateway.ts` to handle untyped OpenClaw API responses. These are less dangerous but reduce TypeScript's ability to catch field access errors.

---

## Summary Table

| ID | Severity | Component | Finding |
|----|----------|-----------|---------|
| H-01 | HIGH | hooks.ts | Pending receipt race condition (single-slot state machine) |
| H-02 | HIGH | hooks.ts | `governedTools` config field never enforced in hook |
| H-03 | HIGH | hooks.ts | ReDoS via unvalidated constitution regex patterns |
| H-04 | HIGH | index.ts | No path traversal/symlink protection on constitution path |
| H-05 | HIGH | index.ts | Arbitrary code execution via `customEvaluatorsPath` require() |
| M-01 | MEDIUM | hooks.ts | Invariant evaluation errors silently swallowed (fail-open) |
| M-02 | MEDIUM | hooks.ts | `_justification` not stripped from authority eval or receipt body |
| M-03 | MEDIUM | hooks.ts | Shell injection regex incomplete (missing >, >>, <<, newline, ${}) |
| M-04 | MEDIUM | hooks.ts | `after_tool_call` receipt persistence failure is non-fatal |
| M-05 | MEDIUM | cli.ts | `verify` loads 1000 receipts into memory for prefix search |
| M-06 | MEDIUM | postinstall.mjs | Force-overwrites user constitutions without backup |
| L-01 | LOW | hooks.ts | `as any` type assertions bypass compile-time safety |
| L-02 | LOW | hooks.ts | Log injection via unescaped tool names |
| L-03 | LOW | gateway.ts | No input validation or pagination on RPC methods |
| L-04 | LOW | cli.ts | `parseInt` without NaN guard on --limit |
| L-05 | LOW | config.ts | No validation on config field values (typo = silent fail-open) |

---

## Recommendations (Priority Order)

1. **H-01**: Replace single `pendingReceipt` slot with a `Map<correlationId, PendingReceipt>` keyed by a unique identifier passed through before/after hook pairs.
2. **H-02**: Either enforce `governedTools` filtering in the hook (skip evaluation for unlisted tools) or remove the field entirely to avoid operator confusion.
3. **H-03**: Add regex complexity limits (e.g., max pattern length, execution timeout via `re2` or worker threads with `setTimeout`).
4. **H-04**: Canonicalize constitution paths with `realpathSync()` and validate they reside within an allowed directory.
5. **H-05**: Validate `customEvaluatorsPath` against an allowlist or require it to be within the plugin directory. Consider integrity checking (hash verification) before `require()`.
6. **M-01**: In enforce mode, treat invariant load/evaluation errors as blocking (consistent with fail-closed design).
7. **M-03**: Expand shell injection regex or use a proper shell command parser.
8. **M-04**: In enforce mode, block on `after_tool_call` receipt persistence failure (or at minimum, flag the execution as unaudited).
9. **M-06**: Check for existing constitutions before overwriting; create `.bak` copies.
10. **L-05**: Validate `enforcementMode` against the enum at config resolution time; throw on invalid values in enforce mode.
