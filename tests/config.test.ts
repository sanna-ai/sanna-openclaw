import { describe, it, expect, vi } from "vitest";
import type { PluginAPI } from "../src/types.js";
import {
  resolveConfig,
  DEFAULT_CONFIG,
} from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockApi(
  configOverrides?: Record<string, unknown>
): PluginAPI {
  return {
    config: {
      plugins: {
        entries: {
          sanna: {
            config: configOverrides ?? {},
          },
        },
      },
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    registerTool: vi.fn(),
    registerService: vi.fn(),
    registerHook: vi.fn(),
    on: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerCli: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// resolveConfig
// ---------------------------------------------------------------------------

describe("resolveConfig", () => {
  it("returns defaults when no plugin config", () => {
    const api = createMockApi();
    const config = resolveConfig(api);

    expect(config.constitutionPath).toBe("");
    expect(config.privateKeyPath).toBe("");
    expect(config.receiptStorePath).toBe("");
    expect(config.enforcementMode).toBe("enforce");
  });

  it("merges custom enforcementMode", () => {
    const api = createMockApi({
      enforcementMode: "audit",
    });
    const config = resolveConfig(api);

    expect(config.enforcementMode).toBe("audit");
  });

  it("merges constitutionPath", () => {
    const api = createMockApi({
      constitutionPath: "/path/to/constitution.yaml",
    });
    const config = resolveConfig(api);

    expect(config.constitutionPath).toBe("/path/to/constitution.yaml");
  });

  it("merges privateKeyPath", () => {
    const api = createMockApi({
      privateKeyPath: "/path/to/key.pem",
    });
    const config = resolveConfig(api);

    expect(config.privateKeyPath).toBe("/path/to/key.pem");
  });

  it("llmChecks defaults to false", () => {
    const api = createMockApi();
    const config = resolveConfig(api);

    expect(config.llmChecks).toBe(false);
  });

  it("customEvaluatorsPath defaults to empty string", () => {
    const api = createMockApi();
    const config = resolveConfig(api);

    expect(config.customEvaluatorsPath).toBe("");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_CONFIG", () => {
  it("has correct default values", () => {
    expect(DEFAULT_CONFIG.constitutionPath).toBe("");
    expect(DEFAULT_CONFIG.privateKeyPath).toBe("");
    expect(DEFAULT_CONFIG.receiptStorePath).toBe("");
    expect(DEFAULT_CONFIG.enforcementMode).toBe("enforce");
  });
});
