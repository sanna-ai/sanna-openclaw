/**
 * /sanna constitution — display the active constitution.
 */

import type { OpenClawPluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerConstitutionCommand(
  api: OpenClawPluginAPI,
  client: SidecarClient
): void {
  api.registerCommand({
    name: "sanna constitution",
    handler: async () => {
      try {
        const status = await client.status();
        return [
          `## Active Constitution`,
          ``,
          "```json",
          JSON.stringify(status.constitution, null, 2),
          "```",
        ].join("\n");
      } catch (err) {
        return `Failed to fetch constitution: ${err}`;
      }
    },
  });
}
