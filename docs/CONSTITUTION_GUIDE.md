# Constitution Guide

How to write and customize Sanna constitutions for OpenClaw.

## Overview

A constitution is a YAML file that defines what an agent can and cannot do. `@sanna/core` evaluates every tool call against it via the `before_tool_call` hook. Verdicts are `allow`, `halt`, or `escalate`.

## YAML Schema

A minimal constitution:

```yaml
sanna_constitution: "1.0.0"

identity:
  agent_name: my-agent
  domain: my-domain
  description: What this agent does

provenance:
  authored_by: you@company.com
  approved_by:
    - reviewer@company.com
  approval_date: "2026-01-01"
  approval_method: manual-sign-off

boundaries:
  - id: B001
    description: Agent operates within project scope
    category: scope
    severity: medium
```

Three fields are required: `identity`, `provenance`, and `boundaries` (at least one).

### identity

Identifies the agent this constitution governs.

| Field | Required | Description |
|---|---|---|
| `agent_name` | Yes | Unique name for this agent |
| `domain` | Yes | Business domain (e.g., `software-development`, `customer-service`) |
| `description` | No | What the agent does |

### provenance

Records who wrote and approved the constitution.

| Field | Required | Description |
|---|---|---|
| `authored_by` | Yes | Email of the author |
| `approved_by` | Yes | List of approver emails (at least one) |
| `approval_date` | Yes | ISO date (`YYYY-MM-DD`) |
| `approval_method` | Yes | How it was approved (e.g., `manual-sign-off`, `security-review`) |

### boundaries

Structural boundaries that define the agent's operating envelope. Each boundary needs a unique ID in `B###` format.

| Field | Required | Values |
|---|---|---|
| `id` | Yes | `B001` through `B999` |
| `description` | Yes | What this boundary enforces |
| `category` | Yes | `scope`, `authorization`, `confidentiality`, `safety`, `compliance`, `custom` |
| `severity` | Yes | `critical`, `high`, `medium`, `low`, `info` |

## Authority Boundaries

This is the core section for tool governance. It defines three tiers of authority.

```yaml
authority_boundaries:
  can_execute:
    - "action-name"
  must_escalate:
    - condition: "When this happens"
      target:
        type: log
  cannot_execute:
    - "action-name"
```

### can_execute

A list of action name strings. Actions matching these entries are allowed without approval.

For OpenClaw tools, use the pattern `tool:qualifier`:

```yaml
can_execute:
  - "exec:git"          # Allow git commands
  - "exec:npm"          # Allow npm commands
  - "write:workspace"   # Allow writes in workspace
  - "edit:workspace"    # Allow edits in workspace
```

### cannot_execute

A list of action name strings. Actions matching these entries are permanently blocked.

```yaml
cannot_execute:
  - "exec:rm -rf"       # Block recursive delete
  - "exec:sudo"         # Block privilege escalation
  - "write:/etc"        # Block writes to system dirs
  - "exec:cat .env"     # Block credential reading
```

### must_escalate

A list of objects with a `condition` (natural-language description) and optional `target` for the escalation.

```yaml
must_escalate:
  - condition: "Installing new packages"
    target:
      type: log           # Log the escalation
  - condition: "Deploying to production"
    target:
      type: webhook        # Send to approval webhook
      url: "https://approvals.company.com/escalate"
```

Escalation target types:
- `log` — Log the escalation (default, no external dependency)
- `webhook` — POST to a URL for approval workflow integration
- `callback` — Call a registered handler function

## OpenClaw Tool Names

When writing authority boundaries, use the core tool names that OpenClaw provides:

| Tool | What It Does |
|---|---|
| `exec` | Shell command execution |
| `write` | File creation |
| `edit` | File modification |
| `apply_patch` | Patch application |
| `browser_navigate` | Browser navigation |
| `browser_click` | Browser click interactions |
| `browser_type` | Browser text input |
| `message` | External messaging |
| `cron` | Task scheduling |

## Trust Tiers

Optional section that provides human-readable descriptions of what the agent can do at each trust level. These are used for documentation and agent behavioral guidance.

```yaml
trust_tiers:
  autonomous:
    - "Read files and run safe commands"
    - "Run tests and linters"
  requires_approval:
    - "Install new dependencies"
    - "Push to remote repositories"
  prohibited:
    - "Delete files recursively"
    - "Access credentials"
```

## Halt Conditions

Define specific conditions that immediately halt the agent. Each needs a unique ID in `H###` format.

```yaml
halt_conditions:
  - id: H001
    trigger: Agent attempts to delete production data
    escalate_to: oncall@company.com
    severity: critical
    enforcement: halt
```

| Field | Required | Values |
|---|---|---|
| `id` | Yes | `H001` through `H999` |
| `trigger` | Yes | Natural-language description of the trigger |
| `escalate_to` | Yes | Email or contact for notification |
| `severity` | Yes | `critical`, `high`, `medium`, `low`, `info` |
| `enforcement` | Yes | `halt`, `warn`, `log` |

## Invariants

