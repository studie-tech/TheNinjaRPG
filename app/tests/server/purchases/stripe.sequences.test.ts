// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { paypalSubscription, storePurchase, stripeCheckout, stripePayment, userData } from "@/drizzle/schema";
import { reconcileFederalStatuses, setFederalStatusWithStoreFloor } from "@/server/utils/purchases/grant";
import { grantStripeReceipt, upgradeStripeFederalWithReps, settleStripePayments, type StripeReceipt } from "@/server/utils/stripe/fulfillment";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../setup/factories";
import { failStatements } from "../../setup/statements";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const USER = "stripe-recipient";
const receipt = (overrides: Partial<StripeReceipt> = {}): StripeReceipt => ({
  id: "pi_test", checkoutId: "checkout-test", createdById: USER, affectedUserId: USER,
  amountCents: 1000, reputationPoints: 20, federalStatus: "NONE", purchasedAt: new Date(), ...overrides,
});
const user = async () => (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, USER) });

// Apply fault injection inside the transaction that serializes reputation delivery.
const withTransactionFault = (db: DrizzleClient, wrap: (tx: DrizzleClient) => DrizzleClient) => new Proxy(db, {
  get(target, property, receiver) {
    if (property === "transaction") return (run: (tx: DrizzleClient) => Promise<unknown>) => target.transaction((tx) => run(wrap(tx)));
    return Reflect.get(target, property, receiver);
  },
});

