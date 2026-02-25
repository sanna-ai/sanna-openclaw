/**
 * Plugin hooks — primary enforcement point for Sanna governance.
 *
 * before_tool_call — PRIMARY enforcement. Fires for every tool call in the
 * agent loop. Calls sidecar /enforce and blocks (deny/escalate) or allows.
 * Fail-closed: if sidecar is unreachable, the action is blocked.
 *
 * after_tool_call — observability. Logs receipt info after allowed calls.
 *
 * tool_result_persist — stamps receipt metadata onto results for transcript.
 */

import type { SannaConfig, PluginAPI } from "./types.js";
import { fetchWithTimeout } from "./http.js";

const SIDECAR_TIMEOUT_MS = 5_000;

export function registerHooks(api: PluginAPI, config: SannaConfig): void {
  const sidecarPort = config.sidecarPort ?? 18890;
  const enforceUrl = `http://127.0.0.1:${sidecarPort}/enforce`;
  const isEnforceMode = config.enforcementMode === "enforce";

  // Track last receipt per tool call for after_tool_call observability
  let lastReceipt: { receiptId: string; tool: string; verdict: string } | null = null;

  // ---------------------------------------------------------------------------
  // before_tool_call — primary enforcement
  // ---------------------------------------------------------------------------
  //
  // Hook signature from OpenClaw source:
  //   hookRunner.runBeforeToolCall(event, ctx)
  //   event: { toolName: string, params: Record<string, unknown> }
  //   ctx: { toolName: string, agentId?: string, sessionKey?: string }
  //
  // Return { block: true, blockReason: string } to block
  // Return { blocked: false } to allow
  // Return undefined/void to allow

  api.registerHook(
    "before_tool_call",
    async (...args: unknown[]) => {
      const event = args[0] as Record<string, unknown> | undefined;
      const ctx = args[1] as Record<string, unknown> | undefined;

      // Extract tool name and params from event
      const toolName = event?.toolName as string | undefined;
      const params = (event?.params ?? {}) as Record<string, unknown>;

      if (!toolName || typeof toolName !== "string") {
        api.logger.warn(
          "[sanna] before_tool_call: could not extract toolName from event. " +
            "Args: " + JSON.stringify(args.slice(0, 2))
        );
        // Fail closed in enforce mode
        if (isEnforceMode) {
          return {
            block: true,
            blockReason: "Governance enforcement error — could not identify tool",
          };
        }
        return undefined;
      }

      // Call sidecar /enforce
      try {
        const res = await fetchWithTimeout(
          enforceUrl,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tool: toolName,
              args: params,
              context: {
                agent_id: (ctx?.agentId as string) ?? "",
                session_id: (ctx?.sessionKey as string) ?? "",
              },
            }),
          },
          SIDECAR_TIMEOUT_MS
        );

        if (!res.ok) {
          api.logger.error(
            `[sanna] Sidecar returned HTTP ${res.status} for ${toolName}`
          );
          if (isEnforceMode) {
            return {
              block: true,
              blockReason:
                "Governance enforcement unavailable — action blocked",
            };
          }
          return undefined;
        }

        const body = (await res.json()) as Record<string, unknown>;
        const verdict = (body.verdict as string) ?? "halt";
        const reason = (body.reason as string) ?? "No reason provided";
        const receipt = body.receipt as Record<string, unknown> | undefined;
        const receiptId = (receipt?.receipt_id as string) ?? "";

        // Store for after_tool_call observability
        lastReceipt = { receiptId, tool: toolName, verdict };

        if (verdict === "allow") {
          api.logger.info(
            `[sanna] ALLOW ${toolName} (receipt: ${receiptId.slice(0, 8)}...)`
          );
          return { blocked: false };
        }

        if (verdict === "escalate") {
          const msg =
            `Requires approval: ${reason} (receipt: ${receiptId})`;
          api.logger.warn(`[sanna] ESCALATE ${toolName}: ${reason}`);
          if (isEnforceMode) {
            return { block: true, blockReason: msg };
          }
          // Audit mode: log but allow
          return undefined;
        }

        // halt / deny / error / anything else → block
        const msg =
          `Blocked by governance: ${reason} (receipt: ${receiptId})`;
        api.logger.warn(`[sanna] DENY ${toolName}: ${reason}`);
        if (isEnforceMode) {
          return { block: true, blockReason: msg };
        }
        // Audit mode: log but allow
        return undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(
          `[sanna] Sidecar unreachable for ${toolName}: ${msg}`
        );
        // FAIL CLOSED
        if (isEnforceMode) {
          return {
            block: true,
            blockReason:
              "Governance enforcement unavailable — action blocked",
          };
        }
        return undefined;
      }
    },
    {
      name: "sanna.before-tool-call",
      description:
        "Sanna governance enforcement — evaluates every tool call against the constitution",
    }
  );

  // ---------------------------------------------------------------------------
  // after_tool_call — observability
  // ---------------------------------------------------------------------------

  api.registerHook(
    "after_tool_call",
    (...args: unknown[]) => {
      if (lastReceipt) {
        api.logger.info(
          `[sanna] after_tool_call: ${lastReceipt.tool} verdict=${lastReceipt.verdict} receipt=${lastReceipt.receiptId.slice(0, 8)}...`
        );
        lastReceipt = null;
      }
    },
    {
      name: "sanna.after-tool-call",
      description: "Sanna governance observability — logs receipt info",
    }
  );

  // ---------------------------------------------------------------------------
  // tool_result_persist — receipt annotation (simplified)
  // ---------------------------------------------------------------------------

  api.registerHook(
    "tool_result_persist",
    (result: unknown) => {
      if (result == null || typeof result !== "object") return undefined;

      const obj = result as Record<string, unknown>;

      // Only annotate results that carry our receipt metadata
      if (!obj._sanna_receipt_hash) return undefined;

      const receiptHash = obj._sanna_receipt_hash as string;

      // Stamp receipt hash into content for transcript visibility
      const annotated = { ...obj };
      if (Array.isArray(annotated.content)) {
        annotated.content = [
          ...annotated.content,
          {
            type: "text",
            text: `\n\uD83D\uDCDC Sanna Receipt: ${receiptHash}`,
          },
        ];
      }

      // Remove internal metadata — not for the transcript
      delete annotated._sanna_receipt_hash;

      return annotated;
    },
    {
      name: "sanna.tool-result-persist",
      description: "Annotates tool results with Sanna governance receipts",
    }
  );
}
