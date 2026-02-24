/**
 * Enforcement gate: wrapper tools that replace governed core tools.
 *
 * Registers sanna_* wrapper tools that evaluate actions against the
 * constitution via the sidecar before allowing execution.
 */

import type { PluginAPI } from "../types.js";
import { TOOL_MAP } from "../types.js";
import { SidecarClient } from "../client.js";

/**
 * Register wrapper tools for all governed core tools.
 *
 * For each tool in governedTools that exists in TOOL_MAP, registers a
 * sanna_* wrapper tool that calls enforceAndForward before execution.
 * Tools not in TOOL_MAP are skipped with a warning.
 */
export function registerEnforcementGate(
  api: PluginAPI,
  client: SidecarClient,
  governedTools: string[]
): void {
  for (const coreTool of governedTools) {
    const wrapperName = TOOL_MAP[coreTool];
    if (!wrapperName) {
      console.warn(
        `[sanna] Unknown governed tool "${coreTool}" not in TOOL_MAP, skipping`
      );
      continue;
    }

    api.registerTool({
      name: wrapperName,
      description: `[Sanna Governed] ${coreTool} — enforced by constitution`,
      schema: { type: "object", additionalProperties: true },
      handler: async (args) => enforceAndForward(client, coreTool, args),
    });
  }
}

/**
 * Enforce a tool call against the constitution and handle the verdict.
 *
 * Returns a result object depending on verdict:
 * - allow: { forwarded: true, tool, args, receipt_id }
 * - halt: { error: true, message: "GOVERNANCE HALT: ..." }
 * - escalate: { error: true, message: "GOVERNANCE ESCALATION: ..." }
 */
export async function enforceAndForward(
  client: SidecarClient,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const response = await client.enforce({ tool, args });

  switch (response.verdict) {
    case "allow":
      // Phase 0.5 will replace this with: return await forwardToGateway(tool, args);
      return {
        forwarded: true,
        tool,
        args,
        receipt_id: response.receipt?.id ?? null,
      };

    case "halt":
      return {
        error: true,
        message:
          `GOVERNANCE HALT: ${response.reason}\n` +
          `Boundary: ${response.boundary_type}\n` +
          `Receipt: ${response.receipt?.id}`,
      };

    case "escalate":
      return {
        error: true,
        message:
          `GOVERNANCE ESCALATION: This action requires user approval.\n` +
          `Reason: ${response.reason}\n` +
          `Use /sanna approve ${response.receipt?.id} to approve.`,
      };

    default:
      // Unknown verdict — fail closed
      return {
        error: true,
        message: `GOVERNANCE HALT: Unknown verdict "${response.verdict}"`,
      };
  }
}

/**
 * Forward a tool call to the Gateway for execution.
 *
 * Placeholder — real implementation requires Phase 0.5 validation
 * of the Gateway invoke API shape.
 */
export async function forwardToGateway(
  tool: string,
  _args: Record<string, unknown>
): Promise<unknown> {
  throw new Error(
    `Gateway forwarding not yet implemented for tool: ${tool}. Requires Phase 0.5 validation.`
  );
}
