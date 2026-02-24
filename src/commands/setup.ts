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
      try {
        const health = await client.health();
        const status = await client.status();

        const lines = [
          `Sanna Governance Setup`,
          ``,
          `  Sidecar:      ${health.status}`,
          `  Version:       ${health.version}`,
          `  Constitution:  ${JSON.stringify(status.constitution)}`,
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
      } catch (err) {
        api.log.error(
          [
            `Sanna Governance Setup`,
            ``,
            `Error: Could not connect to sidecar: ${err}`,
            ``,
            `Troubleshooting:`,
            `  1. Ensure Python 3.10+ is installed`,
            `  2. Run: pip install sanna>=0.13.4 fastapi uvicorn`,
            `  3. Check that port 18791 is available`,
          ].join("\n")
        );
      }
    },
  });
}
