/**
 * sanna_status — governance status tool.
 *
 * Reports the current state of governance enforcement:
 * loaded constitution, enforcement statistics.
 */

import type { PluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerStatusTool(
  api: PluginAPI,
  client: SidecarClient
): void {
  api.registerTool({
    name: "sanna_status",
    description:
      "Get current Sanna governance status: loaded constitution, enforcement statistics.",
    schema: { type: "object", properties: {} },
    handler: async () => {
      return await client.status();
    },
  });
}
