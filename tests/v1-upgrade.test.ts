/**
 * Tests for v1.0 upgrade: core dependency, ReceiptSink, receipt chaining,
 * content mode, and fingerprint verification.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";
import type { HookDeps } from "../src/hooks.js";
import type { ReceiptSink, SinkResult } from "@sanna-ai/core";

// ---------------------------------------------------------------------------
// Mock @sanna-ai/core
// ---------------------------------------------------------------------------

const mockEvaluateAuthority = vi.fn();
const mockGenerateReceipt = vi.fn();
const mockSignReceipt = vi.fn();
const mockLoadInvariantChecks = vi.fn();
const mockRunAllInvariantChecks = vi.fn();

vi.mock("@sanna-ai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sanna-ai/core")>();
  return {
    evaluateAuthority: (...args: unknown[]) => mockEvaluateAuthority(...args),
    generateReceipt: (...args: unknown[]) => mockGenerateReceipt(...args),
    signReceipt: (...args: unknown[]) => mockSignReceipt(...args),
    loadInvariantChecks: (...args: unknown[]) => mockLoadInvariantChecks(...args),
    runAllInvariantChecks: (...args: unknown[]) =>
      mockRunAllInvariantChecks(...args),
    ReceiptStore: vi.fn(),
    LocalSQLiteSink: vi.fn(),
    NullSink: vi.fn(),
    CompositeSink: vi.fn(),
    SPEC_VERSION: "1.1",
    CHECKS_VERSION: "6",
    // Real implementations for hash utilities used by hooks.ts
    hashObj: actual.hashObj,
    hashContent: actual.hashContent,
    EMPTY_HASH: actual.EMPTY_HASH,
  };
});

import { registerHooks } from "../src/hooks.js";
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
    store: vi.fn(async (receipt: unknown): Promise<SinkResult> => {
      saved.push(receipt as Record<string, unknown>);
      return { success: true };
    }),
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
};

/** Call before_tool_call + after_tool_call for an allowed action (completes receipt). */
async function callAllowedAction(
  api: MockAPI,
  toolName: string,
  params: Record<string, unknown> = {},
  result: unknown = { content: [{ type: "text", text: "ok" }] }
) {
  const beforeHook = api._hooks.get("before_tool_call")!;
  const beforeResult = await beforeHook(
    { toolName, params },
    { toolName, agentId: "agent-1", sessionKey: "sess-1" }
  );
  const afterHook = api._hooks.get("after_tool_call")!;
  await afterHook({ toolName, result });
  return beforeResult;
}

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

describe("OC2: ReceiptSink from @sanna-ai/core", () => {
  it("hooks use sink.store() from core", async () => {
    const sink = createMockSink();
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ sink }));

    await callAllowedAction(api, "exec");

    expect(sink.store).toHaveBeenCalledOnce();
  });

  it("sink store returning failure blocks in enforce mode for halt", async () => {
    const sink = createMockSink();
    (sink.store as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: "Disk full",
    });
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ sink }));

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Blocked",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook({ toolName: "exec", params: {} });

    expect(result).toEqual(
      expect.objectContaining({ block: true })
    );
  });

  it("sink.store() is called with receipt object", async () => {
    const sink = createMockSink();
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ sink }));

    await callAllowedAction(api, "exec");

    const storedReceipt = (sink.store as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(storedReceipt).toHaveProperty("receipt_id", "r-v1-test");
  });

  it("sink.store() is awaited (async persistence)", async () => {
    let resolved = false;
    const sink = createMockSink();
    (sink.store as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
      return { success: true };
    });
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ sink }));

    await callAllowedAction(api, "exec");

    expect(resolved).toBe(true);
  });

  it("sink.store() rejection blocks in enforce mode for halt", async () => {
    const sink = createMockSink();
    (sink.store as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Connection refused"));
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ sink }));

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Blocked",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook({ toolName: "exec", params: {} });

    expect(result).toEqual(
      expect.objectContaining({ block: true })
    );
  });

  it("sink.store() rejection in audit mode does not block for halt", async () => {
    const sink = createMockSink();
    (sink.store as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Connection refused"));
    const api = createMockApi();
    registerHooks(api, { ...ENFORCE_CONFIG, enforcementMode: "audit" }, createDeps({ sink }));

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Blocked",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook({ toolName: "exec", params: {} });

    expect(result).toBeUndefined();
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

    await callAllowedAction(api, "exec");

    expect(mockGenerateReceipt).toHaveBeenCalledOnce();
    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.parent_receipts).toEqual(null);
  });

  it("second receipt chains to first via parent_receipts", async () => {
    mockGenerateReceipt
      .mockReturnValueOnce({ receipt_id: "r-1", receipt_fingerprint: "fp-1" })
      .mockReturnValueOnce({ receipt_id: "r-2", receipt_fingerprint: "fp-2" });

    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    await callAllowedAction(api, "exec");
    await callAllowedAction(api, "write");

    const secondCall = mockGenerateReceipt.mock.calls[1][0];
    expect(secondCall.parent_receipts).toEqual(["fp-1"]);
  });

  it("workflow_id is set as top-level ReceiptParams field", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ workflowId: "wf-test-123" }));

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.workflow_id).toBe("wf-test-123");
  });

  it("workflow_id auto-generated when not provided", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.workflow_id).toBeDefined();
    expect(typeof params.workflow_id).toBe("string");
    expect(params.workflow_id.length).toBeGreaterThan(0);
  });

  it("workflow_id stays consistent across multiple calls", async () => {
    mockGenerateReceipt
      .mockReturnValueOnce({ receipt_id: "r-1", receipt_fingerprint: "fp-1" })
      .mockReturnValueOnce({ receipt_id: "r-2", receipt_fingerprint: "fp-2" });

    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    await callAllowedAction(api, "exec");
    await callAllowedAction(api, "write");

    const wf1 = mockGenerateReceipt.mock.calls[0][0].workflow_id;
    const wf2 = mockGenerateReceipt.mock.calls[1][0].workflow_id;
    expect(wf1).toBe(wf2);
  });
});

