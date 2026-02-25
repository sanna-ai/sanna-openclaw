/**
 * Shared utilities for reading OpenClaw configuration.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Read and cache ~/.openclaw/openclaw.json (parsed once).
 */
let _cachedOpenclawConfig: Record<string, unknown> | undefined;

function readOpenclawConfig(): Record<string, unknown> {
  if (_cachedOpenclawConfig !== undefined) return _cachedOpenclawConfig;

  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    _cachedOpenclawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    _cachedOpenclawConfig = {};
  }

  return _cachedOpenclawConfig!;
}

/**
 * Check if hooks.internal.enabled is true in ~/.openclaw/openclaw.json.
 * Returns true only when explicitly set to true.
 */
export function readHooksEnabled(): boolean {
  const raw = readOpenclawConfig() as Record<string, unknown>;
  const hooks = raw?.hooks as Record<string, unknown> | undefined;
  const internal = hooks?.internal as Record<string, unknown> | undefined;
  return internal?.enabled === true;
}
