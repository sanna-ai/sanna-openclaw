/**
 * /sanna verify — look up a receipt by ID.
 */

import type { OpenClawPluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerVerifyCommand(
  api: OpenClawPluginAPI,
  client: SidecarClient
): void {
  api.registerCommand({
    name: "sanna verify",
    handler: async (args: string[]) => {
      const receiptId = args[0];
      if (!receiptId) {
        return "Usage: /sanna verify <receipt_id>";
      }

      const summaries = await client.receipts();
      const match = summaries.find((r) => r.id === receiptId);
      if (!match) {
        return `No receipt found with ID: ${receiptId}`;
      }
      return [
        `## Receipt \`${receiptId}\``,
        ``,
        "```json",
        JSON.stringify(match, null, 2),
        "```",
      ].join("\n");
    },
  });
}
