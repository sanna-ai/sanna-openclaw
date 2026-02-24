import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  PluginAPI,
  PluginConfig,
  ToolDefinition,
  StatusResponse,
  ReceiptSummary,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockStatus, mockReceipts } = vi.hoisted(() => ({
  mockStatus: vi.fn(),
  mockReceipts: vi.fn(),
}));

vi.mock("../src/client.js", () => ({
  SidecarClient: vi.fn().mockImplementation(() => ({
    status: mockStatus,
    receipts: mockReceipts,
  })),
}));

// Import after mocks
import { SidecarClient } from "../src/client.js";
import { registerDashboardCommand, formatDashboard } from "../src/commands/dashboard.js";
import {
  registerReceiptsCommand,
  parseReceiptFilters,
  formatReceiptList,
} from "../src/commands/receipts.js";
import {
  registerConstitutionCommand,
  formatConstitutionView,
} from "../src/commands/constitution.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CommandDef = { name: string; handler: (args: string) => Promise<string> };

function createMockApi(): PluginAPI & { _commands: CommandDef[] } {
  const commands: CommandDef[] = [];
  return {
    _commands: commands,
    registerTool: vi.fn(),
    on: vi.fn(),
    registerCommand(cmd: CommandDef) {
      commands.push(cmd);
    },
    registerCli: vi.fn(),
    registerService: vi.fn(),
    getConfig: vi.fn().mockReturnValue({
      sidecarHost: "127.0.0.1",
      sidecarPort: 18791,
      governedTools: ["exec", "write"],
    }),
  };
}

const FULL_STATUS: StatusResponse = {
  constitution: {
    name: "acme-policy",
    version: "2.1",
    hash: "abc123def456",
    boundaries: { can_execute: 5, must_escalate: 2, cannot_execute: 3 },
  },
  enforcement_stats: { total: 20, allowed: 15, halted: 3, escalated: 2 },
  sidecar_version: "0.13.5",
};

const DOWN_STATUS: StatusResponse = {
  constitution: null,
  enforcement_stats: { total: 0, allowed: 0, halted: 0, escalated: 0 },
  sidecar_version: "unavailable",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// formatDashboard
// ---------------------------------------------------------------------------

describe("formatDashboard", () => {
  it("formats constitution info and stats", () => {
    const output = formatDashboard(FULL_STATUS);
    expect(output).toContain("acme-policy");
    expect(output).toContain("v2.1");
    expect(output).toContain("abc123def456");
    expect(output).toContain("5 allow");
    expect(output).toContain("2 escalate");
    expect(output).toContain("3 deny");
    expect(output).toContain("20 total");
    expect(output).toContain("15 allowed");
    expect(output).toContain("3 halted");
  });

  it("shows 'not loaded' when constitution is null", () => {
    const output = formatDashboard(DOWN_STATUS);
    expect(output).toContain("not loaded");
    expect(output).toContain("0 total");
  });
});

// ---------------------------------------------------------------------------
// dashboard command (sidecar-down)
// ---------------------------------------------------------------------------

describe("dashboard command", () => {
  it("handles sidecar-down gracefully", async () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);
    registerDashboardCommand(api, client);

    mockStatus.mockResolvedValueOnce(DOWN_STATUS);

    const cmd = api._commands.find((c) => c.name === "sanna")!;
    const result = await cmd.handler("");

    expect(result).toContain("not loaded");
    expect(result).toContain("unavailable");
  });
});

// ---------------------------------------------------------------------------
// parseReceiptFilters
// ---------------------------------------------------------------------------

describe("parseReceiptFilters", () => {
  it("parses --tool, --verdict, --limit from args string", () => {
    const filters = parseReceiptFilters("--tool exec --verdict halt --limit 20");
    expect(filters).toEqual({ tool: "exec", verdict: "halt", limit: 20 });
  });

  it("returns empty object for empty string", () => {
    const filters = parseReceiptFilters("");
    expect(filters).toEqual({});
  });

  it("ignores invalid limit", () => {
    const filters = parseReceiptFilters("--limit abc");
    expect(filters).toEqual({});
  });

  it("handles partial flags", () => {
    const filters = parseReceiptFilters("--tool write");
    expect(filters).toEqual({ tool: "write" });
  });
});

// ---------------------------------------------------------------------------
// formatReceiptList
// ---------------------------------------------------------------------------

describe("formatReceiptList", () => {
  it("formats receipts as markdown table", () => {
    const summaries: ReceiptSummary[] = [
      { id: "r-001", tool: "exec", verdict: "allow", timestamp: "2026-01-01T00:00:00Z" },
      { id: "r-002-long-id-here", tool: "write", verdict: "halt", timestamp: "2026-01-01T00:01:00Z" },
    ];
    const output = formatReceiptList(summaries);
    expect(output).toContain("Receipts (2)");
    expect(output).toContain("r-001");
    expect(output).toContain("r-002-long-i...");
    expect(output).toContain("| exec |");
    expect(output).toContain("| halt |");
  });

  it("returns message when no receipts", () => {
    expect(formatReceiptList([])).toBe("No receipts found.");
  });
});

// ---------------------------------------------------------------------------
// receipts command
// ---------------------------------------------------------------------------

describe("receipts command", () => {
  it("passes parsed filters to client.receipts", async () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);
    registerReceiptsCommand(api, client);

    mockReceipts.mockResolvedValueOnce([]);

    const cmd = api._commands.find((c) => c.name === "sanna receipts")!;
    await cmd.handler("--tool exec --limit 5");

    expect(mockReceipts).toHaveBeenCalledWith({ tool: "exec", limit: 5 });
  });
});

// ---------------------------------------------------------------------------
// formatConstitutionView
// ---------------------------------------------------------------------------

describe("formatConstitutionView", () => {
  it("formats constitution with boundary table", () => {
    const output = formatConstitutionView(FULL_STATUS.constitution);
    expect(output).toContain("acme-policy");
    expect(output).toContain("2.1");
    expect(output).toContain("abc123def456");
    expect(output).toContain("can_execute");
    expect(output).toContain("| 5 |");
    expect(output).toContain("must_escalate");
    expect(output).toContain("| 2 |");
    expect(output).toContain("cannot_execute");
    expect(output).toContain("| 3 |");
  });

  it("returns message when no constitution loaded", () => {
    expect(formatConstitutionView(null)).toBe("No constitution loaded.");
  });
});

// ---------------------------------------------------------------------------
// constitution command
// ---------------------------------------------------------------------------

describe("constitution command", () => {
  it("returns formatted constitution from client.status", async () => {
    const api = createMockApi();
    const client = new SidecarClient("127.0.0.1", 18791);
    registerConstitutionCommand(api, client);

    mockStatus.mockResolvedValueOnce(FULL_STATUS);

    const cmd = api._commands.find((c) => c.name === "sanna constitution")!;
    const result = await cmd.handler("");

    expect(result).toContain("acme-policy");
    expect(result).toContain("Boundaries");
  });
});
