/**
 * Shared HTTP utilities.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** fetch with AbortController-based timeout. */
export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

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
 * Read the gateway auth token from ~/.openclaw/openclaw.json.
 * Returns empty string on any failure.
 */
export function readGatewayToken(): string {
  const raw = readOpenclawConfig() as Record<string, unknown>;
  const gateway = raw?.gateway as Record<string, unknown> | undefined;
  const auth = gateway?.auth as Record<string, unknown> | undefined;
  return String(auth?.token ?? "");
}

/**
 * Read the workspace root from ~/.openclaw/openclaw.json.
 * Path: agents.defaults.workspace. Defaults to ~/.openclaw/workspace.
 */
export function readWorkspaceRoot(): string {
  const raw = readOpenclawConfig() as Record<string, unknown>;
  const agents = raw?.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const workspace = defaults?.workspace;
  if (typeof workspace === "string" && workspace) return workspace;
  return join(homedir(), ".openclaw", "workspace");
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
