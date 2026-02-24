import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { PluginConfig, Logger } from "../src/types.js";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures these exist before vi.mock() factories run
// ---------------------------------------------------------------------------

const {
  mockExecFile,
  mockSpawn,
  mockClientHealth,
  mockClientIsHealthy,
} = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
  mockClientHealth: vi.fn(),
  mockClientIsHealthy: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

vi.mock("../src/client.js", () => ({
  SidecarClient: vi.fn().mockImplementation(() => ({
    health: mockClientHealth,
    isHealthy: mockClientIsHealthy,
  })),
}));

// Import after mocks are set up
import { SidecarManager } from "../src/sidecar.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as unknown as Record<string, unknown>).stdout = new EventEmitter();
  (proc as unknown as Record<string, unknown>).stderr = new EventEmitter();
  (proc as unknown as Record<string, unknown>).kill = vi.fn();
  (proc as unknown as Record<string, unknown>).pid = 12345;
  return proc;
}

function makeConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    sidecarHost: "127.0.0.1",
    sidecarPort: 18791,
    governedTools: ["exec", "write"],
    ...overrides,
  };
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

type ExecFileCallback = (
  err: Error | null,
  stdout: string,
  stderr: string
) => void;

/** Mock execFile to return a python version string */
function mockPythonVersion(version: string): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], callback: ExecFileCallback) => {
      callback(null, `Python ${version}\n`, "");
      return {};
    }
  );
}

/** Mock execFile to fail (python not found) */
function mockPythonNotFound(): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], callback: ExecFileCallback) => {
      callback(new Error("ENOENT"), "", "");
      return {};
    }
  );
}

/** Set up standard mocks for a successful start */
function setupHappyPath(): ChildProcess {
  mockPythonVersion("3.12.0");
  const proc = createMockProcess();
  mockSpawn.mockReturnValue(proc);
  mockClientHealth.mockResolvedValue(true);
  return proc;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  // clearAllMocks preserves module mock implementations (SidecarClient factory)
  // while resetting call counts and return values
  vi.clearAllMocks();
  // Set default mock behaviors
  mockClientHealth.mockResolvedValue(true);
  mockClientIsHealthy.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// detectPython()
// ---------------------------------------------------------------------------

describe("detectPython", () => {
  it("parses a valid python3 version", async () => {
    mockPythonVersion("3.12.0");

    const mgr = new SidecarManager(makeConfig(), makeLogger());
    const result = await mgr.detectPython();

    expect(result).toBe("python3");
    expect(mockExecFile).toHaveBeenCalledWith(
      "python3",
      ["--version"],
      expect.any(Function)
    );
  });

  it("accepts Python 3.10 as minimum", async () => {
    mockPythonVersion("3.10.0");

    const mgr = new SidecarManager(makeConfig(), makeLogger());
    const result = await mgr.detectPython();

    expect(result).toBe("python3");
  });

  it("rejects Python older than 3.10", async () => {
    // python3 returns 3.8, python also returns 3.8
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: ExecFileCallback) => {
        callback(null, "Python 3.8.10\n", "");
        return {};
      }
    );

    const mgr = new SidecarManager(makeConfig(), makeLogger());
    await expect(mgr.detectPython()).rejects.toThrow("Python >=3.10 not found");
  });

  it("throws when no python is found", async () => {
    mockPythonNotFound();

    const mgr = new SidecarManager(makeConfig(), makeLogger());
    await expect(mgr.detectPython()).rejects.toThrow("Python >=3.10 not found");
  });

  it("falls back to python when python3 is missing", async () => {
    let callIndex = 0;
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], callback: ExecFileCallback) => {
        callIndex++;
        if (cmd === "python3") {
          callback(new Error("ENOENT"), "", "");
        } else {
          callback(null, "Python 3.11.5\n", "");
        }
        return {};
      }
    );

    const mgr = new SidecarManager(makeConfig(), makeLogger());
    const result = await mgr.detectPython();

    expect(result).toBe("python");
    expect(callIndex).toBe(2);
  });

  it("uses config.pythonPath when provided", async () => {
    mockPythonVersion("3.13.0");

    const mgr = new SidecarManager(
      makeConfig({ pythonPath: "/usr/local/bin/python3.13" }),
      makeLogger()
    );
    const result = await mgr.detectPython();

    expect(result).toBe("/usr/local/bin/python3.13");
    expect(mockExecFile).toHaveBeenCalledWith(
      "/usr/local/bin/python3.13",
      ["--version"],
      expect.any(Function)
    );
  });
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe("start", () => {
  it("spawns a python process with correct arguments", async () => {
    const proc = setupHappyPath();

    const config = makeConfig({
      constitutionPath: "./constitutions/default.yaml",
    });
    const mgr = new SidecarManager(config, makeLogger());
    await mgr.start();

    expect(mockSpawn).toHaveBeenCalledOnce();
    const [cmd, args, opts] = mockSpawn.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];

    expect(cmd).toBe("python3");
    expect(args).toContain("-m");
    expect(args).toContain("sidecar");
    expect(args).toContain("--host");
    expect(args).toContain("127.0.0.1");
    expect(args).toContain("--port");
    expect(args).toContain("18791");
    expect(args).toContain("--constitution");
    expect(args).toContain("./constitutions/default.yaml");
    expect(mgr.isRunning()).toBe(true);

    // Verify PYTHONPATH is set
    const env = (opts.env ?? {}) as Record<string, string>;
    expect(env.PYTHONPATH).toBeDefined();
  });

  it("includes --key and --receipt-store when configured", async () => {
    setupHappyPath();

    const config = makeConfig({
      constitutionPath: "./constitutions/test.yaml",
      signingKeyPath: "/keys/ed25519.pem",
      receiptStorePath: "/data/receipts.db",
    });
    const mgr = new SidecarManager(config, makeLogger());
    await mgr.start();

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain("--key");
    expect(args).toContain("/keys/ed25519.pem");
    expect(args).toContain("--receipt-store");
    expect(args).toContain("/data/receipts.db");
  });

  it("omits --constitution when not configured", async () => {
    setupHappyPath();

    const config = makeConfig({ constitutionPath: undefined });
    const mgr = new SidecarManager(config, makeLogger());
    await mgr.start();

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).not.toContain("--constitution");
  });

  it("skips start if already running", async () => {
    setupHappyPath();
    const log = makeLogger();

    const mgr = new SidecarManager(makeConfig(), log);
    await mgr.start();
    await mgr.start(); // second call

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      "Sidecar already running, skipping start"
    );
  });
});

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

