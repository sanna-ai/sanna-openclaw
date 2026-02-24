/**
 * Gateway deny-list generation.
 *
 * Tells the OpenClaw Gateway to block direct access to governed tools,
 * forcing all execution through governance-wrapped versions.
 */

import type { OpenClawPluginAPI, SidecarConfig } from "../types.js";

/** Apply the deny-list to the Gateway, blocking direct governed tool access */
export function applyDenyList(api: OpenClawPluginAPI, config: SidecarConfig): void {
  const denied = config.governedTools;
  api.log.info(`Blocking direct access to governed tools: ${denied.join(", ")}`);
  api.denyTools(denied);
}

/** Get the list of denied tool names from config */
export function getDeniedTools(config: SidecarConfig): readonly string[] {
  return config.governedTools;
}
