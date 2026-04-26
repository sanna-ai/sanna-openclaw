# @sanna-ai/openclaw — AGENTS.md

AI agent context file (cross-tool standard: Claude Code, Cursor, Codex CLI,
Copilot CLI, Gemini CLI all read this). TypeScript plugin for the OpenClaw
Gateway — governance enforcement on AI agent tool execution via constitution
evaluation and cryptographic receipts.

## Critical rules

- Never skip hooks (`--no-verify`). On hook failure: diagnose root cause, fix, create a **new** commit — do not amend.
- Never use `git add -f`. If `.gitignore` blocks a file, stop and ask.
- Never force-push. Never push directly to main.
- Never embed notion.so URLs in any committed file (repos are public; reference tickets by ID only: SAN-NNN).
- One branch = one scope. Do not bundle unrelated work in a single branch or PR.
- Never blindly retry or suggest "refresh" — diagnose root cause.
- Trace the full call path (hook → core evaluation → receipt sink) before proposing a fix.

## Context — read these

- [docs/architecture.md](docs/architecture.md) — constitution enforcement model, hook architecture, Receipt Triad, tribal-knowledge gotchas
- [docs/state.md](docs/state.md) — auto-generated: version, source layout, test count, dependencies, latest CHANGELOG entry
- [package.json](package.json) — production dependencies and version (source of truth)

## Per-developer notes

For personal scratch (machine-specific paths, WIP rule overrides), use
`CLAUDE.local.md` (gitignored). The committed `AGENTS.md` is the canonical
shared file.
