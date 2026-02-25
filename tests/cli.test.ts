import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";
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
    registerGatewayMethod: vi.fn(),
    registerCli(fn: (ctx: { program: unknown }) => void, opts?: { commands: string[] }) {
      cliRegistrations.push({ fn, opts: opts ?? { commands: [] } });
    },
    config: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

const DEFAULT_CONFIG: SannaConfig = {
  sidecarPort: 18890,
  enforcementMode: "enforce",
  constitutionPath: "/path/to/constitution.yaml",
  governedTools: ["exec", "write"],
};

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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// registerCli
// ---------------------------------------------------------------------------

describe("registerCli", () => {
  it("registers with commands: ['sanna']", () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG);

    expect(api._cliRegistrations).toHaveLength(1);
    expect(api._cliRegistrations[0].opts.commands).toEqual(["sanna"]);
  });

  it("creates sanna parent command with status, audit, verify subcommands", () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG);

    const { program, commands } = createMockProgram();
    api._cliRegistrations[0].fn({ program });

    const names = commands.map((c) => c.name);
    expect(names).toContain("sanna");
    expect(names).toContain("status");
    expect(names).toContain("audit");
    expect(names).toContain("verify");
  });

  it("verify command accepts receipt-hash argument", () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG);

    const { program, commands } = createMockProgram();
    api._cliRegistrations[0].fn({ program });

    const verify = commands.find((c) => c.name === "verify");
    expect(verify).toBeDefined();
    expect(verify!.argument).toBe("<receipt-hash>");
  });

  it("audit command has --limit option", () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG);

    const { program, commands } = createMockProgram();
    api._cliRegistrations[0].fn({ program });

    const audit = commands.find((c) => c.name === "audit");
    expect(audit).toBeDefined();
    expect(audit!.options.some((o) => o.flags.includes("--limit"))).toBe(true);
  });

  it("audit command uses POST method with limit in body", async () => {
    const api = createMockApi();
    registerCli(api, DEFAULT_CONFIG);

    const { program, commands } = createMockProgram();
    api._cliRegistrations[0].fn({ program });

    const audit = commands.find((c) => c.name === "audit");
    expect(audit).toBeDefined();
    expect(audit!.action).toBeDefined();

    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    // Invoke the audit action with opts
    await audit!.action!({ limit: "50" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18890/audit");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.limit).toBe(50);
  });
});
