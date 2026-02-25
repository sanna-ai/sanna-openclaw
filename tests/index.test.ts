import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI } from "../src/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReadHooksEnabled = vi.fn(() => true);
vi.mock("../src/http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/http.js")>();
  return {
    ...actual,
    readHooksEnabled: () => mockReadHooksEnabled(),
  };
});

const mockLoadConstitution = vi.fn();
const mockLoadPrivateKey = vi.fn();
const mockReceiptStoreInstance = { save: vi.fn(), count: vi.fn(), query: vi.fn(), close: vi.fn() };
vi.mock("@sanna-ai/core", () => ({
  loadConstitution: (...args: unknown[]) => mockLoadConstitution(...args),
  loadPrivateKey: (...args: unknown[]) => mockLoadPrivateKey(...args),
  ReceiptStore: vi.fn(() => mockReceiptStoreInstance),
}));

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

const fakeConstitution = {
  schema_version: "0.1.0",
  identity: { agent_name: "test-agent", domain: "testing", description: "test", extensions: {} },
  provenance: { authored_by: "test", approved_by: [], approval_date: "", approval_method: "", change_history: [], signature: null },
  boundaries: [],
  trust_tiers: { autonomous: [], requires_approval: [], prohibited: [] },
  halt_conditions: [],
  invariants: [],
  policy_hash: "test-hash",
  authority_boundaries: null,
  trusted_sources: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockReadHooksEnabled.mockReturnValue(true);
  mockLoadConstitution.mockReturnValue(fakeConstitution);
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

describe("register — constitution loading", () => {
  it("loads constitution from auto-discovered path", () => {
    const api = createMockApi();

    expect(() => register(api)).not.toThrow();
    expect(mockLoadConstitution).toHaveBeenCalled();
  });

  it("throws in enforce mode when constitution fails to load", () => {
    mockLoadConstitution.mockImplementation(() => {
      throw new Error("invalid YAML");
    });
    const api = createMockApi({ enforcementMode: "enforce" });

    expect(() => register(api)).toThrow("invalid YAML");
  });

  it("warns in audit mode when constitution fails to load", () => {
    mockLoadConstitution.mockImplementation(() => {
      throw new Error("invalid YAML");
    });
    const api = createMockApi({ enforcementMode: "audit" });

    expect(() => register(api)).not.toThrow();
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("invalid YAML")
    );
  });
});
