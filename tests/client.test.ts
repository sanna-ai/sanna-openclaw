import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SidecarClient } from "../src/client.js";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// enforce()
// ---------------------------------------------------------------------------

describe("enforce", () => {
  it("forwards request with correct URL, method, body, and headers", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        verdict: "allow",
        reason: "ok",
        boundary_type: "can_execute",
        failed_checks: [],
        receipt: null,
      })
    );

    const client = new SidecarClient("127.0.0.1", 18791);
    await client.enforce({ tool: "ls", args: { path: "/tmp" } });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:18791/enforce");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(init.body as string);
    expect(body.tool).toBe("ls");
    expect(body.args).toEqual({ path: "/tmp" });
  });

  it("returns parsed verdict and receipt from response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        verdict: "allow",
        reason: "Action matches can_execute rule: 'ls'",
        boundary_type: "can_execute",
        failed_checks: [],
        receipt: {
          receipt_id: "abc-123",
          tool: "ls",
          verdict: "allow",
          boundary_type: "can_execute",
          timestamp: "2024-01-01T00:00:00Z",
          constitution_hash: "deadbeef",
          signature: "sig123",
          key_id: "key456",
          signed: true,
        },
      })
    );

    const client = new SidecarClient("127.0.0.1", 18791);
    const result = await client.enforce({ tool: "ls", args: {} });

    expect(result.verdict).toBe("allow");
    expect(result.reason).toBe("Action matches can_execute rule: 'ls'");
    expect(result.receipt).toBeDefined();
    expect(result.receipt!.id).toBe("abc-123");
    expect(result.receipt!.action).toBe("ls");
    expect(result.receipt!.constitution_hash).toBe("deadbeef");
    expect(result.receipt!.signature).toBe("sig123");
  });

  it("returns halt when sidecar is down (fetch throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const client = new SidecarClient("127.0.0.1", 18791);
    const result = await client.enforce({ tool: "ls", args: {} });

    expect(result.verdict).toBe("halt");
    expect(result.reason).toBe("Sanna sidecar unreachable");
    expect(result.failed_checks).toContain("SIDECAR_UNAVAILABLE");
  });

  it("returns halt when fetch is aborted (timeout)", async () => {
    mockFetch.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    const client = new SidecarClient("127.0.0.1", 18791);
    const result = await client.enforce({ tool: "ls", args: {} });

    expect(result.verdict).toBe("halt");
    expect(result.failed_checks).toContain("SIDECAR_UNAVAILABLE");
  });

  it("returns halt on non-200 status", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ detail: "error" }, 500));

    const client = new SidecarClient("127.0.0.1", 18791);
    const result = await client.enforce({ tool: "ls", args: {} });

    expect(result.verdict).toBe("halt");
    expect(result.reason).toContain("500");
    expect(result.failed_checks).toContain("SIDECAR_HTTP_ERROR");
  });
});

// ---------------------------------------------------------------------------
// audit()
// ---------------------------------------------------------------------------

describe("audit", () => {
  it("forwards request with correct URL and body", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ receipt_id: "audit-001" })
    );

    const client = new SidecarClient("127.0.0.1", 18791);
    await client.audit({
      tool: "ls",
      args: { path: "/tmp" },
      result: "file1.txt",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:18791/audit");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.tool).toBe("ls");
    expect(body.result).toBe("file1.txt");
  });

  it("returns halt-equivalent when sidecar is down", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const client = new SidecarClient("127.0.0.1", 18791);
    const result = await client.audit({ tool: "ls", args: {} });

    expect(result.receipt_id).toBeNull();
    expect(result.status).toBe("sidecar_unavailable");
  });
});

// ---------------------------------------------------------------------------
// health()
// ---------------------------------------------------------------------------

describe("health", () => {
  it("sets healthy flag on successful health check", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "ok", version: "0.13.5" })
    );

    const client = new SidecarClient("127.0.0.1", 18791);
    expect(client.isHealthy()).toBe(false); // starts unhealthy

    const result = await client.health();

    expect(result).toBe(true);
    expect(client.isHealthy()).toBe(true);
  });

  it("clears healthy flag on failed health check", async () => {
    // First, make it healthy
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "ok", version: "0.13.5" })
    );
    const client = new SidecarClient("127.0.0.1", 18791);
    await client.health();
    expect(client.isHealthy()).toBe(true);

    // Now fail
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await client.health();

    expect(result).toBe(false);
    expect(client.isHealthy()).toBe(false);
  });
});
