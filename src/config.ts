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
  privateKeyPath: "",
  publicKeyPath: "",
  receiptStorePath: "",
  governedTools: GOVERNED_TOOLS_DEFAULT,
  enforcementMode: "enforce",
  otelExport: false,
  otelServiceName: "sanna-openclaw",
  llmChecks: false,
  llmChecksModel: "",
  customEvaluatorsPath: "",
  sinkType: "local_sqlite",
  contentMode: "full",
};

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

/** Merge plugin config with defaults. */
export function resolveConfig(api: PluginAPI): SannaConfig {
  // OpenClaw passes the full openclaw.json as api.config.
  // Plugin-specific config lives at plugins.entries.<id>.config.
  const fullConfig = (api.config ?? {}) as Record<string, unknown>;
  const pluginsSection = fullConfig.plugins as
    | { entries?: { sanna?: { config?: Partial<SannaConfig> } } }
    | undefined;
  const raw: Partial<SannaConfig> = pluginsSection?.entries?.sanna?.config ?? {};

  return {
    constitutionPath: raw.constitutionPath ?? DEFAULT_CONFIG.constitutionPath,
    privateKeyPath: raw.privateKeyPath ?? DEFAULT_CONFIG.privateKeyPath,
    publicKeyPath: raw.publicKeyPath ?? DEFAULT_CONFIG.publicKeyPath,
    receiptStorePath: raw.receiptStorePath ?? DEFAULT_CONFIG.receiptStorePath,
    governedTools: raw.governedTools ?? DEFAULT_CONFIG.governedTools,
    enforcementMode: raw.enforcementMode ?? DEFAULT_CONFIG.enforcementMode,
    otelExport: raw.otelExport ?? DEFAULT_CONFIG.otelExport,
    otelServiceName: raw.otelServiceName ?? DEFAULT_CONFIG.otelServiceName,
    llmChecks: raw.llmChecks ?? DEFAULT_CONFIG.llmChecks,
    llmChecksModel: raw.llmChecksModel ?? DEFAULT_CONFIG.llmChecksModel,
    customEvaluatorsPath:
      raw.customEvaluatorsPath ?? DEFAULT_CONFIG.customEvaluatorsPath,
    sinkType: raw.sinkType ?? DEFAULT_CONFIG.sinkType,
    contentMode: raw.contentMode ?? DEFAULT_CONFIG.contentMode,
  };
}