describeWithDatabase("Stripe receipt delivery and federal provider coexistence", () => {
  beforeEach(async () => {
    await resetTables(stripePayment, stripeCheckout, paypalSubscription, storePurchase, userData);
    await insertUsers([{ userId: USER, username: USER, reputationPoints: 0, reputationPointsTotal: 0, federalStatus: "NONE" }]);
  });
  it("credits one receipt once under concurrent webhook and redirect deliveries", async () => {
    const db = await getTestDatabase();
    await Promise.all(Array.from({ length: 8 }, () => grantStripeReceipt(db, receipt())));
    expect((await user())?.reputationPoints).toBe(20);
    expect((await user())?.reputationPointsTotal).toBe(20);
    expect(await db.query.stripePayment.findMany()).toHaveLength(1);
  });
  it("recovers when delivery fails after recording a receipt", async () => {
    const db = await getTestDatabase();
    await expect(grantStripeReceipt(withTransactionFault(db, (tx) => failStatements(tx, userData)), receipt())).rejects.toThrow();
    expect((await user())?.reputationPoints).toBe(0);
    await grantStripeReceipt(db, receipt());
    expect((await user())?.reputationPoints).toBe(20);
  });
  it("recovers reconciliation failure after claiming without double credit", async () => {
    const db = await getTestDatabase();
    const faulty = failStatements(db, userData);
    await expect(grantStripeReceipt(faulty, receipt())).rejects.toThrow("Statement failed on purpose");
    expect((await user())?.reputationPoints).toBe(20);
    await grantStripeReceipt(db, receipt());
    expect((await user())?.reputationPoints).toBe(20);
  });
  it("rejects a replay with different paid terms", async () => {
    const db = await getTestDatabase();
    await grantStripeReceipt(db, receipt());
    await expect(grantStripeReceipt(db, receipt({ reputationPoints: 200 }))).rejects.toThrow("terms changed");
    expect((await user())?.reputationPoints).toBe(20);
    await expect(grantStripeReceipt(db, receipt({ isSandbox: true }))).rejects.toThrow("terms changed");
  });
  it("keeps Stripe GOLD through a PayPal downgrade and restores it from NONE", async () => {
    const db = await getTestDatabase();
    await grantStripeReceipt(db, receipt({ id: "in_gold", reputationPoints: 0, federalStatus: "GOLD", expiresAt: new Date(Date.now() + 86400000) }));
    await setFederalStatusWithStoreFloor(db, USER, "NORMAL");
    expect((await user())?.federalStatus).toBe("GOLD");
    await db.update(userData).set({ federalStatus: "NONE" }).where(eq(userData.userId, USER));
    await reconcileFederalStatuses(db);
    expect((await user())?.federalStatus).toBe("GOLD");
  });
  it("falls back to paid PayPal SILVER when a Stripe GOLD period expires", async () => {
    const db = await getTestDatabase();
    await db.insert(paypalSubscription).values({ id: "paypal", subscriptionId: "paypal", createdById: USER, affectedUserId: USER, status: "ACTIVE", federalStatus: "SILVER" });
    await grantStripeReceipt(db, receipt({ id: "in_gold", reputationPoints: 0, federalStatus: "GOLD", expiresAt: new Date(Date.now() + 86400000) }));
    await db.update(stripePayment).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(stripePayment.id, "in_gold"));
    await reconcileFederalStatuses(db);
    expect((await user())?.federalStatus).toBe("SILVER");
  });
  it("an old invoice arriving after a new period cannot downgrade current coverage", async () => {
    const db = await getTestDatabase();
    await grantStripeReceipt(db, receipt({ id: "in_new", reputationPoints: 0, federalStatus: "GOLD", expiresAt: new Date(Date.now() + 86400000) }));
    await grantStripeReceipt(db, receipt({ id: "in_old", reputationPoints: 0, federalStatus: "NORMAL", expiresAt: new Date(Date.now() - 1000) }));
    expect((await user())?.federalStatus).toBe("GOLD");
  });
  it("does not trust an unclaimed or expired invoice to provide federal support", async () => {
    const db = await getTestDatabase();
    await db.insert(stripePayment).values(receipt({ reputationPoints: 0, federalStatus: "GOLD", expiresAt: new Date(Date.now() + 86400000) }));
    await reconcileFederalStatuses(db);
    expect((await user())?.federalStatus).toBe("NONE");
    await grantStripeReceipt(db, receipt({ id: "in_expired", reputationPoints: 0, federalStatus: "GOLD", expiresAt: new Date(Date.now() - 1000) }));
    expect((await user())?.federalStatus).toBe("NONE");
  });
  it("does not grant or upgrade future paid coverage", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ reputationPoints: 100, federalStatus: "NORMAL" }).where(eq(userData.userId, USER));
    await grantStripeReceipt(db, receipt({ id: "in_future", reputationPoints: 0, federalStatus: "NORMAL", purchasedAt: new Date(Date.now() + 86400000), expiresAt: new Date(Date.now() + 172800000) }));
    expect((await user())?.federalStatus).toBe("NONE");
    expect((await upgradeStripeFederalWithReps(db, USER, "NORMAL", "SILVER")).success).toBe(false);
    expect((await user())?.reputationPoints).toBe(100);
  });
  it("charges a concurrent reputation upgrade once and keeps it through provider reconciliation", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ reputationPoints: 100, reputationPointsTotal: 100 }).where(eq(userData.userId, USER));
    const original = receipt({ id: "in_normal", reputationPoints: 0, federalStatus: "NORMAL", expiresAt: new Date(Date.now() + 86400000) });
    await grantStripeReceipt(db, original);
    const outcomes = await Promise.all([upgradeStripeFederalWithReps(db, USER, "NORMAL", "SILVER"), upgradeStripeFederalWithReps(db, USER, "NORMAL", "SILVER")]);
    expect(outcomes.filter((outcome) => outcome.success)).toHaveLength(1);
    expect((await user())?.reputationPoints).toBe(80);
    await grantStripeReceipt(db, original);
    await reconcileFederalStatuses(db);
    expect((await user())?.federalStatus).toBe("SILVER");
  });
  it("does not debit an expired period or another person's gifted subscription", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ reputationPoints: 100 }).where(eq(userData.userId, USER));
    await grantStripeReceipt(db, receipt({ id: "in_gift", createdById: "someone-else", reputationPoints: 0, federalStatus: "NORMAL", expiresAt: new Date(Date.now() + 86400000) }));
    expect((await upgradeStripeFederalWithReps(db, USER, "NORMAL", "SILVER")).success).toBe(false);
    expect((await user())?.reputationPoints).toBe(100);
  });
  it("restores federal coverage when a character returns without delivering old points twice", async () => {
    const db = await getTestDatabase();
    await grantStripeReceipt(db, receipt());
    await grantStripeReceipt(db, receipt({ id: "in_silver", reputationPoints: 0, federalStatus: "SILVER", expiresAt: new Date(Date.now() + 86400000) }));
    await db.delete(userData).where(eq(userData.userId, USER));
    await insertUsers([{ userId: USER, username: USER, reputationPoints: 0, federalStatus: "NONE" }]);
    await settleStripePayments(db, USER);
    expect((await user())?.reputationPoints).toBe(0);
    expect((await user())?.federalStatus).toBe("SILVER");
  });

});
