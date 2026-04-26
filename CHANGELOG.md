# Changelog

## v1.1.0

### Removed

- **`governedTools` config option (and `GOVERNED_TOOLS_DEFAULT` /
  tier constants).** The hook layer evaluated authority on every tool
  call regardless of this field, so the option was a no-op promising
  configurability the implementation never delivered. Documentation
  and config schema implied per-tool governance opt-in; the code
  governed everything by default. Per Sanna's governance-first
  posture, the safer default (everything-governed) is preserved by
  removing the misleading knob rather than introducing per-tool
  opt-out behavior. (SAN-231)

### Migration

- Existing configs with `governedTools` set: the field is now silently
  ignored. JSON Schema validation no longer recognises the property,
  so customers using strict validators may see a warning. Behavior
  is unchanged — every tool was already governed.

## v1.0.1

### Fixed

- `evaluation_coverage` uses schema-valid keys: `total_invariants`, `evaluated`, `not_checked`, `coverage_basis_points` (was `checks_run`, `checks_passed`, `checks_failed`, `coverage_pct`)
- `enforcement.action` uses schema-valid values: `allowed`, `halted`, `escalated`, `warned` (was raw decision strings)
- `enforcement.enforcement_mode` uses schema-valid values: `halt`, `warn`, `log` (was `enforce`, `audit`, `passthrough`)
- `CheckResult.status` uses schema-valid values: `null` for passing, `"FAILED"` for failing (was `"PASS"`, `"FAIL"`)
- `parent_receipts` defaults to `null` when no parent receipt exists (was `[]`) — different fingerprints
- 13 new schema compliance tests (191 total)

## v1.0.0

### Breaking Changes

- `@sanna-ai/core` upgraded from `^0.1.2` to `^1.0.0`
- Receipt persistence uses `ReceiptSink` interface (async `store()`) instead of direct `ReceiptStore.save()`
- Gateway and CLI dependency interfaces updated (`store` field type changed)

### Added

- **ReceiptSink abstraction** — receipt persistence delegated to `@sanna-ai/core`'s `ReceiptSink` interface (`LocalSQLiteSink`, `NullSink`, `CompositeSink`)
- **Receipt chaining** — each receipt includes `parent_receipts` linking to the prior receipt's fingerprint, enabling full audit chains
- **Workflow tracking** — per-session `workflow_id` (UUID) attached to every receipt for session-level grouping
- **Content mode** — `contentMode` config option (`full`, `redacted`, `hashes_only`) passed as top-level receipt field with `content_mode_source: "local_config"`
- **Sink configuration** — `sinkType` config option (`local_sqlite`, `null`, `composite`) for selecting the persistence backend
- **Protocol v1.1 support** — 14-field fingerprint (adds `parent_receipts_hash` and `workflow_id_hash`), `SPEC_VERSION: "1.1"`, `CHECKS_VERSION: "6"`
- 31 new tests covering sink integration, receipt chaining, content mode, and version constants (178 total)

### Changed

- `parent_receipts`, `workflow_id`, `content_mode`, `content_mode_source` are top-level `ReceiptParams` fields (not in `extensions`)
- Gateway and CLI query receipts via `ReceiptStore` obtained from `LocalSQLiteSink.getStore()`

## v0.2.0

### Added

- Constitution preambles — human-readable governance context injected into agent responses
- 14 invariants covering external comms, credential harvesting, persistence, exfiltration, destructive ops
- 9 sensitive-path escalation conditions (SSH keys, signing keys, credentials, config files)
- Browser and web_fetch added to regex evaluator scope with generalized parameter extraction
- Postinstall script for automatic constitution deployment
- OpenTelemetry span export for governance receipts
- LLM semantic checks (opt-in)
- Custom evaluator loading
- Receipt verification with Ed25519 signature support
- Color-coded audit output with --json fallback

### Fixed

- Browser tool regex evaluation not firing (applies_to defaulted to exec/bash only)
- printenv credential hunting bypass (added to harvesting invariant)
- Constitution files not updating on reinstall (postinstall copies to extension root)
- Regex evaluator parameter extraction generalized (command, targetUrl, url, path, query, JSON fallback)
- Invariant verdict override — failed halt invariants now override allow verdicts
- Shell rc persistence gap (.zshrc, .bashrc, .profile added to persistence invariant)
- rm flag splitting bypass (rm -r -f, rm --recursive caught by destructive ops invariant)
- Protocol-relative URL bypass (//domain patterns caught)

### Security

- Discovered and closed via live red-team testing against Claude Haiku 4.5 and Claude Sonnet 4.6
- Full writeup at [sanna.dev/blog](https://sanna.dev/blog)

## 1.0.2 (2026-04-05)

- fix: add escalated count to sanna.status RPC (SAN-163)
- fix: remove composite from sinkType type and plugin.json enum (SAN-163, SAN-176)
- chore: remove unused @sinclair/typebox dependency (SAN-167)
- docs: update SETUP.md version references (SAN-167)
- docs: fix hashes_only in CLAUDE.md (SAN-164)
