---
name: sanna
description: "Sanna governance — use sanna_* tools instead of direct tools"
---

# Sanna Governance

This system has Sanna governance enabled. Tool calls are enforced against a
constitution that defines what actions are allowed, denied, or require escalation.

## Important: Use sanna_* tools

Instead of calling tools directly, use the governed versions:

| Instead of | Use |
|-----------|-----|
| exec | sanna_exec |
| bash | sanna_bash |
| write | sanna_write |
| edit | sanna_edit |
| apply_patch | sanna_apply_patch |
| process | sanna_process |
| browser | sanna_browser |
| message | sanna_message |
| nodes | sanna_nodes |
| web_search | sanna_web_search |
| web_fetch | sanna_web_fetch |
| cron | sanna_cron |
| gateway | sanna_gateway |
| sessions_send | sanna_sessions_send |
| sessions_spawn | sanna_sessions_spawn |

The sanna_* tools accept the SAME parameters as the originals. Just use
the sanna_ prefix. The tool will check the constitution and either:
- Execute the action (allowed)
- Deny the action with an explanation
- Request escalation (ask the user)

## Composite tools

For tools like browser and message that use an "action" parameter,
pass the action as normal:

Example: sanna_browser with action "navigate"
Example: sanna_message with action "send"
Example: sanna_cron with action "create"

## Receipts

Every governed action generates a cryptographic receipt that proves governance
was applied. Receipts are attached to tool results automatically.
