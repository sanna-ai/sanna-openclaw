/**
 * Plugin hooks: before_tool_call safety net + tool_result_persist receipts.
 *
 * before_tool_call — defense in depth. Blocks direct calls to governed tools
 * when the LLM bypasses sanna_* wrappers. Should never fire if tools.allow
 * is configured correctly, but catches misconfiguration and prompt injection.
 *
 * tool_result_persist — synchronous transform hook. Stamps receipt hashes
 * onto tool results before they're persisted to the session transcript.
 */

import type { SannaConfig, PluginAPI } from "./types.js";

export function registerHooks(api: PluginAPI, config: SannaConfig): void {
  const governed = new Set(config.governedTools ?? []);

  // ---------------------------------------------------------------------------
  // before_tool_call — safety net
  // ---------------------------------------------------------------------------
  //
  // VALIDATION REQUIRED: test against live OpenClaw Gateway
  //
  // The exact handler signature for before_tool_call is not fully documented.
  // We use (toolName, params) based on "intercept tool params/results" from
  // the Agent Loop docs. This may need adjustment once tested against a real
  // OpenClaw instance. The try/catch and argument validation below ensure
  // we fail loudly rather than silently if the signature changes.

  api.registerHook(
    "before_tool_call",
    (...args: unknown[]) => {
      try {
        const toolName = args[0];

        // Warn loudly on unexpected argument shape
        if (typeof toolName !== "string") {
          api.logger.warn(
            "[sanna] before_tool_call received unexpected arguments. " +
              "Hook signature may have changed. Args: " +
              JSON.stringify(args.slice(0, 2))
          );
          return;
        }

        // Only intercept governed originals, not sanna_* wrappers
        if (!governed.has(toolName) || toolName.startsWith("sanna_")) return;

        api.logger.warn(
          `[sanna] BLOCKED direct call to governed tool: ${toolName}. Use sanna_${toolName} instead.`
        );

        if (config.enforcementMode === "enforce") {
          throw new Error(
            `[sanna] Tool "${toolName}" requires governance. Use "sanna_${toolName}" instead.`
          );
        }

        // In audit/passthrough mode, log only — let the call through
      } catch (err) {
        // Re-throw sanna enforcement errors — they intentionally block tool calls
        if (err instanceof Error && err.message.includes("[sanna]")) {
          throw err;
        }
        // Unexpected errors: log but don't crash the hook
        api.logger.error(
          `[sanna] before_tool_call handler error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    {
      name: "sanna.before-tool-call",
      description:
        "Sanna governance safety net — blocks direct calls to governed tools",
    }
  );

  // ---------------------------------------------------------------------------
  // tool_result_persist — receipt annotation
  // ---------------------------------------------------------------------------
  //
  // This hook is synchronous (docs are explicit). It annotates results from
  // sanna_* wrappers with the receipt hash so it appears in the transcript.
  //
  // NOTE: The result object shape depends on what OpenClaw passes here.
  // We look for _sanna_receipt_hash set by enforceAndForward().

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
