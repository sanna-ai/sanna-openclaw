/**
 * must_escalate approval workflow.
 *
 * When a constitution rule triggers "escalate", the action requires
 * explicit human approval before proceeding.
 */

import type { OpenClawPluginAPI, EnforceResponse, ToolResult } from "../types.js";

/** Handle an escalation verdict by requesting human approval */
export function handleEscalation(
  _api: OpenClawPluginAPI,
  tool: string,
  args: Record<string, unknown>,
  response: EnforceResponse
): ToolResult {
  const checks = response.failed_checks
    .map((c) => `  - [${c.id}] ${c.description} (${c.section})`)
    .join("\n");

  const message = [
    `## Governance Escalation Required`,
    ``,
    `The action **${tool}** requires human approval before it can proceed.`,
    ``,
    `### Triggered Checks`,
    checks,
    ``,
    `### Reason`,
    response.reason,
    ``,
    `### Requested Action`,
    `\`\`\`json`,
    JSON.stringify(args, null, 2),
    `\`\`\``,
    ``,
    `> To approve, the human operator must explicitly authorize this action.`,
  ].join("\n");

  return {
    content: message,
    isError: true,
  };
}
