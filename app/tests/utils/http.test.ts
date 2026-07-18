import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "@/utils/http";

// Tiny backoff so retry tests run in milliseconds with real timers
const FAST = { maxRetries: 3, baseDelayMs: 1, deadlineMs: 5_000 };

const okResponse = (body: string) => new Response(body, { status: 200 });

describe("fetchWithRetry", () => {
  // bun's vitest shim lacks vi.stubGlobal; save/restore the real fetch instead
  const realFetch = globalThis.fetch;
  const stubFetch = (mock: unknown) => {
    globalThis.fetch = mock as typeof fetch;
  };
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("returns the response on first success without retrying", async () => {
    const fetchMock = vi.fn(async () => okResponse("hello"));
    stubFetch(fetchMock);
    const response = await fetchWithRetry("https://example.test/a", {}, 1000, FAST);
    expect(await response.text()).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and succeeds with a readable (unconsumed) body", async () => {
    let calls = 0;
    stubFetch(
      vi.fn(async () => {
        calls += 1;
        if (calls < 3) throw new TypeError("network error");
        return okResponse('{"value":42}');
      }),
    );
    const response = await fetchWithRetry("https://example.test/b", {}, 1000, FAST);
    // Each attempt is a fresh request, so the body is never pre-consumed
    expect(await response.json()).toEqual({ value: 42 });
    expect(calls).toBe(3);
  });

  it("treats non-2xx responses as failures and retries them", async () => {
    let calls = 0;
    stubFetch(
      vi.fn(async () => {
        calls += 1;
        return calls < 2 ? new Response("boom", { status: 503 }) : okResponse("ok");
      }),
    );
    const response = await fetchWithRetry("https://example.test/c", {}, 1000, FAST);
    expect(response.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("throws the HTTP error after exhausting retries", async () => {
    const fetchMock = vi.fn(async () => new Response("gone", { status: 500 }));
    stubFetch(fetchMock);
    await expect(
      fetchWithRetry("https://example.test/d", {}, 1000, FAST),
    ).rejects.toThrow("HTTP 500");
    // 1 initial + maxRetries attempts
    expect(fetchMock).toHaveBeenCalledTimes(1 + FAST.maxRetries);
  });
});
