/**
 * openclaw sanna setup — interactive setup command.
 */

import type { OpenClawPluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

export function registerSetupCommand(
  api: OpenClawPluginAPI,
  client: SidecarClient
): void {
  api.registerCli({
    name: "sanna setup",
    handler: async () => {
      const healthy = await client.health();
      if (!healthy) {
        api.log.error(
          [
            `Sanna Governance Setup`,
            ``,
            `Error: Could not connect to sidecar`,
            ``,
            `Troubleshooting:`,
            `  1. Ensure Python 3.10+ is installed`,
            `  2. Run: pip install sanna>=0.13.4 fastapi uvicorn`,
            `  3. Check that port 18791 is available`,
          ].join("\n")
        );
        return;
      }

      const status = await client.status();
      const lines = [
        `Sanna Governance Setup`,
        ``,
        `  Sidecar:      healthy`,
        `  Version:       ${status.sidecar_version}`,
        `  Constitution:  ${status.constitution ? status.constitution.name : "none"}`,
        ``,
      ];

      if (!status.constitution) {
        lines.push(
          `Next steps:`,
          `  1. Place a constitution YAML in constitutions/`,
          `  2. Restart the sidecar`,
          `  3. Test with sanna_check before running real commands`
        );
      } else {
        lines.push(`Governance enforcement is active.`);
      }

      api.log.info(lines.join("\n"));
    },
  });
}
