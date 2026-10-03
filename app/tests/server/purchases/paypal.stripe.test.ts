// @vitest-environment node
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { paypalSubscription, paypalTransaction, stripeCheckout, stripePayment, storeUserIdAlias, userData } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { paypalRouter, reconcilePaypalSubscription, syncTransactions, updateReps } from "@/server/api/routers/paypal";
import { stripeRouter } from "@/server/api/routers/stripe";
import * as stripeClient from "@/server/utils/stripe/client";
import { reconcileFederalStatuses, setFederalStatusWithStoreFloor } from "@/server/utils/purchases/grant";
import { fulfillStripeSession } from "@/server/utils/stripe/fulfillment";
import { calcFedUgradeCost, dollars2reps, fedStatusRepsCost, reps2dollars } from "@/utils/paypal";
import { insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const BUYER = "web_buyer";
const TARGET = "web_recipient";
const OTHER = "web_other";
const orders = new Map<string, Record<string, unknown>>();
const subscriptions = new Map<string, Record<string, unknown>>();
const paypalPlans = Object.fromEntries(["NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL", "NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER", "NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD"].map((key) => [key, process.env[key]]));
let createResponseFails = false;
let captureResponseMinimal = false;
let captureFailure: "declined" | "unknown" | undefined;
const request = (reputationPoints = 20) => ({ requestId: nanoid(), expectedUserId: BUYER, userId: TARGET, reputationPoints });
const stripeRequest = (points: number) => ({ requestId: nanoid().replace(/[-_]/g, "a"), expectedUserId: BUYER, userId: TARGET, purchase: { type: "reputation" as const, reputationPoints: points } });
const fetchProvider = vi.fn(async (url: string, options?: RequestInit) => {
  if (url.endsWith("/token")) return Response.json({ access_token: "token" });
  if (options?.method === "POST" && url.endsWith("/orders")) {
    const idempotency = (options.headers as Record<string, string>)["PayPal-Request-Id"] ?? "";
    const previous = [...orders.values()].find((o) => o.requestId === idempotency);
    const body = JSON.parse(String(options.body));
    const id = previous?.id ?? `ORDER${String(orders.size).padStart(12, "0")}`;
    const order = previous ?? { id, status: "CREATED", ...body, requestId: idempotency };
    orders.set(String(id), order);
    if (createResponseFails) { createResponseFails = false; throw new Error("response lost"); }
    return Response.json(order);
  }
  if (url.includes("/v1/billing/subscriptions/")) {
    const id = url.split("/subscriptions/")[1]?.split("/")[0] ?? ""; const subscription = subscriptions.get(id);
    if (url.endsWith("/cancel") && options?.method === "POST" && subscription) { subscription.status = "CANCELLED"; return new Response(null, { status: 204 }); }
    return Response.json(subscription ?? {}, { status: subscription ? 200 : 404 });
  }
  const id = url.split("/orders/")[1]?.split("/")[0] ?? "";
  const order = orders.get(id);
  if (!order) return Response.json({}, { status: 404 });
  if (url.endsWith("/capture") && captureFailure === "declined")
    return Response.json({ details: [{ issue: "INSTRUMENT_DECLINED" }] }, { status: 422 });
  if (url.endsWith("/capture") && captureFailure === "unknown") throw new Error("capture response lost");
  if (url.endsWith("/capture")) {
    order.status = "COMPLETED";
    const units = order.purchase_units as { amount: unknown; invoice_id: string; payments?: unknown }[];
    if (units[0]) units[0].payments = { captures: [{ id: `CAPTURE_${id}`, status: "COMPLETED", amount: units[0].amount, update_time: new Date().toISOString() }] };
  }
  if (url.endsWith("/capture") && captureResponseMinimal) return Response.json({ id: order.id, status: order.status });
  return Response.json(order);
});
const stripeSessions = new Map<string, Stripe.Checkout.Session>();
const stripeApi = { checkout: { sessions: {
  create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => { const session = { id: `cs_test_${params.client_reference_id}`, url: "https://checkout.stripe.com/test", metadata: params.metadata } as Stripe.Checkout.Session; stripeSessions.set(session.id, session); return session; }),
  retrieve: vi.fn(async (id: string) => stripeSessions.get(id)),
} } } as unknown as Stripe;
const original = { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_NORMAL: env.STRIPE_PRICE_NORMAL, STRIPE_PRICE_SILVER: env.STRIPE_PRICE_SILVER, STRIPE_PRICE_GOLD: env.STRIPE_PRICE_GOLD };
const paid = async (points = 20, overrides: Partial<Parameters<typeof updateReps>[0]> = {}) => { const value = reps2dollars(points); return updateReps({ client: await getTestDatabase(), createdById: BUYER, affectedUserId: TARGET, transactionId: "legacy_capture", transactionUpdatedDate: new Date().toISOString(), value, currency: "USD", status: "COMPLETED", reps: dollars2reps(value), type: "REP_PURCHASE", raw: {}, ...overrides }); };
const target = async () => (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, TARGET) });

