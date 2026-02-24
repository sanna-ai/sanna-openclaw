/**
 * HTTP client for communicating with the Python sidecar.
 *
 * Every public method absorbs errors and returns a halt-equivalent response.
 * The sidecar being unreachable NEVER results in an undefined or thrown error
 * reaching the caller — it always results in a halt verdict or safe default.
 */

import type {
  EnforceRequest,
  EnforceResponse,
  AuditRequest,
  AuditResponse,
  StatusResponse,
  ReceiptSummary,
  Receipt,
} from "./types.js";

const TIMEOUT_MS = 5_000;

const HALT_ENFORCE: EnforceResponse = {
  verdict: "halt",
  reason: "Sanna sidecar unreachable",
  failed_checks: ["SIDECAR_UNAVAILABLE"],
};

const HALT_AUDIT: AuditResponse = {
  receipt_id: null,
  status: "sidecar_unavailable",
};

const HALT_STATUS: StatusResponse = {
  constitution: null,
  enforcement_stats: { total: 0, allowed: 0, halted: 0, escalated: 0 },
  sidecar_version: "unavailable",
};

export class SidecarClient {
  private baseUrl: string;
  private healthy = false;
  private cachedVersion = "unknown";

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`;
  }

  /** POST /enforce — evaluate a tool call against the constitution */
  async enforce(req: EnforceRequest): Promise<EnforceResponse> {
    let res: Response;
    try {
      res = await fetchWithTimeout(`${this.baseUrl}/enforce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
    } catch {
      this.healthy = false;
      return HALT_ENFORCE;
    }

    if (!res.ok) {
      this.healthy = false;
      return {
        verdict: "halt",
        reason: `Sidecar returned HTTP ${res.status}`,
        failed_checks: ["SIDECAR_HTTP_ERROR"],
      };
    }

    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      this.healthy = false;
      return {
        verdict: "halt",
        reason: "Sidecar returned invalid JSON",
        failed_checks: ["SIDECAR_PARSE_ERROR"],
      };
    }

    return mapEnforceResponse(body);
  }

  /** POST /audit — generate a post-execution receipt */
  async audit(req: AuditRequest): Promise<AuditResponse> {
    let res: Response;
    try {
      res = await fetchWithTimeout(`${this.baseUrl}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
    } catch {
      this.healthy = false;
      return HALT_AUDIT;
    }

    if (!res.ok) {
      this.healthy = false;
      return HALT_AUDIT;
    }

    try {
      const body = (await res.json()) as Record<string, unknown>;
      return {
        receipt_id: (body.receipt_id as string) ?? null,
        status: "ok",
      };
    } catch {
      this.healthy = false;
      return HALT_AUDIT;
    }
  }

  /** GET /status — constitution summary + enforcement stats */
  async status(): Promise<StatusResponse> {
    let res: Response;
    try {
      res = await fetchWithTimeout(`${this.baseUrl}/status`);
    } catch {
      this.healthy = false;
      return HALT_STATUS;
    }

    if (!res.ok) {
      this.healthy = false;
      return HALT_STATUS;
    }

    try {
      const body = (await res.json()) as Record<string, unknown>;
      return mapStatusResponse(body, this.cachedVersion);
    } catch {
      this.healthy = false;
      return HALT_STATUS;
    }
  }

  /** GET /receipts — query receipts with optional filters */
  async receipts(filters?: {
    tool?: string;
    verdict?: string;
    limit?: number;
  }): Promise<ReceiptSummary[]> {
    const query = new URLSearchParams();
    if (filters?.tool) query.set("tool", filters.tool);
    if (filters?.verdict) query.set("verdict", filters.verdict);
    if (filters?.limit) query.set("limit", String(filters.limit));

    const qs = query.toString();
    const url = qs ? `${this.baseUrl}/receipts?${qs}` : `${this.baseUrl}/receipts`;

    let res: Response;
    try {
      res = await fetchWithTimeout(url);
    } catch {
      this.healthy = false;
      return [];
    }

    if (!res.ok) {
      this.healthy = false;
      return [];
    }

    try {
      const body = (await res.json()) as Record<string, unknown>[];
      return body.map(mapReceiptSummary);
    } catch {
      this.healthy = false;
      return [];
    }
  }

  /** GET /health — liveness probe, sets healthy flag */
  async health(): Promise<boolean> {
    let res: Response;
    try {
      res = await fetchWithTimeout(`${this.baseUrl}/health`);
    } catch {
      this.healthy = false;
      return false;
    }

    if (!res.ok) {
      this.healthy = false;
      return false;
    }

    try {
      const body = (await res.json()) as Record<string, unknown>;
      const status = body.status as string;
      this.healthy = status === "ok";
      if (body.version) {
        this.cachedVersion = body.version as string;
      }
      return this.healthy;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  /** Returns true if the last health check succeeded */
  isHealthy(): boolean {
    return this.healthy;
  }
}

// ---------------------------------------------------------------------------
// Response mappers — translate sidecar JSON to TypeScript interfaces
// ---------------------------------------------------------------------------

function mapEnforceResponse(body: Record<string, unknown>): EnforceResponse {
  const verdict = body.verdict as string;
  const reason = (body.reason as string) ?? "";
  const boundaryType = body.boundary_type as string | undefined;

  // Sidecar returns failed_checks as {id, section, description, effect}[]
  const rawChecks = (body.failed_checks ?? []) as Record<string, unknown>[];
  const failedChecks = rawChecks.map(
    (c) => (c.id as string) ?? String(c)
  );

  // Map receipt from sidecar's ReceiptSummary to our Receipt
  let receipt: Receipt | undefined;
  const rawReceipt = body.receipt as Record<string, unknown> | undefined;
  if (rawReceipt) {
    receipt = {
      id: (rawReceipt.receipt_id as string) ?? "",
      action: (rawReceipt.tool as string) ?? "",
      verdict: (rawReceipt.verdict as string) ?? verdict,
      reason,
      constitution_hash: (rawReceipt.constitution_hash as string) ?? "",
      boundary_type: (rawReceipt.boundary_type as string) ?? boundaryType,
      signature: (rawReceipt.signature as string) ?? undefined,
      timestamp: (rawReceipt.timestamp as string) ?? "",
    };
  }

  // Coerce verdict to our union type — unknown verdicts become "halt"
  const safeVerdict =
    verdict === "allow" || verdict === "escalate" ? verdict : "halt";

  return {
    verdict: safeVerdict,
    reason,
    boundary_type: boundaryType,
    failed_checks: failedChecks,
    receipt,
  };
}

function mapStatusResponse(
  body: Record<string, unknown>,
  sidecarVersion: string
): StatusResponse {
  const rawConst = body.constitution as Record<string, unknown> | undefined;
  let constitution: StatusResponse["constitution"] = null;

  if (rawConst && rawConst.loaded) {
    const counts = (rawConst.boundary_counts ?? {}) as Record<string, number>;
    constitution = {
      name: (rawConst.name as string) ?? "",
      version: (rawConst.version as string) ?? "",
      hash: (rawConst.hash as string) ?? "",
      boundaries: {
        can_execute: counts.can_execute ?? 0,
        must_escalate: counts.must_escalate ?? 0,
        cannot_execute: counts.cannot_execute ?? 0,
      },
    };
  }

  const rawStats = (body.enforcement_stats ?? {}) as Record<string, number>;

  return {
    constitution,
    enforcement_stats: {
      total: rawStats.total ?? 0,
      allowed: rawStats.allowed ?? 0,
      halted: rawStats.halted ?? 0,
      escalated: rawStats.escalated ?? 0,
    },
    sidecar_version: sidecarVersion,
  };
}

function mapReceiptSummary(raw: Record<string, unknown>): ReceiptSummary {
  return {
    id: (raw.receipt_id as string) ?? "",
    tool: (raw.tool as string) ?? "",
    verdict: (raw.verdict as string) ?? "",
    timestamp: (raw.timestamp as string) ?? "",
  };
}

// ---------------------------------------------------------------------------
// Fetch with timeout
// ---------------------------------------------------------------------------

function fetchWithTimeout(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}
