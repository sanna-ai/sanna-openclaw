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

This produces `sanna-1.0.1.tgz`.

**Important:** Use `npm pack` + `openclaw plugins install <tgz>`, not `openclaw plugins install .`. The tgz respects the `files` field in package.json, excluding tests and source files. Direct install copies everything.

## 2. Install the Plugin

```bash
openclaw plugins install sanna-1.0.1.tgz
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

## 6. Receipt Signing (Optional)

Generate an Ed25519 key pair for receipt signing and verification:

```bash
openssl genpkey -algorithm Ed25519 -out private.pem
openssl pkey -in private.pem -pubout -out public.pem
```

Configure the paths:

```bash
openclaw config set plugins.entries.sanna.config.privateKeyPath /path/to/private.pem
openclaw config set plugins.entries.sanna.config.publicKeyPath /path/to/public.pem
```

With both keys configured, receipts are Ed25519-signed and `openclaw sanna verify` can validate signatures.

## 7. OpenTelemetry Export (Optional)

To export governance receipts as OTel spans:

1. Install the peer dependency: `npm install @opentelemetry/api`
2. Enable in config:

```bash
openclaw config set plugins.entries.sanna.config.otelExport true
openclaw config set plugins.entries.sanna.config.otelServiceName my-agent
```

The exporter is fire-and-forget — failures do not block enforcement.

## 8. LLM Semantic Checks (Optional)

Enable AI-powered invariant evaluation for richer policy checks:

```bash
openclaw config set plugins.entries.sanna.config.llmChecks true
openclaw config set plugins.entries.sanna.config.llmChecksModel claude-sonnet-4-5-20250929
```

LLM checks are additive — they enhance rule-based evaluation but do not replace it. Initialization failures are non-fatal and the plugin continues to load.

## 9. Custom Evaluators (Optional)

Point to a JS module that registers custom invariant evaluators at load time:

```bash
openclaw config set plugins.entries.sanna.config.customEvaluatorsPath /path/to/evaluators.js
```

The module is `require()`'d at plugin startup. Use `registerInvariantEvaluator()` from `@sanna-ai/core` in the module to register evaluators.

## 10. Restart and Verify

```bash
openclaw gateway restart
openclaw sanna doctor
```

You should see:

```
PASS  hooks.internal.enabled = true
PASS  constitution: developer-agent (constitutions/developer.yaml)
INFO  version: 1.0.1
PASS  receipt store writable
PASS  public key loaded

Governance is ready.
```

## Full Configuration Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `constitutionPath` | string | `""` (auto-discover) | Path to YAML constitution file or directory |
| `privateKeyPath` | string | `""` | Path to Ed25519 private key PEM for receipt signing |
| `publicKeyPath` | string | `""` | Path to Ed25519 public key PEM for receipt verification |
| `receiptStorePath` | string | `~/.sanna/receipts/openclaw.db` | Path to SQLite receipt store |
| `governedTools` | string[] | All tier 1+2+3 | Tool names to govern |
| `enforcementMode` | string | `"enforce"` | `enforce`, `audit`, or `passthrough` |
| `otelExport` | boolean | `false` | Enable OpenTelemetry span export for governance receipts |
| `otelServiceName` | string | `"sanna-openclaw"` | OpenTelemetry service name for exported spans |
| `llmChecks` | boolean | `false` | Enable LLM semantic checks for invariant evaluation |
| `llmChecksModel` | string | `""` | Model to use for LLM semantic checks |
| `customEvaluatorsPath` | string | `""` | Path to JS module that registers custom invariant evaluators |

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

### Public key not found

If `openclaw sanna doctor` shows `FAIL  public key not found`:

1. Verify the file exists at the configured `publicKeyPath`
2. Ensure it's a valid Ed25519 public key in PEM format
3. Receipt verification will still work without a public key, but signature checks will be skipped
