// @vitest-environment node
import type Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { paypalTransaction, stripeCheckout, stripePayment, userData } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { paypalRouter } from "@/server/api/routers/paypal";
import { stripeRouter } from "@/server/api/routers/stripe";
import * as stripeClient from "@/server/utils/stripe/client";
import { insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const BUYER = "stripe-buyer";
const RECIPIENT = "stripe-target";
const original = { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_NORMAL: env.STRIPE_PRICE_NORMAL, STRIPE_PRICE_SILVER: env.STRIPE_PRICE_SILVER, STRIPE_PRICE_GOLD: env.STRIPE_PRICE_GOLD };
const input = (points = 20) => ({ requestId: nanoid(), expectedUserId: BUYER, userId: RECIPIENT, purchase: { type: "reputation" as const, reputationPoints: points } });
let lostCreateResponse = false;
const sessions = new Map<string, Stripe.Checkout.Session>();
const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
  const id = `cs_test_${params.client_reference_id?.replace(/[_-]/g, "")}`;
  const session = { id, url: `https://checkout.stripe.com/${id}`, status: "open", metadata: params.metadata } as Stripe.Checkout.Session;
  sessions.set(id, session);
  if (lostCreateResponse) { lostCreateResponse = false; throw new Error("Stripe response lost"); }
  return session;
});
const retrieve = vi.fn(async (id: string) => sessions.get(id));
const expire = vi.fn(async (id: string) => { const session = sessions.get(id); if (session) session.status = "expired"; return session; });

const api = { checkout: { sessions: { create, retrieve, expire } }, prices: { retrieve: vi.fn() }, subscriptions: { retrieve: vi.fn(), update: vi.fn() } } as unknown as Stripe;

