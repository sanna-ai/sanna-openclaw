# sanna-openclaw

Governance plugin for OpenClaw. Enforces Sanna constitutions on agent tool execution
with cryptographic receipts.

## Architecture

LLM sees ONLY sanna_* wrapper tools (controlled via tools.allow in openclaw.json).
Original tools remain callable via POST /tools/invoke (not denied at HTTP layer).

Enforcement flow:
1. LLM calls sanna_exec (wrapper)
2. Wrapper POSTs to sidecar /enforce with tool name, args, action
3. Sidecar evaluates against constitution
4. If allowed: wrapper POSTs to gateway /tools/invoke with original tool + args
5. Result returned to LLM
6. tool_result_persist hook annotates result with receipt hash

Sidecar response mapping (enforce.ts → mapSidecarResponse):
- Sidecar returns `verdict` ("allow"/"halt"/"escalate"), TS uses `decision`
- "halt" maps to "deny"
- receipt_hash extracted from receipt.receipt_id

Safety net:
- before_tool_call hook catches any direct calls to governed originals
  (shouldn't happen if tools.allow is configured, but defense in depth)

## Source Layout

```
src/
  index.ts      — plugin entry point (register function)
  config.ts     — config types and defaults
  types.ts      — TypeScript interfaces
  tools.ts      — wrapper tool registration
  enforce.ts    — sidecar /enforce + gateway /tools/invoke forwarding
  hooks.ts      — before_tool_call safety net + tool_result_persist receipts
  sidecar.ts    — sidecar lifecycle (registerService)
  gateway.ts    — sanna.status + sanna.audit RPC methods
  cli.ts        — openclaw sanna status|audit|verify CLI commands
skills/sanna/
  SKILL.md      — agent-facing tool guidance (injected into system prompt)
sidecar/        — Python FastAPI sidecar (do not touch)
constitutions/  — YAML constitution templates
docs/
  SETUP.md      — installation and configuration guide
  CONSTITUTION_GUIDE.md
tests/          — vitest tests
```

## Confirmed OpenClaw APIs (from docs.openclaw.ai)

- api.registerTool({ name, description, parameters, execute }, { optional })
- api.registerService({ id, start, stop })
- api.registerHook(event, handler, { name, description })
- api.registerGatewayMethod(name, handler)
- api.registerCli(fn, { commands })
- POST /tools/invoke: { tool, args, sessionKey? } with Bearer auth
- tools.allow/deny: agent-level, controls LLM tool visibility
- gateway.tools.deny/allow: HTTP-level, separate from agent policy
- before_tool_call / after_tool_call: plugin hooks, intercept tool params/results
- tool_result_persist: synchronous transform hook

## Tool Inventory (OpenClaw built-in)

group:fs — read, write, edit, apply_patch
group:runtime — exec, bash, process
group:web — web_search, web_fetch
group:ui — browser (composite: 20+ actions), canvas (composite)
group:messaging — message (composite: 30+ actions)
group:sessions — sessions_list, sessions_history, sessions_send, sessions_spawn, session_status
group:memory — memory_search, memory_get
group:automation — cron (composite), gateway (composite)
group:nodes — nodes (composite)
Other — image, agents_list

Composite tools use an "action" parameter to select behavior.
Browser is ONE tool, not separate navigate/click/type tools.

## Setup (tools.allow pattern)

In openclaw.json, configure tools.allow to show ONLY sanna_* wrappers for governed tools:
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
  }
}
```
See docs/SETUP.md for full instructions.

## CLI Commands

- `openclaw sanna status` — show sidecar health, mode, constitution, governed tools
- `openclaw sanna audit` — show recent enforcement decisions (--limit N)
- `openclaw sanna verify <receipt-hash>` — verify a receipt via sidecar

## Gateway RPC Methods

- `sanna.status` — enforcement status overview (mode, sidecar health, constitution, stats)
- `sanna.audit` — recent enforcement decisions from sidecar

## Constitution Templates

Three starter templates in constitutions/:
- personal.yaml — lenient: broad execution, messaging requires escalation
- developer.yaml — balanced: full workspace, communication requires escalation
- team.yaml — strict: narrow execution, broad escalation requirements

All validated against the sanna library. See docs/CONSTITUTION_GUIDE.md.

## Test Commands

npx vitest run                    # 106 TypeScript tests (11 files)
cd sidecar && python -m pytest tests/ -v   # 24 Python sidecar tests

Total: 130 tests (106 TS + 24 Python)

Integration tests (tests/integration.test.ts) spawn a real Python sidecar
and exercise the full enforcement loop. They require sanna + uvicorn installed.

## DO NOT

- Touch sidecar/ (Python side is correct)
- Assume before_tool_call doesn't exist (it does — Agent Loop docs confirm it)
- Split composite tools into separate wrappers (browser is ONE tool)
- Use tools.deny to block originals (use tools.allow to show ONLY wrappers)
- Deny originals at gateway.tools.deny (forwarding needs them callable via HTTP)
