# Setup Guide

Step-by-step installation and configuration for sanna-openclaw.

## Prerequisites

| Dependency | Version | Check |
|---|---|---|
| Node.js | 22+ | `node --version` |
| Python | 3.10+ | `python3 --version` |
| OpenClaw Gateway | Latest | `openclaw --version` |
| pip | Any | `python3 -m pip --version` |

## 1. Install the Plugin

```bash
npm install @sanna/openclaw
```

## 2. Run Setup

The setup command creates a Python virtual environment, installs the sanna library, generates Ed25519 signing keys, and copies a constitution template.

```bash
openclaw sanna setup
```

This will:
- Create `.sanna/venv/` with the sidecar's Python dependencies
- Install `sanna>=0.13.4`, `fastapi`, and `uvicorn`
- Generate an Ed25519 keypair in `.sanna/keys/`
- Copy `openclaw-developer.yaml` to `constitutions/active.yaml`
- Write default config to `openclaw.plugin.json`

### Manual Setup

If the setup command is not yet available, do it by hand:

```bash
# Create and activate a virtual environment
python3 -m venv .sanna/venv
source .sanna/venv/bin/activate

# Install sidecar dependencies
pip install sanna>=0.13.4 fastapi>=0.115.0 uvicorn>=0.30.0

# Generate Ed25519 signing keys
python3 -c "
from sanna.crypto import generate_keypair
generate_keypair('.sanna/keys/signing.key', '.sanna/keys/signing.pub')
print('Keys written to .sanna/keys/')
"

# Copy a constitution template
cp constitutions/openclaw-developer.yaml constitutions/active.yaml
```

## 3. Configure the Plugin

Add the plugin to your OpenClaw Gateway configuration. Create or edit `openclaw.plugin.json`:

```json
{
  "plugin": "@sanna/openclaw",
  "config": {
    "constitutionPath": "./constitutions/active.yaml",
    "signingKeyPath": ".sanna/keys/signing.key",
    "publicKeyPath": ".sanna/keys/signing.pub",
    "receiptStorePath": ".sanna/receipts",
    "sidecarHost": "127.0.0.1",
    "sidecarPort": 18791,
    "pythonPath": ".sanna/venv/bin/python3",
    "governedTools": [
      "exec", "write", "edit", "apply_patch",
      "browser_navigate", "browser_click", "browser_type",
      "message", "cron"
    ]
  }
}
```

### Configuration Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `constitutionPath` | string | `"./constitutions"` | Path to the YAML constitution file or directory |
| `signingKeyPath` | string | `""` | Path to Ed25519 private key for receipt signing |
| `publicKeyPath` | string | `""` | Path to Ed25519 public key for receipt verification |
| `receiptStorePath` | string | `""` | Directory for persisted receipt files |
| `sidecarHost` | string | `"127.0.0.1"` | Sidecar bind address (always localhost) |
| `sidecarPort` | number | `18791` | Sidecar HTTP port |
| `pythonPath` | string | `"python3"` | Path to Python interpreter (use venv path) |
| `governedTools` | string[] | All 9 tools | Which core tools to govern (subset of: exec, write, edit, apply_patch, browser_navigate, browser_click, browser_type, message, cron) |

## 4. Restart and Verify

```bash
# Restart the Gateway to load the plugin
openclaw restart

# In chat, check the dashboard
/sanna
```

You should see the governance dashboard with your constitution name, boundary counts, and enforcement stats.

## 5. Choose a Constitution Template

Three templates are included. Copy one to `constitutions/active.yaml`:

```bash
# Conservative — most actions require approval
cp constitutions/openclaw-personal.yaml constitutions/active.yaml

# Developer — broad workspace access
cp constitutions/openclaw-developer.yaml constitutions/active.yaml

# Team — shared agent with escalation workflows
cp constitutions/openclaw-team.yaml constitutions/active.yaml
```

Then restart the Gateway to reload.

## Troubleshooting

### Python not found

The sidecar needs Python 3.10+. If you see `python3: command not found`:

```bash
# macOS
brew install python@3.12

# Ubuntu/Debian
sudo apt install python3.12 python3.12-venv

# Then point the config to the correct path
# "pythonPath": "/usr/bin/python3.12"
```

If using a virtual environment, make sure `pythonPath` in your config points to the venv's Python:

```json
"pythonPath": ".sanna/venv/bin/python3"
```

### Sidecar won't start

Check if the port is already in use:

```bash
lsof -i :18791
```

If another process is using port 18791, either stop it or change `sidecarPort` in your config.

Check if the sidecar can start manually:

```bash
.sanna/venv/bin/python3 -m sidecar
```

This should start the FastAPI server. Look for error messages about missing dependencies or import failures.

### Constitution parse errors

Validate your constitution file directly:

```bash
python3 -c "
from sanna.constitution import load_constitution
c = load_constitution('constitutions/active.yaml')
print(f'Loaded: {c.identity.agent_name}')
print(f'Boundaries: {len(c.boundaries)}')
ab = c.authority_boundaries
if ab:
    print(f'can_execute: {len(ab.can_execute)}')
    print(f'must_escalate: {len(ab.must_escalate)}')
    print(f'cannot_execute: {len(ab.cannot_execute)}')
"
```

Common errors:
- **Missing `identity` or `provenance`**: Both are required top-level keys
- **Invalid boundary ID**: Must match `B###` format (e.g., `B001`, `B042`)
- **Invalid halt condition ID**: Must match `H###` format (e.g., `H001`)
- **Invalid category**: Must be one of `scope`, `authorization`, `confidentiality`, `safety`, `compliance`, `custom`
- **Invalid severity**: Must be one of `critical`, `high`, `medium`, `low`, `info`
- **Invalid enforcement**: Must be one of `halt`, `warn`, `log`

### Agent still using core tools

If the agent calls `exec` directly instead of `sanna_exec`, check:

1. The SKILL.md is loaded — verify `skills/sanna-governance/SKILL.md` exists
2. The governed tools list includes `exec` — check your config's `governedTools`
3. The `before_tool_call` hook is registered — run `/sanna` to confirm the plugin loaded

The `before_tool_call` hook acts as a safety net: even if the agent bypasses wrappers, direct calls to governed tools are blocked.

### Sidecar crashes repeatedly

The sidecar manager restarts crashed processes automatically with exponential backoff (1s to 30s, max 5 restarts). If you see repeated crash messages:

1. Check the sidecar logs for Python errors
2. Verify the sanna library version: `pip show sanna` (needs >= 0.13.4)
3. Try running the sidecar manually to see the full traceback

### All tool calls are halted

The plugin is fail-closed: if the sidecar is unreachable, all governed tool calls return a `halt` verdict. Check:

1. Is the sidecar running? Look for `[sanna] Sidecar started` in Gateway logs
2. Can you reach it? `curl http://127.0.0.1:18791/health`
3. Is the constitution loaded? `curl http://127.0.0.1:18791/status`