Rules about the agent's reasoning and output quality. Use standard IDs for built-in checks.

```yaml
invariants:
  - id: INV_NO_FABRICATION
    rule: Do not claim facts absent from provided sources.
    enforcement: halt

  - id: INV_MARK_INFERENCE
    rule: Clearly mark inferences and speculation.
    enforcement: warn

  - id: INV_NO_FALSE_CERTAINTY
    rule: Do not express certainty exceeding evidence strength.
    enforcement: warn

  - id: INV_PRESERVE_TENSION
    rule: Do not collapse conflicting evidence without justification.
    enforcement: warn

  - id: INV_NO_PREMATURE_COMPRESSION
    rule: Do not issue unconditional conclusions when evidence is mixed.
    enforcement: warn
```

Standard invariant IDs: `INV_NO_FABRICATION`, `INV_MARK_INFERENCE`, `INV_NO_FALSE_CERTAINTY`, `INV_PRESERVE_TENSION`, `INV_NO_PREMATURE_COMPRESSION`. You can also define custom invariants with any `INV_*` or `INV_CUSTOM_*` prefix.

## Common Patterns

### Allow git but deny force push

```yaml
authority_boundaries:
  can_execute:
    - "exec:git"
  cannot_execute:
    - "exec:git push --force"
    - "exec:git push -f"
    - "exec:git reset --hard"
```

### Allow writes in workspace only

```yaml
authority_boundaries:
  can_execute:
    - "write:workspace"
    - "edit:workspace"
    - "apply_patch:workspace"
  cannot_execute:
    - "write:/etc"
    - "write:/usr"
    - "write:/var"
    - "write:/sys"
  must_escalate:
    - condition: "Writing or editing files outside the current working directory"
      target:
        type: log
```

### Allow docs browsing but escalate auth pages

```yaml
authority_boundaries:
  can_execute:
    - "browser_navigate:docs"
  must_escalate:
    - condition: "Browser interactions on login or authentication pages"
      target:
        type: log
    - condition: "Browser interactions with external APIs"
      target:
        type: webhook
        url: "https://approvals.company.com/escalate"
```

### Block all external communication

```yaml
authority_boundaries:
  cannot_execute:
    - "message"
    - "exec:curl"
    - "exec:wget"
    - "exec:ssh"
  must_escalate:
    - condition: "Any browser interaction with external services"
      target:
        type: log
```

### Development tools with test runner access

```yaml
authority_boundaries:
  can_execute:
    - "exec:git"
    - "exec:npm"
    - "exec:npx"
    - "exec:python"
    - "exec:python3"
    - "exec:node"
    - "exec:make"
    - "exec:pytest"
    - "exec:vitest"
    - "exec:jest"
    - "exec:eslint"
    - "exec:prettier"
```

### Escalate deployments with webhook approval

```yaml
must_escalate:
  - condition: "Running deploy, publish, or release commands"
    target:
      type: webhook
      url: "https://approvals.company.com/escalate"
  - condition: "Creating git tags"
    target:
      type: webhook
      url: "https://approvals.company.com/escalate"
```

## Testing Your Constitution

### Validate the constitution

Use `openclaw sanna doctor` to verify the constitution loads correctly:

```bash
openclaw sanna doctor
```

This checks that the constitution parses without error, hooks are enabled, and the receipt store is writable.

### View enforcement activity

Use `openclaw sanna audit` to see recent enforcement decisions:

```bash
openclaw sanna audit --limit 10
```

Use `openclaw sanna status` for an overview of enforcement statistics.

## Template Customization Walkthrough

Start from the template closest to your needs and modify it.

### Step 1: Copy a template

```bash
cp constitutions/openclaw-developer.yaml constitutions/active.yaml
```

### Step 2: Update identity

Change `agent_name` and `domain` to match your use case:

```yaml
identity:
  agent_name: acme-backend-agent
  domain: backend-development
  description: Backend development agent for the Acme project
```

### Step 3: Update provenance

Set your team's authorship and approval chain:

```yaml
provenance:
  authored_by: alice@acme.com
  approved_by:
    - bob@acme.com
    - security@acme.com
  approval_date: "2026-03-01"
  approval_method: security-review
```

### Step 4: Adjust authority boundaries

Add or remove entries. For example, to allow Docker but escalate Kubernetes:

```yaml
authority_boundaries:
  can_execute:
    # ... existing entries ...
    - "exec:docker"
    - "exec:docker-compose"
  must_escalate:
    # ... existing entries ...
    - condition: "Kubernetes operations via kubectl"
      target:
        type: webhook
        url: "https://approvals.acme.com/k8s"
```

### Step 5: Add project-specific halt conditions

```yaml
halt_conditions:
  # ... existing entries ...
  - id: H010
    trigger: Agent attempts to modify database migration files without approval
    escalate_to: db-team@acme.com
    severity: high
    enforcement: halt
```

### Step 6: Validate and deploy

```bash
# Restart the Gateway to pick up the new constitution
openclaw gateway restart

# Validate
openclaw sanna doctor
```
