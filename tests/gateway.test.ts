import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";
import { registerGatewayMethods, type GatewayDeps } from "../src/gateway.js";

// ---------------------------------------------------------------------------
// Mock @sanna-ai/core ReceiptStore
// ---------------------------------------------------------------------------

const mockStoreCount = vi.fn(() => 0);
const mockStoreQuery = vi.fn(() => []);

vi.mock("@sanna-ai/core", () => ({
  ReceiptStore: vi.fn(),
}));

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
    on: vi.fn(),
    registerGatewayMethod(name: string, handler: GatewayHandler) {
      methods.set(name, handler);
    },
    registerCli: vi.fn(),
    config: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const DEFAULT_CONFIG: SannaConfig = {
  enforcementMode: "enforce",
  governedTools: ["exec", "write"],
};

const fakeDeps: GatewayDeps = {
  constitution: {
    schema_version: "0.1.0",
    identity: { agent_name: "test-agent", domain: "testing", description: "test", extensions: {} },
    provenance: { authored_by: "test", approved_by: [], approval_date: "", approval_method: "", change_history: [], signature: null },
    boundaries: [],
    trust_tiers: { autonomous: [], requires_approval: [], prohibited: [] },
    halt_conditions: [],
    invariants: [],
    policy_hash: "hash-abc",
    authority_boundaries: null,
    trusted_sources: null,
  } as GatewayDeps["constitution"],
  store: {
    count: mockStoreCount,
    query: mockStoreQuery,
    save: vi.fn(),
    close: vi.fn(),
  } as unknown as GatewayDeps["store"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreCount.mockReturnValue(0);
  mockStoreQuery.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// sanna.status
// ---------------------------------------------------------------------------

describe("sanna.status", () => {
  it("registers the method", () => {
    const api = createMockApi();
    registerGatewayMethods(api, DEFAULT_CONFIG, fakeDeps);
    expect(api._methods.has("sanna.status")).toBe(true);
  });

  it("returns status with constitution info and stats", async () => {
    const api = createMockApi();
    mockStoreCount.mockReturnValueOnce(10).mockReturnValueOnce(8).mockReturnValueOnce(2);
    registerGatewayMethods(api, DEFAULT_CONFIG, fakeDeps);

    const respond = vi.fn();
    await api._methods.get("sanna.status")!({ respond });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        mode: "enforce",
        constitution: expect.objectContaining({
          name: "test-agent",
        }),
        governedTools: ["exec", "write"],
        enforcement_stats: { total: 10, allowed: 8, denied: 2, escalated: 0 },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// sanna.audit
// ---------------------------------------------------------------------------

describe("sanna.audit", () => {
  it("registers the method", () => {
    const api = createMockApi();
    registerGatewayMethods(api, DEFAULT_CONFIG, fakeDeps);
    expect(api._methods.has("sanna.audit")).toBe(true);
  });

  it("returns receipts from store", async () => {
    const api = createMockApi();
    const receipts = [{ receipt_id: "r-1", tool: "exec" }];
    mockStoreQuery.mockReturnValue(receipts);
    registerGatewayMethods(api, DEFAULT_CONFIG, fakeDeps);

    const respond = vi.fn();
    await api._methods.get("sanna.audit")!({ respond });

    expect(respond).toHaveBeenCalledWith(true, receipts);
  });

  it("returns error when query fails", async () => {
    const api = createMockApi();
    mockStoreQuery.mockImplementation(() => {
      throw new Error("DB error");
    });
    registerGatewayMethods(api, DEFAULT_CONFIG, fakeDeps);

    const respond = vi.fn();
    await api._methods.get("sanna.audit")!({ respond });

    expect(respond).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ error: "Receipt query failed" })
    );
  });
});
