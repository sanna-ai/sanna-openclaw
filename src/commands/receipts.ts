/**
 * /sanna receipts — list session receipts.
 */

import type { OpenClawPluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerReceiptsCommand(
  api: OpenClawPluginAPI,
  client: SidecarClient
): void {
  api.registerCommand({
    name: "sanna receipts",
    handler: async () => {
      try {
        const receipts = await client.listReceipts();

        if (receipts.length === 0) {
          return "No governance receipts.";
        }

        const rows = receipts.map(
          (r) =>
            `| ${r.receipt_id.slice(0, 12)}... | ${r.tool} | ${r.verdict} | ${r.timestamp} |`
        );

        return [
          `## Receipts (${receipts.length})`,
          ``,
          `| ID | Tool | Verdict | Timestamp |`,
          `|---|---|---|---|`,
          ...rows,
        ].join("\n");
      } catch (err) {
        return `Failed to list receipts: ${err}`;
      }
    },
  });
}
