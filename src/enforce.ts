/**
 * Sidecar communication.
 *
 * enforce() — POST to sidecar /enforce (fail closed on error)
 */

import type {
  SannaConfig,
  EnforceRequest,
  EnforceResponse,
} from "./types.js";
import { fetchWithTimeout } from "./http.js";

const SIDECAR_TIMEOUT_MS = 5_000;

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
