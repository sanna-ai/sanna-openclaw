import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout } from "../src/http.js";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
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
