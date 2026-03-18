/**
 * Plugin hooks — primary enforcement point for Sanna governance.
 *
 * before_tool_call — PRIMARY enforcement. Fires for every tool call in the
 * agent loop. Evaluates authority via @sanna-ai/core and blocks or allows.
 * For halt/escalate: generates receipt immediately (tool never runs).
 * For allow: stores partial triad state for after_tool_call completion.
 *
 * after_tool_call — completes the Receipt Triad for allowed actions by
 * computing action_hash from the actual tool result and generating the receipt.
 *
 * tool_result_persist — stamps receipt metadata onto results for transcript.
 */

import { randomUUID } from "node:crypto";
import type { SannaConfig, PluginAPI } from "./types.js";
import type {
  Constitution,
  AuthorityDecision,
  CheckResult,
  ReceiptSink,
} from "@sanna-ai/core";
import {
  evaluateAuthority,
  generateReceipt,
  signReceipt,
  loadInvariantChecks,
  runAllInvariantChecks,
  hashObj,
  hashContent,
  EMPTY_HASH,
} from "@sanna-ai/core";
import type { KeyObject } from "node:crypto";

export interface OtelExporter {
  exportReceipt(receipt: Record<string, unknown>): void;
}

export interface HookDeps {
  constitution: Constitution;
  sink: ReceiptSink;
  privateKey: KeyObject | null;
  otelExporter?: OtelExporter | null;
  workflowId?: string;
}

/** Tools where the plugin observes actual execution output (not gateway proxy). */
const DIRECT_EXEC_TOOLS = ["exec", "bash", "shell", "run_command", "execute"];

/**
 * Extracts a safe, bounded summary of the tool result for receipt outputs.
 * Does not include raw content that might contain PII — just structure metadata.
 */
function summarizeResult(result: unknown): Record<string, unknown> {
  if (result === null || result === undefined) {
    return { type: "null" };
  }
  if (typeof result !== "object") {
    return { type: typeof result, length: String(result).length };
  }
  if (Array.isArray(result)) {
    return { type: "array", length: result.length };
  }
  const obj = result as Record<string, unknown>;
  const keys = Object.keys(obj);
  const summary: Record<string, unknown> = { type: "object", keys: keys.slice(0, 20) };
  if (Array.isArray(obj.content)) {
    summary.content_length = obj.content.length;
  }
  return summary;
}

/** Pending receipt state stored between before_tool_call and after_tool_call. */
interface PendingReceipt {
  correlationId: string;
  toolName: string;
  params: Record<string, unknown>;
  decision: AuthorityDecision;
  checks: CheckResult[];
  evaluationCoverage: Record<string, unknown>;
  parentReceipts: string[] | null;
  inputHash: string;
  reasoningHash: string;
  failedInvariantIds: string[];
  invariantHaltDescription: string | null;
}

