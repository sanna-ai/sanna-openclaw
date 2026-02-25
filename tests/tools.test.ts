import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, SannaConfig, ToolDefinition } from "../src/types.js";
import { registerTools, KNOWN_SCHEMAS } from "../src/tools.js";
import { GOVERNED_TOOLS_DEFAULT } from "../src/config.js";

// ---------------------------------------------------------------------------
// Mock enforce module
// ---------------------------------------------------------------------------

const mockEnforceAndExecute = vi.fn();

vi.mock("../src/enforce.js", () => ({
  enforceAndExecute: (...args: unknown[]) => mockEnforceAndExecute(...args),
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
      const params = entry.def.parameters as Record<string, unknown>;
      expect(params.additionalProperties).toBe(true);
    }
  });

  it("uses richer schemas for known tools", () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["exec", "write", "browser"],
    });

    const exec = api._tools.find((t) => t.def.name === "sanna_exec")!;
    const execParams = exec.def.parameters as Record<string, unknown>;
    expect(execParams.required).toEqual(["command"]);
    expect(execParams.properties).toBeDefined();

    const write = api._tools.find((t) => t.def.name === "sanna_write")!;
    const writeParams = write.def.parameters as Record<string, unknown>;
    expect(writeParams.required).toEqual(["path", "content"]);

    const browser = api._tools.find((t) => t.def.name === "sanna_browser")!;
    const browserParams = browser.def.parameters as Record<string, unknown>;
    expect(browserParams.required).toEqual(["action"]);
  });

  it("uses generic schema for unknown tools", () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["sessions_send"],
    });

    const tool = api._tools[0];
    expect(tool.def.parameters).toEqual({
      type: "object",
      additionalProperties: true,
    });
  });

  it("KNOWN_SCHEMAS covers exec, write, edit, browser, message", () => {
    expect(Object.keys(KNOWN_SCHEMAS)).toEqual(
      expect.arrayContaining(["exec", "write", "edit", "browser", "message"])
    );
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

    mockEnforceAndExecute.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const tool = api._tools[0].def;
    await tool.execute("call-1", {
      action: "navigate",
      url: "https://example.com",
    });

    expect(mockEnforceAndExecute).toHaveBeenCalledWith(
      expect.objectContaining({ governedTools: ["browser"] }),
      "browser",
      { action: "navigate", url: "https://example.com" },
      "navigate",
      { session: "call-1" }
    );
  });

  it("passes undefined action for non-composite tools", async () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["exec"],
    });

    mockEnforceAndExecute.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const tool = api._tools[0].def;
    await tool.execute("call-1", { command: "ls" });

    expect(mockEnforceAndExecute).toHaveBeenCalledWith(
      expect.objectContaining({ governedTools: ["exec"] }),
      "exec",
      { command: "ls" },
      undefined,
      { session: "call-1" }
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
    mockEnforceAndExecute.mockResolvedValueOnce(writeResult);

    const tool = api._tools[0].def;
    const result = await tool.execute("call-1", {
      path: "/tmp/test.txt",
      content: "hello",
    });

    expect(mockEnforceAndExecute).toHaveBeenCalledWith(
      expect.objectContaining({ governedTools: ["write"] }),
      "write",
      { path: "/tmp/test.txt", content: "hello" },
      undefined,
      { session: "call-1" }
    );
    expect(result).toEqual(writeResult);
  });
});

// ---------------------------------------------------------------------------
// Session context
// ---------------------------------------------------------------------------

describe("session context", () => {
  it("passes _id as session when no sessionKey in params", async () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["exec"],
    });

    mockEnforceAndExecute.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const tool = api._tools[0].def;
    await tool.execute("my-call-id", { command: "ls" });

    expect(mockEnforceAndExecute).toHaveBeenCalledWith(
      expect.anything(),
      "exec",
      { command: "ls" },
      undefined,
      { session: "my-call-id" }
    );
  });

  it("uses explicit sessionKey from params when present", async () => {
    const api = createMockApi();
    registerTools(api, {
      ...DEFAULT_CONFIG,
      governedTools: ["exec"],
    });

    mockEnforceAndExecute.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const tool = api._tools[0].def;
    await tool.execute("call-id", { command: "ls", sessionKey: "explicit-session" });

    expect(mockEnforceAndExecute).toHaveBeenCalledWith(
      expect.anything(),
      "exec",
      { command: "ls", sessionKey: "explicit-session" },
      undefined,
      { session: "explicit-session" }
    );
  });
});
