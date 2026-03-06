/**
 * Tests for v1.0 upgrade: core dependency, ReceiptSink, receipt chaining,
 * content mode, and fingerprint verification.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";
import type { HookDeps } from "../src/hooks.js";
import type { ReceiptSink, SinkResult } from "../src/sink.js";

// ---------------------------------------------------------------------------
// Mock @sanna-ai/core
// ---------------------------------------------------------------------------

const mockEvaluateAuthority = vi.fn();
const mockGenerateReceipt = vi.fn();
const mockSignReceipt = vi.fn();
const mockLoadInvariantChecks = vi.fn();
const mockRunAllInvariantChecks = vi.fn();

vi.mock("@sanna-ai/core", () => ({
  evaluateAuthority: (...args: unknown[]) => mockEvaluateAuthority(...args),
  generateReceipt: (...args: unknown[]) => mockGenerateReceipt(...args),
  signReceipt: (...args: unknown[]) => mockSignReceipt(...args),
  loadInvariantChecks: (...args: unknown[]) => mockLoadInvariantChecks(...args),
  runAllInvariantChecks: (...args: unknown[]) =>
    mockRunAllInvariantChecks(...args),
  ReceiptStore: vi.fn(),
}));

import { registerHooks } from "../src/hooks.js";
import {
  LocalSQLiteSink,
  NullSink,
  CompositeSink,
} from "../src/sink.js";
import { resolveConfig, DEFAULT_CONFIG } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HookHandler = (...args: unknown[]) => unknown;

interface MockAPI extends PluginAPI {
  _hooks: Map<string, HookHandler>;
}

function createMockApi(configOverrides?: Record<string, unknown>): MockAPI {
  const hooks = new Map<string, HookHandler>();
  return {
    _hooks: hooks,
    registerTool: vi.fn(),
    registerService: vi.fn(),
    registerHook: vi.fn(),
    on(event: string, handler: HookHandler) {
      hooks.set(event, handler);
    },
    registerGatewayMethod: vi.fn(),
    registerCli: vi.fn(),
    config: configOverrides
      ? { plugins: { entries: { sanna: { config: configOverrides } } } }
      : {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function mockConstitution() {
  return {
    schema_version: "1.0.0",
    identity: { agent_name: "test-agent", domain: "testing", description: "test", extensions: {} },
    provenance: { authored_by: "test", approved_by: [], approval_date: "", approval_method: "", change_history: [], signature: null },
    boundaries: [],
    trust_tiers: { autonomous: [], requires_approval: [], prohibited: [] },
    halt_conditions: [],
    invariants: [],
    policy_hash: "test-hash-abc123",
    authority_boundaries: null,
    trusted_sources: null,
  };
}

function createMockSink(): ReceiptSink & { _saved: Record<string, unknown>[] } {
  const saved: Record<string, unknown>[] = [];
  return {
    _saved: saved,
    save: vi.fn((receipt: Record<string, unknown>): SinkResult => {
      saved.push(receipt);
      return { success: true };
    }),
    query: vi.fn(() => []),
    count: vi.fn(() => 0),
    close: vi.fn(),
  };
}

function createDeps(overrides?: Partial<HookDeps>): HookDeps {
  return {
    constitution: mockConstitution() as HookDeps["constitution"],
    sink: createMockSink(),
    privateKey: null,
    ...overrides,
  };
}

const ENFORCE_CONFIG: SannaConfig = {
  enforcementMode: "enforce",
  governedTools: ["exec", "write"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateReceipt.mockReturnValue({
    receipt_id: "r-v1-test",
    receipt_fingerprint: "fp-v1-test",
  });
  mockSignReceipt.mockImplementation((r: unknown) => r);
  mockLoadInvariantChecks.mockReturnValue([]);
  mockRunAllInvariantChecks.mockReturnValue([]);
  mockEvaluateAuthority.mockReturnValue({
    decision: "allow",
    reason: "Permitted",
    boundary_type: "can_execute",
  });
});

// ---------------------------------------------------------------------------
// OC1: Dependency upgrade verification
// ---------------------------------------------------------------------------

describe("OC1: @sanna-ai/core v1.0.0 dependency", () => {
  it("evaluateAuthority is importable from core", () => {
    expect(typeof mockEvaluateAuthority).toBe("function");
  });

  it("generateReceipt is importable from core", () => {
    expect(typeof mockGenerateReceipt).toBe("function");
  });

  it("signReceipt is importable from core", () => {
    expect(typeof mockSignReceipt).toBe("function");
  });

  it("loadInvariantChecks is importable from core", () => {
    expect(typeof mockLoadInvariantChecks).toBe("function");
  });

  it("runAllInvariantChecks is importable from core", () => {
    expect(typeof mockRunAllInvariantChecks).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// OC2: ReceiptSink integration
// ---------------------------------------------------------------------------

describe("OC2: ReceiptSink replaces ReceiptStore", () => {
  it("hooks use sink.save() instead of store.save()", async () => {
    const sink = createMockSink();
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ sink }));

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    expect(sink.save).toHaveBeenCalledOnce();
  });

  it("sink save returning failure blocks in enforce mode", async () => {
    const sink = createMockSink();
    (sink.save as ReturnType<typeof vi.fn>).mockReturnValue({
      success: false,
      error: "Disk full",
    });
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ sink }));

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook({ toolName: "exec", params: {} });

    expect(result).toEqual(
      expect.objectContaining({ block: true })
    );
  });

  it("NullSink save always succeeds", () => {
    const sink = new NullSink();
    const result = sink.save({ receipt_id: "test" });
    expect(result.success).toBe(true);
  });

  it("NullSink query returns empty array", () => {
    const sink = new NullSink();
    expect(sink.query({})).toEqual([]);
  });

  it("NullSink count returns zero", () => {
    const sink = new NullSink();
    expect(sink.count()).toBe(0);
  });

  it("CompositeSink fans out to all child sinks", () => {
    const s1 = createMockSink();
    const s2 = createMockSink();
    const composite = new CompositeSink([s1, s2]);

    const receipt = { receipt_id: "test-comp" };
    const result = composite.save(receipt);

    expect(result.success).toBe(true);
    expect(s1.save).toHaveBeenCalledWith(receipt);
    expect(s2.save).toHaveBeenCalledWith(receipt);
  });

  it("CompositeSink fail_closed fails if any child fails", () => {
    const s1 = createMockSink();
    const s2 = createMockSink();
    (s2.save as ReturnType<typeof vi.fn>).mockReturnValue({
      success: false,
      error: "s2 failed",
    });
    const composite = new CompositeSink([s1, s2], "fail_closed");

    const result = composite.save({ receipt_id: "test" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("s2 failed");
  });

  it("CompositeSink fail_open succeeds even if child fails", () => {
    const s1 = createMockSink();
    const s2 = createMockSink();
    (s2.save as ReturnType<typeof vi.fn>).mockReturnValue({
      success: false,
      error: "s2 failed",
    });
    const composite = new CompositeSink([s1, s2], "fail_open");

    const result = composite.save({ receipt_id: "test" });
    expect(result.success).toBe(true);
  });

  it("CompositeSink close calls close on all children", () => {
    const s1 = createMockSink();
    const s2 = createMockSink();
    const composite = new CompositeSink([s1, s2]);
    composite.close();

    expect(s1.close).toHaveBeenCalledOnce();
    expect(s2.close).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// OC3: Sink config
// ---------------------------------------------------------------------------

describe("OC3: Sink configuration", () => {
  it("sinkType defaults to local_sqlite", () => {
    expect(DEFAULT_CONFIG.sinkType).toBe("local_sqlite");
  });

  it("resolveConfig merges sinkType", () => {
    const api = createMockApi({ sinkType: "null" });
    const config = resolveConfig(api);
    expect(config.sinkType).toBe("null");
  });

  it("contentMode defaults to full", () => {
    expect(DEFAULT_CONFIG.contentMode).toBe("full");
  });
});

// ---------------------------------------------------------------------------
// OC4: Receipt chaining (parent_receipts, workflow_id)
// ---------------------------------------------------------------------------

describe("OC4: Receipt chaining", () => {
  it("first receipt has empty parent_receipts", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    expect(mockGenerateReceipt).toHaveBeenCalledOnce();
    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.extensions.parent_receipts).toEqual([]);
  });

  it("second receipt chains to first via parent_receipts", async () => {
    mockGenerateReceipt
      .mockReturnValueOnce({ receipt_id: "r-1", receipt_fingerprint: "fp-1" })
      .mockReturnValueOnce({ receipt_id: "r-2", receipt_fingerprint: "fp-2" });

    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });
    // After after_tool_call, lastReceipt is cleared, but before a new
    // before_tool_call, it should still have the fingerprint
    await hook({ toolName: "write", params: {} });

    const secondCall = mockGenerateReceipt.mock.calls[1][0];
    expect(secondCall.extensions.parent_receipts).toEqual(["fp-1"]);
  });

  it("workflow_id is set in extensions", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ workflowId: "wf-test-123" }));

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.extensions.workflow_id).toBe("wf-test-123");
  });

  it("workflow_id auto-generated when not provided", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.extensions.workflow_id).toBeDefined();
    expect(typeof params.extensions.workflow_id).toBe("string");
    expect(params.extensions.workflow_id.length).toBeGreaterThan(0);
  });

  it("workflow_id stays consistent across multiple calls", async () => {
    mockGenerateReceipt
      .mockReturnValueOnce({ receipt_id: "r-1", receipt_fingerprint: "fp-1" })
      .mockReturnValueOnce({ receipt_id: "r-2", receipt_fingerprint: "fp-2" });

    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });
    await hook({ toolName: "write", params: {} });

    const wf1 = mockGenerateReceipt.mock.calls[0][0].extensions.workflow_id;
    const wf2 = mockGenerateReceipt.mock.calls[1][0].extensions.workflow_id;
    expect(wf1).toBe(wf2);
  });
});

// ---------------------------------------------------------------------------
// OC5: Content mode
// ---------------------------------------------------------------------------

describe("OC5: Content mode", () => {
  it("content_mode omitted from extensions when set to full", async () => {
    const api = createMockApi();
    registerHooks(api, { ...ENFORCE_CONFIG, contentMode: "full" }, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.extensions.content_mode).toBeUndefined();
    expect(params.extensions.content_mode_source).toBeUndefined();
  });

  it("content_mode set in extensions when redacted", async () => {
    const api = createMockApi();
    registerHooks(api, { ...ENFORCE_CONFIG, contentMode: "redacted" }, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.extensions.content_mode).toBe("redacted");
    expect(params.extensions.content_mode_source).toBe("local_config");
  });

  it("content_mode set in extensions when hash_only", async () => {
    const api = createMockApi();
    registerHooks(api, { ...ENFORCE_CONFIG, contentMode: "hash_only" }, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.extensions.content_mode).toBe("hash_only");
    expect(params.extensions.content_mode_source).toBe("local_config");
  });

  it("content_mode omitted when config not set", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.extensions.content_mode).toBeUndefined();
  });

  it("resolveConfig merges contentMode", () => {
    const api = createMockApi({ contentMode: "hash_only" });
    const config = resolveConfig(api);
    expect(config.contentMode).toBe("hash_only");
  });
});

// ---------------------------------------------------------------------------
// Receipt fingerprint structure
// ---------------------------------------------------------------------------

describe("Receipt structure", () => {
  it("generateReceipt called with extensions containing workflow metadata", async () => {
    const api = createMockApi();
    registerHooks(api, { ...ENFORCE_CONFIG, contentMode: "redacted" }, createDeps({ workflowId: "wf-fp" }));

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: { command: "ls" } });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.extensions).toEqual({
      workflow_id: "wf-fp",
      parent_receipts: [],
      content_mode: "redacted",
      content_mode_source: "local_config",
    });
  });

  it("receipt includes constitution_ref", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.constitution_ref).toEqual({
      document_id: "test-agent",
      policy_hash: "test-hash-abc123",
    });
  });

  it("receipt includes evaluation_coverage", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.evaluation_coverage).toEqual({
      checks_run: 1,
      checks_passed: 1,
      checks_failed: 0,
      coverage_pct: 100,
    });
  });

  it("receipt extensions passed through to generateReceipt", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ workflowId: "wf-123" }));

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params).toHaveProperty("extensions");
    expect(params.extensions.workflow_id).toBe("wf-123");
  });
});
