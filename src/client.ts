/**
 * HTTP client for communicating with the Python sidecar.
 */

import type {
  EnforceRequest,
  EnforceResponse,
  AuditRequest,
  AuditResponse,
  HealthResponse,
  StatusResponse,
  Receipt,
  SidecarConfig,
} from "./types.js";

export class SidecarClient {
  private baseUrl: string;

  constructor(config: SidecarConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;
  }

  /** GET /health — liveness probe */
  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(`Sidecar health check failed: ${res.status}`);
    }
    return res.json() as Promise<HealthResponse>;
  }

  /** POST /enforce — evaluate a tool call against the constitution */
  async enforce(request: EnforceRequest): Promise<EnforceResponse> {
    const res = await fetch(`${this.baseUrl}/enforce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sidecar enforce failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<EnforceResponse>;
  }

  /** POST /audit — generate a post-execution receipt */
  async audit(request: AuditRequest): Promise<AuditResponse> {
    const res = await fetch(`${this.baseUrl}/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sidecar audit failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<AuditResponse>;
  }

  /** GET /status — constitution summary + enforcement stats */
  async status(): Promise<StatusResponse> {
    const res = await fetch(`${this.baseUrl}/status`);
    if (!res.ok) {
      throw new Error(`Sidecar status failed: ${res.status}`);
    }
    return res.json() as Promise<StatusResponse>;
  }

  /** GET /receipts — query receipts */
  async listReceipts(params?: {
    tool?: string;
    verdict?: string;
    limit?: number;
  }): Promise<Receipt[]> {
    const query = new URLSearchParams();
    if (params?.tool) query.set("tool", params.tool);
    if (params?.verdict) query.set("verdict", params.verdict);
    if (params?.limit) query.set("limit", String(params.limit));

    const qs = query.toString();
    const url = qs ? `${this.baseUrl}/receipts?${qs}` : `${this.baseUrl}/receipts`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Sidecar receipts query failed: ${res.status}`);
    }
    return res.json() as Promise<Receipt[]>;
  }

  /** POST /export — evidence bundle */
  async exportBundle(): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/export`, { method: "POST" });
    if (!res.ok) {
      throw new Error(`Sidecar export failed: ${res.status}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }
}
