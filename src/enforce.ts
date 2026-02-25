/**
 * Sidecar communication + direct tool execution.
 *
 * enforce()           — POST to sidecar /enforce (fail closed on error)
 * directExecute()     — execute tool in-process (see execute.ts)
 * enforceAndExecute() — combined flow: enforce → deny/escalate/execute
 *
 * forward() is retained for potential future use but is not on the main path.
 */

import type {
  SannaConfig,
  EnforceRequest,
  EnforceResponse,
  ToolInvokeRequest,
  ToolResult,
} from "./types.js";
import { fetchWithTimeout, readGatewayToken } from "./http.js";
import { directExecute } from "./execute.js";

const SIDECAR_TIMEOUT_MS = 5_000;
const GATEWAY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// enforce — POST to sidecar /enforce
// ---------------------------------------------------------------------------

/** Evaluate a tool call against the constitution. Fail-closed on any error. */
export async function enforce(
  config: SannaConfig,
  tool: string,
  args: Record<string, unknown>,
  action?: string,
  session?: string
): Promise<EnforceResponse> {
  const port = config.sidecarPort ?? 18890;
  const url = `http://127.0.0.1:${port}/enforce`;

  const body: EnforceRequest = {
    tool,
    args,
    timestamp: new Date().toISOString(),
  };
  if (action !== undefined) body.action = action;
  if (session !== undefined) body.session = session;

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, SIDECAR_TIMEOUT_MS);

    if (!res.ok) {
      return {
        decision: "deny",
        reason: `Sidecar returned HTTP ${res.status}`,
      };
    }

    return mapSidecarResponse((await res.json()) as Record<string, unknown>);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      decision: "deny",
      reason: `Sidecar unreachable: ${msg}`,
    };
  }
}

// ---------------------------------------------------------------------------
// forward — POST to gateway /tools/invoke (retained, not on main path)
// ---------------------------------------------------------------------------

/** Forward a tool call to the Gateway. Throws on error. */
export async function forward(
  config: SannaConfig,
  tool: string,
  args: Record<string, unknown>,
  action?: string
): Promise<unknown> {
  const port = config.gatewayPort ?? 18789;
  const url = `http://127.0.0.1:${port}/tools/invoke`;

  const body: ToolInvokeRequest = { tool, args };
  if (action !== undefined) body.action = action;

  const token = config.gatewayToken || readGatewayToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }, GATEWAY_TIMEOUT_MS);

  if (!res.ok) {
    throw new Error(`Gateway returned HTTP ${res.status}: ${await res.text()}`);
  }

  return await res.json();
}

// ---------------------------------------------------------------------------
// enforceAndExecute — combined flow
// ---------------------------------------------------------------------------

/** Enforce via sidecar, then execute directly if allowed. */
export async function enforceAndExecute(
  config: SannaConfig,
  tool: string,
  args: Record<string, unknown>,
  action?: string,
  context?: { session?: string }
): Promise<ToolResult> {
  const response = await enforce(config, tool, args, action, context?.session);

  if (response.decision === "deny") {
    const denyResult: Record<string, unknown> = {
      content: [
        {
          type: "text",
          text: [
            "\u26D4 Sanna governance denied this action.",
            `Tool: ${tool}`,
            `Reason: ${response.reason ?? "No reason provided"}`,
            `Receipt: ${response.receipt_hash ?? "none"}`,
          ].join("\n"),
        },
      ],
    };
    if (response.receipt_hash) {
      denyResult._sanna_receipt_hash = response.receipt_hash;
    }
    return denyResult as unknown as ToolResult;
  }

  if (response.decision === "escalate") {
    const escResult: Record<string, unknown> = {
      content: [
        {
          type: "text",
          text: [
            "\u26A0\uFE0F Sanna governance requires escalation for this action.",
            `Tool: ${tool}`,
            `Reason: ${response.reason ?? "No reason provided"}`,
            `Receipt: ${response.receipt_hash ?? "none"}`,
            "Please request explicit user approval before proceeding.",
          ].join("\n"),
        },
      ],
    };
    if (response.receipt_hash) {
      escResult._sanna_receipt_hash = response.receipt_hash;
    }
    return escResult as unknown as ToolResult;
  }

  // decision === 'allow' — execute directly
  const result = directExecute(tool, args) as unknown as Record<string, unknown>;
  if (response.receipt_hash) {
    result._sanna_receipt_hash = response.receipt_hash;
  }
  return result as unknown as ToolResult;
}

// ---------------------------------------------------------------------------
// Map sidecar response format to our internal format
// ---------------------------------------------------------------------------

/**
 * The sidecar returns "verdict" (allow/halt/escalate) while our TS interface
 * uses "decision" (allow/deny/escalate). The sidecar returns "halt" where we
 * use "deny". Receipt hash is nested inside receipt.receipt_id.
 */
function mapSidecarResponse(raw: Record<string, unknown>): EnforceResponse {
  // If the response already has "decision" (e.g. from mocked tests), pass through
  if ("decision" in raw && !("verdict" in raw)) {
    return raw as unknown as EnforceResponse;
  }

  // Map sidecar format
  const verdict = (raw.verdict as string) ?? "halt";
  const decision = verdict === "halt" ? "deny" : verdict;

  const receipt = raw.receipt as Record<string, unknown> | undefined;
  const receiptHash = receipt?.receipt_id as string | undefined;

  return {
    decision: decision as EnforceResponse["decision"],
    reason: raw.reason as string | undefined,
    receipt,
    receipt_hash: receiptHash,
    constitution_id: receipt?.constitution_hash as string | undefined,
  };
}
