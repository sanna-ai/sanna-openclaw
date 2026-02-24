import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SannaConfig, EnforceResponse } from "../src/types.js";
import { enforce, forward, enforceAndForward } from "../src/enforce.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SannaConfig = {
  sidecarPort: 18890,
  gatewayPort: 18789,
  gatewayToken: "test-token",
  enforcementMode: "enforce",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// enforce()
// ---------------------------------------------------------------------------

describe("enforce", () => {
  it("sends correct request shape to sidecar", async () => {
    const sidecarResponse: EnforceResponse = {
      decision: "allow",
      receipt_hash: "abc123",
      reason: "Permitted by constitution",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(sidecarResponse));

    const result = await enforce(DEFAULT_CONFIG, "exec", { command: "ls" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18890/enforce");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.tool).toBe("exec");
    expect(body.args).toEqual({ command: "ls" });
    expect(body.timestamp).toBeDefined();

    expect(result.decision).toBe("allow");
    expect(result.receipt_hash).toBe("abc123");
  });

  it("includes action in request when provided", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ decision: "allow" })
    );

    await enforce(DEFAULT_CONFIG, "browser", { url: "https://example.com" }, "navigate");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.action).toBe("navigate");
  });

  it("returns deny on sidecar timeout/error (fail closed)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await enforce(DEFAULT_CONFIG, "exec", { command: "ls" });

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("Sidecar unreachable");
    expect(result.reason).toContain("ECONNREFUSED");
  });

  it("returns deny on non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await enforce(DEFAULT_CONFIG, "exec", { command: "ls" });

    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("HTTP 500");
  });
});

// ---------------------------------------------------------------------------
// forward()
// ---------------------------------------------------------------------------

describe("forward", () => {
  it("sends correct request to /tools/invoke with auth header", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: [{ type: "text", text: "output" }] })
    );

    await forward(DEFAULT_CONFIG, "exec", { command: "ls" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18789/tools/invoke");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer test-token");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.tool).toBe("exec");
    expect(body.args).toEqual({ command: "ls" });
  });

  it("includes action in request when provided", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: [{ type: "text", text: "ok" }] })
    );

    await forward(DEFAULT_CONFIG, "browser", { url: "https://example.com" }, "navigate");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.action).toBe("navigate");
  });

  it("omits Authorization header when no token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ content: [{ type: "text", text: "ok" }] })
    );

    await forward({ ...DEFAULT_CONFIG, gatewayToken: "" }, "exec", { command: "ls" });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("throws on non-200 response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    await expect(
      forward(DEFAULT_CONFIG, "exec", { command: "ls" })
    ).rejects.toThrow("Gateway returned HTTP 404");
  });
});

// ---------------------------------------------------------------------------
// enforceAndForward()
// ---------------------------------------------------------------------------

describe("enforceAndForward", () => {
  it("returns denial ToolResult when sidecar says deny", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        decision: "deny",
        reason: "Action blocked by constitution",
        receipt_hash: "deny-hash-001",
      })
    );

    const result = await enforceAndForward(
      DEFAULT_CONFIG,
      "exec",
      { command: "rm -rf /" }
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text!;
    expect(text).toContain("denied");
    expect(text).toContain("exec");
    expect(text).toContain("Action blocked by constitution");
    expect(text).toContain("deny-hash-001");

    // Should NOT have made a second fetch for forwarding
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns escalation ToolResult when sidecar says escalate", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        decision: "escalate",
        reason: "Requires human approval",
        receipt_hash: "esc-hash-001",
      })
    );

    const result = await enforceAndForward(
      DEFAULT_CONFIG,
      "message",
      { to: "user@example.com" },
      "send"
    );

    expect(result.content).toHaveLength(1);
    const text = result.content[0].text!;
    expect(text).toContain("escalation");
    expect(text).toContain("message");
    expect(text).toContain("Requires human approval");
    expect(text).toContain("esc-hash-001");
    expect(text).toContain("user approval");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards and returns result when sidecar says allow", async () => {
    // First call: enforce → allow
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ decision: "allow", receipt_hash: "allow-hash-001" })
    );
    // Second call: forward → gateway response
    const gatewayResult = {
      content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(gatewayResult));

    const result = await enforceAndForward(
      DEFAULT_CONFIG,
      "exec",
      { command: "ls" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Gateway result is returned with receipt hash attached
    expect(result.content).toEqual(gatewayResult.content);
    expect((result as Record<string, unknown>)._sanna_receipt_hash).toBe(
      "allow-hash-001"
    );
  });

  it("attaches receipt hash to deny result", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        decision: "deny",
        reason: "Blocked",
        receipt_hash: "deny-receipt-001",
      })
    );

    const result = await enforceAndForward(DEFAULT_CONFIG, "exec", {
      command: "rm -rf /",
    });

    expect(
      (result as Record<string, unknown>)._sanna_receipt_hash
    ).toBe("deny-receipt-001");
  });

  it("attaches receipt hash to escalate result", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        decision: "escalate",
        reason: "Needs approval",
        receipt_hash: "esc-receipt-001",
      })
    );

    const result = await enforceAndForward(DEFAULT_CONFIG, "message", {
      to: "user@example.com",
    });

    expect(
      (result as Record<string, unknown>)._sanna_receipt_hash
    ).toBe("esc-receipt-001");
  });
});
