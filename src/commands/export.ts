/**
 * /sanna export — export receipts as JSON.
 */

import type { OpenClawPluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerExportCommand(
  api: OpenClawPluginAPI,
  client: SidecarClient
): void {
  api.registerCommand({
    name: "sanna export",
    handler: async () => {
      const summaries = await client.receipts();

      if (summaries.length === 0) {
        return "No receipts to export.";
      }

      const exported = {
        exported_at: new Date().toISOString(),
        receipt_count: summaries.length,
        receipts: summaries,
      };

      return [
        `## Exported ${summaries.length} Receipts`,
        ``,
        "```json",
        JSON.stringify(exported, null, 2),
        "```",
      ].join("\n");
    },
  });
}
