/**
 * Gateway RPC methods for operational visibility.
 *
 * sanna.status — current enforcement status, sidecar health, constitution info
 * sanna.audit  — recent enforcement decisions proxied from sidecar
 */

import type { SannaConfig, PluginAPI } from "./types.js";

const SIDECAR_TIMEOUT_MS = 5_000;

/** Register sanna.status and sanna.audit Gateway RPC methods. */
export function registerGatewayMethods(
  api: PluginAPI,
  config: SannaConfig
): void {
  const port = config.sidecarPort ?? 18890;
  const baseUrl = `http://127.0.0.1:${port}`;

  // ---------------------------------------------------------------------------
  // sanna.status — enforcement status overview
  // ---------------------------------------------------------------------------

  api.registerGatewayMethod("sanna.status", async ({ respond }) => {
    try {
      // Check sidecar health
      const healthRes = await fetchWithTimeout(`${baseUrl}/health`);
      const healthy = healthRes.ok;

      // Get status from sidecar
      let status: Record<string, unknown> = {};
      if (healthy) {
        const statusRes = await fetchWithTimeout(`${baseUrl}/status`);
        if (statusRes.ok) {
          status = (await statusRes.json()) as Record<string, unknown>;
        }
      }

      respond(true, {
        mode: config.enforcementMode ?? "enforce",
        sidecar: healthy ? "healthy" : "unreachable",
        constitutionPath: config.constitutionPath ?? "",
        governedTools: config.governedTools ?? [],
        ...status,
      });
    } catch {
      respond(true, {
        mode: config.enforcementMode ?? "enforce",
        sidecar: "unreachable",
        constitutionPath: config.constitutionPath ?? "",
        governedTools: config.governedTools ?? [],
      });
    }
  });

  // ---------------------------------------------------------------------------
  // sanna.audit — recent enforcement decisions
  // ---------------------------------------------------------------------------

  api.registerGatewayMethod("sanna.audit", async ({ respond }) => {
    try {
      const res = await fetchWithTimeout(`${baseUrl}/audit`);
      if (!res.ok) {
        respond(false, { error: `Sidecar returned HTTP ${res.status}` });
        return;
      }
      const data = await res.json();
      respond(true, data);
    } catch {
      respond(false, { error: "Sidecar unreachable" });
    }
  });
}

// ---------------------------------------------------------------------------
// Fetch with timeout
// ---------------------------------------------------------------------------

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIDECAR_TIMEOUT_MS);

  return fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}
