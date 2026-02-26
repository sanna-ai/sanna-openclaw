/**
 * Plugin hooks — primary enforcement point for Sanna governance.
 *
 * before_tool_call — PRIMARY enforcement. Fires for every tool call in the
 * agent loop. Evaluates authority via @sanna-ai/core and blocks or allows.
 *
 * after_tool_call — observability. Logs receipt info after allowed calls.
 *
 * tool_result_persist — stamps receipt metadata onto results for transcript.
 */

import type { SannaConfig, PluginAPI } from "./types.js";
import type {
  Constitution,
  AuthorityDecision,
  CheckResult,
} from "@sanna-ai/core";
import {
  evaluateAuthority,
  generateReceipt,
  signReceipt,
  ReceiptStore,
  loadInvariantChecks,
  runAllInvariantChecks,
} from "@sanna-ai/core";
import type { KeyObject } from "node:crypto";

export interface OtelExporter {
  exportReceipt(receipt: Record<string, unknown>): void;
}

export interface HookDeps {
  constitution: Constitution;
  store: ReceiptStore;
  privateKey: KeyObject | null;
  otelExporter?: OtelExporter | null;
}

export function registerHooks(
  api: PluginAPI,
  config: SannaConfig,
  deps: HookDeps
): void {
  const { constitution, store, privateKey } = deps;
  const isEnforceMode = config.enforcementMode === "enforce";

  // Track last receipt per tool call for after_tool_call observability
  let lastReceipt: {
    receiptId: string;
    tool: string;
    verdict: string;
  } | null = null;

  // ---------------------------------------------------------------------------
  // before_tool_call — primary enforcement
  // ---------------------------------------------------------------------------

  api.on(
    "before_tool_call",
    async (...args: unknown[]) => {
      const event = args[0] as Record<string, unknown> | undefined;
      const ctx = args[1] as Record<string, unknown> | undefined;

      const toolName = event?.toolName as string | undefined;
      const params = (event?.params ?? {}) as Record<string, unknown>;

      if (!toolName || typeof toolName !== "string") {
        api.logger.warn(
          "[sanna] before_tool_call: could not extract toolName from event. " +
            "Args: " +
            JSON.stringify(args.slice(0, 2))
        );
        if (isEnforceMode) {
          return {
            block: true,
            blockReason:
              "Governance enforcement error — could not identify tool",
          };
        }
        return undefined;
      }

      // Evaluate authority via @sanna-ai/core
      let decision: AuthorityDecision;
      try {
        decision = evaluateAuthority(toolName, params, constitution);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(
          `[sanna] Authority evaluation error for ${toolName}: ${msg}`
        );
        if (isEnforceMode) {
          return {
            block: true,
            blockReason: "Governance enforcement error — evaluation failed",
          };
        }
        return undefined;
      }

      // Build checks array: authority check + invariant checks
      const authorityCheck: CheckResult = {
        check_id: "AUTHORITY",
        name: "Authority Boundary Evaluation",
        passed: decision.decision === "allow",
        severity: decision.decision === "allow" ? "info" : "critical",
        status: decision.decision === "allow" ? "PASS" : "FAIL",
        evidence: `${decision.boundary_type}: ${decision.reason}`,
      };

      const checks: CheckResult[] = [authorityCheck];

      // Run constitution invariant checks on tool params
      try {
        const invariantDefs = loadInvariantChecks(constitution);
        if (invariantDefs.length > 0) {
          const output = JSON.stringify(params);
          const context = `tool:${toolName} params:${Object.keys(params).join(",")}`;
          const invariantResults = runAllInvariantChecks(
            constitution,
            output,
            context
          );
          checks.push(...invariantResults);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.warn(
          `[sanna] Invariant check error for ${toolName}: ${msg}`
        );
      }

      // Compute evaluation coverage
      const evaluation_coverage = {
        checks_run: checks.length,
        checks_passed: checks.filter((c) => c.passed).length,
        checks_failed: checks.filter((c) => !c.passed).length,
        coverage_pct: checks.length > 0 ? 100 : 0,
      };

      // Generate receipt for EVERY decision
      const correlationId = `${toolName}-${Date.now()}`;
      let receipt: Record<string, unknown>;
      try {
        receipt = generateReceipt({
          correlation_id: correlationId,
          inputs: { tool: toolName, params },
          outputs: {
            verdict: decision.decision,
            reason: decision.reason,
            boundary_type: decision.boundary_type,
          },
          checks,
          constitution_ref: {
            document_id: constitution.identity.agent_name,
            policy_hash: constitution.policy_hash ?? "",
          },
          enforcement: {
            action: toolName,
            reason: decision.reason,
            failed_checks: decision.decision !== "allow"
              ? [`${decision.boundary_type}: ${decision.reason}`]
              : [],
            enforcement_mode: config.enforcementMode ?? "enforce",
            timestamp: new Date().toISOString(),
          },
          evaluation_coverage,
        }) as unknown as Record<string, unknown>;

        if (privateKey) {
          receipt = signReceipt(receipt, privateKey, "sanna-openclaw");
        }

        // Write-ahead: persist BEFORE returning verdict
        store.save(receipt);

        // Fire-and-forget OTel export after successful persistence
        if (deps.otelExporter) {
          try {
            deps.otelExporter.exportReceipt(receipt);
          } catch {
            // Best effort — OTel export must never block enforcement
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(
          `[sanna] Receipt generation/persistence failed for ${toolName}: ${msg}`
        );
        if (isEnforceMode) {
          return {
            block: true,
            blockReason:
              "Governance enforcement error — receipt persistence failed",
          };
        }
        return undefined;
      }

      const receiptId = (receipt.receipt_id as string) ?? "";
      const agentId = (ctx?.agentId as string) ?? "";
      const sessionId = (ctx?.sessionKey as string) ?? "";

      // Store for after_tool_call observability
      lastReceipt = {
        receiptId,
        tool: toolName,
        verdict: decision.decision,
      };

      if (decision.decision === "allow") {
        api.logger.info(
          `[sanna] ALLOW ${toolName} (receipt: ${receiptId.slice(0, 8)}...) agent=${agentId} session=${sessionId}`
        );
        return { blocked: false };
      }

      if (decision.decision === "escalate") {
        const blockMsg = `Requires approval: ${decision.reason} (receipt: ${receiptId})`;
        api.logger.warn(`[sanna] ESCALATE ${toolName}: ${decision.reason}`);
        if (isEnforceMode) {
          return { block: true, blockReason: blockMsg };
        }
        return undefined;
      }

      // halt / deny → block
      const blockMsg = `Blocked by governance: ${decision.reason} (receipt: ${receiptId})`;
      api.logger.warn(`[sanna] DENY ${toolName}: ${decision.reason}`);
      if (isEnforceMode) {
        return { block: true, blockReason: blockMsg };
      }
      return undefined;
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

  api.on(
    "after_tool_call",
    (..._args: unknown[]) => {
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
  // tool_result_persist — receipt annotation
  // ---------------------------------------------------------------------------

  api.on(
    "tool_result_persist",
    (result: unknown) => {
      if (result == null || typeof result !== "object") return undefined;

      const obj = result as Record<string, unknown>;
      if (!obj._sanna_receipt_hash) return undefined;

      const receiptHash = obj._sanna_receipt_hash as string;

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

      delete annotated._sanna_receipt_hash;
      return annotated;
    },
    {
      name: "sanna.tool-result-persist",
      description: "Annotates tool results with Sanna governance receipts",
    }
  );
}
