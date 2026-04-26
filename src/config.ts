/**
 * Configuration: types, defaults, and resolution.
 */

import type { SannaConfig, PluginAPI } from "./types.js";

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: Required<SannaConfig> = {
  constitutionPath: "",
  privateKeyPath: "",
  publicKeyPath: "",
  receiptStorePath: "",
  enforcementMode: "enforce",
  otelExport: false,
  otelServiceName: "sanna-openclaw",
  llmChecks: false,
  llmChecksModel: "",
  customEvaluatorsPath: "",
  sinkType: "local_sqlite",
  contentMode: "full" as const,
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
