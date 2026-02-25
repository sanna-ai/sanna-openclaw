/**
 * sanna-openclaw plugin entry point.
 *
 * Called by the OpenClaw Gateway plugin loader.
 *
 * Architecture: before_tool_call hook is the primary enforcement point.
 * Every tool call in the agent loop passes through the hook, which calls
 * the sidecar /enforce endpoint. No wrapper tools needed.
 */

import type { PluginAPI } from "./types.js";
import { resolveConfig } from "./config.js";
import { registerSidecar } from "./sidecar.js";
import { registerHooks } from "./hooks.js";
import { registerGatewayMethods } from "./gateway.js";
import { registerCli } from "./cli.js";

export default function register(api: PluginAPI): void {
  const config = resolveConfig(api);
  api.logger.info(
    `[sanna] Governance plugin loaded. Mode: ${config.enforcementMode}`
  );

  registerSidecar(api, config);
  registerHooks(api, config);
  registerGatewayMethods(api, config);
  registerCli(api, config);
}
