import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  PluginAPI,
  PluginConfig,
  ToolDefinition,
  StatusResponse,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures availability before vi.mock factories
// ---------------------------------------------------------------------------

const { mockEnforce, mockAudit, mockStatus } = vi.hoisted(() => ({
  mockEnforce: vi.fn(),
  mockAudit: vi.fn(),
  mockStatus: vi.fn(),
}));

vi.mock("../src/client.js", () => ({
  SidecarClient: vi.fn().mockImplementation(() => ({
    enforce: mockEnforce,
    audit: mockAudit,
    status: mockStatus,
  })),
}));

vi.mock("../src/sidecar.js", () => ({
  SidecarManager: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getClient: vi.fn(),
  })),
}));

// Import after mocks
import { register } from "../src/index.js";
import { registerAuditHook } from "../src/hooks/audit.js";
import { registerCheckTool } from "../src/tools/check.js";
import { registerStatusTool } from "../src/tools/status.js";
import { SidecarClient } from "../src/client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HookFn = (...args: unknown[]) => Promise<void>;

interface ServiceDef {
  name: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function createMockApi(
  configOverrides?: Partial<PluginConfig>
): PluginAPI & {
  _tools: ToolDefinition[];
  _hooks: Map<string, HookFn[]>;
  _services: ServiceDef[];
} {
  const tools: ToolDefinition[] = [];
  const hooks = new Map<string, HookFn[]>();
  const services: ServiceDef[] = [];

  return {
    _tools: tools,
    _hooks: hooks,
    _services: services,
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
    },
    on(event: string, handler: (...args: unknown[]) => Promise<void>) {
      const existing = hooks.get(event) || [];
      existing.push(handler);
      hooks.set(event, existing);
    },
    registerCommand: vi.fn(),
    registerCli: vi.fn(),
    registerService(service: ServiceDef) {
      services.push(service);
    },
    getConfig: vi.fn().mockReturnValue({
      sidecarHost: "127.0.0.1",
      sidecarPort: 18791,
      governedTools: ["exec", "write"],
      ...configOverrides,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// register()
// ---------------------------------------------------------------------------

describe("register", () => {
  it("registers sanna-sidecar service", () => {
    const api = createMockApi();
    register(api);

    expect(api._services).toHaveLength(1);
    expect(api._services[0].name).toBe("sanna-sidecar");
  });

  it("registers enforcement gate wrapper tools", () => {
    const api = createMockApi({ governedTools: ["exec", "write"] });
    register(api);

    const names = api._tools.map((t) => t.name);
    expect(names).toContain("sanna_exec");
    expect(names).toContain("sanna_write");
  });

  it("registers before_tool_call intercept hook", () => {
    const api = createMockApi();
    register(api);

    expect(api._hooks.has("before_tool_call")).toBe(true);
    expect(api._hooks.get("before_tool_call")!.length).toBeGreaterThan(0);
  });

  it("registers tool_result_persist audit hook", () => {
    const api = createMockApi();
    register(api);

    expect(api._hooks.has("tool_result_persist")).toBe(true);
    expect(api._hooks.get("tool_result_persist")!.length).toBeGreaterThan(0);
  });

  it("registers sanna_check tool", () => {
    const api = createMockApi();
    register(api);

    const names = api._tools.map((t) => t.name);
    expect(names).toContain("sanna_check");
  });

  it("registers sanna_status tool", () => {
    const api = createMockApi();
    register(api);

    const names = api._tools.map((t) => t.name);
    expect(names).toContain("sanna_status");
  });
});

// ---------------------------------------------------------------------------
// audit hook
// ---------------------------------------------------------------------------

describe("audit hook", () => {
  it("calls client.audit on tool_result_persist", async () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);
    registerAuditHook(api, client);

    const handler = (api._hooks.get("tool_result_persist") ?? [])[0];
    mockAudit.mockResolvedValueOnce({ receipt_id: "r-001", status: "ok" });

    await handler({
      tool: "sanna_exec",
      args: { command: "ls" },
      result: "file.txt",
    });

    expect(mockAudit).toHaveBeenCalledOnce();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "sanna_exec",
        args: { command: "ls" },
        result: "file.txt",
      })
    );
  });

  it("swallows errors without propagating", async () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);
    registerAuditHook(api, client);

    const handler = (api._hooks.get("tool_result_persist") ?? [])[0];
    mockAudit.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Must not throw — audit failures are swallowed
    await handler({ tool: "exec", args: {} });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Audit receipt failed"),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// check tool
// ---------------------------------------------------------------------------

describe("check tool", () => {
  it("returns verdict from client.enforce", async () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);
    registerCheckTool(api, client);

    const checkTool = api._tools.find((t) => t.name === "sanna_check")!;
    mockEnforce.mockResolvedValueOnce({
      verdict: "allow",
      reason: "Action matches can_execute rule",
      boundary_type: "can_execute",
      failed_checks: [],
    });

    const result = await checkTool.handler({
      tool: "ls",
      args: { path: "/tmp" },
    });

    expect(result).toEqual({
      would_allow: true,
      verdict: "allow",
      reason: "Action matches can_execute rule",
      boundary: "can_execute",
    });
  });
});

// ---------------------------------------------------------------------------
// status tool
// ---------------------------------------------------------------------------

describe("status tool", () => {
  it("returns client.status() result", async () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);
    registerStatusTool(api, client);

    const statusTool = api._tools.find((t) => t.name === "sanna_status")!;
    const mockStatusResult: StatusResponse = {
      constitution: {
        name: "test-constitution",
        version: "1.0",
        hash: "abc123",
        boundaries: {
          can_execute: 5,
          must_escalate: 1,
          cannot_execute: 2,
        },
      },
      enforcement_stats: {
        total: 10,
        allowed: 8,
        halted: 1,
        escalated: 1,
      },
      sidecar_version: "0.13.5",
    };
    mockStatus.mockResolvedValueOnce(mockStatusResult);

    const result = await statusTool.handler({});

    expect(result).toEqual(mockStatusResult);
  });
});
