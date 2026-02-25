# Setup Guide

Step-by-step installation and configuration for sanna.

## Prerequisites

| Dependency | Version | Check |
|---|---|---|
| Node.js | 22+ | `node --version` |
| OpenClaw | >= 2026.1.26 | `openclaw --version` |

## 1. Build and Pack

```bash
cd sanna-openclaw
npm install
npm run build
npm pack
```

This produces `sanna-0.1.0.tgz`.

**Important:** Use `npm pack` + `openclaw plugins install <tgz>`, not `openclaw plugins install .`. The tgz respects the `files` field in package.json, excluding tests and source files. Direct install copies everything.

## 2. Install the Plugin

```bash
openclaw plugins install sanna-0.1.0.tgz
```

## 3. Enable Hooks

This is the critical step. Add `hooks.internal.enabled: true` to `~/.openclaw/openclaw.json`:

```json
{
  "hooks": {
    "internal": {
      "enabled": true
    }
  }
}
```

Without this, the `before_tool_call` hook never fires and governance is silently bypassed. In enforce mode, the plugin throws on startup if this is not set.

## 4. Constitution Setup

The plugin auto-discovers constitutions from the `constitutions/` directory inside the plugin install. Discovery priority:

1. `default.yaml` / `default.yml`
2. `constitution.yaml` / `constitution.yml`
3. `developer.yaml` / `developer.yml`
4. First `.yaml` / `.yml` file alphabetically

To use a custom constitution, set `constitutionPath` in the plugin config:

```bash
openclaw config set plugins.entries.sanna.config.constitutionPath /path/to/my-constitution.yaml
```

Or copy one of the included templates:

```bash
# Developer — broad workspace access (default)
# Personal — lenient, messaging escalated
# Team — strict, broad escalation requirements
```

## 5. Configure Enforcement Mode (Optional)

| Mode | Behavior |
|---|---|
| `enforce` (default) | Constitution is enforced. Denied actions are blocked. Fail-closed on errors. |
| `audit` | Constitution is checked but not enforced. All actions proceed. Denials are logged. |
| `passthrough` | No enforcement. |

```bash
openclaw config set plugins.entries.sanna.config.enforcementMode enforce
```

## 6. Restart and Verify

```bash
openclaw gateway restart
openclaw sanna doctor
```

You should see:

```
PASS  hooks.internal.enabled = true
PASS  constitution: developer-agent (constitutions/developer.yaml)
INFO  version: 0.1.0
PASS  receipt store writable

Governance is ready.
```

## Configuration Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `constitutionPath` | string | `""` (auto-discover) | Path to YAML constitution file or directory |
| `privateKeyPath` | string | `""` | Path to Ed25519 private key PEM for receipt signing |
| `receiptStorePath` | string | `~/.sanna/receipts/openclaw.db` | Path to SQLite receipt store |
| `governedTools` | string[] | All tier 1+2+3 | Tool names to govern |
| `enforcementMode` | string | `"enforce"` | `enforce`, `audit`, or `passthrough` |

## Troubleshooting

### Hooks not enabled

If `openclaw sanna doctor` shows `FAIL  hooks.internal.enabled is not set`:

1. Open `~/.openclaw/openclaw.json`
2. Add `"hooks": { "internal": { "enabled": true } }`
3. Run `openclaw gateway restart`

In enforce mode, the plugin refuses to load without this setting.

### Constitution not found

If the plugin fails with "No constitution found":

1. Check that `constitutions/` exists in the plugin install directory (`~/.openclaw/extensions/sanna/constitutions/`)
2. Or set an explicit path: `openclaw config set plugins.entries.sanna.config.constitutionPath /path/to/constitution.yaml`
3. Validate with `openclaw sanna doctor`

### Receipt store not writable

The default receipt store is `~/.sanna/receipts/openclaw.db`. Ensure the directory exists and is writable:

```bash
mkdir -p ~/.sanna/receipts
openclaw sanna doctor
```

### Constitution parse errors

If the constitution fails to load, use `openclaw sanna doctor` to see the error message. Check your YAML against the [Constitution Guide](CONSTITUTION_GUIDE.md).
