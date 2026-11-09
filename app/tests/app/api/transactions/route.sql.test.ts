import { afterEach, beforeEach, expect, it, spyOn, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/transactions/route";
import {
  paypalTransaction,
  recruitmentRewards,
  stripePayment,
  userData,
  webStoreOrder,
} from "@/drizzle/schema";
import * as gamesettings from "@/libs/gamesettings";
import type { syncTransactions } from "@/server/utils/paypal/fulfillment";
import * as stripeClient from "@/server/utils/stripe/client";
import { reserveStoreOrder } from "@/server/utils/webStore";
import { dollars2reps } from "@/utils/paypal";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubCronAuth } from "../../../setup/serverModules";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("PayPal transaction reconciliation", () => {
  beforeEach(async () => {
    await resetTables(
      webStoreOrder,
      paypalTransaction,
      recruitmentRewards,
      stripePayment,
      userData,
    );
    stubCronAuth(() => null);
    spyOn(stripeClient, "stripeIsLive").mockReturnValue(false);
    spyOn(gamesettings, "lockWithGameTimer").mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  it("keeps failed deliveries in the report while processing other payments and referrals once", async () => {
    const db = await getTestDatabase();
    await insertUsers([
      {
        userId: "recruiter",
        username: "Recruiter",
        reputationPoints: 0,
        reputationPointsTotal: 0,
      },
      {
        userId: "buyer",
        username: "Buyer",
        reputationPoints: 0,
        reputationPointsTotal: 0,
        recruiterId: "recruiter",
        createdAt: new Date(Date.now() - 86400_000),
      },
      {
        userId: "recipient",
        username: "Recipient",
        reputationPoints: 0,
        reputationPointsTotal: 0,
        money: 0,
      },
      { userId: "missing", username: "Missing" },
    ]);
    const offer = {
      name: "Supplies",
      priceCents: 1250,
      contents: { reputationPoints: 20, money: 500, items: [] },
    };
    const failed = await reserveStoreOrder(db, "buyer", "missing", offer);
    const paid = await reserveStoreOrder(db, "buyer", "recipient", offer);
    if (!failed.success || !paid.success)
      throw new Error("Checkout reservation failed");
    await db.delete(userData).where(eq(userData.userId, "missing"));
    const transactions: Parameters<typeof syncTransactions>[1] = [
      failed.order.id,
      paid.order.id,
      "legacy",
    ].map((id) => ({
      transaction_info: {
        transaction_id: `capture-${id}`,
        transaction_initiation_date: new Date().toISOString(),
        transaction_updated_date: new Date().toISOString(),
        paypal_reference_id: `provider-${id}`,
        paypal_reference_id_type: "ODR",
        transaction_event_code: "T0006",
        transaction_subject: offer.name,
        transaction_amount: { currency_code: "USD", value: "12.50" },
        transaction_status: "S",
        custom_field: id === "legacy" ? "buyer-buyer" : `store:${id}`,
        invoice_id: id,
      },
      cart_info: { item_details: [] },
    }));
    spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/v1/oauth2/token"))
        return Response.json({ access_token: "test-only" });
      return Response.json({ transaction_details: transactions });
    });

    const response = await GET(new Request("https://example.com/api/transactions"));
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(report).toContain(
      `Transaction ID capture-${failed.order.id}: Recipient unavailable.`,
    );
    expect(report).toContain("Supplies delivered");
    expect(report).toContain("Transaction ID capture-legacy synced!");
    expect(report).toContain("Add 2 ref reps");
    const referralReps = 2 + Math.floor(dollars2reps(12.5) * 0.1);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "recruiter") }),
    ).toMatchObject({
      reputationPoints: referralReps,
      reputationPointsTotal: referralReps,
    });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "recipient") }),
    ).toMatchObject({ reputationPoints: 20, reputationPointsTotal: 20, money: 500 });
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "buyer") }),
    ).toMatchObject({ reputationPoints: dollars2reps(12.5) });
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(4);
    expect(await db.query.recruitmentRewards.findMany()).toHaveLength(2);
    expect(
      await db.query.webStoreOrder.findFirst({
        where: eq(webStoreOrder.id, failed.order.id),
      }),
    ).toMatchObject({ grantedAt: null, captureId: null });

    const retry = await GET(new Request("https://example.com/api/transactions"));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toBe(
      `OK. Transaction ID capture-${failed.order.id}: Recipient unavailable. Contact support with your payment receipt., Purchase already delivered, Transaction ID capture-legacy already processed`,
    );
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "recruiter") }),
    ).toMatchObject({
      reputationPoints: referralReps,
      reputationPointsTotal: referralReps,
    });
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(4);
    expect(await db.query.recruitmentRewards.findMany()).toHaveLength(2);
  });

  const seedStripeReferrals = async () => {
    const db = await getTestDatabase();
    const createdAt = new Date(Date.now() - 86400_000);
    await insertUsers([
      {
        userId: "recruiter",
        username: "Recruiter",
        createdAt,
        reputationPoints: 5000,
        reputationPointsTotal: 5000,
      },
      {
        userId: "other-recruiter",
        username: "OtherRecruiter",
        createdAt,
        reputationPoints: 0,
        reputationPointsTotal: 0,
      },
      { userId: "buyer", username: "Buyer", createdAt, recruiterId: "recruiter" },
      {
        userId: "recipient",
        username: "Recipient",
        createdAt,
        recruiterId: "other-recruiter",
      },
    ]);
    spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/v1/oauth2/token")
          ? { access_token: "test-only" }
          : { transaction_details: [] },
      ),
    );
    return db;
  };
  const stripeReceipt = (id: string) => ({
    id,
    checkoutId: `checkout-${id}`,
    createdById: "buyer",
    affectedUserId: "recipient",
    amountCents: 2000,
    reputationPoints: 105,
    purchasedAt: new Date(),
    grantedAt: new Date(),
    isSandbox: true,
  });

  it("awards a gifted Stripe purchase to the buyer's recruiter exactly once under concurrent reconciliation", async () => {
    const db = await seedStripeReferrals();
    await db.insert(stripePayment).values(stripeReceipt("pi_gift"));
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        GET(new Request("https://example.com/api/transactions")),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    await GET(new Request("https://example.com/api/transactions"));
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "recruiter") }),
    ).toMatchObject({ reputationPoints: 5010, reputationPointsTotal: 5010 });
    expect(
      await db.query.userData.findFirst({
        where: eq(userData.userId, "other-recruiter"),
      }),
    ).toMatchObject({ reputationPoints: 0 });
    expect(await db.query.recruitmentRewards.findMany()).toMatchObject([
      { userId: "recruiter", recruitedUserId: "buyer", amount: 10, type: "REPUTATION" },
    ]);
    expect(await db.query.paypalTransaction.findMany()).toHaveLength(0);
  });

  it("excludes unpaid, held, Federal, other-environment, nonpositive and recreated-account Stripe receipts", async () => {
    const db = await seedStripeReferrals();
    const oldPurchase = new Date(Date.now() - 2 * 86400_000);
    await db.insert(stripePayment).values([
      { ...stripeReceipt("pi_pending"), grantedAt: null },
      { ...stripeReceipt("pi_review"), reviewRequired: true },
      { ...stripeReceipt("in_federal"), federalStatus: "GOLD" },
      { ...stripeReceipt("pi_live"), isSandbox: false },
      { ...stripeReceipt("pi_free"), amountCents: 0 },
      { ...stripeReceipt("pi_zero"), reputationPoints: 0 },
      { ...stripeReceipt("pi_recreated_buyer"), purchasedAt: oldPurchase },
      {
        ...stripeReceipt("pi_recreated_recruiter"),
        createdById: "recipient",
        purchasedAt: oldPurchase,
      },
      stripeReceipt("pi_valid"),
    ]);
    // The buyer predates this receipt, but its recruiter was recreated after the payment.
    await db
      .update(userData)
      .set({ createdAt: new Date(Date.now() - 3 * 86400_000) })
      .where(eq(userData.userId, "recipient"));
    const response = await GET(new Request("https://example.com/api/transactions"));
    expect(response.status).toBe(200);
    expect(await db.query.recruitmentRewards.findMany()).toMatchObject([
      { userId: "recruiter", recruitedUserId: "buyer", amount: 10 },
    ]);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "recruiter") }),
    ).toMatchObject({ reputationPoints: 5010 });
    expect(
      await db.query.userData.findFirst({
        where: eq(userData.userId, "other-recruiter"),
      }),
    ).toMatchObject({ reputationPoints: 0 });
  });
});
