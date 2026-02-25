import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI } from "../src/types.js";

// ---------------------------------------------------------------------------
// Mocks — isolate index.ts from real side effects
// ---------------------------------------------------------------------------

const mockReadHooksEnabled = vi.fn(() => true);
vi.mock("../src/http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/http.js")>();
  return {
    ...actual,
    readHooksEnabled: () => mockReadHooksEnabled(),
  };
});

vi.mock("../src/sidecar.js", () => ({ registerSidecar: vi.fn() }));
vi.mock("../src/hooks.js", () => ({ registerHooks: vi.fn() }));
vi.mock("../src/gateway.js", () => ({ registerGatewayMethods: vi.fn() }));
vi.mock("../src/cli.js", () => ({ registerCli: vi.fn() }));

import register from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockApi(configOverrides?: Record<string, unknown>): PluginAPI {
  return {
    registerTool: vi.fn(),
    registerService: vi.fn(),
    registerHook: vi.fn(),
    on: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerCli: vi.fn(),
    config: configOverrides ?? {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("register — hooks.internal.enabled check", () => {
  it("succeeds when hooks.internal.enabled is true", () => {
    mockReadHooksEnabled.mockReturnValue(true);
    const api = createMockApi();

    expect(() => register(api)).not.toThrow();
    expect(api.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Governance plugin loaded")
    );
  });

  it("throws in enforce mode when hooks.internal.enabled is false", () => {
    mockReadHooksEnabled.mockReturnValue(false);
    const api = createMockApi({ enforcementMode: "enforce" });

    expect(() => register(api)).toThrow("hooks.internal.enabled");
    expect(api.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("hooks.internal.enabled")
    );
  });

  it("warns but does not throw in audit mode when hooks.internal.enabled is false", () => {
    mockReadHooksEnabled.mockReturnValue(false);
    const api = createMockApi({ enforcementMode: "audit" });

    expect(() => register(api)).not.toThrow();
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("hooks.internal.enabled")
    );
  });

  it("warns but does not throw in passthrough mode when hooks.internal.enabled is false", () => {
    mockReadHooksEnabled.mockReturnValue(false);
    const api = createMockApi({ enforcementMode: "passthrough" });

    expect(() => register(api)).not.toThrow();
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("hooks.internal.enabled")
    );
  });
});
