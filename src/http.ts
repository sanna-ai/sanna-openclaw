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
 * Read the gateway auth token from ~/.openclaw/openclaw.json.
 * Cached after first read — returns empty string on any failure.
 */
let _cachedToken: string | undefined;

export function readGatewayToken(): string {
  if (_cachedToken !== undefined) return _cachedToken;

  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    _cachedToken = String(raw?.gateway?.auth?.token ?? "");
  } catch {
    _cachedToken = "";
  }

  return _cachedToken;
}
