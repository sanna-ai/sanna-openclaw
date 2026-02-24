/**
 * sanna_check — voluntary pre-check tool.
 *
 * Allows the agent to check whether an action would be allowed
 * before attempting it. Does not execute anything.
 */

import type { OpenClawPluginAPI, ToolCallContext } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerCheckTool(
  api: OpenClawPluginAPI,
  client: SidecarClient
): void {
  api.registerTool({
    name: "sanna_check",
    description:
      "Pre-check whether a tool call would be allowed by the governance constitution. " +
      "Does not execute the tool — only returns the verdict.",
    schema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Tool name to check (e.g., exec, write)" },
        args: { type: "object", description: "Arguments that would be passed to the tool" },
      },
      required: ["tool", "args"],
    },
    handler: async (args) => {
      const tool = args.tool as string;
      const toolArgs = (args.args ?? {}) as Record<string, unknown>;

      const context: ToolCallContext = {
        session_id: api.getSessionId(),
        agent_id: api.getAgentId(),
        conversation_turn: api.getConversationTurn(),
        timestamp: new Date().toISOString(),
      };

      try {
        const response = await client.enforce({ tool, args: toolArgs, context });
        return {
          content: JSON.stringify(
            {
              verdict: response.verdict,
              reason: response.reason,
              failed_checks: response.failed_checks.map((c) => c.id),
            },
            null,
            2
          ),
        };
      } catch (err) {
        return {
          content: `Pre-check failed: ${err}`,
          isError: true,
        };
      }
    },
  });
}