describeWithDatabase("Stripe router guards and durable checkout terms", () => {
  beforeEach(async () => {
    Object.assign(env, { STRIPE_SECRET_KEY: "sk_test_placeholder", STRIPE_WEBHOOK_SECRET: "whsec_placeholder", STRIPE_PRICE_NORMAL: "price_normal", STRIPE_PRICE_SILVER: "price_silver", STRIPE_PRICE_GOLD: "price_gold" });
    await resetTables(stripeCheckout, stripePayment, paypalTransaction, userData);
    await insertUsers([{ userId: BUYER, username: BUYER, reputationPoints: 0 }, { userId: RECIPIENT, username: RECIPIENT, reputationPoints: 0 }]);
    sessions.clear(); lostCreateResponse = false; create.mockClear(); retrieve.mockClear(); expire.mockClear();
    vi.spyOn(stripeClient, "getStripe").mockReturnValue(api);
  });
  afterEach(() => { vi.restoreAllMocks(); Object.assign(env, original); });
  it("creates server-priced USD checkout with adaptive currency conversion disabled", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = input();
    const result = await caller.createCheckout(purchase);
    expect(result.success).toBe(true);
    const params = create.mock.calls[0]?.[0];
    expect(params?.adaptive_pricing).toEqual({ enabled: false });
    expect(params?.automatic_tax).toEqual({ enabled: true });
    expect(params?.billing_address_collection).toBe("required");
    expect(params?.customer_creation).toBe("always");
    expect(params?.line_items?.[0]?.price_data?.tax_behavior).toBe("inclusive");
    expect(params?.allowed_payment_method_types).toEqual(["card"]);
    expect(params?.line_items?.[0]?.price_data?.currency).toBe("usd");
    expect(await (await getTestDatabase()).query.stripeCheckout.findFirst({ where: eq(stripeCheckout.id, purchase.requestId) })).toMatchObject({ createdById: BUYER, affectedUserId: RECIPIENT });
    expect(await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, RECIPIENT) })).toMatchObject({ reputationPoints: 0 });
  });
  it("retry resumes the same session and changed request terms are rejected", async () => {
    const caller = await callerFor(stripeRouter, BUYER); const purchase = input();
    const first = await caller.createCheckout(purchase);
    expect(await caller.createCheckout(purchase)).toEqual({ ...first, message: "Continue checkout" });
    expect(create).toHaveBeenCalledTimes(1);
    expect((await caller.createCheckout({ ...purchase, userId: BUYER })).success).toBe(false);
  });
  it("recovers an unknown creation response after one hour with unchanged provider terms", async () => {
    const caller = await callerFor(stripeRouter, BUYER); const purchase = input(3000);
    lostCreateResponse = true;
    await expect(caller.createCheckout(purchase)).rejects.toThrow("Stripe response lost");
    const originalParams = create.mock.calls[0]?.[0]; const before = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(before + 2 * 3600000);
    expect((await caller.createCheckout(purchase)).success).toBe(true);
    expect(create.mock.calls[1]?.[0]).toEqual(originalParams);
    expect(originalParams?.expires_at).toBeGreaterThan(before / 1000 + 23 * 3600);
    expect(originalParams?.expires_at).toBeLessThanOrEqual(before / 1000 + 24 * 3600);
    expect(sessions.size).toBe(1);
  });
  it("cannot release an unknown creation outcome while its session could still be payable", async () => {
    const caller = await callerFor(stripeRouter, BUYER); const purchase = input(3000);
    lostCreateResponse = true; await expect(caller.createCheckout(purchase)).rejects.toThrow("Stripe response lost");
    expect((await caller.cancelCheckout({ checkoutId: purchase.requestId })).success).toBe(false);
    expect((await caller.createCheckout(input(3000))).success).toBe(false);
    expect((await (await getTestDatabase()).query.stripeCheckout.findFirst({ where: eq(stripeCheckout.id, purchase.requestId) }))?.closedAt).toBeNull();
  });
  it("an expired sessionless checkout can close and no longer blocks either provider", async () => {
    const db = await getTestDatabase(); const caller = await callerFor(stripeRouter, BUYER); const purchase = input(3000);
    lostCreateResponse = true; await expect(caller.createCheckout(purchase)).rejects.toThrow("Stripe response lost");
    await db.update(stripeCheckout).set({ createdAt: new Date(Date.now() - 25 * 3600000 - 5000) }).where(eq(stripeCheckout.id, purchase.requestId));
    expect((await caller.createCheckout(purchase)).success).toBe(false);
    expect(await (await callerFor(paypalRouter, BUYER)).getRecentRepsCount({ userId: BUYER })).toBe(0);
    expect((await caller.cancelCheckout({ checkoutId: purchase.requestId })).success).toBe(true);
    expect((await caller.createCheckout(input(3000))).success).toBe(true);
  });
  it("rejects an account switch and native-shell checkout before contacting Stripe", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    expect((await caller.createCheckout({ ...input(), expectedUserId: "other" })).success).toBe(false);
    const native = stripeRouter.createCaller({ drizzle: await getTestDatabase(), userId: BUYER, userAgent: "TNR-Native/1.0 (ios)" } as Parameters<typeof stripeRouter.createCaller>[0]);
    expect((await native.createCheckout(input())).success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects banned recipients without creating a payment", async () => {
    const db = await getTestDatabase(); await db.update(userData).set({ isBanned: true }).where(eq(userData.userId, RECIPIENT));
    expect((await (await callerFor(stripeRouter, BUYER)).createCheckout(input())).success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it("reserves unfinished purchases against the monthly cap and releases cancelled sessions", async () => {
    const caller = await callerFor(stripeRouter, BUYER); const purchase = input(3000);
    expect((await caller.createCheckout(purchase)).success).toBe(true);
    expect((await caller.createCheckout(input(2000))).success).toBe(false);
    expect((await caller.cancelCheckout({ checkoutId: purchase.requestId })).success).toBe(true);
    expect((await caller.createCheckout(input(2000))).success).toBe(true);
  });
  it("only allows the payer to cancel unfinished checkout", async () => {
    const caller = await callerFor(stripeRouter, BUYER); const purchase = input(); await caller.createCheckout(purchase);
    expect((await (await callerFor(stripeRouter, RECIPIENT)).cancelCheckout({ checkoutId: purchase.requestId })).success).toBe(false);
    expect(expire).not.toHaveBeenCalled();
  });
  it("parallel requests cannot both create reservations from the same balance snapshot", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const outcomes = await Promise.all([caller.createCheckout(input(3000)), caller.createCheckout(input(3000))]);
    expect(outcomes.filter((outcome) => outcome.success)).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
