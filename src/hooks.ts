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
      let invariantDefs: unknown[] = [];
      try {
        invariantDefs = loadInvariantChecks(constitution) as unknown[];
        if (invariantDefs.length > 0) {
          const output = JSON.stringify(params);
          const context = `tool:${toolName} params:${Object.keys(params).join(",")}`;
          const invariantResults = runAllInvariantChecks(
            constitution,
            output,
            context
          );

          // Bug fix: core returns UNKNOWN_TYPE for regex_deny rules because
          // it has no regex evaluator. Evaluate them in-process for tools
          // where parameters could route around other controls.
          const REGEX_EVAL_TOOLS = ["exec", "bash", "read", "write", "web_fetch", "web_search", "browser"];
          if (REGEX_EVAL_TOOLS.includes(toolName)) {
            for (const check of invariantResults) {
              if (check.status !== "UNKNOWN_TYPE") continue;
              const def = invariantDefs.find(
                (d) =>
                  (d as Record<string, unknown>).id === check.check_id
              ) as Record<string, unknown> | undefined;
              if (!def) continue;

              // Scope check: applies_to limits which tools run this invariant.
              // Defaults to ["exec", "bash"] for backward compatibility.
              const appliesTo = (def.applies_to as string[] | undefined) ?? [
                "exec",
                "bash",
              ];
              if (!appliesTo.includes(toolName)) continue;

              const rule = def.rule as string | undefined;
              if (!rule?.startsWith("regex_deny pattern:")) continue;

              const regexStr = rule
                .slice("regex_deny pattern:".length)
                .trim();
              const parts = regexStr.match(/^\/(.+)\/([gimsuy]*)$/);
              if (!parts) continue;

              try {
                const regex = new RegExp(parts[1], parts[2]);
                // Extract primary matchable content from tool parameters.
                // Field-specific extraction avoids false positives from JSON
                // syntax. Falls back to full serialization for unknown structures.
                const p = params as Record<string, unknown>;
                const testStr =
                  (typeof p.command === "string" && p.command) ||
                  (typeof p.targetUrl === "string" && p.targetUrl) ||
                  (typeof p.url === "string" && p.url) ||
                  (typeof p.path === "string" && p.path) ||
                  (typeof p.query === "string" && p.query) ||
                  JSON.stringify(params);
                const hit = regex.exec(testStr);
                if (hit) {
                  check.passed = false;
                  check.status = "FAIL";
                  check.evidence = `Parameter matched denied pattern: ${hit[0]}`;
                } else {
                  check.passed = true;
                  check.status = "PASS";
                  check.evidence =
                    "Parameter did not match denied pattern";
                }
                check.enforcement_level = def.enforcement as string;
              } catch {
                // Invalid regex — leave as UNKNOWN_TYPE
              }
            }
          }

          checks.push(...invariantResults);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.warn(
          `[sanna] Invariant check error for ${toolName}: ${msg}`
        );
      }

      // Failed invariant checks with halt/escalate enforcement override the verdict
      let invariantHaltDescription: string | null = null;
      for (const check of checks) {
        if (check.check_id === "AUTHORITY") continue;
        if (check.passed || check.status === "UNKNOWN_TYPE") continue;

        const def = invariantDefs.find(
          (d) =>
            (d as Record<string, unknown>).id === check.check_id
        ) as Record<string, unknown> | undefined;

        let enfLevel = check.enforcement_level;
        if (!enfLevel && def) enfLevel = def.enforcement as string;

        if (enfLevel === "halt" && decision.decision === "allow") {
          invariantHaltDescription =
            (def?.description as string) || null;
          decision = {
            decision: "halt",
            reason: `Invariant ${check.check_id} failed: ${check.evidence}`,
            boundary_type: decision.boundary_type,
          };
          break;
        }

        // "warn" enforcement maps to escalate — core only accepts halt/warn/log,
        // so constitutions use "warn" for invariants that need human approval.
        if (enfLevel === "warn" && decision.decision === "allow") {
          const desc = (def?.description as string) || check.check_id;
          decision = {
            decision: "escalate",
            reason: `Invariant ${check.check_id}: ${desc}`,
            boundary_type: decision.boundary_type,
          };
          break;
        }
      }

      // Collect failed invariant check IDs for enforcement block
      const failedInvariantIds = checks
        .filter(
          (c) =>
            c.check_id !== "AUTHORITY" &&
            !c.passed &&
            c.status !== "UNKNOWN_TYPE"
        )
        .map((c) => c.check_id);

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
            failed_checks: [
              ...(decision.decision !== "allow"
                ? [`${decision.boundary_type}: ${decision.reason}`]
                : []),
              ...failedInvariantIds,
            ],
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
        const blockMsg = `Sanna requires approval: ${decision.reason} (receipt: ${receiptId})`;
        api.logger.warn(`[sanna] ESCALATE ${toolName}: ${decision.reason}`);
        if (isEnforceMode) {
          return { block: true, blockReason: blockMsg };
        }
        return undefined;
      }

      // halt / deny → block
      const blockMsg = invariantHaltDescription
        ? `Blocked by Sanna governance: ${invariantHaltDescription} (receipt: ${receiptId})`
        : `Blocked by Sanna governance: ${decision.reason} (receipt: ${receiptId})`;
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
