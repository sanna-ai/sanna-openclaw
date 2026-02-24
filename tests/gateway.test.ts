import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";
import { registerGatewayMethods } from "../src/gateway.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GatewayHandler = (ctx: {
  respond: (ok: boolean, payload: unknown) => void;
}) => void | Promise<void>;

interface MockAPI extends PluginAPI {
  _methods: Map<string, GatewayHandler>;
}

function createMockApi(): MockAPI {
  const methods = new Map<string, GatewayHandler>();
  return {
    _methods: methods,
    registerTool: vi.fn(),
    registerService: vi.fn(),
    registerHook: vi.fn(),
    registerGatewayMethod(name: string, handler: GatewayHandler) {
      methods.set(name, handler);
    },
    registerCli: vi.fn(),
    config: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const DEFAULT_CONFIG: SannaConfig = {
  sidecarPort: 18890,
  enforcementMode: "enforce",
  constitutionPath: "/path/to/constitution.yaml",
  governedTools: ["exec", "write"],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// sanna.status
// ---------------------------------------------------------------------------

describe("sanna.status", () => {
  it("registers the method", () => {
    const api = createMockApi();
    registerGatewayMethods(api, DEFAULT_CONFIG);
    expect(api._methods.has("sanna.status")).toBe(true);
  });

  it("returns status when sidecar is healthy", async () => {
    const api = createMockApi();
    registerGatewayMethods(api, DEFAULT_CONFIG);

    // health check
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "ok" }));
    // status call
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        constitution: { name: "test", version: "1.0" },
        enforcement_stats: { total: 5, allowed: 4, denied: 1 },
      })
    );

    const respond = vi.fn();
    await api._methods.get("sanna.status")!({ respond });

    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
      mode: "enforce",
      sidecar: "healthy",
      constitutionPath: "/path/to/constitution.yaml",
      governedTools: ["exec", "write"],
      constitution: { name: "test", version: "1.0" },
    }));
  });

  it("returns unreachable when sidecar is down", async () => {
    const api = createMockApi();
    registerGatewayMethods(api, DEFAULT_CONFIG);

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const respond = vi.fn();
    await api._methods.get("sanna.status")!({ respond });

    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({
      mode: "enforce",
      sidecar: "unreachable",
    }));
  });
});

// ---------------------------------------------------------------------------
// sanna.audit
// ---------------------------------------------------------------------------

describe("sanna.audit", () => {
  it("registers the method", () => {
    const api = createMockApi();
    registerGatewayMethods(api, DEFAULT_CONFIG);
    expect(api._methods.has("sanna.audit")).toBe(true);
  });

  it("proxies audit data from sidecar", async () => {
    const api = createMockApi();
    registerGatewayMethods(api, DEFAULT_CONFIG);

    const auditData = [
      { tool: "exec", decision: "allow", timestamp: "2026-01-01T00:00:00Z" },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(auditData));

    const respond = vi.fn();
    await api._methods.get("sanna.audit")!({ respond });

    expect(respond).toHaveBeenCalledWith(true, auditData);
  });

  it("returns error when sidecar is unreachable", async () => {
    const api = createMockApi();
    registerGatewayMethods(api, DEFAULT_CONFIG);

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const respond = vi.fn();
    await api._methods.get("sanna.audit")!({ respond });

    expect(respond).toHaveBeenCalledWith(false, expect.objectContaining({
      error: "Sidecar unreachable",
    }));
  });
});
