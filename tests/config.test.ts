import { describe, it, expect, vi } from "vitest";
import type { PluginAPI } from "../src/types.js";
import {
  resolveConfig,
  DEFAULT_CONFIG,
  GOVERNED_TOOLS_DEFAULT,
} from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockApi(
  configOverrides?: Record<string, unknown>
): PluginAPI {
  return {
    config: configOverrides ?? {},
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    registerTool: vi.fn(),
    registerService: vi.fn(),
    registerHook: vi.fn(),
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
    expect(config.gatewayPort).toBe(18789);
    expect(config.gatewayToken).toBe("");
    expect(config.sidecarPort).toBe(18890);
    expect(config.governedTools).toEqual(GOVERNED_TOOLS_DEFAULT);
    expect(config.enforcementMode).toBe("enforce");
  });

  it("merges custom governedTools", () => {
    const api = createMockApi({
      governedTools: ["exec", "write"],
    });
    const config = resolveConfig(api);

    expect(config.governedTools).toEqual(["exec", "write"]);
    // Other fields still have defaults
    expect(config.sidecarPort).toBe(18890);
    expect(config.enforcementMode).toBe("enforce");
  });

  it("merges custom enforcementMode", () => {
    const api = createMockApi({
      enforcementMode: "audit",
    });
    const config = resolveConfig(api);

    expect(config.enforcementMode).toBe("audit");
  });

  it("merges custom gatewayPort and gatewayToken", () => {
    const api = createMockApi({
      gatewayPort: 9999,
      gatewayToken: "secret-token",
    });
    const config = resolveConfig(api);

    expect(config.gatewayPort).toBe(9999);
    expect(config.gatewayToken).toBe("secret-token");
  });

  it("merges constitutionPath", () => {
    const api = createMockApi({
      constitutionPath: "/path/to/constitution.yaml",
    });
    const config = resolveConfig(api);

    expect(config.constitutionPath).toBe("/path/to/constitution.yaml");
  });
});

// ---------------------------------------------------------------------------
// GOVERNED_TOOLS_DEFAULT
// ---------------------------------------------------------------------------

describe("GOVERNED_TOOLS_DEFAULT", () => {
  it("contains all tier 1 tools", () => {
    const tier1 = ["exec", "bash", "write", "edit", "apply_patch", "process"];
    for (const tool of tier1) {
      expect(GOVERNED_TOOLS_DEFAULT).toContain(tool);
    }
  });

  it("contains all tier 2 tools", () => {
    const tier2 = ["browser", "message", "nodes"];
    for (const tool of tier2) {
      expect(GOVERNED_TOOLS_DEFAULT).toContain(tool);
    }
  });

  it("contains all tier 3 tools", () => {
    const tier3 = [
      "web_search",
      "web_fetch",
      "cron",
      "gateway",
      "sessions_send",
      "sessions_spawn",
    ];
    for (const tool of tier3) {
      expect(GOVERNED_TOOLS_DEFAULT).toContain(tool);
    }
  });

  it("does not contain tier 4 tools", () => {
    const tier4 = [
      "read",
      "image",
      "canvas",
      "sessions_list",
      "sessions_history",
      "session_status",
      "memory_search",
      "memory_get",
      "agents_list",
    ];
    for (const tool of tier4) {
      expect(GOVERNED_TOOLS_DEFAULT).not.toContain(tool);
    }
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_CONFIG", () => {
  it("has correct default values", () => {
    expect(DEFAULT_CONFIG.constitutionPath).toBe("");
    expect(DEFAULT_CONFIG.gatewayPort).toBe(18789);
    expect(DEFAULT_CONFIG.gatewayToken).toBe("");
    expect(DEFAULT_CONFIG.sidecarPort).toBe(18890);
    expect(DEFAULT_CONFIG.enforcementMode).toBe("enforce");
    expect(DEFAULT_CONFIG.governedTools).toEqual(GOVERNED_TOOLS_DEFAULT);
  });
});
