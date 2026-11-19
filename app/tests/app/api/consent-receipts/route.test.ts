import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { POST } from "@/app/api/consent-receipts/route";
import { snapshotEnv } from "../../../setup/env";

const receipt = {
  consentId: "9fd42109-92aa-44ec-8354-5b341f3d6ef9",
  revision: 2,
  categories: ["necessary"],
  consentTimestamp: new Date().toISOString(),
  language: "en",
};
const request = (body: unknown = receipt, headers: Record<string, string> = {}) =>
  new Request("https://www.theninja-rpg.com/api/consent-receipts", {
    method: "POST",
    headers: {
      Origin: "https://www.theninja-rpg.com",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

afterAll(snapshotEnv("CONSENT_RECEIPTS_URL"));
beforeEach(() => {
  process.env.CONSENT_RECEIPTS_URL = "https://collector.example.com/receipts";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("anonymous consent receipt integration", () => {
  it("forwards only a minimal receipt and acknowledges a successful upstream write", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const result = await POST(
      request(receipt, {
        Cookie: "session=private",
        Authorization: "Bearer private",
        Referer: "https://www.theninja-rpg.com/profile",
        "X-Forwarded-For": "192.0.2.1",
      }),
    );
    expect(result.status).toBe(204);
    expect(result.headers.get("cache-control")).toBe("no-store");
    const [destination, options] = send.mock.calls[0] ?? [];
    expect(destination).toBe("https://collector.example.com/receipts");
    expect(JSON.parse(String(options?.body))).toEqual(receipt);
    expect(options?.headers).toEqual({
      "Content-Type": "application/json",
      Origin: "https://www.theninja-rpg.com",
    });
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(await result.text()).not.toContain("collector");
  });

  it.each([
    [request(receipt, { Origin: "https://other.example" }), 403],
    [request(receipt, { "Content-Type": "text/plain" }), 415],
    [request({ ...receipt, userId: "private-account" }), 400],
    [request({ ...receipt, categories: ["unknown"] }), 400],
    [request({ ...receipt, consentId: "invalid" }), 400],
    [request({ ...receipt, categories: ["marketing"] }), 400],
    [request({ ...receipt, extra: "a".repeat(2048) }), 413],
  ])("rejects invalid input before forwarding", async (input, status) => {
    const send = vi.spyOn(globalThis, "fetch");
    expect((await POST(input as Request)).status).toBe(status as number);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([400, 429, 500])(
    "keeps failed upstream delivery retryable",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
      const result = await POST(request());
      expect(result.status).toBe(503);
      expect(await result.text()).not.toContain("collector.example.com");
    },
  );

  it("does not acknowledge unavailable or unconfigured collection", async () => {
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network unavailable"));
    expect((await POST(request())).status).toBe(503);
    send.mockClear();
    delete process.env.CONSENT_RECEIPTS_URL;
    expect((await POST(request())).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  it("requires HTTPS for the server-only destination", async () => {
    const { serverSchema } = await import("@/env/schema.mjs");
    expect(serverSchema.shape.CONSENT_RECEIPTS_URL.safeParse(undefined).success).toBe(
      true,
    );
    expect(
      serverSchema.shape.CONSENT_RECEIPTS_URL.safeParse(
        "https://collector.example.com/receipts",
      ).success,
    ).toBe(true);
    expect(
      serverSchema.shape.CONSENT_RECEIPTS_URL.safeParse(
        "http://collector.example.com/receipts",
      ).success,
    ).toBe(false);
  });
});