describe("stop", () => {
  it("sends SIGTERM to the process", async () => {
    const proc = setupHappyPath();
    const mgr = new SidecarManager(makeConfig(), makeLogger());
    await mgr.start();

    const stopPromise = mgr.stop();
    // Simulate the process exiting after SIGTERM
    proc.emit("exit", 0);
    await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(mgr.isRunning()).toBe(false);
  });

  it("sends SIGKILL after timeout if process does not exit", async () => {
    const proc = setupHappyPath();
    const log = makeLogger();
    const mgr = new SidecarManager(makeConfig(), log);
    await mgr.start();

    const stopPromise = mgr.stop();
    // Advance past the 5s stop timeout without emitting exit
    await vi.advanceTimersByTimeAsync(5001);
    await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
    expect(log.warn).toHaveBeenCalledWith(
      "Sidecar did not exit gracefully, sending SIGKILL"
    );
  });

  it("is a no-op when no process is running", async () => {
    const mgr = new SidecarManager(makeConfig(), makeLogger());
    await mgr.stop(); // should not throw
    expect(mgr.isRunning()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// crash recovery
// ---------------------------------------------------------------------------

describe("crash recovery", () => {
  it("increments restart count on crash", async () => {
    const proc = setupHappyPath();
    const log = makeLogger();

    const mgr = new SidecarManager(makeConfig(), log);
    await mgr.start();

    expect(mgr.getRestartCount()).toBe(0);

    // Simulate a crash (not a deliberate stop)
    proc.emit("exit", 1);

    expect(mgr.getRestartCount()).toBe(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("Sidecar crashed (code 1)")
    );
  });

  it("schedules restart with exponential backoff", async () => {
    const proc = setupHappyPath();
    const log = makeLogger();

    const mgr = new SidecarManager(makeConfig(), log);
    await mgr.start();

    // Crash #1: delay should be 1000ms (1s * 2^0)
    proc.emit("exit", 1);

    expect(log.info).toHaveBeenCalledWith("Scheduling restart in 1000ms");
  });

  it("stops restarting after max restarts", async () => {
    const proc = setupHappyPath();
    const log = makeLogger();

    const mgr = new SidecarManager(makeConfig(), log);
    await mgr.start();

    // Simulate 6 crashes (MAX_RESTARTS=5, so crash 6 should not restart)
    for (let i = 1; i <= 6; i++) {
      proc.emit("exit", 1);
    }

    expect(mgr.getRestartCount()).toBe(6);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("Max restarts (5) exceeded")
    );
  });

  it("does not trigger crash recovery during intentional stop", async () => {
    const proc = setupHappyPath();
    const log = makeLogger();

    const mgr = new SidecarManager(makeConfig(), log);
    await mgr.start();

    const stopPromise = mgr.stop();
    proc.emit("exit", 0);
    await stopPromise;

    expect(mgr.getRestartCount()).toBe(0);
    // Should not log "Sidecar crashed"
    expect(log.error).not.toHaveBeenCalledWith(
      expect.stringContaining("Sidecar crashed")
    );
  });
});

// ---------------------------------------------------------------------------
// isHealthy()
// ---------------------------------------------------------------------------

describe("isHealthy", () => {
  it("delegates to client.isHealthy()", () => {
    mockClientIsHealthy.mockReturnValue(true);
    const mgr = new SidecarManager(makeConfig(), makeLogger());
    expect(mgr.isHealthy()).toBe(true);

    mockClientIsHealthy.mockReturnValue(false);
    expect(mgr.isHealthy()).toBe(false);
  });
});
