import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";
import type { HookDeps } from "../src/hooks.js";

// ---------------------------------------------------------------------------
// Mock @sanna-ai/core
// ---------------------------------------------------------------------------

const mockEvaluateAuthority = vi.fn();
const mockGenerateReceipt = vi.fn();
const mockSignReceipt = vi.fn();
const mockStoreSave = vi.fn();
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HookHandler = (...args: unknown[]) => unknown;

interface MockAPI extends PluginAPI {
  _hooks: Map<string, HookHandler>;
}

function createMockApi(): MockAPI {
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
    config: {},
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

const ENFORCE_CONFIG: SannaConfig = {
  enforcementMode: "enforce",
  governedTools: ["exec", "write", "browser"],
};

const AUDIT_CONFIG: SannaConfig = {
  enforcementMode: "audit",
  governedTools: ["exec", "write", "browser"],
};

function mockConstitution() {
  return {
    schema_version: "0.1.0",
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

function createDeps(overrides?: Partial<HookDeps>): HookDeps {
  return {
    constitution: mockConstitution() as HookDeps["constitution"],
    store: { save: mockStoreSave } as unknown as HookDeps["store"],
    privateKey: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: generate receipt returns an object with receipt_id
  mockGenerateReceipt.mockReturnValue({ receipt_id: "r-mock-123" });
  mockSignReceipt.mockImplementation((r: unknown) => r);
  // Default: no invariant checks defined
  mockLoadInvariantChecks.mockReturnValue([]);
  mockRunAllInvariantChecks.mockReturnValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// before_tool_call — primary enforcement
// ---------------------------------------------------------------------------

describe("before_tool_call", () => {
  it("registers three hooks", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    expect(api._hooks.has("before_tool_call")).toBe(true);
    expect(api._hooks.has("after_tool_call")).toBe(true);
    expect(api._hooks.has("tool_result_persist")).toBe(true);
  });

  it("calls evaluateAuthority with tool name and params", async () => {
    const api = createMockApi();
    const deps = createDeps();
    registerHooks(api, ENFORCE_CONFIG, deps);

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook(
      { toolName: "exec", params: { command: "ls" } },
      { toolName: "exec", agentId: "agent-1", sessionKey: "sess-1" }
    );

    expect(mockEvaluateAuthority).toHaveBeenCalledOnce();
    expect(mockEvaluateAuthority).toHaveBeenCalledWith(
      "exec",
      { command: "ls" },
      deps.constitution
    );
  });

  it("returns { blocked: false } when decision is allow", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "ls", params: {} },
      { toolName: "ls" }
    );

    expect(result).toEqual({ blocked: false });
  });

  it("returns { block: true } when decision is halt", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Tool not allowed",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "rm", params: {} },
      { toolName: "rm" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Blocked by governance");
    expect(result.blockReason).toContain("Tool not allowed");
  });

  it("returns { block: true } when decision is escalate", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "escalate",
      reason: "Needs human approval",
      boundary_type: "must_escalate",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "browser", params: { action: "navigate" } },
      { toolName: "browser" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Requires approval");
    expect(result.blockReason).toContain("Needs human approval");
  });

  it("generates and saves a receipt for every decision", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} }, { toolName: "exec" });

    expect(mockGenerateReceipt).toHaveBeenCalledOnce();
    expect(mockStoreSave).toHaveBeenCalledOnce();
  });

  it("saves receipt for deny decisions too", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Blocked",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "rm", params: {} }, { toolName: "rm" });

    expect(mockGenerateReceipt).toHaveBeenCalledOnce();
    expect(mockStoreSave).toHaveBeenCalledOnce();
  });

  it("blocks when evaluation throws (enforce mode, fail closed)", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockImplementation(() => {
      throw new Error("evaluation error");
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("evaluation failed");
  });

  it("blocks when receipt persistence fails (enforce mode)", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockGenerateReceipt.mockImplementation(() => {
      throw new Error("DB write failed");
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("receipt persistence failed");
  });

  it("does not block in audit mode on deny", async () => {
    const api = createMockApi();
    registerHooks(api, AUDIT_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Not allowed",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "rm", params: {} },
      { toolName: "rm" }
    );

    expect(result).toBeUndefined();
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("DENY rm")
    );
  });

  it("does not block in audit mode when evaluation throws", async () => {
    const api = createMockApi();
    registerHooks(api, AUDIT_CONFIG, createDeps());

    mockEvaluateAuthority.mockImplementation(() => {
      throw new Error("evaluation error");
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    );

    expect(result).toBeUndefined();
    expect(api.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("evaluation error")
    );
  });

  it("blocks when toolName cannot be extracted (enforce mode)", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { noToolName: true },
      {}
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("could not identify tool");
  });

  it("allows when toolName cannot be extracted (audit mode)", async () => {
    const api = createMockApi();
    registerHooks(api, AUDIT_CONFIG, createDeps());

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook({ noToolName: true }, {});

    expect(result).toBeUndefined();
  });

  it("includes receipt ID in block reason", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Forbidden",
      boundary_type: "cannot_execute",
    });
    mockGenerateReceipt.mockReturnValue({ receipt_id: "receipt-abc-123" });

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "rm", params: {} },
      { toolName: "rm" }
    )) as Record<string, unknown>;

    expect(result.blockReason).toContain("receipt-abc-123");
  });

  it("logs ALLOW with receipt ID prefix", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockGenerateReceipt.mockReturnValue({
      receipt_id: "abcdef12-3456-7890",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "ls", params: {} }, { toolName: "ls" });

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("ALLOW ls")
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("abcdef12")
    );
  });

  it("signs receipt when privateKey is provided", async () => {
    const api = createMockApi();
    const fakeKey = {} as HookDeps["privateKey"];
    registerHooks(api, ENFORCE_CONFIG, createDeps({ privateKey: fakeKey }));

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} }, { toolName: "exec" });

    expect(mockSignReceipt).toHaveBeenCalledOnce();
    expect(mockSignReceipt).toHaveBeenCalledWith(
      expect.anything(),
      fakeKey,
      "sanna-openclaw"
    );
  });
});

