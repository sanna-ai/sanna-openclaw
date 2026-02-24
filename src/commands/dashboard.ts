/**
 * /sanna — main dashboard command.
 *
 * Shows governance status overview.
 */

import type { OpenClawPluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";
import { SidecarManager } from "../sidecar.js";

export function registerDashboardCommand(
  api: OpenClawPluginAPI,
  client: SidecarClient,
  sidecar: SidecarManager
): void {
  api.registerCommand({
    name: "sanna",
    handler: async () => {
      try {
        const health = await client.health();
        const status = await client.status();
        const receipts = await client.listReceipts();

        return [
          `## Sanna Governance Dashboard`,
          ``,
          `| Property | Value |`,
          `|---|---|`,
          `| Sidecar | ${sidecar.isRunning() ? "running" : "stopped"} (${health.status}) |`,
          `| Sanna Version | ${health.version} |`,
          `| Constitution | ${(status.constitution as Record<string, unknown>).name ?? "none"} |`,
          `| Receipts | ${receipts.length} |`,
          ``,
          `Use \`/sanna receipts\`, \`/sanna verify\`, \`/sanna constitution\`, \`/sanna export\`.`,
        ].join("\n");
      } catch (err) {
        return `Sanna governance error: ${err}`;
      }
    },
  });
}
