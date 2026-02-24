/**
 * sanna_status — governance status tool.
 *
 * Reports the current state of governance enforcement.
 */

import type { OpenClawPluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";
import { SidecarManager } from "../sidecar.js";

export function registerStatusTool(
  api: OpenClawPluginAPI,
  client: SidecarClient,
  sidecar: SidecarManager
): void {
  api.registerTool({
    name: "sanna_status",
    description: "Check the current Sanna governance enforcement status.",
    schema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const health = await client.health();
        const status = await client.status();

        return {
          content: JSON.stringify(
            {
              sidecar_running: sidecar.isRunning(),
              sidecar_status: health.status,
              sanna_version: health.version,
              constitution: status.constitution,
              enforcement_stats: status.enforcement_stats,
            },
            null,
            2
          ),
        };
      } catch (err) {
        return {
          content: JSON.stringify({
            sidecar_running: sidecar.isRunning(),
            sidecar_status: "unreachable",
            error: String(err),
          }),
          isError: true,
        };
      }
    },
  });
}
