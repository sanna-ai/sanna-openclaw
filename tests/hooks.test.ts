import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";
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
    registerHook(event: string, handler: HookHandler) {
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
  sidecarPort: 18890,
  enforcementMode: "enforce",
  governedTools: ["exec", "write", "browser"],
};

const AUDIT_CONFIG: SannaConfig = {
  sidecarPort: 18890,
  enforcementMode: "audit",
  governedTools: ["exec", "write", "browser"],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.clearAllMocks();
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
    registerHooks(api, ENFORCE_CONFIG);

    expect(api._hooks.has("before_tool_call")).toBe(true);
    expect(api._hooks.has("after_tool_call")).toBe(true);
    expect(api._hooks.has("tool_result_persist")).toBe(true);
  });

  it("calls sidecar /enforce with tool name and params", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ verdict: "allow", receipt: { receipt_id: "r-123" } })
    );

    const hook = api._hooks.get("before_tool_call")!;
    await hook(
      { toolName: "exec", params: { command: "ls" } },
      { toolName: "exec", agentId: "agent-1", sessionKey: "sess-1" }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18890/enforce");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.tool).toBe("exec");
    expect(body.args).toEqual({ command: "ls" });
    expect(body.context.agent_id).toBe("agent-1");
    expect(body.context.session_id).toBe("sess-1");
  });

  it("returns { blocked: false } when verdict is allow", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ verdict: "allow", receipt: { receipt_id: "r-allow" } })
    );

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "ls", params: {} },
      { toolName: "ls" }
    );

    expect(result).toEqual({ blocked: false });
  });

  it("returns { block: true } when verdict is halt", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        verdict: "halt",
        reason: "Tool not allowed",
        receipt: { receipt_id: "r-halt" },
      })
    );

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "rm", params: {} },
      { toolName: "rm" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Blocked by governance");
    expect(result.blockReason).toContain("Tool not allowed");
  });

  it("returns { block: true } when verdict is escalate", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        verdict: "escalate",
        reason: "Needs human approval",
        receipt: { receipt_id: "r-esc" },
      })
    );

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "browser", params: { action: "navigate" } },
      { toolName: "browser" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("Requires approval");
    expect(result.blockReason).toContain("Needs human approval");
  });

  it("blocks when sidecar is unreachable (fail closed)", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("unavailable");
  });

  it("blocks when sidecar returns non-200 (fail closed)", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    fetchMock.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    )) as Record<string, unknown>;

    expect(result.block).toBe(true);
    expect(result.blockReason).toContain("unavailable");
  });

  it("does not block in audit mode on deny", async () => {
    const api = createMockApi();
    registerHooks(api, AUDIT_CONFIG);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        verdict: "halt",
        reason: "Not allowed",
        receipt: { receipt_id: "r-audit" },
      })
    );

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "rm", params: {} },
      { toolName: "rm" }
    );

    // Audit mode: logs but does not block
    expect(result).toBeUndefined();
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("DENY rm")
    );
  });

  it("does not block in audit mode when sidecar unreachable", async () => {
    const api = createMockApi();
    registerHooks(api, AUDIT_CONFIG);

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    );

    expect(result).toBeUndefined();
    expect(api.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Sidecar unreachable")
    );
  });

  it("blocks when toolName cannot be extracted (enforce mode)", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

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
    registerHooks(api, AUDIT_CONFIG);

    const hook = api._hooks.get("before_tool_call")!;
    const result = await hook(
      { noToolName: true },
      {}
    );

    expect(result).toBeUndefined();
  });

  it("includes receipt ID in block reason", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        verdict: "halt",
        reason: "Forbidden",
        receipt: { receipt_id: "receipt-abc-123" },
      })
    );

    const hook = api._hooks.get("before_tool_call")!;
    const result = (await hook(
      { toolName: "rm", params: {} },
      { toolName: "rm" }
    )) as Record<string, unknown>;

    expect(result.blockReason).toContain("receipt-abc-123");
  });

  it("logs ALLOW with receipt ID prefix", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        verdict: "allow",
        receipt: { receipt_id: "abcdef12-3456-7890" },
      })
    );

    const hook = api._hooks.get("before_tool_call")!;
    await hook(
      { toolName: "ls", params: {} },
      { toolName: "ls" }
    );

    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("ALLOW ls")
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("abcdef12")
    );
  });
});

// ---------------------------------------------------------------------------
// after_tool_call — observability
// ---------------------------------------------------------------------------

describe("after_tool_call", () => {
  it("logs receipt info after allowed call", async () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    // Trigger before_tool_call to populate lastReceipt
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        verdict: "allow",
        receipt: { receipt_id: "r-after-test" },
      })
    );

    const beforeHook = api._hooks.get("before_tool_call")!;
    await beforeHook(
      { toolName: "exec", params: {} },
      { toolName: "exec" }
    );

    // Now trigger after_tool_call
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
    registerHooks(api, ENFORCE_CONFIG);

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
    registerHooks(api, ENFORCE_CONFIG);

    const hook = api._hooks.get("tool_result_persist")!;
    const result = hook({
      content: [{ type: "text", text: "hello" }],
    });
    expect(result).toBeUndefined();
  });

  it("removes _sanna_receipt_hash from annotated result", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

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
    registerHooks(api, ENFORCE_CONFIG);

    const hook = api._hooks.get("tool_result_persist")!;
    expect(hook(null)).toBeUndefined();
    expect(hook(undefined)).toBeUndefined();
  });

  it("does not mutate the original result object", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

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
