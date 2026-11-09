import type Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import {
  paypalTransaction,
  stripeCheckout,
  stripePayment,
  userData,
} from "@/drizzle/schema";
import { paypalRouter } from "@/server/api/routers/paypal";
import { stripeRouter } from "@/server/api/routers/stripe";
import * as stripeClient from "@/server/utils/stripe/client";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { useStripeTestEnv } from "../../setup/stripe";

const BUYER = "stripe-buyer";
const RECIPIENT = "stripe-target";
const input = (points = 20) => ({
  requestId: nanoid(),
  expectedUserId: BUYER,
  userId: RECIPIENT,
  purchase: { type: "reputation" as const, reputationPoints: points },
});
let lostCreateResponse = false;
const sessions = new Map<string, Stripe.Checkout.Session>();
const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
  const id = `cs_test_${params.client_reference_id?.replace(/[_-]/g, "")}`;
  const session = {
    id,
    url: `https://checkout.stripe.com/${id}`,
    status: "open",
    metadata: params.metadata,
  } as Stripe.Checkout.Session;
  sessions.set(id, session);
  if (lostCreateResponse) {
    lostCreateResponse = false;
    throw new Error("Stripe response lost");
  }
  return session;
});
const retrieve = vi.fn(async (id: string) => sessions.get(id));
const expire = vi.fn(async (id: string) => {
  const session = sessions.get(id);
  if (session) session.status = "expired";
  return session;
});

const api = {
  checkout: { sessions: { create, retrieve, expire } },
  prices: { retrieve: vi.fn() },
  subscriptions: { retrieve: vi.fn(), update: vi.fn() },
} as unknown as Stripe;

