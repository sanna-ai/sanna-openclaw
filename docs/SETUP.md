# Setup Guide

Step-by-step installation and configuration for sanna-openclaw.

## Prerequisites

| Dependency | Version | Check |
|---|---|---|
| Node.js | 22+ | `node --version` |
| Python | 3.10+ | `python3 --version` |
| OpenClaw | Latest | `openclaw --version` |

## 1. Install the Plugin

```bash
openclaw plugins install @sanna/openclaw
```

## 2. Configure Constitution Path

```bash
openclaw config set plugins.entries.sanna.config.constitutionPath ~/.openclaw/sanna/constitution.yaml
```

Copy one of the included templates:

```bash
# Conservative — most actions require approval
cp constitutions/openclaw-personal.yaml ~/.openclaw/sanna/constitution.yaml

# Developer — broad workspace access
cp constitutions/openclaw-developer.yaml ~/.openclaw/sanna/constitution.yaml

# Team — shared agent with escalation workflows
cp constitutions/openclaw-team.yaml ~/.openclaw/sanna/constitution.yaml
```

## 3. Configure tools.allow

This is the critical step. You must configure `tools.allow` in your OpenClaw
agent config so the LLM sees ONLY `sanna_*` wrapper tools for governed tools,
plus ungoverned tools directly.

In your `openclaw.json` (or agent configuration):

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

This shows:
- `sanna_*` wrappers for all governed tools (tier 1 + 2 + 3)
- Ungoverned tools directly (read, image, canvas, memory, sessions read-only, agents_list)

The LLM cannot call governed originals because they're not in the allow list.
But `/tools/invoke` can still call them because `gateway.tools.deny` is separate
from `tools.allow`.

**Do NOT add governed tools to `gateway.tools.deny`.** The sanna_* wrappers
need to forward via `POST /tools/invoke`, which requires the original tools
to be callable at the HTTP layer.

## 4. Configure Enforcement Mode (Optional)

Three modes are available:

| Mode | Behavior |
|---|---|
| `enforce` (default) | Constitution is enforced. Denied actions are blocked. |
| `audit` | Constitution is checked but not enforced. All actions proceed. Denials are logged. |
| `passthrough` | No enforcement. Wrappers forward directly. |

```bash
openclaw config set plugins.entries.sanna.config.enforcementMode enforce
```

## 5. Configure Gateway Token (Optional)

If your Gateway requires authentication for `/tools/invoke`:

```bash
openclaw config set plugins.entries.sanna.config.gatewayToken YOUR_TOKEN
```

## 6. Restart and Verify

```bash
# Restart the gateway
openclaw gateway restart

# Check status
openclaw sanna status
```

You should see:

```
Sidecar: healthy
Mode: enforce
Constitution: ~/.openclaw/sanna/constitution.yaml
Governed tools: exec, bash, write, edit, apply_patch, process, browser, message, nodes, ...
```

## Configuration Reference

All fields in `openclaw.plugin.json` configSchema:

| Field | Type | Default | Description |
|---|---|---|---|
| `constitutionPath` | string | `""` | Path to YAML constitution file |
| `gatewayPort` | number | `18789` | Gateway HTTP port for /tools/invoke |
| `gatewayToken` | string | `""` | Bearer token for Gateway auth |
| `sidecarPort` | number | `18890` | Python sidecar HTTP port |
| `governedTools` | string[] | All tier 1+2+3 | Tool names to wrap with governance |
| `enforcementMode` | string | `"enforce"` | `enforce`, `audit`, or `passthrough` |

## Troubleshooting

### Sidecar unreachable

The plugin is fail-closed: if the sidecar is unreachable, all governed tool calls
are denied. Check:

1. Is the sidecar running? Look for `[sanna] Sidecar started` in Gateway logs
2. Can you reach it? `curl http://127.0.0.1:18890/health`
3. Is Python available? The sidecar needs `python3` on PATH

### Agent calling original tools directly

If the agent calls `exec` instead of `sanna_exec`:

1. Check `tools.allow` — governed originals should NOT be in the allow list
2. Check that the SKILL.md is loaded by the agent
3. The `before_tool_call` hook is a safety net but `tools.allow` is the primary control

### Constitution parse errors

Validate your constitution:

```bash
python3 -c "
from sanna.constitution import load_constitution
c = load_constitution('path/to/constitution.yaml')
print(f'Loaded: {c.identity.agent_name}')
print(f'Boundaries: {len(c.boundaries)}')
"
```

### Port conflicts

Default ports: sidecar on 18890, gateway on 18789. If either conflicts:

```bash
openclaw config set plugins.entries.sanna.config.sidecarPort 19000
```
