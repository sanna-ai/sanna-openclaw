/**
 * Configuration: types, defaults, and resolution.
 */

import type { SannaConfig, PluginAPI } from "./types.js";

// ---------------------------------------------------------------------------
// Default governed tools by tier
// ---------------------------------------------------------------------------

/** Tier 1 — modifies system state */
const TIER_1 = ["exec", "bash", "write", "edit", "apply_patch", "process"];

/** Tier 2 — composite tools with high-risk actions */
const TIER_2 = ["browser", "message", "nodes"];

/** Tier 3 — audit trail */
const TIER_3 = [
  "web_search",
  "web_fetch",
  "cron",
  "gateway",
  "sessions_send",
  "sessions_spawn",
];

/**
 * Default list of governed tools (tier 1 + 2 + 3).
 *
 * Tier 4 tools (read, image, canvas, sessions_list, sessions_history,
 * session_status, memory_search, memory_get, agents_list) are NOT
 * governed by default.
 */
export const GOVERNED_TOOLS_DEFAULT: string[] = [
  ...TIER_1,
  ...TIER_2,
  ...TIER_3,
];

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: Required<SannaConfig> = {
  constitutionPath: "",
  gatewayPort: 18789,
  gatewayToken: "",
  sidecarPort: 18890,
  governedTools: GOVERNED_TOOLS_DEFAULT,
  enforcementMode: "enforce",
};

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

/** Merge plugin config with defaults. */
export function resolveConfig(api: PluginAPI): SannaConfig {
  const raw = (api.config ?? {}) as Partial<SannaConfig>;

  return {
    constitutionPath: raw.constitutionPath ?? DEFAULT_CONFIG.constitutionPath,
    gatewayPort: raw.gatewayPort ?? DEFAULT_CONFIG.gatewayPort,
    gatewayToken: raw.gatewayToken ?? DEFAULT_CONFIG.gatewayToken,
    sidecarPort: raw.sidecarPort ?? DEFAULT_CONFIG.sidecarPort,
    governedTools: raw.governedTools ?? DEFAULT_CONFIG.governedTools,
    enforcementMode: raw.enforcementMode ?? DEFAULT_CONFIG.enforcementMode,
  };
}
