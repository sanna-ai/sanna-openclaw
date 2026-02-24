/**
 * tool_result_persist hook — post-execution audit receipts.
 *
 * After a tool execution completes, this hook generates a signed
 * receipt via the sidecar for audit trail purposes.
 */

import type { OpenClawPluginAPI, SidecarConfig, HookEvent, HookResult } from "../types.js";
import { SidecarClient } from "../client.js";

/** Register the post-execution audit hook */
export function registerAuditHook(
  api: OpenClawPluginAPI,
  client: SidecarClient,
  config: SidecarConfig
): void {
  const auditedTools = config.governedTools.map((t) => `sanna_${t}`);

  api.on("tool_result_persist", async (event: HookEvent): Promise<HookResult> => {
    if (!auditedTools.includes(event.tool)) {
      return { allow: true };
    }

    try {
      const response = await client.audit({
        tool: event.tool,
        args: event.args,
        result: event.result ?? null,
        error: null,
        context: {
          session_id: api.getSessionId(),
          agent_id: api.getAgentId(),
          conversation_turn: api.getConversationTurn(),
          timestamp: new Date().toISOString(),
        },
      });

      api.log.debug(
        `Audit receipt generated: ${response.receipt_id} for ${event.tool}`
      );
    } catch (err) {
      api.log.error(`Failed to generate audit receipt for ${event.tool}: ${err}`);
      // Don't block the result — audit failure is logged but non-fatal
    }

    return { allow: true };
  });
}