// ---------------------------------------------------------------------------
// checks and evaluation_coverage
// ---------------------------------------------------------------------------

describe("checks and evaluation_coverage", () => {
  it("authority decision appears as CheckResult in receipt checks array", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} }, { toolName: "exec" });

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    expect(checks).toBeDefined();
    const authority = checks.find((c) => c.check_id === "AUTHORITY");
    expect(authority).toBeDefined();
    expect(authority!.passed).toBe(true);
    expect(authority!.name).toBe("Authority Boundary Evaluation");
    expect(authority!.severity).toBe("info");
    expect(authority!.status).toBe("PASS");
    expect(authority!.evidence).toBe("can_execute: Permitted");
  });

  it("authority deny appears as failed CheckResult", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Tool not allowed",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "rm", params: {} }, { toolName: "rm" });

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    const authority = checks.find((c) => c.check_id === "AUTHORITY");
    expect(authority).toBeDefined();
    expect(authority!.passed).toBe(false);
    expect(authority!.severity).toBe("critical");
  });

  it("constitution invariants run on tool params", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue([
      { id: "INV-001", type: "pattern", params: {} },
    ]);
    mockRunAllInvariantChecks.mockReturnValue([
      {
        check_id: "INV-001",
        name: "Pattern check",
        passed: true,
        severity: "info",
        evidence: "no match",
      },
    ]);

    const hook = api._hooks.get("before_tool_call")!;
    await hook(
      { toolName: "exec", params: { command: "ls" } },
      { toolName: "exec" }
    );

    expect(mockRunAllInvariantChecks).toHaveBeenCalledOnce();

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    expect(checks).toHaveLength(2);
    expect(checks[0].check_id).toBe("AUTHORITY");
    expect(checks[1].check_id).toBe("INV-001");
  });

  it("invariant check error does not block enforcement", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockImplementation(() => {
      throw new Error("invariant load failed");
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    );

    // Should still generate receipt and allow
    expect(result).toEqual({ blocked: false });
    expect(mockGenerateReceipt).toHaveBeenCalledOnce();

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    expect(checks).toHaveLength(1);
    expect(checks[0].check_id).toBe("AUTHORITY");
  });

  it("evaluation_coverage is populated", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue([
      { id: "INV-001", type: "pattern", params: {} },
    ]);
    mockRunAllInvariantChecks.mockReturnValue([
      {
        check_id: "INV-001",
        passed: false,
        severity: "high",
        evidence: "match found",
      },
    ]);

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} }, { toolName: "exec" });

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const coverage = receiptArgs.evaluation_coverage as Record<
      string,
      unknown
    >;
    expect(coverage).toBeDefined();
    expect(coverage.checks_run).toBe(2);
    expect(coverage.checks_passed).toBe(1); // authority passed
    expect(coverage.checks_failed).toBe(1); // invariant failed
    expect(coverage.coverage_pct).toBe(100);
  });

  it("empty invariant list produces authority-only receipt", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue([]);

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} }, { toolName: "exec" });

    expect(mockRunAllInvariantChecks).not.toHaveBeenCalled();

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    expect(checks).toHaveLength(1);
    expect(checks[0].check_id).toBe("AUTHORITY");
  });

  it("invariant check failure changes receipt status", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue([
      { id: "INV-002", type: "pattern", params: {} },
    ]);
    mockRunAllInvariantChecks.mockReturnValue([
      {
        check_id: "INV-002",
        name: "Dangerous pattern",
        passed: false,
        severity: "high",
        evidence: "matched dangerous pattern",
      },
    ]);

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: {} }, { toolName: "exec" });

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    expect(checks).toHaveLength(2);
    const failedCheck = checks.find((c) => c.check_id === "INV-002");
    expect(failedCheck).toBeDefined();
    expect(failedCheck!.passed).toBe(false);
    expect(failedCheck!.severity).toBe("high");
    expect(failedCheck!.evidence).toBe("matched dangerous pattern");
  });

  it("escalate decision produces failed authority check", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "escalate",
      reason: "Needs human approval",
      boundary_type: "must_escalate",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook(
      { toolName: "browser", params: { action: "navigate" } },
      { toolName: "browser" }
    );

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    const authority = checks.find((c) => c.check_id === "AUTHORITY");
    expect(authority).toBeDefined();
    expect(authority!.passed).toBe(false);
    expect(authority!.severity).toBe("critical");
    expect(authority!.status).toBe("FAIL");
    expect(authority!.evidence).toBe("must_escalate: Needs human approval");
  });
});

