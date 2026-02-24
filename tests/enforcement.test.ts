import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginAPI, ToolDefinition, EnforceResponse } from "../src/types.js";
import { TOOL_MAP } from "../src/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockEnforce } = vi.hoisted(() => ({
  mockEnforce: vi.fn(),
}));

vi.mock("../src/client.js", () => ({
  SidecarClient: vi.fn().mockImplementation(() => ({
    enforce: mockEnforce,
  })),
}));

// Import after mocks
import {
  registerEnforcementGate,
  enforceAndForward,
  forwardToGateway,
} from "../src/enforcement/gate.js";
import { generateDenyList, generateAllowList } from "../src/enforcement/policy.js";
import { registerIntercept } from "../src/enforcement/intercept.js";
import { SidecarClient } from "../src/client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HookFn = (...args: unknown[]) => Promise<void>;

function createMockApi(): PluginAPI & {
  _tools: ToolDefinition[];
  _hooks: Map<string, HookFn[]>;
} {
  const tools: ToolDefinition[] = [];
  const hooks = new Map<string, HookFn[]>();

  return {
    _tools: tools,
    _hooks: hooks,
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
    registerService: vi.fn(),
    getConfig: vi.fn(),
  };
}

const ALL_GOVERNED = [
  "exec",
  "write",
  "edit",
  "apply_patch",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "message",
  "cron",
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// registerEnforcementGate
// ---------------------------------------------------------------------------

describe("registerEnforcementGate", () => {
  it("registers a wrapper tool for each governed core tool", () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);

    registerEnforcementGate(api, client, ALL_GOVERNED);

    expect(api._tools).toHaveLength(ALL_GOVERNED.length);
  });

  it("registered tool names match TOOL_MAP values", () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);

    registerEnforcementGate(api, client, ALL_GOVERNED);

    const names = api._tools.map((t) => t.name);
    expect(names).toContain("sanna_exec");
    expect(names).toContain("sanna_write");
    expect(names).toContain("sanna_edit");
    expect(names).toContain("sanna_patch"); // apply_patch → sanna_patch
    expect(names).toContain("sanna_browse"); // browser_navigate → sanna_browse
    expect(names).toContain("sanna_click");
    expect(names).toContain("sanna_type");
    expect(names).toContain("sanna_message");
    expect(names).toContain("sanna_cron");
  });

  it("skips unknown tools not in TOOL_MAP with a warning", () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    registerEnforcementGate(api, client, ["exec", "unknown_tool"]);

    expect(api._tools).toHaveLength(1);
    expect(api._tools[0].name).toBe("sanna_exec");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown_tool")
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// enforceAndForward
// ---------------------------------------------------------------------------

describe("enforceAndForward", () => {
  it("returns forwarded placeholder on allow verdict", async () => {
    const client = new SidecarClient("127.0.0.1", 18791);
    mockEnforce.mockResolvedValueOnce({
      verdict: "allow",
      reason: "ok",
      failed_checks: [],
      receipt: { id: "r-123" },
    } satisfies Partial<EnforceResponse> as EnforceResponse);

    const result = await enforceAndForward(client, "exec", { command: "ls" });

    expect(result).toEqual({
      forwarded: true,
      tool: "exec",
      args: { command: "ls" },
      receipt_id: "r-123",
    });
  });

  it("returns GOVERNANCE HALT on halt verdict", async () => {
    const client = new SidecarClient("127.0.0.1", 18791);
    mockEnforce.mockResolvedValueOnce({
      verdict: "halt",
      reason: "Tool rm is in cannot_execute boundary",
      boundary_type: "cannot_execute",
      failed_checks: ["CANNOT_EXECUTE"],
      receipt: { id: "r-456" },
    } satisfies Partial<EnforceResponse> as EnforceResponse);

    const result = await enforceAndForward(client, "exec", {
      command: "rm -rf /",
    });

    const r = result as { error: boolean; message: string };
    expect(r.error).toBe(true);
    expect(r.message).toContain("GOVERNANCE HALT");
    expect(r.message).toContain("cannot_execute");
    expect(r.message).toContain("r-456");
  });

  it("returns GOVERNANCE ESCALATION on escalate verdict", async () => {
    const client = new SidecarClient("127.0.0.1", 18791);
    mockEnforce.mockResolvedValueOnce({
      verdict: "escalate",
      reason: "Tool curl requires human approval",
      boundary_type: "must_escalate",
      failed_checks: ["MUST_ESCALATE"],
      receipt: { id: "r-789" },
    } satisfies Partial<EnforceResponse> as EnforceResponse);

    const result = await enforceAndForward(client, "exec", {
      command: "curl example.com",
    });

    const r = result as { error: boolean; message: string };
    expect(r.error).toBe(true);
    expect(r.message).toContain("GOVERNANCE ESCALATION");
    expect(r.message).toContain("user approval");
    expect(r.message).toContain("r-789");
  });

  it("returns GOVERNANCE HALT when sidecar is unreachable", async () => {
    const client = new SidecarClient("127.0.0.1", 18791);
    mockEnforce.mockResolvedValueOnce({
      verdict: "halt",
      reason: "Sanna sidecar unreachable",
      failed_checks: ["SIDECAR_UNAVAILABLE"],
    } satisfies Partial<EnforceResponse> as EnforceResponse);

    const result = await enforceAndForward(client, "exec", { command: "ls" });

    const r = result as { error: boolean; message: string };
    expect(r.error).toBe(true);
    expect(r.message).toContain("GOVERNANCE HALT");
    expect(r.message).toContain("Sanna sidecar unreachable");
  });
});

// ---------------------------------------------------------------------------
// forwardToGateway
// ---------------------------------------------------------------------------

describe("forwardToGateway", () => {
  it("throws because gateway forwarding is not yet implemented", async () => {
    await expect(forwardToGateway("exec", {})).rejects.toThrow(
      "Gateway forwarding not yet implemented"
    );
  });
});

// ---------------------------------------------------------------------------
// generateDenyList
// ---------------------------------------------------------------------------

describe("generateDenyList", () => {
  it("returns correct core tool names for all governed tools", () => {
    const denied = generateDenyList(ALL_GOVERNED);
    expect(denied).toEqual(ALL_GOVERNED);
  });

  it("filters out tools not in TOOL_MAP", () => {
    const denied = generateDenyList(["exec", "unknown_tool", "write"]);
    expect(denied).toEqual(["exec", "write"]);
    expect(denied).not.toContain("unknown_tool");
  });
});

// ---------------------------------------------------------------------------
// generateAllowList
// ---------------------------------------------------------------------------

describe("generateAllowList", () => {
  it("returns correct wrapper names for all governed tools", () => {
    const allowed = generateAllowList(ALL_GOVERNED);

    expect(allowed).toHaveLength(ALL_GOVERNED.length);
    for (const tool of ALL_GOVERNED) {
      expect(allowed).toContain(TOOL_MAP[tool]);
    }
  });

  it("filters out tools not in TOOL_MAP", () => {
    const allowed = generateAllowList(["exec", "unknown_tool"]);
    expect(allowed).toEqual(["sanna_exec"]);
  });
});

// ---------------------------------------------------------------------------
// registerIntercept
// ---------------------------------------------------------------------------

describe("registerIntercept", () => {
  it("blocks direct call to governed core tool", async () => {
    const api = createMockApi();
    registerIntercept(api, ["exec", "write"]);

    const handlers = api._hooks.get("before_tool_call") ?? [];
    expect(handlers).toHaveLength(1);

    const handler = handlers[0];
    await expect(
      handler({ tool: "exec", args: { command: "ls" } })
    ).rejects.toThrow("GOVERNANCE BLOCK");
  });

  it("skips wrapper tools (sanna_ prefix)", async () => {
    const api = createMockApi();
    registerIntercept(api, ["exec"]);

    const handler = (api._hooks.get("before_tool_call") ?? [])[0];
    // sanna_ prefix tools should pass through without throwing
    await handler({ tool: "sanna_exec", args: {} });
  });

  it("skips ungoverned tools", async () => {
    const api = createMockApi();
    registerIntercept(api, ["exec"]);

    const handler = (api._hooks.get("before_tool_call") ?? [])[0];
    // "write" is not in the governed list for this test
    await handler({ tool: "write", args: {} });
  });

  it("includes correct wrapper name from TOOL_MAP in error message", async () => {
    const api = createMockApi();
    registerIntercept(api, ["browser_navigate"]);

    const handler = (api._hooks.get("before_tool_call") ?? [])[0];
    await expect(
      handler({ tool: "browser_navigate", args: {} })
    ).rejects.toThrow("sanna_browse");
  });
});