describeWithDatabase("Stripe router guards and durable checkout terms", () => {
  useStripeTestEnv();
  beforeEach(async () => {
    await resetTables(stripeCheckout, stripePayment, paypalTransaction, userData);
    await insertUsers([
      { userId: BUYER, username: BUYER, reputationPoints: 0 },
      { userId: RECIPIENT, username: RECIPIENT, reputationPoints: 0 },
    ]);
    sessions.clear();
    lostCreateResponse = false;
    create.mockClear();
    retrieve.mockClear();
    expire.mockClear();
    vi.spyOn(stripeClient, "getStripe").mockReturnValue(api);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("keeps healthy subscriptions and unavailable rows manageable after an isolated lookup failure", async () => {
    const db = await getTestDatabase();
    await db.insert(stripeCheckout).values(
      ["healthy", "unavailable"].map((id) => ({
        id,
        createdById: BUYER,
        affectedUserId: RECIPIENT,
        amountCents: 1500,
        federalStatus: "GOLD" as const,
        subscriptionId: `sub_${id}`,
      })),
    );
    const lookup = vi.spyOn(api.subscriptions, "retrieve").mockImplementation((async (
      id: string,
    ) => {
      if (id === "sub_unavailable") throw new Error("Stripe rate limited this lookup");
      return { status: "active", cancel_at_period_end: false };
    }) as never);
    const caller = await callerFor(stripeRouter, BUYER);
    expect(await caller.getSubscriptions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkoutId: "healthy",
          status: "active",
          cancelAtPeriodEnd: false,
        }),
        expect.objectContaining({
          checkoutId: "unavailable",
          status: "unavailable",
          cancelAtPeriodEnd: false,
        }),
      ]),
    );
    lookup.mockResolvedValue({
      status: "active",
      cancel_at_period_end: false,
    } as never);
    expect(
      (await caller.getSubscriptions()).every((row) => row.status === "active"),
    ).toBe(true);
    expect(
      (await caller.cancelSubscription({ checkoutId: "unavailable" })).success,
    ).toBe(true);
  });
  it("creates server-priced inclusive USD checkout with Stripe as merchant of record", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = input();
    const result = await caller.createCheckout(purchase);
    expect(result.success).toBe(true);
    const params = create.mock.calls[0]?.[0];
    expect(params?.adaptive_pricing).toBeUndefined();
    expect(params?.managed_payments).toEqual({ enabled: true });
    expect(params?.automatic_tax).toBeUndefined();
    expect(params?.line_items?.[0]?.price_data?.product_data?.tax_code).toBe(
      "txcd_10000000",
    );
    expect(params?.billing_address_collection).toBe("required");
    expect(params?.customer_creation).toBe("always");
    expect(params?.line_items?.[0]?.price_data?.tax_behavior).toBe("inclusive");
    expect(params?.allowed_payment_method_types).toBeUndefined();
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params?.line_items?.[0]?.price_data?.currency).toBe("usd");
    expect(
      await (await getTestDatabase()).query.stripeCheckout.findFirst({
        where: eq(stripeCheckout.id, purchase.requestId),
      }),
    ).toMatchObject({ createdById: BUYER, affectedUserId: RECIPIENT });
    expect(
      await (await getTestDatabase()).query.userData.findFirst({
        where: eq(userData.userId, RECIPIENT),
      }),
    ).toMatchObject({ reputationPoints: 0 });
  });
  it("retry resumes the same session and changed request terms are rejected", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = input();
    const first = await caller.createCheckout(purchase);
    expect(await caller.createCheckout(purchase)).toEqual({
      ...first,
      message: "Continue checkout",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect((await caller.createCheckout({ ...purchase, userId: BUYER })).success).toBe(
      false,
    );
  });
  it("recovers an unknown creation response after one hour with unchanged provider terms", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = input(3000);
    lostCreateResponse = true;
    await expect(caller.createCheckout(purchase)).rejects.toThrow(
      "Stripe response lost",
    );
    const originalParams = create.mock.calls[0]?.[0];
    const before = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(before + 2 * 3600000);
    expect((await caller.createCheckout(purchase)).success).toBe(true);
    expect(create.mock.calls[1]?.[0]).toEqual(originalParams);
    expect(originalParams?.expires_at).toBeGreaterThan(before / 1000 + 23 * 3600);
    expect(originalParams?.expires_at).toBeLessThanOrEqual(before / 1000 + 24 * 3600);
    expect(sessions.size).toBe(1);
  });
  it("cannot release an unknown creation outcome while its session could still be payable", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = input(3000);
    lostCreateResponse = true;
    await expect(caller.createCheckout(purchase)).rejects.toThrow(
      "Stripe response lost",
    );
    expect(
      (await caller.cancelCheckout({ checkoutId: purchase.requestId })).success,
    ).toBe(false);
    expect((await caller.createCheckout(input(3000))).success).toBe(false);
    expect(
      (
        await (
          await getTestDatabase()
        ).query.stripeCheckout.findFirst({
          where: eq(stripeCheckout.id, purchase.requestId),
        })
      )?.closedAt,
    ).toBeNull();
  });
  it("an expired sessionless checkout can close and no longer blocks either provider", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = input(3000);
    lostCreateResponse = true;
    await expect(caller.createCheckout(purchase)).rejects.toThrow(
      "Stripe response lost",
    );
    await db
      .update(stripeCheckout)
      .set({ createdAt: new Date(Date.now() - 25 * 3600000 - 5000) })
      .where(eq(stripeCheckout.id, purchase.requestId));
    expect((await caller.createCheckout(purchase)).success).toBe(false);
    expect(
      await (await callerFor(paypalRouter, BUYER)).getRecentRepsCount({
        userId: BUYER,
      }),
    ).toBe(0);
    expect(
      (await caller.cancelCheckout({ checkoutId: purchase.requestId })).success,
    ).toBe(true);
    expect((await caller.createCheckout(input(3000))).success).toBe(true);
  });
  it("rejects an account switch and native-shell checkout before contacting Stripe", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    expect(
      (await caller.createCheckout({ ...input(), expectedUserId: "other" })).success,
    ).toBe(false);
    const native = stripeRouter.createCaller({
      drizzle: await getTestDatabase(),
      userId: BUYER,
      userAgent: "TNR-Native/1.0 (ios)",
    } as Parameters<typeof stripeRouter.createCaller>[0]);
    expect((await native.createCheckout(input())).success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects banned recipients without creating a payment", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ isBanned: true })
      .where(eq(userData.userId, RECIPIENT));
    expect(
      (await (await callerFor(stripeRouter, BUYER)).createCheckout(input())).success,
    ).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it("reserves unfinished purchases against the monthly cap and releases cancelled sessions", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = input(3000);
    expect((await caller.createCheckout(purchase)).success).toBe(true);
    expect((await caller.createCheckout(input(2000))).success).toBe(false);
    expect(
      (await caller.cancelCheckout({ checkoutId: purchase.requestId })).success,
    ).toBe(true);
    expect((await caller.createCheckout(input(2000))).success).toBe(true);
  });
  it("only allows the payer to cancel unfinished checkout", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = input();
    await caller.createCheckout(purchase);
    expect(
      (
        await (
          await callerFor(stripeRouter, RECIPIENT)
        ).cancelCheckout({ checkoutId: purchase.requestId })
      ).success,
    ).toBe(false);
    expect(expire).not.toHaveBeenCalled();
  });
  it("parallel requests cannot both create reservations from the same balance snapshot", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const outcomes = await Promise.all([
      caller.createCheckout(input(3000)),
      caller.createCheckout(input(3000)),
    ]);
    expect(outcomes.filter((outcome) => outcome.success)).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("lists only the payer's current unfinished checkouts, excluding delivered, closed and stale rows", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(stripeRouter, BUYER);
    const open = input();
    await caller.createCheckout(open);
    const closed = input();
    await caller.createCheckout(closed);
    await caller.cancelCheckout({ checkoutId: closed.requestId });
    const stale = input();
    await caller.createCheckout(stale);
    await db
      .update(stripeCheckout)
      .set({ createdAt: new Date(Date.now() - 26 * 3600000) })
      .where(eq(stripeCheckout.id, stale.requestId));
    const delivered = input();
    await caller.createCheckout(delivered);
    await db.insert(stripePayment).values({
      id: "pi_list_delivered",
      checkoutId: delivered.requestId,
      createdById: BUYER,
      affectedUserId: RECIPIENT,
      amountCents: 100,
      reputationPoints: 20,
      purchasedAt: new Date(),
      grantedAt: new Date(),
    });
    const subscription = input();
    await caller.createCheckout(subscription);
    await db
      .update(stripeCheckout)
      .set({ subscriptionId: "sub_list_finished" })
      .where(eq(stripeCheckout.id, subscription.requestId));
    expect(await caller.getPendingCheckouts()).toEqual([
      {
        id: open.requestId,
        affectedUserId: RECIPIENT,
        federalStatus: "NONE",
        reputationPoints: expect.any(Number),
        recipientUsername: RECIPIENT,
      },
    ]);
    expect(
      await (await callerFor(stripeRouter, RECIPIENT)).getPendingCheckouts(),
    ).toEqual([]);
  });
  it("recovers a lost creation response from listed immutable terms and rejects finished session replay", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = input(51);
    lostCreateResponse = true;
    await expect(caller.createCheckout(purchase)).rejects.toThrow(
      "Stripe response lost",
    );
    const [pending] = await caller.getPendingCheckouts();
    expect(pending).toBeDefined();
    const recovered = {
      ...purchase,
      requestId: pending!.id,
      userId: pending!.affectedUserId,
      purchase: {
        type: "reputation" as const,
        reputationPoints: pending!.reputationPoints,
      },
    };
    const result = await caller.createCheckout(recovered);
    expect(result.success).toBe(true);
    expect(sessions.size).toBe(1);
    const session = [...sessions.values()][0]!;
    session.status = "complete";
    expect((await caller.createCheckout(recovered)).success).toBe(false);
    expect((await caller.cancelCheckout({ checkoutId: pending!.id })).success).toBe(
      false,
    );
    expect(expire).not.toHaveBeenCalled();
  });

  it("resumes listed federal checkout without creating a duplicate subscription and cancellation removes its reservation", async () => {
    const caller = await callerFor(stripeRouter, BUYER);
    const purchase = {
      requestId: nanoid(),
      expectedUserId: BUYER,
      userId: RECIPIENT,
      purchase: { type: "federal" as const, federalStatus: "NORMAL" as const },
    };
    vi.spyOn(stripeClient, "validFederalPrice").mockReturnValue(true);
    expect((await caller.createCheckout(purchase)).success).toBe(true);
    expect(
      (await caller.createCheckout({ ...purchase, requestId: nanoid() })).success,
    ).toBe(false);
    const [pending] = await caller.getPendingCheckouts();
    expect(pending?.federalStatus).toBe("NORMAL");
    expect(
      (await caller.createCheckout({ ...purchase, requestId: pending!.id })).success,
    ).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect((await caller.cancelCheckout({ checkoutId: pending!.id })).success).toBe(
      true,
    );
    expect(await caller.getPendingCheckouts()).toEqual([]);
    expect(
      (await caller.createCheckout({ ...purchase, requestId: nanoid() })).success,
    ).toBe(true);
  });
});
