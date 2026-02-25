import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:fs before importing http module
const mockReadFileSync = vi.fn();
vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import { fetchWithTimeout, readGatewayToken } from "../src/http.js";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchWithTimeout", () => {
  it("passes method, headers, and body through to fetch", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await fetchWithTimeout(
      "http://localhost:9999/test",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Custom": "val" },
        body: '{"key":"value"}',
      },
      5000
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:9999/test");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["X-Custom"]).toBe("val");
    expect(init.body).toBe('{"key":"value"}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts the request on timeout", async () => {
    vi.useFakeTimers();

    // fetch never resolves — simulates a hang
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError"))
          );
        })
    );

    const promise = fetchWithTimeout(
      "http://localhost:9999/slow",
      {},
      1000
    );

    vi.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow("aborted");

    vi.useRealTimers();
  });

  it("clears the timeout timer on successful response", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await fetchWithTimeout("http://localhost:9999/fast", {}, 5000);

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe("readGatewayToken", () => {
  it("reads token from openclaw.json gateway.auth.token", async () => {
    // Reset cached token by re-importing with fresh module
    // Since the cache is module-level, we test via the mock behavior
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({ gateway: { auth: { token: "my-secret-token" } } })
    );

    // Force fresh import to reset cache
    const mod = await import("../src/http.js?" + Date.now());
    const token = mod.readGatewayToken();

    expect(token).toBe("my-secret-token");
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining("openclaw.json"),
      "utf-8"
    );
  });

  it("returns empty string when file does not exist", async () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });

    const mod = await import("../src/http.js?" + Date.now());
    const token = mod.readGatewayToken();

    expect(token).toBe("");
  });

  it("returns empty string when token path is missing", async () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ gateway: {} }));

    const mod = await import("../src/http.js?" + Date.now());
    const token = mod.readGatewayToken();

    expect(token).toBe("");
  });
});
