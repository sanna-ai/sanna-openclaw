/**
 * Gateway RPC methods for operational visibility.
 *
 * sanna.status — current enforcement status, constitution info, receipt stats
 * sanna.audit  — recent enforcement receipts from ReceiptStore
 */

import type { SannaConfig, PluginAPI } from "./types.js";
import type { Constitution } from "@sanna-ai/core";
import type { ReceiptStore } from "@sanna-ai/core";

export interface GatewayDeps {
  constitution: Constitution;
  store: ReceiptStore;
}

/** Register sanna.status and sanna.audit Gateway RPC methods. */
export function registerGatewayMethods(
  api: PluginAPI,
  config: SannaConfig,
  deps: GatewayDeps
): void {
  const { constitution, store } = deps;

  // ---------------------------------------------------------------------------
  // sanna.status — enforcement status overview
  // ---------------------------------------------------------------------------

  api.registerGatewayMethod("sanna.status", ({ respond }) => {
    const stats = { total: 0, allowed: 0, denied: 0, escalated: 0 };
    try {
      stats.total = store.count();
      stats.allowed = store.count({ status: "PASS" });
      stats.denied = store.count({ status: "FAIL" });
    } catch {
      // best effort
    }

    respond(true, {
      mode: config.enforcementMode ?? "enforce",
      constitution: {
        name: constitution.identity.agent_name,
        version: constitution.schema_version,
        policy_hash: constitution.policy_hash ?? "",
      },
      governedTools: config.governedTools ?? [],
      enforcement_stats: stats,
    });
  });

  // ---------------------------------------------------------------------------
  // sanna.audit — recent enforcement receipts
  // ---------------------------------------------------------------------------

  api.registerGatewayMethod("sanna.audit", ({ respond }) => {
    try {
      const receipts = store.query({ enforcement: true, limit: 20 });
      respond(true, receipts);
    } catch {
      respond(false, { error: "Receipt query failed" });
    }
  });
}
