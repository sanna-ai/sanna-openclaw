# CLAUDE.md — sanna-openclaw

## What This Is
OpenClaw plugin that enforces Sanna governance constitutions on AI agent tool execution. Prevents unauthorized actions, generates Ed25519-signed cryptographic receipts. TypeScript plugin + Python sidecar architecture.

## Architecture
- TypeScript plugin runs in-process with the OpenClaw Gateway
- Python sidecar wraps the sanna library (pip install sanna >=0.13.4) as localhost HTTP
- Plugin registers wrapper tools (sanna_exec, sanna_write, etc.) that replace core tools
- Gateway deny-list blocks core tools, forcing all execution through wrappers
- before_tool_call hook is a structural safety net independent of wrappers
- tool_result_persist hook generates post-execution audit receipts

## Source Layout
```
src/
  index.ts              # register(api) entry point
  sidecar.ts            # Python process lifecycle (start, health, restart, stop)
  client.ts             # HTTP client for sidecar communication
  types.ts              # Shared TypeScript types
  enforcement/
    gate.ts             # Wrapper tool registration + enforcement flow
    policy.ts           # Gateway deny-list generation
    intercept.ts        # before_tool_call safety net hook
    escalation.ts       # must_escalate approval workflow
  tools/
    check.ts            # sanna_check voluntary pre-check
    status.ts           # sanna_status
    receipt.ts          # sanna_receipt lookup
  hooks/
    audit.ts            # tool_result_persist post-exec receipts
  commands/
    dashboard.ts        # /sanna
    receipts.ts         # /sanna receipts
    verify.ts           # /sanna verify
    constitution.ts     # /sanna constitution
    export.ts           # /sanna export
    setup.ts            # openclaw sanna setup
sidecar/
  __main__.py           # uvicorn entrypoint
  server.py             # FastAPI app wrapping sanna library
  requirements.txt      # sanna>=0.13.4, fastapi, uvicorn
skills/sanna-governance/
  SKILL.md              # Agent behavioral rules
constitutions/          # Template constitutions
tests/                  # vitest (TS) + pytest (Python)
```

## Rules

Sidecar unreachable = HALT. Never fail open. If the enforcement engine is down, the agent cannot act.
Wrapper tools generate enforcement receipts BEFORE forwarding. Audit hook generates receipts AFTER execution. Governed tools get two receipts.
Constitution enforcement and cryptographic receipts are equal pillars. Never ship one without the other.
Ed25519 signatures use RFC 8785 JSON canonicalization (from sanna library). Do not reimplement.
All sidecar communication is localhost HTTP only. Never expose the sidecar to the network.
Run vitest after every TypeScript change. Run pytest after every sidecar change. Zero regressions.
Never name specific LLM models in code comments, docs, or changelogs.
package.json is the single source for version. openclaw.plugin.json version must match.

## Testing

TypeScript: npx vitest run from repo root
Python: cd sidecar && python -m pytest tests/ -v
Integration: Requires running OpenClaw instance

## OpenClaw Plugin API (reference)

api.registerTool({ name, description, schema, handler }) — register agent tool
api.on('before_tool_call', handler) — intercept before execution
api.on('tool_result_persist', handler) — intercept after execution
api.registerCommand({ name, handler }) — slash commands
api.registerCli({ name, handler }) — CLI commands
api.registerService({ name, start, stop }) — background service lifecycle
Tool names CANNOT shadow core tools (exec, write, edit, etc.)
Gateway tool policy can deny specific tool names
