import { describe, it, expect, vi } from "vitest";

// Mock node:fs before importing http module
const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

describe("readHooksEnabled", () => {
  it("returns true when hooks.internal.enabled is true", async () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ hooks: { internal: { enabled: true } } })
    );

    const mod = await import("../src/http.js?" + Date.now());
    expect(mod.readHooksEnabled()).toBe(true);
  });

  it("returns false when hooks.internal.enabled is not set", async () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({}));

    const mod = await import("../src/http.js?" + Date.now());
    expect(mod.readHooksEnabled()).toBe(false);
  });

  it("returns false when file does not exist", async () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });

    const mod = await import("../src/http.js?" + Date.now());
    expect(mod.readHooksEnabled()).toBe(false);
  });

  it("returns false when hooks.internal.enabled is false", async () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ hooks: { internal: { enabled: false } } })
    );

    const mod = await import("../src/http.js?" + Date.now());
    expect(mod.readHooksEnabled()).toBe(false);
  });
});
