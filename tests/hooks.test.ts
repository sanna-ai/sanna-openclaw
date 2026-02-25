import { describe, it, expect, vi, beforeEach } from "vitest";
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
  enforcementMode: "enforce",
  governedTools: ["exec", "write", "browser"],
};

const AUDIT_CONFIG: SannaConfig = {
  enforcementMode: "audit",
  governedTools: ["exec", "write", "browser"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// before_tool_call
// ---------------------------------------------------------------------------

describe("before_tool_call", () => {
  it("throws for governed tool in enforce mode", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    const hook = api._hooks.get("before_tool_call")!;
    expect(() => hook("exec", { command: "ls" })).toThrow(
      'Tool "exec" requires governance'
    );
    expect(() => hook("exec", { command: "ls" })).toThrow(
      "sanna_exec"
    );
  });

  it("logs but does not throw in audit mode", () => {
    const api = createMockApi();
    registerHooks(api, AUDIT_CONFIG);

    const hook = api._hooks.get("before_tool_call")!;
    expect(() => hook("exec", { command: "ls" })).not.toThrow();
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("BLOCKED direct call to governed tool: exec")
    );
  });

  it("ignores sanna_* prefixed tools", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    const hook = api._hooks.get("before_tool_call")!;
    // sanna_exec is a wrapper, not a governed original — should not block
    expect(() => hook("sanna_exec", { command: "ls" })).not.toThrow();
    expect(api.logger.warn).not.toHaveBeenCalled();
  });

  it("ignores non-governed tools", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    const hook = api._hooks.get("before_tool_call")!;
    // "read" is not in governedTools — should pass through
    expect(() => hook("read", { path: "/tmp/file" })).not.toThrow();
    expect(api.logger.warn).not.toHaveBeenCalled();
  });

  it("ignores non-string toolName", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    const hook = api._hooks.get("before_tool_call")!;
    expect(() => hook(42, {})).not.toThrow();
    expect(() => hook(undefined, {})).not.toThrow();
  });

  it("logs warning when first arg is not a string", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    const hook = api._hooks.get("before_tool_call")!;
    hook(42, { some: "params" });

    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("before_tool_call received unexpected arguments")
    );
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Hook signature may have changed")
    );
  });

  it("logs warning when called with single object arg (possible { tool, params } shape)", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    const hook = api._hooks.get("before_tool_call")!;
    hook({ tool: "exec", params: { command: "ls" } });

    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("before_tool_call received unexpected arguments")
    );
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Args:")
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
    // Original content preserved
    expect(content[0]).toEqual({ type: "text", text: "file1.txt" });
    // Receipt annotation added
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("abc123def456");
    expect(content[1].text).toContain("Sanna Receipt");
  });

  it("returns undefined for non-sanna results", () => {
    const api = createMockApi();
    registerHooks(api, ENFORCE_CONFIG);

    const hook = api._hooks.get("tool_result_persist")!;

    // No _sanna_receipt_hash → not a sanna result
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

    // Original should still have its receipt hash
    expect(original._sanna_receipt_hash).toBe("hash123");
    // Original content should not be modified
    expect(original.content).toHaveLength(1);
  });
});
