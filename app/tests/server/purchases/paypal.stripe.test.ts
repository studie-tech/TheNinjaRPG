import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  paypalSubscription,
  paypalTransaction,
  stripeCheckout,
  stripePayment,
  storeUserIdAlias,
  userData,
  webStoreOrder,
} from "@/drizzle/schema";
import { MAX_REPS_PER_MONTH } from "@/drizzle/constants";
import { paypalRouter } from "@/server/api/routers/paypal";
import {
  deliverPaypalReputation,
  reconcilePaypalSubscription,
  syncTransactions,
  updateSubscription,
} from "@/server/utils/paypal/fulfillment";
import { reserveStoreOrder, deliverStoreOrder } from "@/server/utils/webStore";
import { stripeRouter } from "@/server/api/routers/stripe";
import * as stripeClient from "@/server/utils/stripe/client";
import {
  reconcileFederalStatuses,
  setFederalStatusWithStoreFloor,
} from "@/server/utils/purchases/federalStatus";
import {
  fulfillStripeInvoice,
  fulfillStripeSession,
} from "@/server/utils/stripe/fulfillment";
import {
  calcFedUgradeCost,
  dollars2reps,
  fedStatusRepsCost,
  reps2dollars,
} from "@/utils/paypal";
import { beforeStatements, failStatements } from "../../setup/statements";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { restoreEnvAfterEach } from "../../setup/env";
import { useStripeTestEnv } from "../../setup/stripe";

const BUYER = "web_buyer";
const TARGET = "web_recipient";
const OTHER = "web_other";
const orders = new Map<string, Record<string, unknown>>();
const subscriptions = new Map<string, Record<string, unknown>>();
let captureResponseMinimal = false;
const storeRequest = (reputationPoints = 20) => ({
  recipientId: TARGET,
  selection: { type: "custom" as const, reputationPoints },
});
const stripeRequest = (points: number) => ({
  requestId: nanoid().replace(/[-_]/g, "a"),
  expectedUserId: BUYER,
  userId: TARGET,
  purchase: { type: "reputation" as const, reputationPoints: points },
});
const fetchProvider = vi.fn(async (url: string, options?: RequestInit) => {
  if (url.endsWith("/token")) return Response.json({ access_token: "token" });
  if (options?.method === "POST" && url.endsWith("/orders")) {
    const idempotency =
      (options.headers as Record<string, string>)["PayPal-Request-Id"] ?? "";
    const previous = [...orders.values()].find((o) => o.requestId === idempotency);
    const body = JSON.parse(String(options.body));
    const id = previous?.id ?? `ORDER${String(orders.size).padStart(12, "0")}`;
    const order = previous ?? {
      id,
      status: "CREATED",
      ...body,
      requestId: idempotency,
    };
    orders.set(String(id), order);
    return Response.json(order);
  }
  if (url.includes("/v1/billing/subscriptions/")) {
    const id = url.split("/subscriptions/")[1]?.split("/")[0] ?? "";
    const subscription = subscriptions.get(id);
    if (url.endsWith("/cancel") && options?.method === "POST" && subscription) {
      subscription.status = "CANCELLED";
      return new Response(null, { status: 204 });
    }
    return Response.json(subscription ?? {}, { status: subscription ? 200 : 404 });
  }
  const id = url.split("/orders/")[1]?.split("/")[0] ?? "";
  const order = orders.get(id);
  if (!order) return Response.json({}, { status: 404 });
  if (url.endsWith("/capture")) {
    order.status = "COMPLETED";
    const units = order.purchase_units as {
      amount: unknown;
      invoice_id: string;
      payments?: unknown;
    }[];
    if (units[0])
      units[0].payments = {
        captures: [
          {
            id: `CAPTURE_${id}`,
            status: "COMPLETED",
            amount: units[0].amount,
            update_time: new Date().toISOString(),
          },
        ],
      };
  }
  if (url.endsWith("/capture") && captureResponseMinimal)
    return Response.json({ id: order.id, status: order.status });
  return Response.json(order);
});
const stripeSessions = new Map<string, Stripe.Checkout.Session>();
const stripeApi = {
  checkout: {
    sessions: {
      create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
        const session = {
          id: `cs_test_${params.client_reference_id}`,
          url: "https://checkout.stripe.com/test",
          metadata: params.metadata,
        } as Stripe.Checkout.Session;
        stripeSessions.set(session.id, session);
        return session;
      }),
      retrieve: vi.fn(async (id: string) => stripeSessions.get(id)),
    },
  },
} as unknown as Stripe;
const paid = async (
  points = 20,
  overrides: Partial<Parameters<typeof deliverPaypalReputation>[0]> = {},
) => {
  const value = reps2dollars(points);
  return deliverPaypalReputation({
    client: await getTestDatabase(),
    createdById: BUYER,
    affectedUserId: TARGET,
    transactionId: "legacy_capture",
    transactionUpdatedDate: new Date().toISOString(),
    value,
    currency: "USD",
    status: "COMPLETED",
    reps: dollars2reps(value),
    type: "REP_PURCHASE",
    raw: {},
    ...overrides,
  });
};
/** A PayPal subscription as the provider reports it: BUYER's active gold gift to TARGET, last paid `paidAt`. */
const providerSubscription = ({
  paidAt = new Date(),
  amount = "15.00",
  ...overrides
}: { paidAt?: Date; amount?: string } & Record<string, unknown> = {}) => ({
  id: "SUB_TEST",
  status: "ACTIVE",
  plan_id: "plan_test_gold",
  custom_id: `${BUYER}-${TARGET}`,
  billing_info: {
    last_payment: {
      time: paidAt.toISOString(),
      amount: { value: amount, currency_code: "USD" },
    },
  },
  ...overrides,
});
/** A completed PayPal reporting transaction from BUYER for TARGET, updated now. */
const transactionInfo = (overrides: Record<string, unknown>) => ({
  transaction_status: "S",
  custom_field: `${BUYER}-${TARGET}`,
  transaction_updated_date: new Date().toISOString(),
  ...overrides,
});
const target = async () =>
  (await getTestDatabase()).query.userData.findFirst({
    where: eq(userData.userId, TARGET),
  });

