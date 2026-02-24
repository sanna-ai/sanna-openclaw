/**
 * tool_result_persist hook — post-execution audit receipts.
 *
 * After a tool execution completes, this hook generates a signed
 * receipt via the sidecar for audit trail purposes. Audit failures
 * are caught and logged — they must NEVER break tool execution.
 */

import type { PluginAPI } from "../types.js";
import { SidecarClient } from "../client.js";

/** Register the post-execution audit hook */
export function registerAuditHook(
  api: PluginAPI,
  client: SidecarClient
): void {
  api.on("tool_result_persist", async (...hookArgs: unknown[]) => {
    const event = hookArgs[0] as {
      tool: string;
      args: Record<string, unknown>;
      result?: unknown;
      error?: string;
    };

    try {
      await client.audit({
        tool: event.tool,
        args: event.args,
        result: event.result,
        error: event.error,
        context: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      // Audit failure must NEVER break tool execution
      console.error(`[sanna] Audit receipt failed for ${event.tool}:`, err);
    }
  });
}