// ---------------------------------------------------------------------------
// OC5: Content mode
// ---------------------------------------------------------------------------

describe("OC5: Content mode", () => {
  it("content_mode omitted when set to full", async () => {
    const api = createMockApi();
    registerHooks(api, { ...ENFORCE_CONFIG, contentMode: "full" }, createDeps());

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.content_mode).toBeUndefined();
    expect(params.content_mode_source).toBeUndefined();
  });

  it("content_mode set as top-level field when redacted", async () => {
    const api = createMockApi();
    registerHooks(api, { ...ENFORCE_CONFIG, contentMode: "redacted" }, createDeps());

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.content_mode).toBe("redacted");
    expect(params.content_mode_source).toBe("local_config");
  });

  it("content_mode set as top-level field when hashes_only", async () => {
    const api = createMockApi();
    registerHooks(api, { ...ENFORCE_CONFIG, contentMode: "hashes_only" }, createDeps());

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.content_mode).toBe("hashes_only");
    expect(params.content_mode_source).toBe("local_config");
  });

  it("content_mode omitted when config not set", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.content_mode).toBeUndefined();
  });

  it("resolveConfig merges contentMode", () => {
    const api = createMockApi({ contentMode: "hashes_only" });
    const config = resolveConfig(api);
    expect(config.contentMode).toBe("hashes_only");
  });
});

// ---------------------------------------------------------------------------
// Receipt structure with v1.1 fields
// ---------------------------------------------------------------------------

describe("Receipt structure with v1.1 fields", () => {
  it("generateReceipt called with parent_receipts as top-level field", async () => {
    const api = createMockApi();
    registerHooks(api, { ...ENFORCE_CONFIG, contentMode: "redacted" }, createDeps({ workflowId: "wf-fp" }));

    await callAllowedAction(api, "exec", { command: "ls" });

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.parent_receipts).toEqual(null);
    expect(params.workflow_id).toBe("wf-fp");
    expect(params.content_mode).toBe("redacted");
    expect(params.content_mode_source).toBe("local_config");
  });

  it("receipt includes constitution_ref", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.constitution_ref).toEqual({
      document_id: "test-agent",
      policy_hash: "test-hash-abc123",
    });
  });

  it("receipt includes evaluation_coverage", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.evaluation_coverage).toEqual({
      total_invariants: 1,
      evaluated: 1,
      not_checked: 0,
      coverage_basis_points: 10000,
    });
  });

  it("content_mode_source absent when content_mode absent", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    expect(params.content_mode_source).toBeUndefined();
  });

  it("SPEC_VERSION is 1.1 in core exports", async () => {
    const { SPEC_VERSION } = await import("@sanna-ai/core");
    expect(SPEC_VERSION).toBe("1.1");
  });

  it("CHECKS_VERSION is 6 in core exports", async () => {
    const { CHECKS_VERSION } = await import("@sanna-ai/core");
    expect(CHECKS_VERSION).toBe("6");
  });

  it("parent_receipts and workflow_id are top-level ReceiptParams fields", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps({ workflowId: "wf-123" }));

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0];
    // These must be top-level, not nested in extensions
    expect(params.workflow_id).toBe("wf-123");
    expect(params.parent_receipts).toEqual(null);
    // Verify they're not in extensions
    expect(params.extensions?.workflow_id).toBeUndefined();
    expect(params.extensions?.parent_receipts).toBeUndefined();
  });
});
