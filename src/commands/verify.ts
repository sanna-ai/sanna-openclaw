/**
 * /sanna verify — verify a receipt by looking it up.
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

      try {
        const receipts = await client.listReceipts();
        const receipt = receipts.find((r) => r.receipt_id === receiptId);
        if (!receipt) {
          return `No receipt found with ID: ${receiptId}`;
        }
        return [
          `## Receipt \`${receiptId}\``,
          ``,
          "```json",
          JSON.stringify(receipt, null, 2),
          "```",
        ].join("\n");
      } catch (err) {
        return `Verification failed: ${err}`;
      }
    },
  });
}
