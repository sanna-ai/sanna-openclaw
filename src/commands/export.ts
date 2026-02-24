/**
 * /sanna export — export evidence bundle.
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
      try {
        const bundle = await client.exportBundle();

        return [
          `## Evidence Bundle`,
          ``,
          "```json",
          JSON.stringify(bundle, null, 2),
          "```",
        ].join("\n");
      } catch (err) {
        return `Failed to export evidence bundle: ${err}`;
      }
    },
  });
}
