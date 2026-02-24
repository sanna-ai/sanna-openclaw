/**
 * sanna_check — voluntary pre-check tool.
 *
 * Allows the agent to check whether an action would be allowed
 * by the governance constitution without executing it.
 */

import type { PluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerCheckTool(
  api: PluginAPI,
  client: SidecarClient
): void {
  api.registerTool({
    name: "sanna_check",
    description:
      "Check if an action would be allowed by the governance constitution without executing it.",
    schema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Tool name to check" },
        args: {
          type: "object",
          description: "Arguments that would be passed",
        },
      },
      required: ["tool", "args"],
    },
    handler: async ({ tool, args }) => {
      const verdict = await client.enforce({
        tool: tool as string,
        args: (args ?? {}) as Record<string, unknown>,
      });
      return {
        would_allow: verdict.verdict === "allow",
        verdict: verdict.verdict,
        reason: verdict.reason,
        boundary: verdict.boundary_type,
      };
    },
  });
}
