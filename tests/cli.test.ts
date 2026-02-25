import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";
import type { CliDeps } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Mock @sanna/core and http
// ---------------------------------------------------------------------------

const mockStoreCount = vi.fn(() => 0);
const mockStoreQuery = vi.fn(() => []);
const mockReadHooksEnabled = vi.fn(() => true);

vi.mock("@sanna/core", () => ({
  ReceiptStore: vi.fn(),
}));

vi.mock("../src/http.js", () => ({
  readHooksEnabled: () => mockReadHooksEnabled(),
}));

import { registerCli } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CliRegistration {
  fn: (ctx: { program: unknown }) => void;
  opts: { commands: string[] };
}

interface MockAPI extends PluginAPI {
  _cliRegistrations: CliRegistration[];
}

function createMockApi(): MockAPI {
  const cliRegistrations: CliRegistration[] = [];
  return {
    _cliRegistrations: cliRegistrations,
    registerTool: vi.fn(),
    registerService: vi.fn(),
    registerHook: vi.fn(),
    on: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerCli(
      fn: (ctx: { program: unknown }) => void,
      opts?: { commands: string[] }
    ) {
      cliRegistrations.push({ fn, opts: opts ?? { commands: [] } });
    },
    config: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const DEFAULT_CONFIG: SannaConfig = {
  enforcementMode: "enforce",
  governedTools: ["exec", "write"],
};

function createDeps(): CliDeps {
  return {
    constitution: {
      schema_version: "0.1.0",
      identity: {
        agent_name: "test-agent",
        domain: "testing",
        description: "test",
        extensions: {},
      },
      policy_hash: "test-hash",
    } as CliDeps["constitution"],
    store: {
      count: mockStoreCount,
      query: mockStoreQuery,
      save: vi.fn(),
      close: vi.fn(),
    } as unknown as CliDeps["store"],
    constitutionPath: "/path/to/constitution.yaml",
  };
}

// Track registered subcommands
interface CommandRecord {
  name: string;
  description?: string;
  action?: (...args: unknown[]) => void | Promise<void>;
  options: Array<{ flags: string; desc: string }>;
  argument?: string;
}

function createMockProgram(): {
  program: unknown;
  commands: CommandRecord[];
} {
  const commands: CommandRecord[] = [];

  function makeCommandBuilder(record: CommandRecord): unknown {
    const builder = {
      description(desc: string) {
        record.description = desc;
        return builder;
      },
      option(flags: string, desc: string) {
        record.options.push({ flags, desc });
        return builder;
      },
      argument(arg: string) {
        record.argument = arg;
        return builder;
      },
      action(fn: (...args: unknown[]) => void | Promise<void>) {
        record.action = fn;
        return builder;
      },
      command(name: string) {
        const sub: CommandRecord = { name, options: [] };
        commands.push(sub);
        return makeCommandBuilder(sub);
      },
    };
    return builder;
  }

  const program = {
    command(name: string) {
      const record: CommandRecord = { name, options: [] };
      commands.push(record);
      return makeCommandBuilder(record);
    },
  };

  return { program, commands };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreCount.mockReturnValue(0);
  mockStoreQuery.mockReturnValue([]);
  mockReadHooksEnabled.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// registerCli
// ---------------------------------------------------------------------------

describe("registerCli", () => {
  it("registers with commands: ['sanna']", () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG, createDeps());

    expect(api._cliRegistrations).toHaveLength(1);
    expect(api._cliRegistrations[0].opts.commands).toEqual(["sanna"]);
  });

  it("creates sanna parent command with status, audit, verify, doctor subcommands", () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG, createDeps());

    const { program, commands } = createMockProgram();
    api._cliRegistrations[0].fn({ program });

    const names = commands.map((c) => c.name);
    expect(names).toContain("sanna");
    expect(names).toContain("status");
    expect(names).toContain("audit");
    expect(names).toContain("verify");
    expect(names).toContain("doctor");
  });

  it("verify command accepts receipt-id argument", () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG, createDeps());

    const { program, commands } = createMockProgram();
    api._cliRegistrations[0].fn({ program });

    const verify = commands.find((c) => c.name === "verify");
    expect(verify).toBeDefined();
    expect(verify!.argument).toBe("<receipt-id>");
  });

  it("audit command has --limit option", () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG, createDeps());

    const { program, commands } = createMockProgram();
    api._cliRegistrations[0].fn({ program });

    const audit = commands.find((c) => c.name === "audit");
    expect(audit).toBeDefined();
    expect(audit!.options.some((o) => o.flags.includes("--limit"))).toBe(true);
  });

  it("audit command queries receipt store", async () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG, createDeps());

    const { program, commands } = createMockProgram();
    api._cliRegistrations[0].fn({ program });

    const audit = commands.find((c) => c.name === "audit");
    expect(audit).toBeDefined();
    expect(audit!.action).toBeDefined();

    mockStoreQuery.mockReturnValue([]);
    await audit!.action!({ limit: "50" });

    expect(mockStoreQuery).toHaveBeenCalledOnce();
  });

  it("doctor command checks hooks, constitution, and store", async () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG, createDeps());

    const { program, commands } = createMockProgram();
    api._cliRegistrations[0].fn({ program });

    const doctor = commands.find((c) => c.name === "doctor");
    expect(doctor).toBeDefined();
    expect(doctor!.action).toBeDefined();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await doctor!.action!();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("PASS");
    expect(output).toContain("hooks.internal.enabled");
    expect(output).toContain("constitution");
    expect(output).toContain("receipt store");
    consoleSpy.mockRestore();
  });
});