describeWithDatabase("Shared PayPal and Stripe reputation reservations", () => {
  useStripeTestEnv();
  restoreEnvAfterEach(
    "NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL",
    "NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER",
    "NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD",
  );
  beforeEach(async () => {
    await resetTables(
      paypalSubscription,
      paypalTransaction,
      stripeCheckout,
      stripePayment,
      storeUserIdAlias,
      webStoreOrder,
      userData,
    );
    await insertUsers(
      [BUYER, TARGET, OTHER].map((userId) => ({
        userId,
        username: userId,
        reputationPoints: 0,
        reputationPointsTotal: 0,
      })),
    );
    orders.clear();
    subscriptions.clear();
    stripeSessions.clear();
    Object.assign(process.env, {
      NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL: "plan_test_normal",
      NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER: "plan_test_silver",
      NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD: "plan_test_gold",
    });
    captureResponseMinimal = false;
    fetchProvider.mockClear();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchProvider as unknown as typeof fetch,
    );
    vi.spyOn(stripeClient, "getStripe").mockReturnValue(stripeApi);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const completeStripe = (
    input: ReturnType<typeof stripeRequest>,
    created = Date.now(),
    overrides: Record<string, unknown> = {},
  ) => {
    const session = stripeSessions.get(`cs_test_${input.requestId}`);
    Object.assign(session ?? {}, {
      status: "complete",
      payment_status: "paid",
      mode: "payment",
      payment_intent: `pi_${input.requestId}`,
      livemode: false,
      currency: "usd",
      amount_total: Math.round(reps2dollars(input.purchase.reputationPoints) * 100),
      client_reference_id: input.requestId,
      managed_payments: { enabled: true },
      automatic_tax: { enabled: true, status: "complete" },
      created: Math.floor(created / 1000),
      ...overrides,
    });
    return `cs_test_${input.requestId}`;
  };
  it("does not charge the buyer's allowance for recruiter rewards recorded against that buyer", async () => {
    const db = await getTestDatabase();
    await paid(20);
    await db.insert(paypalTransaction).values({
      id: "referral_receipt",
      createdById: BUYER,
      affectedUserId: OTHER,
      transactionId: "referral_tx",
      transactionUpdatedDate: new Date().toISOString(),
      amount: 0,
      reputationPoints: MAX_REPS_PER_MONTH,
      currency: "USD",
      status: "COMPLETED",
      type: "REFERRAL",
      rawData: {},
    });
    expect(
      await (await callerFor(paypalRouter, BUYER)).getRecentRepsCount({
        userId: BUYER,
      }),
    ).toBe(20);
    expect(
      (await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(20)))
        .success,
    ).toBe(true);
    expect(
      (await (await callerFor(paypalRouter, BUYER)).createStoreOrder(storeRequest(20)))
        .success,
    ).toBe(true);
  });
  it.each(["insert", "update", "unchanged"])(
    "repairs derived support after an interrupted subscription %s without a transaction",
    async (mode) => {
      const db = await getTestDatabase();
      const paidAt = new Date(Date.now() - 3600000);
      if (mode !== "insert")
        await db.insert(paypalSubscription).values({
          id: "recover_projection",
          subscriptionId: "I-PROJECTION",
          createdById: BUYER,
          affectedUserId: TARGET,
          federalStatus: mode === "unchanged" ? "GOLD" : "NORMAL",
          status: "ACTIVE",
          orderId: "I-PROJECTION",
          updatedAt:
            mode === "unchanged" ? paidAt : new Date(Date.now() - 2 * 86400000),
        });
      const input = {
        client: failStatements(db, userData),
        createdById: BUYER,
        affectedUserId: TARGET,
        subscriptionId: "I-PROJECTION",
        orderId: "I-PROJECTION",
        federalStatus: "GOLD" as const,
        status: "ACTIVE",
        lastPayment: paidAt,
      };
      // The paid ledger survives a failed projection write; an identical retry must repair it.
      await expect(updateSubscription(input)).rejects.toThrow(
        "Statement failed on purpose",
      );
      expect(await db.query.paypalSubscription.findMany()).toEqual([
        expect.objectContaining({ federalStatus: "GOLD", updatedAt: paidAt }),
      ]);
      expect((await target())?.federalStatus).toBe("NONE");
      expect((await updateSubscription({ ...input, client: db })).success).toBe(true);
      expect((await target())?.federalStatus).toBe("GOLD");
      expect(await db.query.paypalSubscription.findMany()).toHaveLength(1);
    },
  );
  it("does not apply a subscription update after its ownership changes", async () => {
    const db = await getTestDatabase();
    await db.insert(paypalSubscription).values({
      id: "moved_subscription",
      subscriptionId: "I-MOVED",
      createdById: BUYER,
      affectedUserId: TARGET,
      federalStatus: "NORMAL",
      status: "ACTIVE",
      updatedAt: new Date(Date.now() - 2 * 86400000),
    });
    const client = beforeStatements(db, paypalSubscription, [
      () =>
        db
          .update(paypalSubscription)
          .set({ createdById: OTHER, affectedUserId: OTHER })
          .where(eq(paypalSubscription.id, "moved_subscription")),
    ]);
    expect(
      (
        await updateSubscription({
          client,
          createdById: BUYER,
          affectedUserId: TARGET,
          subscriptionId: "I-MOVED",
          federalStatus: "GOLD",
          status: "ACTIVE",
          lastPayment: new Date(),
        })
      ).success,
    ).toBe(false);
    expect((await target())?.federalStatus).toBe("NONE");
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({
      createdById: OTHER,
      affectedUserId: OTHER,
      federalStatus: "NORMAL",
    });
  });
  it.each([false, true])(
    "shares bundle reservations and delivered receipts with Stripe: Stripe first=%s",
    async (stripeFirst) => {
      const db = await getTestDatabase();
      await paid(MAX_REPS_PER_MONTH - 1000);
      const stripe = await callerFor(stripeRouter, BUYER);
      const paypal = await callerFor(paypalRouter, BUYER);
      const offer = {
        name: "Reputation bundle",
        priceCents: 100000,
        contents: { reputationPoints: 990, money: 0, items: [] },
      };
      if (stripeFirst) {
        const input = stripeRequest(990);
        expect((await stripe.createCheckout(input)).success).toBe(true);
        expect(
          (
            await reserveStoreOrder(db, BUYER, TARGET, {
              ...offer,
              contents: { ...offer.contents, reputationPoints: 20 },
            })
          ).success,
        ).toBe(false);
        const sessionId = completeStripe(input);
        expect(await fulfillStripeSession(db, sessionId)).toBe("fulfilled");
        expect(
          (
            await reserveStoreOrder(db, BUYER, TARGET, {
              ...offer,
              contents: { ...offer.contents, reputationPoints: 20 },
            })
          ).success,
        ).toBe(false);
      } else {
        const reserved = await reserveStoreOrder(db, BUYER, TARGET, offer);
        if (!reserved.success) throw new Error(reserved.message);
        expect((await stripe.createCheckout(stripeRequest(20))).success).toBe(false);
        const receipt = {
          snapshotId: reserved.order.id,
          captureId: "bundle_capture",
          orderId: "bundle_order",
          invoiceId: reserved.order.id,
          currency: "USD",
          value: "1000.00",
          raw: {},
        };
        const results = await Promise.all([
          deliverStoreOrder(db, receipt),
          deliverStoreOrder(db, receipt),
        ]);
        expect(results.every((result) => result.success)).toBe(true);
        expect(await db.query.paypalTransaction.findMany()).toHaveLength(2);
        expect((await stripe.createCheckout(stripeRequest(20))).success).toBe(false);
      }
      expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(
        MAX_REPS_PER_MONTH - 10,
      );
      expect((await target())?.reputationPoints).toBe(MAX_REPS_PER_MONTH - 10);
    },
  );
  it("serializes simultaneous bundle and Stripe reservations on the buyer allowance", async () => {
    const db = await getTestDatabase();
    await paid(MAX_REPS_PER_MONTH - 1000);
    const stripe = await callerFor(stripeRouter, BUYER);
    const results = await Promise.all([
      stripe.createCheckout(stripeRequest(990)),
      reserveStoreOrder(db, BUYER, TARGET, {
        name: "Reputation bundle",
        priceCents: 100000,
        contents: { reputationPoints: 990, money: 0, items: [] },
      }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(
      await (await callerFor(paypalRouter, BUYER)).getRecentRepsCount({
        userId: BUYER,
      }),
    ).toBe(MAX_REPS_PER_MONTH - 10);
    expect((await target())?.reputationPoints).toBe(MAX_REPS_PER_MONTH - 1000);
  });
  it.each([false, true])(
    "holds delayed Stripe payment for review when released allowance is consumed: PayPal=%s",
    async (usePaypal) => {
      const db = await getTestDatabase();
      const stripe = await callerFor(stripeRouter, BUYER);
      const paypal = await callerFor(paypalRouter, BUYER);
      const first = stripeRequest(3000);
      await stripe.createCheckout(first);
      const old = Date.now() - 26 * 3600000;
      await db
        .update(stripeCheckout)
        .set({ createdAt: new Date(old) })
        .where(eq(stripeCheckout.id, first.requestId));
      expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(0);
      const second = stripeRequest(3000);
      if (usePaypal) {
        for (let purchase = 0; purchase < 3; purchase++) {
          const order = await paypal.createStoreOrder(storeRequest(1000));
          if (!("orderId" in order)) throw new Error("missing order");
          Object.assign(orders.get(order.orderId) ?? {}, { status: "APPROVED" });
          expect(
            (await paypal.captureStoreOrder({ orderId: order.orderId })).success,
          ).toBe(true);
        }
      } else {
        expect((await stripe.createCheckout(second)).success).toBe(true);
        completeStripe(second);
      }
      const sessionId = completeStripe(first, old);
      const results = await Promise.all([
        fulfillStripeSession(db, sessionId),
        fulfillStripeSession(db, sessionId),
        ...(usePaypal ? [] : [fulfillStripeSession(db, `cs_test_${second.requestId}`)]),
      ]);
      expect(results.slice(0, 2)).toEqual(["review_required", "review_required"]);
      expect((await target())?.reputationPoints).toBe(3000);
      expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(3000);
      const outcome = await stripe.resolveSession({ sessionId });
      expect(outcome).toMatchObject({ success: false });
      expect(outcome.message).toContain("Contact support");
      expect(
        await db.query.stripePayment.findFirst({
          where: eq(stripePayment.checkoutId, first.requestId),
        }),
      ).toMatchObject({ grantedAt: null, reviewRequired: true });
      await db
        .update(stripePayment)
        .set({ purchasedAt: new Date(Date.now() - 31 * 86400000) })
        .where(eq(stripePayment.checkoutId, second.requestId));
      await db
        .update(paypalTransaction)
        .set({ createdAt: new Date(Date.now() - 31 * 86400000) });
      expect(await fulfillStripeSession(db, sessionId)).toBe("review_required");
      expect((await target())?.reputationPoints).toBe(3000);
    },
  );
  it("serializes concurrent deliveries of expired Stripe reservations", async () => {
    const db = await getTestDatabase();
    const stripe = await callerFor(stripeRouter, BUYER);
    const sessions: string[] = [];
    for (const input of [stripeRequest(3000), stripeRequest(3000)]) {
      expect((await stripe.createCheckout(input)).success).toBe(true);
      const old = Date.now() - 26 * 3600000;
      await db
        .update(stripeCheckout)
        .set({ createdAt: new Date(old) })
        .where(eq(stripeCheckout.id, input.requestId));
      sessions.push(completeStripe(input, old));
    }
    const outcomes = await Promise.all(
      sessions.map((id) => fulfillStripeSession(db, id)),
    );
    expect(outcomes.sort()).toEqual(["fulfilled", "review_required"]);
    expect((await target())?.reputationPoints).toBe(3000);
  });
  it.each([false, true])(
    "actual PayPal checkout and Stripe share reservations: Stripe first=%s",
    async (stripeFirst) => {
      await paid(MAX_REPS_PER_MONTH - 1000);
      const paypal = await callerFor(paypalRouter, BUYER);
      const stripe = await callerFor(stripeRouter, BUYER);
      if (stripeFirst) {
        expect((await stripe.createCheckout(stripeRequest(990))).success).toBe(true);
        expect((await paypal.createStoreOrder(storeRequest(20))).success).toBe(false);
        expect(fetchProvider).not.toHaveBeenCalled();
      } else {
        expect((await paypal.createStoreOrder(storeRequest(990))).success).toBe(true);
        expect((await stripe.createCheckout(stripeRequest(20))).success).toBe(false);
      }
      expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(
        MAX_REPS_PER_MONTH - 10,
      );
    },
  );
  it("concurrent actual PayPal and Stripe checkouts reserve the allowance once", async () => {
    await paid(MAX_REPS_PER_MONTH - 1000);
    const paypal = await callerFor(paypalRouter, BUYER);
    const stripe = await callerFor(stripeRouter, BUYER);
    const outcomes = await Promise.all([
      paypal.createStoreOrder(storeRequest(990)),
      stripe.createCheckout(stripeRequest(990)),
    ]);
    expect(outcomes.filter((outcome) => outcome.success)).toHaveLength(1);
    expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(
      MAX_REPS_PER_MONTH - 10,
    );
  });
  it("actual PayPal capture delivers once and fetches minimal provider responses", async () => {
    const paypal = await callerFor(paypalRouter, BUYER);
    const order = await paypal.createStoreOrder(storeRequest(20));
    if (!("orderId" in order)) throw new Error("missing order");
    Object.assign(orders.get(order.orderId) ?? {}, { status: "APPROVED" });
    captureResponseMinimal = true;
    const outcomes = await Promise.all([
      paypal.captureStoreOrder({ orderId: order.orderId }),
      paypal.captureStoreOrder({ orderId: order.orderId }),
    ]);
    expect(outcomes.some((outcome) => outcome.success)).toBe(true);
    expect((await paypal.captureStoreOrder({ orderId: order.orderId })).success).toBe(
      true,
    );
    expect((await target())?.reputationPoints).toBe(20);
    expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(20);
    expect(
      await (await getTestDatabase()).query.paypalTransaction.findMany(),
    ).toHaveLength(1);
    expect((await paypal.resolveOrder({ orderId: order.orderId })).success).toBe(true);
    expect((await target())?.reputationPoints).toBe(20);
  });
  it.each(["RESERVED", "CAPTURING", "DELIVERY_PENDING"])(
    "retains compatibility allowance for historical %s receipts",
    async (status) => {
      const db = await getTestDatabase();
      await db.insert(paypalTransaction).values({
        id: "historical",
        createdById: BUYER,
        affectedUserId: TARGET,
        transactionId: "reservation_historical",
        transactionUpdatedDate: new Date().toISOString(),
        amount: reps2dollars(MAX_REPS_PER_MONTH - 500),
        reputationPoints: MAX_REPS_PER_MONTH - 500,
        currency: "USD",
        status,
        type: "REP_PURCHASE",
        rawData: {},
      });
      const paypal = await callerFor(paypalRouter, BUYER);
      expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(
        MAX_REPS_PER_MONTH - 500,
      );
      expect((await paypal.createStoreOrder(storeRequest(1000))).success).toBe(false);
      expect(
        (
          await (
            await callerFor(stripeRouter, BUYER)
          ).createCheckout(stripeRequest(2000))
        ).success,
      ).toBe(false);
      await db
        .update(paypalTransaction)
        .set({ createdAt: new Date(Date.now() - 4 * 3600000) });
      expect(await paypal.getRecentRepsCount({ userId: BUYER })).toBe(
        status === "RESERVED" ? 0 : MAX_REPS_PER_MONTH - 500,
      );
    },
  );
  const receipt = {
    id: "reserved_receipt",
    createdById: BUYER,
    affectedUserId: TARGET,
    transactionId: "legacy_capture",
    transactionUpdatedDate: new Date().toISOString(),
    orderId: "reserved_order",
    amount: reps2dollars(20),
    reputationPoints: 20,
    currency: "USD",
    status: "RESERVED",
    type: "REP_PURCHASE" as const,
    rawData: {},
  };
  it.each([
    [
      "buyer",
      { createdById: OTHER },
      "PayPal payment does not match receipt ownership or amount",
    ],
    [
      "recipient",
      { affectedUserId: OTHER },
      "PayPal payment does not match receipt ownership or amount",
    ],
    [
      "amount",
      { amount: receipt.amount + 1 },
      "PayPal payment does not match receipt ownership or amount",
    ],
    [
      "currency",
      { currency: "EUR" },
      "PayPal payment does not match receipt ownership or amount",
    ],
    [
      "reputation",
      { reputationPoints: 21 },
      "PayPal payment does not match reserved terms",
    ],
    [
      "order",
      { orderId: "other_order" },
      "PayPal payment does not match reserved terms",
    ],
  ])(
    "refuses a payment whose %s differs from its reserved receipt",
    async (_, terms, message) => {
      await (await getTestDatabase())
        .insert(paypalTransaction)
        .values({ ...receipt, ...terms });
      await expect(paid(20, { orderId: "reserved_order" })).rejects.toThrow(message);
      expect((await target())?.reputationPoints).toBe(0);
    },
  );
  it("answers delivered receipts before comparing their reserved terms, but never before ownership", async () => {
    const db = await getTestDatabase();
    await db
      .insert(paypalTransaction)
      .values({ ...receipt, status: "COMPLETED", reputationPoints: 21 });
    expect(await paid(20, { orderId: "reserved_order" })).toEqual({
      success: true,
      message: "Reputation points already delivered",
    });
    await db.update(paypalTransaction).set({ affectedUserId: OTHER });
    await expect(paid(20, { orderId: "reserved_order" })).rejects.toThrow(
      "receipt ownership or amount",
    );
    expect((await target())?.reputationPoints).toBe(0);
  });
  it("recovery of an unreserved legacy payment cannot exceed Stripe's reservation", async () => {
    expect(
      (await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeRequest(3000)))
        .success,
    ).toBe(true);
    const outcome = await paid(2000);
    expect(outcome && "success" in outcome && outcome.success).toBe(false);
    expect((await target())?.reputationPoints).toBe(0);
    expect(
      await (await getTestDatabase()).query.paypalTransaction.findFirst(),
    ).toMatchObject({ status: "REVIEW_REQUIRED" });
  });
  it("a review-required payment remains held even after other reservations disappear", async () => {
    const db = await getTestDatabase();
    const stripeInput = stripeRequest(3000);
    await (await callerFor(stripeRouter, BUYER)).createCheckout(stripeInput);
    expect(await paid(2000)).toMatchObject({ success: false });
    await db
      .update(stripeCheckout)
      .set({ closedAt: new Date() })
      .where(eq(stripeCheckout.id, stripeInput.requestId));
    expect(await paid(2000)).toMatchObject({ success: false });
    expect((await target())?.reputationPoints).toBe(0);
  });
  it("concurrent PayPal delivery retries cannot credit the same capture twice", async () => {
    await Promise.all(Array.from({ length: 5 }, () => paid()));
    expect((await target())?.reputationPoints).toBe(dollars2reps(reps2dollars(20)));
    expect(
      await (await getTestDatabase()).query.paypalTransaction.findMany(),
    ).toHaveLength(1);
  });
  it("missing recipients roll back the receipt so recovery can deliver", async () => {
    const db = await getTestDatabase();
    await db.delete(userData).where(eq(userData.userId, TARGET));
    await expect(paid()).rejects.toThrow("recipient not found");
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
    await insertUsers([{ userId: TARGET, username: TARGET, reputationPoints: 0 }]);
    expect(await paid()).toMatchObject({ success: true });
  });
  it("transaction lookup reports not found as failure with a recovery message", async () => {
    const caller = await callerFor(paypalRouter, BUYER);
    expect(
      await caller.resolveTransaction({
        transactionId: "MISSING_CAPTURE",
        transactionDate: new Date(),
      }),
    ).toMatchObject({
      success: false,
      message: expect.stringContaining("No completed PayPal transaction was found"),
    });
  });
  it.each([
    { custom_field: "", transaction_amount: { value: "10", currency_code: "USD" } },
    { transaction_amount: undefined },
    { transaction_amount: { value: "NaN", currency_code: "USD" } },
    { transaction_amount: { value: "1invalid", currency_code: "USD" } },
    { transaction_amount: { value: "0", currency_code: "USD" } },
    { transaction_amount: { value: "-1", currency_code: "USD" } },
    { transaction_amount: { value: "10", currency_code: "DKK" } },
  ])(
    "malformed or invalid reporting data is a failed recovery: %j",
    async (overrides) => {
      const info = transactionInfo({ transaction_id: "INVALID_CAPTURE", ...overrides });
      const outcome = await syncTransactions(
        await getTestDatabase(),
        [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1],
        "token",
      );
      expect(outcome[0]?.success).toBe(false);
      expect(outcome[0]?.message).toContain("invalid");
      expect((await target())?.reputationPoints).toBe(0);
      expect(
        await (await getTestDatabase()).query.paypalTransaction.findMany(),
      ).toHaveLength(0);
    },
  );
  it("missing subscription details return failure without granting coverage", async () => {
    const info = transactionInfo({
      transaction_id: "SUB_CAPTURE",
      transaction_amount: { value: "10", currency_code: "USD" },
      paypal_reference_id_type: "SUB",
      paypal_reference_id: "MISSING_SUBSCRIPTION",
    });
    expect(
      await syncTransactions(
        await getTestDatabase(),
        [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1],
        "token",
      ),
    ).toMatchObject([
      { success: false, message: expect.stringContaining("not found") },
    ]);
  });
  it.each([
    { plan_id: "plan_unknown" },
    { custom_id: `${OTHER}-${TARGET}` },
    { custom_id: `${BUYER}-${OTHER}` },
    { custom_id: undefined },
    { custom_id: `${BUYER}-${TARGET}-extra` },
    {
      billing_info: {
        last_payment: {
          time: new Date(Date.now() + 86400000).toISOString(),
          amount: { value: "15.00", currency_code: "USD" },
        },
      },
    },
    {
      billing_info: {
        last_payment: {
          time: new Date().toISOString(),
          amount: { value: "15.00", currency_code: "DKK" },
        },
      },
    },
  ])(
    "subscription recovery rejects unknown or inconsistent paid terms: %j",
    async (overrides) => {
      const subscription = providerSubscription(overrides);
      subscriptions.set("SUB_TEST", subscription);
      const info = transactionInfo({
        transaction_id: "SUB_CAPTURE",
        transaction_amount: { value: "15", currency_code: "USD" },
        paypal_reference_id_type: "SUB",
        paypal_reference_id: "SUB_TEST",
      });
      expect(
        await syncTransactions(
          await getTestDatabase(),
          [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1],
          "token",
        ),
      ).toMatchObject([{ success: false }]);
      expect((await target())?.federalStatus).toBe("NONE");
      expect(
        await (await getTestDatabase()).query.paypalSubscription.findMany(),
      ).toHaveLength(0);
    },
  );
  it("a configured, owned paid subscription grants the gift once and sync retries succeed", async () => {
    subscriptions.set("SUB_TEST", providerSubscription());
    const caller = await callerFor(paypalRouter, BUYER);
    const giftResult = await caller.resolveSubscription({ subscriptionId: "SUB_TEST" });
    expect(giftResult.success).toBe(true);
    expect(giftResult.userPatch).toEqual({});
    expect((await target())?.federalStatus).toBe("GOLD");
    expect(
      (await caller.resolveSubscription({ subscriptionId: "SUB_TEST" })).userPatch,
    ).toEqual({});
    expect(
      await (await getTestDatabase()).query.paypalSubscription.findMany(),
    ).toHaveLength(1);
    const recipientResult = await (
      await callerFor(paypalRouter, TARGET)
    ).resolveSubscription({ subscriptionId: "SUB_TEST" });
    expect(recipientResult.success).toBe(true);
    expect(recipientResult.userPatch).toBeUndefined();
    expect(recipientResult.userDelta).toBeUndefined();
    const rejected = await (await callerFor(paypalRouter, OTHER)).resolveSubscription({
      subscriptionId: "SUB_TEST",
    });
    expect(rejected.success).toBe(false);
    expect(rejected.userPatch).toBeUndefined();
  });
  it.each(["buyer", "recipient"] as const)(
    "uses canonical subscription ownership for a renamed %s's cache response",
    async (renamed) => {
      const db = await getTestDatabase();
      await db
        .insert(storeUserIdAlias)
        .values(
          renamed === "recipient"
            ? { oldUserId: TARGET, newUserId: BUYER }
            : { oldUserId: BUYER, newUserId: OTHER },
        );
      subscriptions.set("SUB_TEST", providerSubscription());
      const callerId = renamed === "recipient" ? BUYER : OTHER;
      const affectedUserId = renamed === "recipient" ? BUYER : TARGET;
      const result = await (
        await callerFor(paypalRouter, callerId)
      ).resolveSubscription({ subscriptionId: "SUB_TEST" });
      expect(result.success).toBe(true);
      expect(result.userPatch).toEqual(renamed === "recipient" ? undefined : {});
      expect(result.userDelta).toBeUndefined();
      expect(await db.query.paypalSubscription.findFirst()).toMatchObject({
        createdById: callerId,
        affectedUserId,
      });
      expect(
        await db.query.userData.findFirst({
          where: eq(userData.userId, affectedUserId),
        }),
      ).toMatchObject({ federalStatus: "GOLD" });
      expect(
        await db.query.userData.findFirst({
          where: eq(userData.userId, renamed === "recipient" ? TARGET : OTHER),
        }),
      ).toMatchObject({ federalStatus: "NONE" });
    },
  );
  it.each([
    ["GOLD", "NORMAL", "plan_test_normal", "5.00"],
    ["GOLD", "SILVER", "plan_test_silver", "10.00"],
    ["SILVER", "NORMAL", "plan_test_normal", "5.00"],
  ] as const)(
    "preserves paid PayPal %s while synchronizing and cancelling %s, then expires the higher tier",
    async (higher, lower, plan, amount) => {
      const db = await getTestDatabase();
      const paidAt = new Date(Date.now() - 86400000);
      await db
        .update(userData)
        .set({ federalStatus: higher })
        .where(eq(userData.userId, TARGET));
      await db.insert(paypalSubscription).values({
        id: "higher-sub",
        subscriptionId: "SUB_HIGH",
        createdById: BUYER,
        affectedUserId: TARGET,
        orderId: "SUB_HIGH",
        status: "ACTIVE",
        federalStatus: higher,
        updatedAt: paidAt,
      });
      const subscription = {
        id: "SUB_LOW",
        status: "ACTIVE",
        plan_id: plan,
        custom_id: `${BUYER}-${TARGET}`,
        billing_info: {
          last_payment: {
            time: paidAt.toISOString(),
            amount: { value: amount, currency_code: "USD" },
          },
        },
      };
      subscriptions.set("SUB_LOW", subscription);
      const caller = await callerFor(paypalRouter, BUYER);
      expect(
        (await caller.resolveSubscription({ subscriptionId: "SUB_LOW" })).success,
      ).toBe(true);
      expect((await target())?.federalStatus).toBe(higher);
      subscription.billing_info.last_payment.time = new Date().toISOString();
      expect(
        (await caller.resolveSubscription({ subscriptionId: "SUB_LOW" })).success,
      ).toBe(true);
      expect((await target())?.federalStatus).toBe(higher);
      expect(
        (await caller.cancelPaypalSubscription({ subscriptionId: "SUB_LOW" })).success,
      ).toBe(true);
      expect(
        (await caller.resolveSubscription({ subscriptionId: "SUB_LOW" })).success,
      ).toBe(true);
      expect((await target())?.federalStatus).toBe(higher);
      expect(
        await db.query.paypalSubscription.findFirst({
          where: eq(paypalSubscription.subscriptionId, "SUB_HIGH"),
        }),
      ).toEqual(
        expect.objectContaining({
          status: "ACTIVE",
          federalStatus: higher,
          updatedAt: paidAt,
        }),
      );
      expect(
        await db.query.paypalSubscription.findFirst({
          where: eq(paypalSubscription.subscriptionId, "SUB_LOW"),
        }),
      ).toMatchObject({ status: "CANCELLED", federalStatus: lower });
      await db
        .update(paypalSubscription)
        .set({ updatedAt: new Date(Date.now() - 32 * 86400000) })
        .where(eq(paypalSubscription.subscriptionId, "SUB_HIGH"));
      await reconcileFederalStatuses(db);
      expect((await target())?.federalStatus).toBe(lower);
      await db
        .update(paypalSubscription)
        .set({ updatedAt: new Date(Date.now() - 32 * 86400000) })
        .where(eq(paypalSubscription.subscriptionId, "SUB_LOW"));
      await reconcileFederalStatuses(db);
      expect((await target())?.federalStatus).toBe("NONE");
    },
  );
  it("direct subscription recovery rejects an unknown paid plan without downgrading coverage", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, TARGET));
    subscriptions.set("SUB_TEST", providerSubscription({ plan_id: "plan_unknown" }));
    expect(
      (
        await (
          await callerFor(paypalRouter, BUYER)
        ).resolveSubscription({ subscriptionId: "SUB_TEST" })
      ).success,
    ).toBe(false);
    expect((await target())?.federalStatus).toBe("GOLD");
  });
  it.each([0.01, 14.99, 15.01, 30])(
    "neither recovery path grants GOLD for the wrong paid total: %s",
    async (amount) => {
      subscriptions.set(
        "SUB_TEST",
        providerSubscription({ amount: amount.toFixed(2) }),
      );
      const caller = await callerFor(paypalRouter, BUYER);
      expect(
        (await caller.resolveSubscription({ subscriptionId: "SUB_TEST" })).success,
      ).toBe(false);
      const info = transactionInfo({
        transaction_id: "SUB_CAPTURE",
        transaction_amount: { value: amount.toFixed(2), currency_code: "USD" },
        paypal_reference_id_type: "SUB",
        paypal_reference_id: "SUB_TEST",
      });
      expect(
        await syncTransactions(
          await getTestDatabase(),
          [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1],
          "token",
        ),
      ).toMatchObject([{ success: false }]);
      expect((await target())?.federalStatus).toBe("NONE");
      expect(
        await (await getTestDatabase()).query.paypalSubscription.findMany(),
      ).toHaveLength(0);
    },
  );
  it.each([
    { tier: "NORMAL", price: 5 },
    { tier: "SILVER", price: 10 },
  ])("accepts the configured USD amount for %s", async ({ tier, price }) => {
    subscriptions.set(
      "SUB_TEST",
      providerSubscription({
        plan_id: `plan_test_${tier.toLowerCase()}`,
        amount: price.toFixed(2),
      }),
    );
    expect(
      (
        await (
          await callerFor(paypalRouter, BUYER)
        ).resolveSubscription({ subscriptionId: "SUB_TEST" })
      ).success,
    ).toBe(true);
    expect((await target())?.federalStatus).toBe(tier);
  });
  it("direct recovery retains a cancelled subscription's paid period through reconciliation, then expires it", async () => {
    const db = await getTestDatabase();
    const paidAt = new Date(Date.now() - 86400000);
    subscriptions.set(
      "SUB_TEST",
      providerSubscription({ status: "CANCELLED", paidAt }),
    );
    const caller = await callerFor(paypalRouter, BUYER);
    expect(
      (await caller.resolveSubscription({ subscriptionId: "SUB_TEST" })).success,
    ).toBe(true);
    expect((await target())?.federalStatus).toBe("GOLD");
    expect(await db.query.paypalSubscription.findFirst()).toEqual(
      expect.objectContaining({
        status: "CANCELLED",
        federalStatus: "GOLD",
        updatedAt: paidAt,
      }),
    );
    await setFederalStatusWithStoreFloor(db, TARGET, "NONE");
    await reconcileFederalStatuses(db);
    expect((await target())?.federalStatus).toBe("GOLD");
    await db
      .update(paypalSubscription)
      .set({ updatedAt: new Date(Date.now() - 32 * 86400000) })
      .where(eq(paypalSubscription.subscriptionId, "SUB_TEST"));
    await reconcileFederalStatuses(db);
    expect((await target())?.federalStatus).toBe("NONE");
  });
  it("a cancelled subscription with an expired paid period cannot restore coverage", async () => {
    subscriptions.set(
      "SUB_TEST",
      providerSubscription({
        status: "CANCELLED",
        paidAt: new Date(Date.now() - 32 * 86400000),
      }),
    );
    expect(
      (
        await (
          await callerFor(paypalRouter, BUYER)
        ).resolveSubscription({ subscriptionId: "SUB_TEST" })
      ).success,
    ).toBe(true);
    expect((await target())?.federalStatus).toBe("NONE");
  });
  it("scheduled reconciliation never turns an old active payment into a fresh paid period", async () => {
    const db = await getTestDatabase();
    const paidAt = new Date(Date.now() - 40 * 86400000);
    await db.insert(paypalSubscription).values({
      id: "expired-sub",
      subscriptionId: "SUB_TEST",
      createdById: BUYER,
      affectedUserId: TARGET,
      orderId: "ORDER_TEST",
      status: "ACTIVE",
      federalStatus: "GOLD",
      updatedAt: paidAt,
    });
    const subscription = providerSubscription({ paidAt });
    expect(
      await reconcilePaypalSubscription({
        client: db,
        subscription,
        subscriptionId: "SUB_TEST",
        expected: { createdById: BUYER, affectedUserId: TARGET },
      }),
    ).toMatchObject({ success: true });
    expect(await db.query.paypalSubscription.findFirst()).toEqual(
      expect.objectContaining({ updatedAt: paidAt, federalStatus: "NONE" }),
    );
    expect((await target())?.federalStatus).toBe("NONE");
  });
  it("scheduled reconciliation uses the provider payment date and rejects a wrong paid amount", async () => {
    const db = await getTestDatabase();
    const oldPaidAt = new Date(Date.now() - 40 * 86400000);
    const paidAt = new Date(Date.now() - 2 * 86400000);
    await db.insert(paypalSubscription).values({
      id: "renew-sub",
      subscriptionId: "SUB_TEST",
      createdById: BUYER,
      affectedUserId: TARGET,
      orderId: "ORDER_TEST",
      status: "ACTIVE",
      federalStatus: "GOLD",
      updatedAt: oldPaidAt,
    });
    const subscription = providerSubscription({ paidAt, amount: "0.01" });
    expect(
      await reconcilePaypalSubscription({
        client: db,
        subscription,
        subscriptionId: "SUB_TEST",
        expected: { createdById: BUYER, affectedUserId: TARGET },
      }),
    ).toMatchObject({ success: false });
    expect(await db.query.paypalSubscription.findFirst()).toEqual(
      expect.objectContaining({ updatedAt: oldPaidAt }),
    );
    subscription.billing_info.last_payment.amount.value = "15.00";
    expect(
      await reconcilePaypalSubscription({
        client: db,
        subscription,
        subscriptionId: "SUB_TEST",
        expected: { createdById: BUYER, affectedUserId: TARGET },
      }),
    ).toMatchObject({ success: true });
    expect(await db.query.paypalSubscription.findFirst()).toEqual(
      expect.objectContaining({ updatedAt: paidAt }),
    );
    expect((await target())?.federalStatus).toBe("GOLD");
  });
  it("provider-only approvals retain a billing reference and a saved reputation upgrade", async () => {
    const db = await getTestDatabase();
    const paidAt = new Date(Date.now() - 10 * 86400000);
    const upgradeAt = new Date(Date.now() - 5 * 86400000);
    await db.insert(paypalSubscription).values({
      id: "upgrade-sub",
      subscriptionId: "SUB_TEST",
      createdById: BUYER,
      affectedUserId: TARGET,
      status: "ACTIVE",
      federalStatus: "GOLD",
      updatedAt: upgradeAt,
    });
    await db
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, TARGET));
    const subscription = providerSubscription({
      plan_id: "plan_test_normal",
      paidAt,
      amount: "5.00",
    });
    expect(
      await reconcilePaypalSubscription({
        client: db,
        subscription,
        subscriptionId: "SUB_TEST",
      }),
    ).toMatchObject({ success: true });
    expect(await db.query.paypalSubscription.findFirst()).toEqual(
      expect.objectContaining({
        orderId: "SUB_TEST",
        federalStatus: "GOLD",
        updatedAt: upgradeAt,
      }),
    );
    subscription.billing_info.last_payment.time = new Date().toISOString();
    expect(
      await reconcilePaypalSubscription({
        client: db,
        subscription,
        subscriptionId: "SUB_TEST",
      }),
    ).toMatchObject({ success: true });
    expect(await db.query.paypalSubscription.findFirst()).toEqual(
      expect.objectContaining({ federalStatus: "GOLD", updatedAt: upgradeAt }),
    );
  });
  it("concurrent gifts cannot spend the same reputation balance twice", async () => {
    const db = await getTestDatabase();
    const cost = fedStatusRepsCost("GOLD");
    await db
      .update(userData)
      .set({ reputationPoints: cost })
      .where(eq(userData.userId, BUYER));
    const caller = await callerFor(paypalRouter, BUYER);
    const results = await Promise.all(
      [TARGET, OTHER].map((userId) =>
        caller.subscribeWithReps({ userId, expectedUserId: BUYER, status: "GOLD" }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, BUYER) }))
        ?.reputationPoints,
    ).toBe(0);
    expect(await db.query.paypalSubscription.findMany()).toHaveLength(1);
    expect(
      (await db.query.userData.findMany()).filter(
        (user) => user.federalStatus === "GOLD",
      ),
    ).toHaveLength(1);
  });
  it("a changed recipient rolls back the reputation debit and ledger", async () => {
    const db = await getTestDatabase();
    const cost = fedStatusRepsCost("GOLD");
    await db
      .update(userData)
      .set({ reputationPoints: cost })
      .where(eq(userData.userId, BUYER));
    await db
      .update(userData)
      .set({ federalStatus: "SILVER" })
      .where(eq(userData.userId, TARGET));
    expect(
      (
        await (
          await callerFor(paypalRouter, BUYER)
        ).subscribeWithReps({ userId: TARGET, expectedUserId: BUYER, status: "GOLD" })
      ).success,
    ).toBe(false);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, BUYER) }))
        ?.reputationPoints,
    ).toBe(cost);
    expect(await db.query.paypalSubscription.findMany()).toHaveLength(0);
  });
  it("a changed account cannot spend the former account's reputation purchase", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ reputationPoints: fedStatusRepsCost("GOLD") })
      .where(eq(userData.userId, OTHER));
    expect(
      (
        await (
          await callerFor(paypalRouter, OTHER)
        ).subscribeWithReps({ userId: TARGET, expectedUserId: BUYER, status: "GOLD" })
      ).success,
    ).toBe(false);
    expect(await db.query.paypalSubscription.findMany()).toHaveLength(0);
  });
  it("concurrent self upgrades debit once and leave a matching paid ledger", async () => {
    const db = await getTestDatabase();
    const cost = calcFedUgradeCost("NORMAL", "GOLD");
    if (!cost) throw new Error("missing upgrade cost");
    await db
      .update(userData)
      .set({
        reputationPoints: cost,
        reputationPointsTotal: cost,
        federalStatus: "NORMAL",
      })
      .where(eq(userData.userId, BUYER));
    await db.insert(paypalSubscription).values({
      id: "self-upgrade",
      subscriptionId: `reps_${nanoid()}`,
      createdById: BUYER,
      affectedUserId: BUYER,
      status: "ACTIVE",
      federalStatus: "NORMAL",
    });
    const caller = await callerFor(paypalRouter, BUYER);
    const results = await Promise.all([
      caller.upgradeSubscription({ userId: BUYER, plan: "GOLD" }),
      caller.upgradeSubscription({ userId: BUYER, plan: "GOLD" }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, BUYER) }),
    ).toMatchObject({
      reputationPoints: 0,
      reputationPointsTotal: 0,
      federalStatus: "GOLD",
    });
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({
      federalStatus: "GOLD",
    });
  });
  it("expired PayPal coverage cannot be used to buy a discounted upgrade", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ reputationPoints: 1000, federalStatus: "SILVER" })
      .where(eq(userData.userId, BUYER));
    await db.insert(paypalSubscription).values({
      id: "expired-upgrade",
      subscriptionId: "I-EXPIRED",
      createdById: BUYER,
      affectedUserId: BUYER,
      status: "CANCELLED",
      federalStatus: "SILVER",
      updatedAt: new Date(Date.now() - 32 * 86400000),
    });
    expect(
      (
        await (
          await callerFor(paypalRouter, BUYER)
        ).upgradeSubscription({ userId: BUYER, plan: "GOLD" })
      ).success,
    ).toBe(false);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, BUYER) }))
        ?.reputationPoints,
    ).toBe(1000);
  });
  it.each([`reps_${nanoid()}`, nanoid()])(
    "reputation-funded cancellation retains coverage without a provider call (%s)",
    async (subscriptionId) => {
      const db = await getTestDatabase();
      const paidAt = new Date(Date.now() - 86400000);
      await db
        .update(userData)
        .set({ federalStatus: "GOLD" })
        .where(eq(userData.userId, TARGET));
      await db.insert(paypalSubscription).values({
        id: "rep-sub",
        subscriptionId,
        createdById: BUYER,
        affectedUserId: TARGET,
        status: "ACTIVE",
        federalStatus: "GOLD",
        updatedAt: paidAt,
      });
      expect(
        (
          await (
            await callerFor(paypalRouter, TARGET)
          ).cancelPaypalSubscription({ subscriptionId })
        ).success,
      ).toBe(true);
      expect(fetchProvider).not.toHaveBeenCalled();
      await reconcileFederalStatuses(db);
      expect((await target())?.federalStatus).toBe("GOLD");
      expect(await db.query.paypalSubscription.findFirst()).toEqual(
        expect.objectContaining({ status: "CANCELLED", updatedAt: paidAt }),
      );
    },
  );
  it("failed provider lookups cannot claim cancellation or change the ledger", async () => {
    const db = await getTestDatabase();
    await db.insert(paypalSubscription).values({
      id: "missing-sub",
      subscriptionId: "SUB_TEST",
      createdById: BUYER,
      affectedUserId: TARGET,
      orderId: "ORDER_TEST",
      status: "ACTIVE",
      federalStatus: "GOLD",
    });
    expect(
      (
        await (
          await callerFor(paypalRouter, BUYER)
        ).cancelPaypalSubscription({ subscriptionId: "SUB_TEST" })
      ).success,
    ).toBe(false);
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({
      status: "ACTIVE",
    });
    expect(
      fetchProvider.mock.calls.filter(([url]) => url.endsWith("/cancel")),
    ).toHaveLength(0);
  });
  it("cancellation verifies authoritative ownership before asking PayPal to stop billing", async () => {
    const db = await getTestDatabase();
    await db.insert(paypalSubscription).values({
      id: "mismatch-sub",
      subscriptionId: "SUB_TEST",
      createdById: BUYER,
      affectedUserId: TARGET,
      orderId: "ORDER_TEST",
      status: "ACTIVE",
      federalStatus: "GOLD",
    });
    subscriptions.set("SUB_TEST", {
      id: "SUB_TEST",
      status: "ACTIVE",
      custom_id: `${OTHER}-${TARGET}`,
    });
    expect(
      (
        await (
          await callerFor(paypalRouter, BUYER)
        ).cancelPaypalSubscription({ subscriptionId: "SUB_TEST" })
      ).success,
    ).toBe(false);
    expect(
      fetchProvider.mock.calls.filter(([url]) => url.endsWith("/cancel")),
    ).toHaveLength(0);
    expect(await db.query.paypalSubscription.findFirst()).toMatchObject({
      status: "ACTIVE",
    });
  });
  it("a suspended subscription is actually cancelled and keeps its verified paid period", async () => {
    const db = await getTestDatabase();
    const paidAt = new Date(Date.now() - 86400000);
    await db.insert(paypalSubscription).values({
      id: "suspended-sub",
      subscriptionId: "SUB_TEST",
      createdById: BUYER,
      affectedUserId: TARGET,
      orderId: "ORDER_TEST",
      status: "ACTIVE",
      federalStatus: "GOLD",
      updatedAt: paidAt,
    });
    await db
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, TARGET));
    subscriptions.set(
      "SUB_TEST",
      providerSubscription({ status: "SUSPENDED", paidAt }),
    );
    expect(
      (
        await (
          await callerFor(paypalRouter, BUYER)
        ).cancelPaypalSubscription({ subscriptionId: "SUB_TEST" })
      ).success,
    ).toBe(true);
    expect(
      fetchProvider.mock.calls.filter(([url]) => url.endsWith("/cancel")),
    ).toHaveLength(1);
    expect(await db.query.paypalSubscription.findFirst()).toEqual(
      expect.objectContaining({ status: "CANCELLED", updatedAt: paidAt }),
    );
    await reconcileFederalStatuses(db);
    expect((await target())?.federalStatus).toBe("GOLD");
  });
  it("recovers a legacy purchase from its order ID without a reporting lookup or capture", async () => {
    const db = await getTestDatabase();
    const orderId = "LEGACY00000000000";
    const invoiceId = nanoid();
    const amount = { value: reps2dollars(20).toFixed(2), currency_code: "USD" };
    orders.set(orderId, {
      id: orderId,
      status: "COMPLETED",
      purchase_units: [
        {
          custom_id: `${BUYER}-${TARGET}`,
          invoice_id: invoiceId,
          amount,
          payments: {
            captures: [
              {
                id: "legacy_recovered_capture",
                status: "COMPLETED",
                amount,
                update_time: new Date().toISOString(),
              },
            ],
          },
        },
      ],
    });
    await db.insert(paypalTransaction).values({
      id: invoiceId,
      createdById: BUYER,
      affectedUserId: TARGET,
      transactionId: `reservation_${invoiceId}`,
      orderId,
      invoiceId,
      transactionUpdatedDate: new Date().toISOString(),
      amount: reps2dollars(20),
      reputationPoints: 20,
      currency: "USD",
      status: "RESERVED",
      type: "REP_PURCHASE",
      rawData: {},
    });
    const buyer = await callerFor(paypalRouter, BUYER);
    expect(
      (await (await callerFor(paypalRouter, OTHER)).resolveOrder({ orderId })).success,
    ).toBe(false);
    expect((await target())?.reputationPoints).toBe(0);
    expect((await buyer.resolveOrder({ orderId })).success).toBe(true);
    expect((await buyer.resolveOrder({ orderId })).success).toBe(true);
    expect((await target())?.reputationPoints).toBe(20);
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(1);
    expect(
      fetchProvider.mock.calls.some(
        ([url]) => url.endsWith("/capture") || url.includes("/reporting/"),
      ),
    ).toBe(false);
  });
  it.each([
    { refunded: false, migrated: false },
    { refunded: true, migrated: false },
    { refunded: false, migrated: true },
  ])(
    "legacy reporting and order recovery verify capture status and ownership: %j",
    async ({ refunded, migrated }) => {
      const orderId = "ORDER000000000000";
      const invoiceId = nanoid();
      const amount = { value: reps2dollars(20).toFixed(2), currency_code: "USD" };
      orders.set(orderId, {
        id: orderId,
        status: "COMPLETED",
        purchase_units: [
          {
            custom_id: `${BUYER}-${TARGET}`,
            invoice_id: invoiceId,
            amount,
            payments: {
              captures: [
                {
                  id: "legacy_capture",
                  status: refunded ? "REFUNDED" : "COMPLETED",
                  amount,
                  update_time: new Date().toISOString(),
                },
              ],
            },
          },
        ],
      });
      const db = await getTestDatabase();
      await db.insert(paypalTransaction).values({
        id: invoiceId,
        createdById: BUYER,
        affectedUserId: TARGET,
        transactionId: `reservation_${invoiceId}`,
        orderId,
        invoiceId,
        transactionUpdatedDate: new Date().toISOString(),
        amount: reps2dollars(20),
        reputationPoints: 20,
        currency: "USD",
        status: "RESERVED",
        type: "REP_PURCHASE",
        rawData: {},
      });
      if (migrated) {
        await db
          .insert(storeUserIdAlias)
          .values({ oldUserId: BUYER, newUserId: OTHER });
        await db
          .update(paypalTransaction)
          .set({ createdById: OTHER })
          .where(eq(paypalTransaction.id, invoiceId));
      }
      const info = transactionInfo({
        transaction_id: "legacy_capture",
        transaction_amount: amount,
        invoice_id: invoiceId,
      });
      expect(
        await syncTransactions(
          db,
          [{ transaction_info: info }] as Parameters<typeof syncTransactions>[1],
          "token",
        ),
      ).toMatchObject([{ success: !refunded }]);
      const paypal = await callerFor(paypalRouter, migrated ? OTHER : BUYER);
      expect((await paypal.resolveOrder({ orderId })).success).toBe(!refunded);
      expect((await target())?.reputationPoints).toBe(refunded ? 0 : 20);
      expect(await db.query.paypalTransaction.findMany()).toHaveLength(1);
    },
  );
  it("recovery rejects non-USD payments before credit", async () => {
    expect(await paid(20, { currency: "DKK" })).toMatchObject({ success: false });
    expect((await target())?.reputationPoints).toBe(0);
    expect(
      await (await getTestDatabase()).query.paypalTransaction.findMany(),
    ).toHaveLength(0);
  });
  it("legacy paid delivery and a Stripe reservation share one concurrent allowance", async () => {
    const stripe = await callerFor(stripeRouter, BUYER);
    const [payment, checkout] = await Promise.all([
      paid(3000),
      stripe.createCheckout(stripeRequest(3000)),
    ]);
    const granted = payment && "success" in payment && payment.success;
    expect([granted, checkout.success].filter(Boolean)).toHaveLength(1);
    expect(
      await (await callerFor(paypalRouter, BUYER)).getRecentRepsCount({
        userId: BUYER,
      }),
    ).toBeLessThanOrEqual(4000);
  });
  it.each([
    undefined,
    { enabled: false, status: "complete" },
    { enabled: true, status: "failed" },
  ])(
    "does not fulfill Stripe sessions without completed automatic tax: %j",
    async (automatic_tax) => {
      const caller = await callerFor(stripeRouter, BUYER);
      const input = stripeRequest(20);
      const result = await caller.createCheckout(input);
      expect(result.success).toBe(true);
      const sessionId = `cs_test_${input.requestId}`;
      completeStripe(input, Date.now(), {
        payment_intent: "pi_test_tax",
        automatic_tax,
      });
      await expect(
        fulfillStripeSession(await getTestDatabase(), sessionId),
      ).rejects.toThrow("tax calculation is incomplete");
      expect((await target())?.reputationPoints).toBe(0);
      expect(
        await (await getTestDatabase()).query.stripePayment.findMany(),
      ).toHaveLength(0);
    },
  );
  it.each([undefined, { enabled: false }])(
    "rejects paid sessions outside Managed Payments: %j",
    async (managed_payments) => {
      const input = stripeRequest(20);
      const caller = await callerFor(stripeRouter, BUYER);
      await caller.createCheckout(input);
      const sessionId = `cs_test_${input.requestId}`;
      completeStripe(input, Date.now(), {
        payment_intent: "pi_unmanaged",
        managed_payments,
      });
      await expect(
        fulfillStripeSession(await getTestDatabase(), sessionId),
      ).rejects.toThrow("not managed by Stripe");
      expect((await target())?.reputationPoints).toBe(0);
    },
  );
  it("uses the verified USD integration amount when Managed Payments offers local currency", async () => {
    const input = stripeRequest(20);
    await (await callerFor(stripeRouter, BUYER)).createCheckout(input);
    const sessionId = `cs_test_${input.requestId}`;
    completeStripe(input, Date.now(), {
      payment_intent: "pi_local_presentment",
      presentment_details: { presentment_currency: "dkk", presentment_amount: 6500 },
    });
    expect(await fulfillStripeSession(await getTestDatabase(), sessionId)).toBe(
      "fulfilled",
    );
    expect((await target())?.reputationPoints).toBe(dollars2reps(reps2dollars(20)));
  });
  it.each([true, false])(
    "only managed subscription invoices grant or renew coverage (managed=%s)",
    async (enabled) => {
      const db = await getTestDatabase();
      const checkoutId = nanoid();
      await db.insert(stripeCheckout).values({
        id: checkoutId,
        createdById: BUYER,
        affectedUserId: TARGET,
        amountCents: 1500,
        reputationPoints: 0,
        federalStatus: "GOLD",
        priceId: "price_gold",
      });
      let start = Math.floor(Date.now() / 1000) - 100;
      let end = start + 30 * 86400;
      const invoice = () => ({
        id: "in_managed_first",
        status: "paid",
        livemode: false,
        currency: "usd",
        total: 1500,
        automatic_tax: { enabled: true, status: "complete" },
        parent: { subscription_details: { subscription: "sub_managed" } },
        lines: {
          has_more: false,
          data: [
            {
              amount: 1500,
              quantity: 1,
              pricing: { price_details: { price: "price_gold" } },
              period: { start, end },
              parent: { subscription_item_details: { proration: false } },
            },
          ],
        },
      });
      vi.spyOn(stripeClient, "getStripe").mockReturnValue({
        invoices: { retrieve: async (id: string) => ({ ...invoice(), id }) },
        subscriptions: {
          retrieve: async () => ({
            id: "sub_managed",
            managed_payments: { enabled },
            metadata: { tnrCheckoutId: checkoutId },
          }),
        },
      } as unknown as Stripe);
      if (!enabled) {
        await expect(fulfillStripeInvoice(db, "in_managed_first")).rejects.toThrow(
          "not managed by Stripe",
        );
        expect((await target())?.federalStatus).toBe("NONE");
        expect(await db.query.stripePayment.findMany()).toHaveLength(0);
        return;
      }
      await fulfillStripeInvoice(db, "in_managed_first");
      expect((await target())?.federalStatus).toBe("GOLD");
      start -= 100;
      end += 30 * 86400;
      await fulfillStripeInvoice(db, "in_managed_renewal");
      const renewal = await db.query.stripePayment.findFirst({
        where: eq(stripePayment.id, "in_managed_renewal"),
      });
      expect(renewal?.expiresAt).toEqual(new Date(end * 1000));
      await fulfillStripeInvoice(db, "in_managed_renewal");
      expect(await db.query.stripePayment.findMany()).toHaveLength(2);
    },
  );
});