export function registerHooks(
  api: PluginAPI,
  config: SannaConfig,
  deps: HookDeps
): void {
  const { constitution, sink, privateKey } = deps;
  const isEnforceMode = config.enforcementMode === "enforce";
  const workflowId = deps.workflowId ?? randomUUID();

  // Pending receipt for allowed actions — completed in after_tool_call
  let pendingReceipt: PendingReceipt | null = null;

  // Track last completed receipt for receipt chaining (parent_receipts)
  let lastReceipt: {
    receiptId: string;
    fingerprint: string;
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
        status: (decision.decision === "allow" ? null : "FAILED") as string | undefined,
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
                  check.status = "FAILED";
                  check.evidence = `Parameter matched denied pattern: ${hit[0]}`;
                } else {
                  check.passed = true;
                  check.status = null as unknown as string | undefined;
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

      // Built-in shell injection check for exec/bash tools
      // Defense in depth: runs even without a constitution invariant
      if (DIRECT_EXEC_TOOLS.includes(toolName) && decision.decision === "allow") {
        const cmdStr =
          (params.command as string) ??
          (params.cmd as string) ??
          (typeof params === "string" ? params : "");

        const SHELL_OPS = /[;|&`]|\$\(/;
        if (cmdStr && SHELL_OPS.test(cmdStr)) {
          if (isEnforceMode) {
            decision = {
              decision: "halt",
              reason: `Shell operators detected in ${toolName} parameters: built-in safety check. Use individual commands instead of shell pipelines.`,
              boundary_type: decision.boundary_type,
            };
            invariantHaltDescription =
              "Shell operators detected in exec tool parameters";
          } else {
            api.logger.warn(
              `[sanna] Shell operators detected in ${toolName} params (audit mode, not blocking)`
            );
          }
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

      // Compute evaluation coverage (schema: total_invariants, evaluated, not_checked, coverage_basis_points)
      const evaluation_coverage = {
        total_invariants: checks.length,
        evaluated: checks.length,
        not_checked: 0,
        coverage_basis_points: checks.length > 0 ? 10000 : 0,
      };

      // Receipt chaining: parent_receipts from prior receipt fingerprint
      // Must be null (not []) when no parent — they produce different fingerprints
      const parentReceipts = lastReceipt?.fingerprint
        ? [lastReceipt.fingerprint]
        : null;

      // Compute triad hashes (shared by halt/escalate and allow paths)
      const argsClean = { ...params };
      delete argsClean._justification;
      const inputObj = { args: argsClean, tool: toolName };
      const inputHash = hashObj(inputObj);

      const justification = (params._justification as string) ?? "";
      const reasoningHash = justification ? hashContent(justification) : EMPTY_HASH;

      const correlationId = `${toolName}-${Date.now()}`;

      // -----------------------------------------------------------------------
      // HALT or ESCALATE — tool will NOT execute. Generate receipt now.
      // -----------------------------------------------------------------------
      if (decision.decision !== "allow") {
        const eventType = decision.decision === "halt"
          ? "invocation_halted"
          : "invocation_escalated";

        let receipt: Record<string, unknown>;
        try {
          // TODO: Remove `as any` once @sanna-ai/core types include triad fields (D4/D5).
          // Extra fields pass through via the index signature on Receipt.
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
              action: decision.decision === "escalate" ? "escalated" : "halted",
              reason: decision.reason,
              failed_checks: [
                `${decision.boundary_type}: ${decision.reason}`,
                ...failedInvariantIds,
              ],
              enforcement_mode: config.enforcementMode === "enforce" ? "halt"
                : config.enforcementMode === "audit" ? "warn"
                : "log",
              timestamp: new Date().toISOString(),
            },
            evaluation_coverage,
            parent_receipts: parentReceipts,
            workflow_id: workflowId,
            content_mode: config.contentMode && config.contentMode !== "full" ? config.contentMode : undefined,
            content_mode_source: config.contentMode && config.contentMode !== "full" ? "local_config" : undefined,
            event_type: eventType,
            context_limitation: "gateway_boundary",
            input_hash: inputHash,
            reasoning_hash: reasoningHash,
            action_hash: EMPTY_HASH,
            assurance: "partial",
          } as any) as unknown as Record<string, unknown>;

          if (privateKey) {
            receipt = signReceipt(receipt, privateKey, "sanna-openclaw");
          }

          // Write-ahead: persist BEFORE returning verdict
          const sinkResult = await sink.store(receipt as Parameters<typeof sink.store>[0]);
          if (!sinkResult.success) {
            throw new Error(sinkResult.error ?? "Sink store failed");
          }

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
        const fingerprint = (receipt.receipt_fingerprint as string) ?? "";

        // Store for receipt chaining
        lastReceipt = {
          receiptId,
          fingerprint,
          tool: toolName,
          verdict: decision.decision,
        };

        // Clear any stale pending receipt
        pendingReceipt = null;

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
      }

      // -----------------------------------------------------------------------
      // ALLOW — tool WILL execute. Store partial state for after_tool_call.
      // Receipt generation deferred until after_tool_call where we have the
      // actual tool result for action_hash computation.
      // -----------------------------------------------------------------------
      pendingReceipt = {
        correlationId,
        toolName,
        params,
        decision,
        checks,
        evaluationCoverage: evaluation_coverage,
        parentReceipts,
        inputHash,
        reasoningHash,
        failedInvariantIds,
        invariantHaltDescription,
      };

      const agentId = (ctx?.agentId as string) ?? "";
      const sessionId = (ctx?.sessionKey as string) ?? "";
      api.logger.info(
        `[sanna] ALLOW ${toolName} (pending receipt) agent=${agentId} session=${sessionId}`
      );
      return { blocked: false };
    },
    {
      name: "sanna.before-tool-call",
      description:
        "Sanna governance enforcement — evaluates every tool call against the constitution",
    }
  );

  // ---------------------------------------------------------------------------
  // after_tool_call — Receipt Triad completion for allowed actions
  // ---------------------------------------------------------------------------

  api.on(
    "after_tool_call",
    async (...args: unknown[]) => {
      if (!pendingReceipt) {
        // No pending receipt: tool was blocked (receipt already generated)
        // or something unexpected. Nothing to do.
        return;
      }

      const pending = pendingReceipt;
      pendingReceipt = null;

      // Extract tool result from args
      // OpenClaw passes the tool result as the first argument
      const event = args[0] as Record<string, unknown> | undefined;
      const result = event?.result ?? event ?? null;

      // Compute action_hash from the actual tool result
      let actionHash: string;
      try {
        if (result !== null && result !== undefined) {
          actionHash = hashObj(result as Record<string, unknown>);
        } else {
          actionHash = EMPTY_HASH;
        }
      } catch {
        actionHash = EMPTY_HASH;
      }

      // Determine event_type and context_limitation
      const eventType = "invocation_allowed";
      const contextLimitation = DIRECT_EXEC_TOOLS.includes(pending.toolName)
        ? "cli_execution"
        : "gateway_boundary";
      const assurance = pending.reasoningHash !== EMPTY_HASH ? "full" : "partial";

      // Generate complete receipt with real action_hash
      let receipt: Record<string, unknown>;
      try {
        // TODO: Remove `as any` once @sanna-ai/core types include triad fields (D4/D5).
        receipt = generateReceipt({
          correlation_id: pending.correlationId,
          inputs: { tool: pending.toolName, params: pending.params },
          outputs: {
            verdict: pending.decision.decision,
            reason: pending.decision.reason,
            boundary_type: pending.decision.boundary_type,
            result_summary: summarizeResult(result),
          },
          checks: pending.checks,
          constitution_ref: {
            document_id: constitution.identity.agent_name,
            policy_hash: constitution.policy_hash ?? "",
          },
          enforcement: {
            action: "allowed",
            reason: pending.decision.reason,
            failed_checks: pending.failedInvariantIds,
            enforcement_mode: config.enforcementMode === "enforce" ? "halt"
              : config.enforcementMode === "audit" ? "warn"
              : "log",
            timestamp: new Date().toISOString(),
          },
          evaluation_coverage: pending.evaluationCoverage,
          parent_receipts: pending.parentReceipts,
          workflow_id: workflowId,
          content_mode: config.contentMode && config.contentMode !== "full" ? config.contentMode : undefined,
          content_mode_source: config.contentMode && config.contentMode !== "full" ? "local_config" : undefined,
          event_type: eventType,
          context_limitation: contextLimitation,
          input_hash: pending.inputHash,
          reasoning_hash: pending.reasoningHash,
          action_hash: actionHash,
          assurance,
        } as any) as unknown as Record<string, unknown>;

        if (privateKey) {
          receipt = signReceipt(receipt, privateKey, "sanna-openclaw");
        }

        const sinkResult = await sink.store(receipt as Parameters<typeof sink.store>[0]);
        if (!sinkResult.success) {
          api.logger.error(
            `[sanna] after_tool_call: receipt persistence failed: ${sinkResult.error}`
          );
        }

        if (deps.otelExporter) {
          try { deps.otelExporter.exportReceipt(receipt); } catch { /* best effort */ }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.logger.error(
          `[sanna] after_tool_call: receipt generation failed for ${pending.toolName}: ${msg}`
        );
        return;
      }

      const receiptId = (receipt.receipt_id as string) ?? "";
      const fingerprint = (receipt.receipt_fingerprint as string) ?? "";

      // Update lastReceipt for chaining
      lastReceipt = {
        receiptId,
        fingerprint,
        tool: pending.toolName,
        verdict: pending.decision.decision,
      };

      api.logger.info(
        `[sanna] after_tool_call: ${pending.toolName} action_hash=${actionHash.slice(0, 8)}... receipt=${receiptId.slice(0, 8)}...`
      );
    },
    {
      name: "sanna.after-tool-call",
      description: "Sanna governance — completes receipt with action_hash from tool result",
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