// ---------------------------------------------------------------------------
// after_tool_call — observability
// ---------------------------------------------------------------------------

describe("after_tool_call", () => {
  it("logs receipt info after allowed call", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const beforeHook = api._hooks.get("before_tool_call")!;
    await beforeHook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    );

    const afterHook = api._hooks.get("after_tool_call")!;
    afterHook();

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("after_tool_call")
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("exec")
    );
  });
});

// ---------------------------------------------------------------------------
// tool_result_persist
// ---------------------------------------------------------------------------

describe("tool_result_persist", () => {
  it("annotates result with receipt hash", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("tool_result_persist")!;
    const result = hook({
      content: [{ type: "text", text: "file1.txt" }],
      _sanna_receipt_hash: "abc123def456",
    }) as Record<string, unknown>;

    expect(result).toBeDefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]).toEqual({ type: "text", text: "file1.txt" });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("abc123def456");
    expect(content[1].text).toContain("Sanna Receipt");
  });

  it("returns undefined for non-sanna results", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("tool_result_persist")!;
    const result = hook({
      content: [{ type: "text", text: "hello" }],
    });
    expect(result).toBeUndefined();
  });

  it("removes _sanna_receipt_hash from annotated result", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("tool_result_persist")!;
    const result = hook({
      content: [{ type: "text", text: "ok" }],
      _sanna_receipt_hash: "hash123",
    }) as Record<string, unknown>;

    expect(result).toBeDefined();
    expect(result._sanna_receipt_hash).toBeUndefined();
  });

  it("returns undefined for null/undefined input", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("tool_result_persist")!;
    expect(hook(null)).toBeUndefined();
    expect(hook(undefined)).toBeUndefined();
  });

  it("does not mutate the original result object", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const hook = api._hooks.get("tool_result_persist")!;
    const original = {
      content: [{ type: "text", text: "ok" }],
      _sanna_receipt_hash: "hash123",
    };

    hook(original);

    expect(original._sanna_receipt_hash).toBe("hash123");
    expect(original.content).toHaveLength(1);
  });
});
