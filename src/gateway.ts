/**
 * Gateway RPC methods for operational visibility.
 *
 * sanna.status — current enforcement status, sidecar health, constitution info
 * sanna.audit  — recent enforcement decisions proxied from sidecar
 */

import type { SannaConfig, PluginAPI } from "./types.js";
import { fetchWithTimeout } from "./http.js";

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
      const healthRes = await fetchWithTimeout(
        `${baseUrl}/health`,
        {},
        SIDECAR_TIMEOUT_MS
      );
      const healthy = healthRes.ok;

      // Get status from sidecar
      let status: Record<string, unknown> = {};
      if (healthy) {
        const statusRes = await fetchWithTimeout(
          `${baseUrl}/status`,
          {},
          SIDECAR_TIMEOUT_MS
        );
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
  // sanna.audit — recent enforcement decisions (POST /audit)
  // ---------------------------------------------------------------------------

  api.registerGatewayMethod("sanna.audit", async ({ respond }) => {
    try {
      const res = await fetchWithTimeout(
        `${baseUrl}/audit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 20 }),
        },
        SIDECAR_TIMEOUT_MS
      );
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