describeWithDatabase("Shared PayPal and Stripe reputation reservations", () => {
  beforeEach(async () => {
    await resetTables(paypalSubscription, paypalTransaction, stripeCheckout, stripePayment, storeUserIdAlias, userData);
    await insertUsers([BUYER, TARGET, OTHER].map((userId) => ({ userId, username: userId, reputationPoints: 0, reputationPointsTotal: 0 })));
    Object.assign(env, { STRIPE_SECRET_KEY: "sk_test_placeholder", STRIPE_WEBHOOK_SECRET: "whsec_placeholder", STRIPE_PRICE_NORMAL: "price_normal", STRIPE_PRICE_SILVER: "price_silver", STRIPE_PRICE_GOLD: "price_gold" });
    orders.clear(); subscriptions.clear(); stripeSessions.clear();
    Object.assign(process.env, { NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL: "plan_test_normal", NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER: "plan_test_silver", NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD: "plan_test_gold" }); createResponseFails = false; captureResponseMinimal = false; captureFailure = undefined; fetchProvider.mockClear();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchProvider as unknown as typeof fetch);
    vi.spyOn(stripeClient, "getStripe").mockReturnValue(stripeApi);
  });
  afterEach(() => { for (const [key, value] of Object.entries(paypalPlans)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } vi.restoreAllMocks(); Object.assign(env, original); });
  const completeStripe = (input: ReturnType<typeof stripeRequest>, created = Date.now()) => {
    const session = stripeSessions.get(`cs_test_${input.requestId}`);
    Object.assign(session ?? {}, { status: "complete", payment_status: "paid", mode: "payment", payment_intent: `pi_${input.requestId}`, livemode: false, currency: "usd", amount_total: Math.round(reps2dollars(input.purchase.reputationPoints) * 100), client_reference_id: input.requestId, automatic_tax: { enabled: true, status: "complete" }, created: Math.floor(created / 1000) });
    return `cs_test_${input.requestId}`;
  };
  it.each([false, true])("holds delayed Stripe payment for review when released allowance is consumed: PayPal=%s", async (usePaypal) => {
    const db = await getTestDatabase(); const stripe = await callerFor(stripeRouter, BUYER); const paypal = await callerFor(paypalRouter, BUYER);
    const first = stripeRequest(3000); await stripe.createCheckout(first);
    const old = Date.now() - 26 * 3600000;
    await db.update(stripeCheckout).set({ createdAt: new Date(old) }).where(eq(stripeCheckout.id, first.requestId));
    expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(0);
    const second = stripeRequest(3000);
    if (usePaypal) {
      const order = await paypal.createOrder(request(3000));
      if (!("orderId" in order)) throw new Error("missing order");
      expect((await paypal.captureOrder({ orderId: order.orderId })).success).toBe(true);
    } else {
      expect((await stripe.createCheckout(second)).success).toBe(true);
      completeStripe(second);
    }
    const sessionId = completeStripe(first, old);
    const results = await Promise.all([
      fulfillStripeSession(db, sessionId), fulfillStripeSession(db, sessionId),
      ...(usePaypal ? [] : [fulfillStripeSession(db, `cs_test_${second.requestId}`)]),
    ]);
    expect(results.slice(0, 2)).toEqual(["review_required", "review_required"]);
    expect((await target())?.reputationPoints).toBe(3000);
    expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(3000);
    const outcome = await stripe.resolveSession({ sessionId });
    expect(outcome).toMatchObject({ success: false }); expect(outcome.message).toContain("Contact support");
    expect(await db.query.stripePayment.findFirst({ where: eq(stripePayment.checkoutId, first.requestId) })).toMatchObject({ grantedAt: null, reviewRequired: true });
    await db.update(stripePayment).set({ purchasedAt: new Date(Date.now() - 31 * 86400000) }).where(eq(stripePayment.checkoutId, second.requestId));
    await db.update(paypalTransaction).set({ createdAt: new Date(Date.now() - 31 * 86400000) });
    expect(await fulfillStripeSession(db, sessionId)).toBe("review_required");
    expect((await target())?.reputationPoints).toBe(3000);
  });
  it("serializes concurrent deliveries of expired Stripe reservations", async () => {
    const db = await getTestDatabase(); const stripe = await callerFor(stripeRouter, BUYER);
    const sessions: string[] = [];
    for (const input of [stripeRequest(3000), stripeRequest(3000)]) {
      expect((await stripe.createCheckout(input)).success).toBe(true);
      const old = Date.now() - 26 * 3600000;
      await db.update(stripeCheckout).set({ createdAt: new Date(old) }).where(eq(stripeCheckout.id, input.requestId));
      sessions.push(completeStripe(input, old));
    }
    const outcomes = await Promise.all(sessions.map((id) => fulfillStripeSession(db, id)));
    expect(outcomes.sort()).toEqual(["fulfilled", "review_required"]);
    expect((await target())?.reputationPoints).toBe(3000);
  });
  it.each([false, true])("definite PayPal funding decline can be retried or cancelled: cancel=%s", async (cancel) => {
    const db = await getTestDatabase(); const paypal = await callerFor(paypalRouter, BUYER); const input = request(3000);
    const order = await paypal.createOrder(input); if (!("orderId" in order)) throw new Error("missing order");
    captureFailure = "declined";
    expect(await paypal.captureOrder({ orderId: order.orderId })).toMatchObject({ success: false, restartFunding: true });
    expect(await db.query.paypalTransaction.findFirst()).toMatchObject({ status: "RESERVED" });
    expect((await paypal.createOrder(input)).success).toBe(true);
    expect((await target())?.reputationPoints).toBe(0);
    captureFailure = undefined;
    if (cancel) {
      expect((await paypal.cancelOrder({ requestId: input.requestId })).success).toBe(true);
      expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(0);
      expect((await paypal.captureOrder({ orderId: order.orderId })).success).toBe(false);
    } else {
      const outcomes = await Promise.all([paypal.captureOrder({ orderId: order.orderId }), paypal.captureOrder({ orderId: order.orderId })]);
      expect(outcomes.some((r) => r.success)).toBe(true);
      expect((await target())?.reputationPoints).toBe(3000);
    }
  });
  it("an unknown PayPal capture outcome retains its reservation and recovers idempotently", async () => {
    const db = await getTestDatabase(); const paypal = await callerFor(paypalRouter, BUYER); const input = request(3000);
    const order = await paypal.createOrder(input); if (!("orderId" in order)) throw new Error("missing order");
    captureFailure = "unknown";
    await expect(paypal.captureOrder({ orderId: order.orderId })).rejects.toThrow("capture response lost");
    await db.update(paypalTransaction).set({ createdAt: new Date(Date.now() - 4 * 3600000) }).where(eq(paypalTransaction.id, input.requestId));
    expect(await db.query.paypalTransaction.findFirst()).toMatchObject({ status: "CAPTURING" });
    expect(await paypal.createOrder(input)).not.toHaveProperty("restartCheckout", true);
    expect((await paypal.cancelOrder({ requestId: input.requestId })).success).toBe(false);
    expect((await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(2000))).success).toBe(false);
    captureFailure = undefined;
    expect((await paypal.captureOrder({ orderId: order.orderId })).success).toBe(true);
    expect((await target())?.reputationPoints).toBe(3000);
    const ids = fetchProvider.mock.calls.filter(([url]) => url.endsWith("/capture")).map(([, options]) => (options?.headers as Record<string, string>)["PayPal-Request-Id"]);
    expect(new Set(ids).size).toBe(1);
  });
  it("blocks PayPal before charging when Stripe reserved the remaining allowance", async () => {
    const stripe = await callerFor(stripeRouter, BUYER);
    expect((await stripe.createCheckout(stripeRequest(3000))).success).toBe(true);
    const paypal = await callerFor(paypalRouter, BUYER);
    expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBeGreaterThanOrEqual(3000);
    expect((await paypal.createOrder(request(2000))).success).toBe(false);
    expect(fetchProvider).not.toHaveBeenCalled();
  });
  it("blocks Stripe when PayPal reserved the remaining allowance", async () => {
    expect((await (await callerFor(paypalRouter, BUYER)).createOrder(request(3000))).success).toBe(true);
    expect((await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(2000))).success).toBe(false);
  });
  it("parallel mixed-provider checkout cannot reserve twice", async () => {
    const paypal = await callerFor(paypalRouter, BUYER); const stripe = await callerFor(stripeRouter, BUYER);
    const results = await Promise.all([paypal.createOrder(request(3000)), stripe.createCheckout(stripeRequest(3000))]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
  });
  it("server prices, binds, and resumes an uncertain PayPal create response", async () => {
    const caller = await callerFor(paypalRouter, BUYER); const input = request();
    createResponseFails = true;
    await expect(caller.createOrder(input)).rejects.toThrow("response lost");
    const result = await caller.createOrder(input);
    expect(result.success).toBe(true); expect(result).not.toHaveProperty("restartCheckout", true); expect(orders.size).toBe(1);
    const units = [...orders.values()][0]?.purchase_units as { amount: unknown; custom_id: string }[];
    expect(units[0]).toMatchObject({ amount: { currency_code: "USD", value: reps2dollars(20).toFixed(2) }, custom_id: `${BUYER}-${TARGET}` });
    expect((await caller.createOrder({ ...input, userId: OTHER })).success).toBe(false);
    expect((await caller.createOrder({ ...input, reputationPoints: 30 })).success).toBe(false);
  });
  it("capture converts the reservation once, including concurrent retries", async () => {
    const caller = await callerFor(paypalRouter, BUYER); const input = request(); const result = await caller.createOrder(input);
    if (!("orderId" in result)) throw new Error("missing order");
    const before = await caller.getRecentRepsCount({ userId: BUYER });
    const outcomes = await Promise.all([caller.captureOrder({ orderId: result.orderId }), caller.captureOrder({ orderId: result.orderId })]);
    expect(outcomes.some((r) => r.success)).toBe(true);
    expect((await target())?.reputationPoints).toBe(dollars2reps(reps2dollars(20)));
    expect(await caller.getRecentRepsCount({ userId: BUYER })).toBe(before);
    expect((await caller.captureOrder({ orderId: result.orderId })).success).toBe(true);
    expect(await (await getTestDatabase()).query.paypalTransaction.findMany()).toHaveLength(1);
  });
  it("fetches authoritative order metadata when capture returns a minimal representation", async () => {
    const caller = await callerFor(paypalRouter, BUYER); const result = await caller.createOrder(request());
    if (!("orderId" in result)) throw new Error("missing order");
    captureResponseMinimal = true;
    expect((await caller.captureOrder({ orderId: result.orderId })).success).toBe(true);
    const capture = fetchProvider.mock.calls.find(([url]) => url.endsWith("/capture"));
    expect(capture?.[1]?.headers).toMatchObject({ Prefer: "return=representation" });
    expect((await target())?.reputationPoints).toBe(dollars2reps(reps2dollars(20)));
  });
  it("cancellation releases a reservation and prevents capture of its order", async () => {
    const caller = await callerFor(paypalRouter, BUYER); const input = request(3000); const result = await caller.createOrder(input);
    if (!("orderId" in result)) throw new Error("missing order");
    expect((await caller.cancelOrder({ requestId: input.requestId })).success).toBe(true);
    expect(await caller.getRecentRepsCount({ userId: BUYER })).toBe(0);
    const count = fetchProvider.mock.calls.length;
    expect((await caller.captureOrder({ orderId: result.orderId })).success).toBe(false);
    expect(fetchProvider.mock.calls.length).toBe(count);
    expect((await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(3000))).success).toBe(true);
  });
  it("a capture in progress cannot be cancelled or release its allowance", async () => {
    const db = await getTestDatabase(); const caller = await callerFor(paypalRouter, BUYER); const input = request(3000); await caller.createOrder(input);
    await db.update(paypalTransaction).set({ status: "CAPTURING" }).where(eq(paypalTransaction.id, input.requestId));
    expect((await caller.cancelOrder({ requestId: input.requestId })).success).toBe(false);
    expect(await caller.createOrder(input)).not.toHaveProperty("restartCheckout", true);
    expect((await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(2000))).success).toBe(false);
  });
  it.each(["cancelled", "expired"])("renews checkout after a confirmed %s reservation", async (state) => {
    const db = await getTestDatabase(); const caller = await callerFor(paypalRouter, BUYER); const input = request();
    const first = await caller.createOrder(input);
    if (!("orderId" in first)) throw new Error("missing order");
    if (state === "cancelled") expect((await caller.cancelOrder({ requestId: input.requestId })).success).toBe(true);
    else await db.update(paypalTransaction).set({ createdAt: new Date(Date.now() - 4 * 3600000) }).where(eq(paypalTransaction.id, input.requestId));
    const count = fetchProvider.mock.calls.length;
    expect(await caller.createOrder(input)).toMatchObject({ success: false, restartCheckout: true });
    expect(fetchProvider.mock.calls.length).toBe(count);
    expect((await caller.captureOrder({ orderId: first.orderId })).success).toBe(false);
    const next = await caller.createOrder({ ...input, requestId: nanoid() });
    expect(next.success).toBe(true);
    if (!("orderId" in next)) throw new Error("missing renewed order");
    expect(next.orderId).not.toBe(first.orderId);
    expect(await (await callerFor(paypalRouter, OTHER)).createOrder(input)).not.toHaveProperty("restartCheckout", true);
  });
  it("rejects capture and cancellation by another account", async () => {
    const caller = await callerFor(paypalRouter, BUYER); const input = request(); const result = await caller.createOrder(input);
    if (!("orderId" in result)) throw new Error("missing order");
    const other = await callerFor(paypalRouter, OTHER); const count = fetchProvider.mock.calls.length;
    expect((await other.captureOrder({ orderId: result.orderId })).success).toBe(false);
    expect((await other.cancelOrder({ requestId: input.requestId })).success).toBe(false);
    expect(fetchProvider.mock.calls.length).toBe(count);
  });
  it("does not capture an expired order", async () => {
    const db = await getTestDatabase(); const caller = await callerFor(paypalRouter, BUYER); const input = request(); const result = await caller.createOrder(input);
    if (!("orderId" in result)) throw new Error("missing order");
    await db.update(paypalTransaction).set({ createdAt: new Date(Date.now() - 4 * 3600000) }).where(eq(paypalTransaction.id, input.requestId));
    const count = fetchProvider.mock.calls.length;
    expect((await caller.captureOrder({ orderId: result.orderId })).success).toBe(false);
    expect(fetchProvider.mock.calls.length).toBe(count);
  });
  it.each([false, true])("expired unclaimed PayPal reservations release allowance for either provider: Stripe=%s", async (useStripe) => {
    const db = await getTestDatabase(); const paypal = await callerFor(paypalRouter, BUYER); const input = request(3000);
    await paypal.createOrder(input);
    await db.update(paypalTransaction).set({ createdAt: new Date(Date.now() - (3 * 3600000 + 5000)) }).where(eq(paypalTransaction.id, input.requestId));
    expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(0);
    const outcome = useStripe ? await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(3000)) : await paypal.createOrder(request(3000));
    expect(outcome.success).toBe(true);
  });
  it("an unexpired reservation still consumes allowance just before the capture deadline", async () => {
    const db = await getTestDatabase(); const paypal = await callerFor(paypalRouter, BUYER); const input = request(3000);
    await paypal.createOrder(input);
    await db.update(paypalTransaction).set({ createdAt: new Date(Date.now() - (3 * 3600000 - 5000)) }).where(eq(paypalTransaction.id, input.requestId));
    expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBeGreaterThanOrEqual(3000);
    expect((await paypal.createOrder(request(2000))).success).toBe(false);
    expect((await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(2000))).success).toBe(false);
  });
  it("recovery of an unreserved legacy payment cannot exceed Stripe's reservation", async () => {
    expect((await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(3000))).success).toBe(true);
    const outcome = await paid(2000);
    expect(outcome && "success" in outcome && outcome.success).toBe(false);
    expect((await target())?.reputationPoints).toBe(0);
    expect(await (await getTestDatabase()).query.paypalTransaction.findFirst()).toMatchObject({ status: "REVIEW_REQUIRED" });
  });
  it("a review-required payment remains held even after other reservations disappear", async () => {
    const db = await getTestDatabase(); const stripeInput = stripeRequest(3000);
    await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeInput);
    expect(await paid(2000)).toMatchObject({ success: false });
    await db.update(stripeCheckout).set({ closedAt: new Date() }).where(eq(stripeCheckout.id, stripeInput.requestId));
    expect(await paid(2000)).toMatchObject({ success: false });
    expect((await target())?.reputationPoints).toBe(0);
  });
  it("concurrent PayPal delivery retries cannot credit the same capture twice", async () => {
    await Promise.all(Array.from({ length: 5 }, () => paid()));
    expect((await target())?.reputationPoints).toBe(dollars2reps(reps2dollars(20)));
    expect(await (await getTestDatabase()).query.paypalTransaction.findMany()).toHaveLength(1);
  });
  it("missing recipients roll back the receipt so recovery can deliver", async () => {
    const db = await getTestDatabase(); await db.delete(userData).where(eq(userData.userId, TARGET));
    await expect(paid()).rejects.toThrow("recipient not found");
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
    await insertUsers([{ userId: TARGET, username: TARGET, reputationPoints: 0 }]);
    expect(await paid()).toMatchObject({ success: true });
  });
  it("transaction lookup reports not found as failure with a recovery message", async () => {
    const caller = await callerFor(paypalRouter, BUYER);
    expect(await caller.resolveTransaction({ transactionId: "MISSING_CAPTURE", transactionDate: new Date() })).toMatchObject({ success: false, message: expect.stringContaining("No completed PayPal transaction was found") });
  });
  it.each([{ custom_field: "", transaction_amount: { value: "10", currency_code: "USD" } }, { transaction_amount: undefined }, { transaction_amount: { value: "NaN", currency_code: "USD" } }, { transaction_amount: { value: "1invalid", currency_code: "USD" } }, { transaction_amount: { value: "0", currency_code: "USD" } }, { transaction_amount: { value: "-1", currency_code: "USD" } }, { transaction_amount: { value: "10", currency_code: "DKK" } }])("malformed or invalid reporting data is a failed recovery: %j", async (overrides) => {
    const info = { transaction_id: "INVALID_CAPTURE", transaction_status: "S", custom_field: `${BUYER}-${TARGET}`, transaction_updated_date: new Date().toISOString(), ...overrides };
    const outcome = await syncTransactions(await getTestDatabase(), [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1], "token");
    expect(outcome.success).toBe(false); expect(outcome.messages[0]).toContain("invalid");
    expect((await target())?.reputationPoints).toBe(0);
    expect(await (await getTestDatabase()).query.paypalTransaction.findMany()).toHaveLength(0);
  });
  it("missing subscription details return failure without granting coverage", async () => {
    const info = { transaction_id: "SUB_CAPTURE", transaction_status: "S", custom_field: `${BUYER}-${TARGET}`, transaction_amount: { value: "10", currency_code: "USD" }, paypal_reference_id_type: "SUB", paypal_reference_id: "MISSING_SUBSCRIPTION", transaction_updated_date: new Date().toISOString() };
    expect(await syncTransactions(await getTestDatabase(), [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1], "token")).toMatchObject({ success: false, messages: [expect.stringContaining("not found")] });
  });
  it.each([{ plan_id: "plan_unknown" }, { custom_id: `${OTHER}-${TARGET}` }, { custom_id: `${BUYER}-${OTHER}` }, { custom_id: undefined }, { custom_id: `${BUYER}-${TARGET}-extra` }, { billing_info: { last_payment: { time: new Date(Date.now() + 86400000).toISOString(), amount: { value: "15.00", currency_code: "USD" } } } }, { billing_info: { last_payment: { time: new Date().toISOString(), amount: { value: "15.00", currency_code: "DKK" } } } }])("subscription recovery rejects unknown or inconsistent paid terms: %j", async (overrides) => {
    const subscription = { id: "SUB_TEST", status: "ACTIVE", plan_id: "plan_test_gold", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: new Date().toISOString(), amount: { value: "15.00", currency_code: "USD" } } }, ...overrides };
    subscriptions.set("SUB_TEST", subscription);
    const info = { transaction_id: "SUB_CAPTURE", transaction_status: "S", transaction_updated_date: new Date().toISOString(), custom_field: `${BUYER}-${TARGET}`, transaction_amount: { value: "15", currency_code: "USD" }, paypal_reference_id_type: "SUB", paypal_reference_id: "SUB_TEST" };
    expect(await syncTransactions(await getTestDatabase(), [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1], "token")).toMatchObject({ success: false });
    expect((await target())?.federalStatus).toBe("NONE");
    expect(await (await getTestDatabase()).query.paypalSubscription.findMany()).toHaveLength(0);
  });
  it("a configured, owned paid subscription grants the gift once and sync retries succeed", async () => {
    subscriptions.set("SUB_TEST", { id: "SUB_TEST", status: "ACTIVE", plan_id: "plan_test_gold", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: new Date().toISOString(), amount: { value: "15.00", currency_code: "USD" } } } });
    const caller = await callerFor(paypalRouter, BUYER);
    expect((await caller.resolveSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(true);
    expect((await target())?.federalStatus).toBe("GOLD");
    expect((await caller.resolveSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(true);
    expect(await (await getTestDatabase()).query.paypalSubscription.findMany()).toHaveLength(1);
    expect((await (await callerFor(paypalRouter, OTHER)).resolveSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(false);
  });
  it.each([
    ["GOLD", "NORMAL", "plan_test_normal", "5.00"],
    ["GOLD", "SILVER", "plan_test_silver", "10.00"],
    ["SILVER", "NORMAL", "plan_test_normal", "5.00"],
  ] as const)("preserves paid PayPal %s while synchronizing and cancelling %s, then expires the higher tier", async (higher, lower, plan, amount) => {
    const db = await getTestDatabase(); const paidAt = new Date(Date.now() - 86400000);
    await db.update(userData).set({ federalStatus: higher }).where(eq(userData.userId, TARGET));
    await db.insert(paypalSubscription).values({ id: "higher-sub", subscriptionId: "SUB_HIGH", createdById: BUYER, affectedUserId: TARGET, orderId: "SUB_HIGH", status: "ACTIVE", federalStatus: higher, updatedAt: paidAt });
    const subscription = { id: "SUB_LOW", status: "ACTIVE", plan_id: plan, custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: paidAt.toISOString(), amount: { value: amount, currency_code: "USD" } } } };
    subscriptions.set("SUB_LOW", subscription);
    const caller = await callerFor(paypalRouter, BUYER);
    expect((await caller.resolveSubscription({ subscriptionId: "SUB_LOW" })).success).toBe(true);
    expect((await target())?.federalStatus).toBe(higher);
    subscription.billing_info.last_payment.time = new Date().toISOString();
    expect((await caller.resolveSubscription({ subscriptionId: "SUB_LOW" })).success).toBe(true);
    expect((await target())?.federalStatus).toBe(higher);
    expect((await caller.cancelPaypalSubscription({ subscriptionId: "SUB_LOW" })).success).toBe(true);
    expect((await caller.resolveSubscription({ subscriptionId: "SUB_LOW" })).success).toBe(true);
    expect((await target())?.federalStatus).toBe(higher);
    expect(await db.query.paypalSubscription.findFirst({ where: eq(paypalSubscription.subscriptionId, "SUB_HIGH") })).toMatchObject({ status: "ACTIVE", federalStatus: higher, updatedAt: paidAt });
    expect(await db.query.paypalSubscription.findFirst({ where: eq(paypalSubscription.subscriptionId, "SUB_LOW") })).toMatchObject({ status: "CANCELLED", federalStatus: lower });
    await db.update(paypalSubscription).set({ updatedAt: new Date(Date.now() - 32 * 86400000) }).where(eq(paypalSubscription.subscriptionId, "SUB_HIGH"));
    await reconcileFederalStatuses(db);
    expect((await target())?.federalStatus).toBe(lower);
    await db.update(paypalSubscription).set({ updatedAt: new Date(Date.now() - 32 * 86400000) }).where(eq(paypalSubscription.subscriptionId, "SUB_LOW"));
    await reconcileFederalStatuses(db);
    expect((await target())?.federalStatus).toBe("NONE");
  });
  it("direct subscription recovery rejects an unknown paid plan without downgrading coverage", async () => {
    const db = await getTestDatabase(); await db.update(userData).set({ federalStatus: "GOLD" }).where(eq(userData.userId, TARGET));
    subscriptions.set("SUB_TEST", { id: "SUB_TEST", status: "ACTIVE", plan_id: "plan_unknown", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: new Date().toISOString(), amount: { value: "15.00", currency_code: "USD" } } } });
    expect((await (await callerFor(paypalRouter, BUYER)).resolveSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(false);
    expect((await target())?.federalStatus).toBe("GOLD");
  });
  it.each([0.01, 14.99, 15.01, 30])("neither recovery path grants GOLD for the wrong paid total: %s", async (amount) => {
    subscriptions.set("SUB_TEST", { id: "SUB_TEST", status: "ACTIVE", plan_id: "plan_test_gold", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: new Date().toISOString(), amount: { value: amount.toFixed(2), currency_code: "USD" } } } });
    const caller = await callerFor(paypalRouter, BUYER);
    expect((await caller.resolveSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(false);
    const info = { transaction_id: "SUB_CAPTURE", transaction_status: "S", transaction_updated_date: new Date().toISOString(), custom_field: `${BUYER}-${TARGET}`, transaction_amount: { value: amount.toFixed(2), currency_code: "USD" }, paypal_reference_id_type: "SUB", paypal_reference_id: "SUB_TEST" };
    expect(await syncTransactions(await getTestDatabase(), [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1], "token")).toMatchObject({ success: false });
    expect((await target())?.federalStatus).toBe("NONE");
    expect(await (await getTestDatabase()).query.paypalSubscription.findMany()).toHaveLength(0);
  });
  it.each([{ tier: "NORMAL", price: 5 }, { tier: "SILVER", price: 10 }])("accepts the configured USD amount for %s", async ({ tier, price }) => {
    subscriptions.set("SUB_TEST", { id: "SUB_TEST", status: "ACTIVE", plan_id: `plan_test_${tier.toLowerCase()}`, custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: new Date().toISOString(), amount: { value: price.toFixed(2), currency_code: "USD" } } } });
    expect((await (await callerFor(paypalRouter, BUYER)).resolveSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(true);
    expect((await target())?.federalStatus).toBe(tier);
  });
  it("direct recovery retains a cancelled subscription's paid period through reconciliation, then expires it", async () => {
    const db = await getTestDatabase(); const paidAt = new Date(Date.now() - 86400000);
    subscriptions.set("SUB_TEST", { id: "SUB_TEST", status: "CANCELLED", plan_id: "plan_test_gold", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: paidAt.toISOString(), amount: { value: "15.00", currency_code: "USD" } } } });
    const caller = await callerFor(paypalRouter, BUYER);
    expect((await caller.resolveSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(true);
    expect((await target())?.federalStatus).toBe("GOLD");
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ status: "CANCELLED", federalStatus: "GOLD", updatedAt: paidAt });
    await setFederalStatusWithStoreFloor(db, TARGET, "NONE");
    await reconcileFederalStatuses(db);
    expect((await target())?.federalStatus).toBe("GOLD");
    await db.update(paypalSubscription).set({ updatedAt: new Date(Date.now() - 32 * 86400000) }).where(eq(paypalSubscription.subscriptionId, "SUB_TEST"));
    await reconcileFederalStatuses(db);
    expect((await target())?.federalStatus).toBe("NONE");
  });
  it("a cancelled subscription with an expired paid period cannot restore coverage", async () => {
    subscriptions.set("SUB_TEST", { id: "SUB_TEST", status: "CANCELLED", plan_id: "plan_test_gold", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: new Date(Date.now() - 32 * 86400000).toISOString(), amount: { value: "15.00", currency_code: "USD" } } } });
    expect((await (await callerFor(paypalRouter, BUYER)).resolveSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(true);
    expect((await target())?.federalStatus).toBe("NONE");
  });
  it("scheduled reconciliation never turns an old active payment into a fresh paid period", async () => {
    const db = await getTestDatabase(); const paidAt = new Date(Date.now() - 40 * 86400000);
    await db.insert(paypalSubscription).values({ id: "expired-sub", subscriptionId: "SUB_TEST", createdById: BUYER, affectedUserId: TARGET, orderId: "ORDER_TEST", status: "ACTIVE", federalStatus: "GOLD", updatedAt: paidAt });
    const subscription = { id: "SUB_TEST", status: "ACTIVE", plan_id: "plan_test_gold", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: paidAt.toISOString(), amount: { value: "15.00", currency_code: "USD" } } } };
    expect(await reconcilePaypalSubscription({ client: db, subscription, subscriptionId: "SUB_TEST", expected: { createdById: BUYER, affectedUserId: TARGET } })).toMatchObject({ success: true });
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ updatedAt: paidAt, federalStatus: "NONE" });
    expect((await target())?.federalStatus).toBe("NONE");
  });
  it("scheduled reconciliation uses the provider payment date and rejects a wrong paid amount", async () => {
    const db = await getTestDatabase(); const oldPaidAt = new Date(Date.now() - 40 * 86400000); const paidAt = new Date(Date.now() - 2 * 86400000);
    await db.insert(paypalSubscription).values({ id: "renew-sub", subscriptionId: "SUB_TEST", createdById: BUYER, affectedUserId: TARGET, orderId: "ORDER_TEST", status: "ACTIVE", federalStatus: "GOLD", updatedAt: oldPaidAt });
    const subscription = { id: "SUB_TEST", status: "ACTIVE", plan_id: "plan_test_gold", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: paidAt.toISOString(), amount: { value: "0.01", currency_code: "USD" } } } };
    expect(await reconcilePaypalSubscription({ client: db, subscription, subscriptionId: "SUB_TEST", expected: { createdById: BUYER, affectedUserId: TARGET } })).toMatchObject({ success: false });
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ updatedAt: oldPaidAt });
    subscription.billing_info.last_payment.amount.value = "15.00";
    expect(await reconcilePaypalSubscription({ client: db, subscription, subscriptionId: "SUB_TEST", expected: { createdById: BUYER, affectedUserId: TARGET } })).toMatchObject({ success: true });
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ updatedAt: paidAt });
    expect((await target())?.federalStatus).toBe("GOLD");
  });
  it("provider-only approvals retain a billing reference and a saved reputation upgrade", async () => {
    const db = await getTestDatabase(); const paidAt = new Date(Date.now() - 10 * 86400000); const upgradeAt = new Date(Date.now() - 5 * 86400000);
    await db.insert(paypalSubscription).values({ id: "upgrade-sub", subscriptionId: "SUB_TEST", createdById: BUYER, affectedUserId: TARGET, status: "ACTIVE", federalStatus: "GOLD", updatedAt: upgradeAt });
    await db.update(userData).set({ federalStatus: "GOLD" }).where(eq(userData.userId, TARGET));
    const subscription = { id: "SUB_TEST", status: "ACTIVE", plan_id: "plan_test_normal", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: paidAt.toISOString(), amount: { value: "5.00", currency_code: "USD" } } } };
    expect(await reconcilePaypalSubscription({ client: db, subscription, subscriptionId: "SUB_TEST" })).toMatchObject({ success: true });
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ orderId: "SUB_TEST", federalStatus: "GOLD", updatedAt: upgradeAt });
    subscription.billing_info.last_payment.time = new Date().toISOString();
    expect(await reconcilePaypalSubscription({ client: db, subscription, subscriptionId: "SUB_TEST" })).toMatchObject({ success: true });
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ federalStatus: "GOLD", updatedAt: upgradeAt });
  });
  it("concurrent gifts cannot spend the same reputation balance twice", async () => {
    const db = await getTestDatabase(); const cost = fedStatusRepsCost("GOLD");
    await db.update(userData).set({ reputationPoints: cost }).where(eq(userData.userId, BUYER));
    const caller = await callerFor(paypalRouter, BUYER);
    const results = await Promise.all([TARGET, OTHER].map((userId) => caller.subscribeWithReps({ userId, expectedUserId: BUYER, status: "GOLD" })));
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, BUYER) }))?.reputationPoints).toBe(0);
    expect(await db.query.paypalSubscription.findMany()).toHaveLength(1);
    expect((await db.query.userData.findMany()).filter((user) => user.federalStatus === "GOLD")).toHaveLength(1);
  });
  it("a changed recipient rolls back the reputation debit and ledger", async () => {
    const db = await getTestDatabase(); const cost = fedStatusRepsCost("GOLD");
    await db.update(userData).set({ reputationPoints: cost }).where(eq(userData.userId, BUYER));
    await db.update(userData).set({ federalStatus: "SILVER" }).where(eq(userData.userId, TARGET));
    expect((await (await callerFor(paypalRouter, BUYER)).subscribeWithReps({ userId: TARGET, expectedUserId: BUYER, status: "GOLD" })).success).toBe(false);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, BUYER) }))?.reputationPoints).toBe(cost);
    expect(await db.query.paypalSubscription.findMany()).toHaveLength(0);
  });
  it("a changed account cannot spend the former account's reputation purchase", async () => {
    const db = await getTestDatabase(); await db.update(userData).set({ reputationPoints: fedStatusRepsCost("GOLD") }).where(eq(userData.userId, OTHER));
    expect((await (await callerFor(paypalRouter, OTHER)).subscribeWithReps({ userId: TARGET, expectedUserId: BUYER, status: "GOLD" })).success).toBe(false);
    expect(await db.query.paypalSubscription.findMany()).toHaveLength(0);
  });
  it("concurrent self upgrades debit once and leave a matching paid ledger", async () => {
    const db = await getTestDatabase(); const cost = calcFedUgradeCost("NORMAL", "GOLD");
    if (!cost) throw new Error("missing upgrade cost");
    await db.update(userData).set({ reputationPoints: cost, reputationPointsTotal: cost, federalStatus: "NORMAL" }).where(eq(userData.userId, BUYER));
    await db.insert(paypalSubscription).values({ id: "self-upgrade", subscriptionId: `reps_${nanoid()}`, createdById: BUYER, affectedUserId: BUYER, status: "ACTIVE", federalStatus: "NORMAL" });
    const caller = await callerFor(paypalRouter, BUYER);
    const results = await Promise.all([caller.upgradeSubscription({ userId: BUYER, plan: "GOLD" }), caller.upgradeSubscription({ userId: BUYER, plan: "GOLD" })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, BUYER) })).toMatchObject({ reputationPoints: 0, reputationPointsTotal: 0, federalStatus: "GOLD" });
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ federalStatus: "GOLD" });
  });
  it("expired PayPal coverage cannot be used to buy a discounted upgrade", async () => {
    const db = await getTestDatabase(); await db.update(userData).set({ reputationPoints: 1000, federalStatus: "SILVER" }).where(eq(userData.userId, BUYER));
    await db.insert(paypalSubscription).values({ id: "expired-upgrade", subscriptionId: "I-EXPIRED", createdById: BUYER, affectedUserId: BUYER, status: "CANCELLED", federalStatus: "SILVER", updatedAt: new Date(Date.now() - 32 * 86400000) });
    expect((await (await callerFor(paypalRouter, BUYER)).upgradeSubscription({ userId: BUYER, plan: "GOLD" })).success).toBe(false);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, BUYER) }))?.reputationPoints).toBe(1000);
  });
  it.each([`reps_${nanoid()}`, nanoid()])("reputation-funded cancellation retains coverage without a provider call (%s)", async (subscriptionId) => {
    const db = await getTestDatabase(); const paidAt = new Date(Date.now() - 86400000);
    await db.update(userData).set({ federalStatus: "GOLD" }).where(eq(userData.userId, TARGET));
    await db.insert(paypalSubscription).values({ id: "rep-sub", subscriptionId, createdById: BUYER, affectedUserId: TARGET, status: "ACTIVE", federalStatus: "GOLD", updatedAt: paidAt });
    expect((await (await callerFor(paypalRouter, TARGET)).cancelPaypalSubscription({ subscriptionId })).success).toBe(true);
    expect(fetchProvider).not.toHaveBeenCalled();
    await reconcileFederalStatuses(db); expect((await target())?.federalStatus).toBe("GOLD");
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ status: "CANCELLED", updatedAt: paidAt });
  });
  it("failed provider lookups cannot claim cancellation or change the ledger", async () => {
    const db = await getTestDatabase(); await db.insert(paypalSubscription).values({ id: "missing-sub", subscriptionId: "SUB_TEST", createdById: BUYER, affectedUserId: TARGET, orderId: "ORDER_TEST", status: "ACTIVE", federalStatus: "GOLD" });
    expect((await (await callerFor(paypalRouter, BUYER)).cancelPaypalSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(false);
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ status: "ACTIVE" });
    expect(fetchProvider.mock.calls.filter(([url]) => url.endsWith("/cancel"))).toHaveLength(0);
  });
  it("cancellation verifies authoritative ownership before asking PayPal to stop billing", async () => {
    const db = await getTestDatabase(); await db.insert(paypalSubscription).values({ id: "mismatch-sub", subscriptionId: "SUB_TEST", createdById: BUYER, affectedUserId: TARGET, orderId: "ORDER_TEST", status: "ACTIVE", federalStatus: "GOLD" });
    subscriptions.set("SUB_TEST", { id: "SUB_TEST", status: "ACTIVE", custom_id: `${OTHER}-${TARGET}` });
    expect((await (await callerFor(paypalRouter, BUYER)).cancelPaypalSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(false);
    expect(fetchProvider.mock.calls.filter(([url]) => url.endsWith("/cancel"))).toHaveLength(0);
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ status: "ACTIVE" });
  });
  it("a suspended subscription is actually cancelled and keeps its verified paid period", async () => {
    const db = await getTestDatabase(); const paidAt = new Date(Date.now() - 86400000);
    await db.insert(paypalSubscription).values({ id: "suspended-sub", subscriptionId: "SUB_TEST", createdById: BUYER, affectedUserId: TARGET, orderId: "ORDER_TEST", status: "ACTIVE", federalStatus: "GOLD", updatedAt: paidAt });
    await db.update(userData).set({ federalStatus: "GOLD" }).where(eq(userData.userId, TARGET));
    subscriptions.set("SUB_TEST", { id: "SUB_TEST", status: "SUSPENDED", plan_id: "plan_test_gold", custom_id: `${BUYER}-${TARGET}`, billing_info: { last_payment: { time: paidAt.toISOString(), amount: { value: "15.00", currency_code: "USD" } } } });
    expect((await (await callerFor(paypalRouter, BUYER)).cancelPaypalSubscription({ subscriptionId: "SUB_TEST" })).success).toBe(true);
    expect(fetchProvider.mock.calls.filter(([url]) => url.endsWith("/cancel"))).toHaveLength(1);
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({ status: "CANCELLED", updatedAt: paidAt });
    await reconcileFederalStatuses(db); expect((await target())?.federalStatus).toBe("GOLD");
  });
  it("reporting recovery converts a captured reservation without duplicate credit", async () => {
    const caller = await callerFor(paypalRouter, BUYER); const input = request(); const result = await caller.createOrder(input);
    if (!("orderId" in result)) throw new Error("missing order");
    await fetchProvider(`https://api.paypal.com/v2/checkout/orders/${result.orderId}/capture`, { method: "POST" });
    const info = { transaction_id: `CAPTURE_${result.orderId}`, transaction_status: "S", custom_field: `${BUYER}-${TARGET}`, transaction_amount: { value: reps2dollars(20).toFixed(2), currency_code: "USD" }, transaction_updated_date: new Date().toISOString(), invoice_id: input.requestId };
    await syncTransactions(await getTestDatabase(), [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1], "token");
    expect((await target())?.reputationPoints).toBe(dollars2reps(reps2dollars(20)));
    expect((await caller.captureOrder({ orderId: result.orderId })).success).toBe(true);
    expect(await (await getTestDatabase()).query.paypalTransaction.findMany()).toHaveLength(1);
  });
  it("reporting recovery does not grant a reserved order whose capture was refunded", async () => {
    const caller = await callerFor(paypalRouter, BUYER); const input = request(); const result = await caller.createOrder(input);
    if (!("orderId" in result)) throw new Error("missing order");
    const order = orders.get(result.orderId); if (!order) throw new Error("missing order");
    order.status = "COMPLETED";
    const units = order.purchase_units as { payments?: unknown; amount: unknown }[];
    if (units[0]) units[0].payments = { captures: [{ id: "refunded_capture", status: "REFUNDED", amount: units[0].amount }] };
    const info = { transaction_id: "refunded_capture", transaction_status: "S", custom_field: `${BUYER}-${TARGET}`, transaction_amount: { value: reps2dollars(20).toFixed(2), currency_code: "USD" }, transaction_updated_date: new Date().toISOString(), invoice_id: input.requestId };
    expect(await syncTransactions(await getTestDatabase(), [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1], "token")).toMatchObject({ success: false });
    expect((await target())?.reputationPoints).toBe(0);
  });
  it("user-ID migration preserves ownership of an already created provider order", async () => {
    const db = await getTestDatabase(); const input = request(); const result = await (await callerFor(paypalRouter, BUYER)).createOrder(input);
    if (!("orderId" in result)) throw new Error("missing order");
    await db.insert(storeUserIdAlias).values({ oldUserId: BUYER, newUserId: OTHER });
    await db.update(paypalTransaction).set({ createdById: OTHER }).where(eq(paypalTransaction.id, input.requestId));
    expect((await (await callerFor(paypalRouter, OTHER)).captureOrder({ orderId: result.orderId })).success).toBe(true);
    expect((await target())?.reputationPoints).toBe(dollars2reps(reps2dollars(20)));
  });
  it("cancel is idempotent and a rejected create request cannot trap the form", async () => {
    const caller = await callerFor(paypalRouter, BUYER); const input = request();
    expect((await caller.cancelOrder({ requestId: input.requestId })).success).toBe(true);
    await caller.createOrder(input);
    expect((await caller.cancelOrder({ requestId: input.requestId })).success).toBe(true);
    expect((await caller.cancelOrder({ requestId: input.requestId })).success).toBe(true);
  });
  it("native shells and account switches cannot create a web PayPal order", async () => {
    const db = await getTestDatabase();
    const native = paypalRouter.createCaller({ drizzle: db, userId: BUYER, userAgent: "TNR-Native/1.0 (ios)" } as Parameters<typeof paypalRouter.createCaller>[0]);
    expect((await native.createOrder(request())).success).toBe(false);
    expect((await (await callerFor(paypalRouter, BUYER)).createOrder({ ...request(), expectedUserId: OTHER })).success).toBe(false);
    expect(fetchProvider).not.toHaveBeenCalled();
  });
  it("recovery rejects non-USD payments before credit", async () => {
    expect(await paid(20, { currency: "DKK" })).toMatchObject({ success: false });
    expect((await target())?.reputationPoints).toBe(0);
    expect(await (await getTestDatabase()).query.paypalTransaction.findMany()).toHaveLength(0);
  });
  it("legacy paid delivery and a Stripe reservation share one concurrent allowance", async () => {
    const stripe = await callerFor(stripeRouter, BUYER);
    const [payment, checkout] = await Promise.all([paid(3000), stripe.createCheckout(stripeRequest(3000))]);
    const granted = payment && "success" in payment && payment.success;
    expect([granted, checkout.success].filter(Boolean)).toHaveLength(1);
    expect(await (await callerFor(paypalRouter, BUYER)).getRecentRepsCount({ userId: BUYER })).toBeLessThanOrEqual(4000);
  });
  it.each([undefined, { enabled: false, status: "complete" }, { enabled: true, status: "failed" }])("does not fulfill Stripe sessions without completed automatic tax: %j", async (automatic_tax) => {
    const caller = await callerFor(stripeRouter, BUYER); const input = stripeRequest(20); const result = await caller.createCheckout(input);
    expect(result.success).toBe(true);
    const sessionId = `cs_test_${input.requestId}`;
    const session = stripeSessions.get(sessionId);
    Object.assign(session ?? {}, { status: "complete", payment_status: "paid", mode: "payment", payment_intent: "pi_test_tax", livemode: false, currency: "usd", amount_total: Math.round(reps2dollars(20) * 100), client_reference_id: input.requestId, automatic_tax, created: Math.floor(Date.now()/1000) });
    await expect(fulfillStripeSession(await getTestDatabase(), sessionId)).rejects.toThrow("tax calculation is incomplete");
    expect((await target())?.reputationPoints).toBe(0);
    expect(await (await getTestDatabase()).query.stripePayment.findMany()).toHaveLength(0);
  });
});
