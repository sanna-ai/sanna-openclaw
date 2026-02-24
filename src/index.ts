/**
 * sanna-openclaw plugin entry point.
 *
 * Called by the OpenClaw Gateway plugin loader.
 */

import type { PluginAPI } from "./types.js";
import { resolveConfig } from "./config.js";
import { registerSidecar } from "./sidecar.js";
import { registerTools } from "./tools.js";
import { registerHooks } from "./hooks.js";
import { registerGatewayMethods } from "./gateway.js";
import { registerCli } from "./cli.js";

export default function register(api: PluginAPI): void {
  const config = resolveConfig(api);
  api.logger.info(
    `[sanna] Governance plugin loaded. Mode: ${config.enforcementMode}`
  );

  registerSidecar(api, config);
  registerTools(api, config);
  registerHooks(api, config);
  registerGatewayMethods(api, config);
  registerCli(api, config);
}
