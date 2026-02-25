import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SannaConfig, EnforceResponse } from "../src/types.js";
import { enforce } from "../src/enforce.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SannaConfig = {
  sidecarPort: 18890,
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

  it("includes session in request when provided", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ decision: "allow" })
    );

    await enforce(DEFAULT_CONFIG, "exec", { command: "ls" }, undefined, "session-abc");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.session).toBe("session-abc");
  });

  it("omits session from request when not provided", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ decision: "allow" })
    );

    await enforce(DEFAULT_CONFIG, "exec", { command: "ls" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.session).toBeUndefined();
  });
});
