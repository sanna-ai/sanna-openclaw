/**
 * sanna_receipt — receipt lookup tool.
 *
 * Allows the agent to query governance receipts.
 */

import type { OpenClawPluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerReceiptTool(
  api: OpenClawPluginAPI,
  client: SidecarClient
): void {
  api.registerTool({
    name: "sanna_receipt",
    description: "Query Sanna governance receipts. Filter by tool name, verdict, or limit results.",
    schema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Filter by tool name" },
        verdict: { type: "string", description: "Filter by verdict (allow, halt, escalate)" },
        limit: { type: "number", description: "Max receipts to return" },
      },
    },
    handler: async (args) => {
      const summaries = await client.receipts({
        tool: args.tool as string | undefined,
        verdict: args.verdict as string | undefined,
        limit: args.limit as number | undefined,
      });
      if (summaries.length === 0) {
        return { content: "No receipts found matching the query." };
      }
      return { content: JSON.stringify(summaries, null, 2) };
    },
  });
}
