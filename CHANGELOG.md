# Changelog

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
