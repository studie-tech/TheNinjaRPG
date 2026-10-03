// @vitest-environment node
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { paypalTransaction, stripeCheckout, stripePayment, storeUserIdAlias, userData } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { paypalRouter, syncTransactions, updateReps } from "@/server/api/routers/paypal";
import { stripeRouter } from "@/server/api/routers/stripe";
import * as stripeClient from "@/server/utils/stripe/client";
import { fulfillStripeSession } from "@/server/utils/stripe/fulfillment";
import { dollars2reps, reps2dollars } from "@/utils/paypal";
import { insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const BUYER = "web_buyer";
const TARGET = "web_recipient";
const OTHER = "web_other";
const orders = new Map<string, Record<string, unknown>>();
let createResponseFails = false;
let captureResponseMinimal = false;
const request = (reputationPoints = 20) => ({ requestId: nanoid(), expectedUserId: BUYER, userId: TARGET, reputationPoints });
const stripeRequest = (points: number) => ({ requestId: nanoid(), expectedUserId: BUYER, userId: TARGET, purchase: { type: "reputation" as const, reputationPoints: points } });
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
  const id = url.split("/orders/")[1]?.split("/")[0] ?? "";
  const order = orders.get(id);
  if (!order) return Response.json({}, { status: 404 });
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
    await resetTables(paypalTransaction, stripeCheckout, stripePayment, storeUserIdAlias, userData);
    await insertUsers([BUYER, TARGET, OTHER].map((userId) => ({ userId, username: userId, reputationPoints: 0, reputationPointsTotal: 0 })));
    Object.assign(env, { STRIPE_SECRET_KEY: "sk_test_placeholder", STRIPE_WEBHOOK_SECRET: "whsec_placeholder", STRIPE_PRICE_NORMAL: "price_normal", STRIPE_PRICE_SILVER: "price_silver", STRIPE_PRICE_GOLD: "price_gold" });
    orders.clear(); stripeSessions.clear(); createResponseFails = false; captureResponseMinimal = false; fetchProvider.mockClear();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchProvider as unknown as typeof fetch);
    vi.spyOn(stripeClient, "getStripe").mockReturnValue(stripeApi);
  });
  afterEach(() => { vi.restoreAllMocks(); Object.assign(env, original); });
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
    expect(result.success).toBe(true); expect(orders.size).toBe(1);
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
    expect((await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(2000))).success).toBe(false);
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
