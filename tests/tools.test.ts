import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, SannaConfig, ToolDefinition } from "../src/types.js";
import { registerTools } from "../src/tools.js";
import { GOVERNED_TOOLS_DEFAULT } from "../src/config.js";

// ---------------------------------------------------------------------------
// Mock enforce module
// ---------------------------------------------------------------------------

const mockEnforceAndForward = vi.fn();

vi.mock("../src/enforce.js", () => ({
  enforceAndForward: (...args: unknown[]) => mockEnforceAndForward(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockAPI extends PluginAPI {
  _tools: Array<{ def: ToolDefinition; opts?: { optional?: boolean } }>;
}

function createMockApi(): MockAPI {
  const tools: Array<{ def: ToolDefinition; opts?: { optional?: boolean } }> = [];
  return {
    _tools: tools,
    registerTool(def, opts) {
      tools.push({ def, opts });
    },
    registerService: vi.fn(),
    registerHook: vi.fn(),
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

const DEFAULT_CONFIG: SannaConfig = {
  sidecarPort: 18890,
  gatewayPort: 18789,
  gatewayToken: "test-token",
  enforcementMode: "enforce",
  governedTools: GOVERNED_TOOLS_DEFAULT,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// registerTools
// ---------------------------------------------------------------------------

describe("registerTools", () => {
  it("registers sanna_* for each governed tool", () => {
    const api = createMockApi();
    registerTools(api, DEFAULT_CONFIG);

    const names = api._tools.map((t) => t.def.name);
    for (const tool of GOVERNED_TOOLS_DEFAULT) {
      expect(names).toContain(`sanna_${tool}`);
    }
  });

  it("registers all tools with optional: false", () => {
    const api = createMockApi();
    registerTools(api, DEFAULT_CONFIG);

    for (const entry of api._tools) {
      expect(entry.opts?.optional).toBe(false);
    }
  });

  it("registers correct count of tools", () => {
    const api = createMockApi();
    registerTools(api, DEFAULT_CONFIG);

    expect(api._tools).toHaveLength(GOVERNED_TOOLS_DEFAULT.length);
  });

  it("uses additionalProperties: true for all schemas", () => {
    const api = createMockApi();
    registerTools(api, DEFAULT_CONFIG);

    for (const entry of api._tools) {
      expect(entry.def.parameters).toEqual({
        type: "object",
        additionalProperties: true,
      });
    }
  });

  it("registers only tools from custom governedTools list", () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["exec", "write"],
    });

    const names = api._tools.map((t) => t.def.name);
    expect(names).toEqual(["sanna_exec", "sanna_write"]);
  });

  it("logs each registered tool", () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["exec", "browser"],
    });

    expect(api.logger.info).toHaveBeenCalledWith(
      "[sanna] Registered governed tool: sanna_exec"
    );
    expect(api.logger.info).toHaveBeenCalledWith(
      "[sanna] Registered governed tool: sanna_browser"
    );
  });
});

// ---------------------------------------------------------------------------
// Composite tool wrapper
// ---------------------------------------------------------------------------

describe("composite tool wrapper", () => {
  it("extracts action parameter for composite tools", async () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["browser"],
    });

    mockEnforceAndForward.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const tool = api._tools[0].def;
    await tool.execute("call-1", {
      action: "navigate",
      url: "https://example.com",
    });

    expect(mockEnforceAndForward).toHaveBeenCalledWith(
      expect.objectContaining({ governedTools: ["browser"] }),
      "browser",
      { action: "navigate", url: "https://example.com" },
      "navigate"
    );
  });

  it("passes undefined action for non-composite tools", async () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["exec"],
    });

    mockEnforceAndForward.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const tool = api._tools[0].def;
    await tool.execute("call-1", { command: "ls" });

    expect(mockEnforceAndForward).toHaveBeenCalledWith(
      expect.objectContaining({ governedTools: ["exec"] }),
      "exec",
      { command: "ls" },
      undefined
    );
  });
});

// ---------------------------------------------------------------------------
// Simple tool wrapper
// ---------------------------------------------------------------------------

describe("simple tool wrapper", () => {
  it("passes params through to enforceAndForward", async () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["write"],
    });

    const writeResult = {
      content: [{ type: "text", text: "File written" }],
    };
    mockEnforceAndForward.mockResolvedValueOnce(writeResult);

    const tool = api._tools[0].def;
    const result = await tool.execute("call-1", {
      path: "/tmp/test.txt",
      content: "hello",
    });

    expect(mockEnforceAndForward).toHaveBeenCalledWith(
      expect.objectContaining({ governedTools: ["write"] }),
      "write",
      { path: "/tmp/test.txt", content: "hello" },
      undefined
    );
    expect(result).toEqual(writeResult);
  });
});
