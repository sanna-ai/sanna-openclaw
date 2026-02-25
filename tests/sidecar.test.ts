import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn();
const mockOn = vi.fn();
const mockKill = vi.fn();
const mockStdoutOn = vi.fn();
const mockStderrOn = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => {
    mockSpawn(...args);
    return {
      stdout: { on: mockStdoutOn },
      stderr: { on: mockStderrOn },
      on: mockOn,
      kill: mockKill,
      pid: 12345,
    };
  },
}));

import { registerSidecar } from "../src/sidecar.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ServiceDef {
  id: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

function createMockApi(): PluginAPI & { _services: ServiceDef[] } {
  const services: ServiceDef[] = [];
  return {
    _services: services,
    registerTool: vi.fn(),
    registerService(svc: ServiceDef) {
      services.push(svc);
    },
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
  constitutionPath: "/path/to/constitution.yaml",
  enforcementMode: "enforce",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// registerSidecar
// ---------------------------------------------------------------------------

describe("registerSidecar", () => {
  it("registers a service with id sanna-sidecar", () => {
    const api = createMockApi();
    registerSidecar(api, DEFAULT_CONFIG);

    expect(api._services).toHaveLength(1);
    expect(api._services[0].id).toBe("sanna-sidecar");
  });

  it("start() spawns python3 with correct args", async () => {
    const api = createMockApi();
    registerSidecar(api, DEFAULT_CONFIG);

    // Make health check pass immediately
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await api._services[0].start();

    expect(mockSpawn).toHaveBeenCalledWith(
      "python3",
      ["-m", "sidecar", "--port", "18890", "--constitution", "/path/to/constitution.yaml"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        cwd: expect.any(String),
        env: expect.objectContaining({ PYTHONPATH: expect.stringContaining("sanna-openclaw") }),
      })
    );
  });

  it("start() succeeds when health check passes", async () => {
    const api = createMockApi();
    registerSidecar(api, DEFAULT_CONFIG);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    await api._services[0].start();

    expect(api.logger.info).toHaveBeenCalledWith(
      "[sanna] Sidecar started on port 18890"
    );
  });

  it("start() throws when health check never passes", async () => {
    const api = createMockApi();
    registerSidecar(api, DEFAULT_CONFIG);

    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(api._services[0].start()).rejects.toThrow(
      "Sidecar failed health check"
    );
    expect(mockKill).toHaveBeenCalledWith("SIGTERM");
  }, 15_000);

  it("stop() kills the child process", async () => {
    const api = createMockApi();
    registerSidecar(api, DEFAULT_CONFIG);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    await api._services[0].start();

    await api._services[0].stop();

    expect(mockKill).toHaveBeenCalledWith("SIGTERM");
    expect(api.logger.info).toHaveBeenCalledWith("[sanna] Sidecar stopped");
  });

  it("start() omits --constitution flag when no constitutionPath", async () => {
    const api = createMockApi();
    registerSidecar(api, { ...DEFAULT_CONFIG, constitutionPath: undefined });

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    await api._services[0].start();

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).not.toContain("--constitution");
  });
});
