// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import { env } from "@/env/server.mjs";
import { getStripe } from "@/server/utils/stripe/client";
import * as fulfillment from "@/server/utils/stripe/fulfillment";

const original = { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET };
const secret = "whsec_local_signature_test";
const payload = (type = "product.created", livemode = false) => JSON.stringify({ id: "evt_test", object: "event", type, livemode, data: { object: { id: "cs_test_session" } } });
const signed = (body: string, timestamp?: number) => getStripe().webhooks.generateTestHeaderStringAsync({ payload: body, secret, ...(timestamp ? { timestamp } : {}) });
const request = (body: string, signature?: string) => new Request("http://localhost/api/webhooks/stripe", { method: "POST", body, headers: signature ? { "stripe-signature": signature } : {} });

describe("Stripe webhook authentication and retry contract", () => {
  beforeEach(() => { env.STRIPE_SECRET_KEY = "sk_test_placeholder"; env.STRIPE_WEBHOOK_SECRET = secret; });
  afterEach(() => { vi.restoreAllMocks(); Object.assign(env, original); });
  it("rejects unsigned payloads", async () => expect((await POST(request(payload()))).status).toBe(400));
  it("rejects a tampered payload and a forged signature", async () => {
    const body = payload();
    expect((await POST(request(body + " ", await signed(body)))).status).toBe(400);
    expect((await POST(request(body, "t=1,v1=forged"))).status).toBe(400);
  });
  it("rejects stale signatures and the opposite Stripe environment", async () => {
    const body = payload();
    expect((await POST(request(body, await signed(body, Math.floor(Date.now() / 1000) - 600)))).status).toBe(400);
    const live = payload("product.created", true);
    expect((await POST(request(live, await signed(live)))).status).toBe(400);
  });
  it("acknowledges valid unrelated events without attempting fulfillment", async () => {
    const handler = vi.spyOn(fulfillment, "fulfillStripeSession");
    const body = payload(); expect((await POST(request(body, await signed(body)))).status).toBe(200);
    expect(handler).not.toHaveBeenCalled();
  });
  it("uses only the verified object's id for session fulfillment", async () => {
    const handler = vi.spyOn(fulfillment, "fulfillStripeSession").mockResolvedValue("fulfilled");
    const body = payload("checkout.session.completed");
    expect((await POST(request(body, await signed(body)))).status).toBe(200);
    expect(handler.mock.calls[0]?.[1]).toBe("cs_test_session");
  });
  it("requests retries when confirmed payment delivery fails", async () => {
    vi.spyOn(fulfillment, "fulfillStripeSession").mockRejectedValue(new Error("Transient database failure"));
    const body = payload("checkout.session.completed");
    expect((await POST(request(body, await signed(body)))).status).toBe(500);
  });
  it("stays unavailable when its verification secret is missing", async () => {
    env.STRIPE_WEBHOOK_SECRET = undefined;
    expect((await POST(request(payload()))).status).toBe(503);
  });
});
