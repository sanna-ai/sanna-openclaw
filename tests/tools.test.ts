import { describe, it, expect, vi } from "vitest";
import type { PluginAPI, SannaConfig } from "../src/types.js";
import { registerTools, KNOWN_SCHEMAS, COMPOSITE_TOOLS } from "../src/tools.js";
import { GOVERNED_TOOLS_DEFAULT } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockApi(): PluginAPI {
  return {
    registerTool: vi.fn(),
    registerService: vi.fn(),
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
  enforcementMode: "enforce",
  governedTools: GOVERNED_TOOLS_DEFAULT,
};

// ---------------------------------------------------------------------------
// registerTools — now a no-op (hook-based enforcement)
// ---------------------------------------------------------------------------

describe("registerTools", () => {
  it("does not register any wrapper tools", () => {
    const api = createMockApi();
    registerTools(api, DEFAULT_CONFIG);

    expect(api.registerTool).not.toHaveBeenCalled();
  });

  it("does not throw", () => {
    const api = createMockApi();
    expect(() => registerTools(api, DEFAULT_CONFIG)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// KNOWN_SCHEMAS — retained for reference
// ---------------------------------------------------------------------------

describe("KNOWN_SCHEMAS", () => {
  it("covers exec, write, edit, browser, message", () => {
    expect(Object.keys(KNOWN_SCHEMAS)).toEqual(
      expect.arrayContaining(["exec", "write", "edit", "browser", "message"])
    );
  });

  it("all schemas have additionalProperties: true", () => {
    for (const schema of Object.values(KNOWN_SCHEMAS)) {
      expect(schema.additionalProperties).toBe(true);
    }
  });

  it("exec requires command", () => {
    expect(KNOWN_SCHEMAS.exec.required).toEqual(["command"]);
  });

  it("write requires path and content", () => {
    expect(KNOWN_SCHEMAS.write.required).toEqual(["path", "content"]);
  });

  it("browser requires action", () => {
    expect(KNOWN_SCHEMAS.browser.required).toEqual(["action"]);
  });
});

// ---------------------------------------------------------------------------
// COMPOSITE_TOOLS
// ---------------------------------------------------------------------------

describe("COMPOSITE_TOOLS", () => {
  it("includes browser, message, nodes, cron, gateway", () => {
    expect(COMPOSITE_TOOLS.has("browser")).toBe(true);
    expect(COMPOSITE_TOOLS.has("message")).toBe(true);
    expect(COMPOSITE_TOOLS.has("nodes")).toBe(true);
    expect(COMPOSITE_TOOLS.has("cron")).toBe(true);
    expect(COMPOSITE_TOOLS.has("gateway")).toBe(true);
  });

  it("does not include simple tools", () => {
    expect(COMPOSITE_TOOLS.has("exec")).toBe(false);
    expect(COMPOSITE_TOOLS.has("write")).toBe(false);
  });
});
