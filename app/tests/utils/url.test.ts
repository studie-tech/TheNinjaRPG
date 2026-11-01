import { afterEach, describe, expect, it, vi } from "bun:test";
import { isUrlAccessible } from "@/utils/url";

// A public IP literal keeps the real SSRF checks independent of external DNS.
const url = "https://203.0.113.10/image.webp";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("isUrlAccessible", () => {
  it.each([200, 404, 503])("treats an HTTP %s response as reachable", async (status) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    globalThis.fetch = fetchMock as typeof fetch;

    expect(await isUrlAccessible(url)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({
      method: "HEAD",
      signal: expect.any(AbortSignal),
    }));
  });

  it.each([new TypeError("Connection reset"), new DOMException("Timed out", "AbortError")])(
    "rejects a failed request: %s",
    async (error) => {
      error.stack = `${error.name}: ${error.message}\n    at fetch(fetch:1:1)`;
      const fetchMock = vi.fn(async () => { throw error; });
      globalThis.fetch = fetchMock as typeof fetch;

      expect(await isUrlAccessible(url)).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("blocks private addresses before making a request", async () => {
    const fetchMock = vi.fn(async () => new Response());
    globalThis.fetch = fetchMock as typeof fetch;

    expect(await isUrlAccessible("http://127.0.0.1/private")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
