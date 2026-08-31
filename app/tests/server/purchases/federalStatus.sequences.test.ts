// @vitest-environment node

import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  paypalSubscription,
  storeEntitlementState,
  storePurchase,
  userData,
} from "@/drizzle/schema";
import type { FederalStatus, StorePlatform } from "@/drizzle/constants";
import {
  grantStorePurchase,
  revokeFederalStatus,
  setFederalStatusWithStoreFloor,
  storeFederalFloor,
  transferStorePurchases,
} from "@/server/utils/purchases/grant";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

/**
 * federalStatus is one column with two paying sources and five writers, and the ordering
 * between them is where every bug in it has lived. These drive real webhook sequences
 * against real tables rather than checking a helper in isolation.
 */
const USER = "federal-seq-user";
const DESTINATION = "federal-transfer-destination";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const db = () => getTestDatabase();

const statusOf = async (): Promise<FederalStatus> => {
  const database = await db();
  const row = await database.query.userData.findFirst({
    columns: { federalStatus: true },
    where: eq(userData.userId, USER),
  });
  return row?.federalStatus ?? "NONE";
};

/** A store purchase as the webhook would have written it, optionally backdated. */
const buyFederal = async (
  tier: FederalStatus,
  agoMs = 0,
  store: StorePlatform = "APPLE",
) => {
  const database = await db();
  const transactionId = nanoid();
  await grantStorePurchase(database, {
    userId: USER,
    transactionId,
    productId:
      tier === "GOLD"
        ? "tnr_federal_gold"
        : tier === "SILVER"
          ? "tnr_federal_silver"
          : "tnr_federal_normal",
    store,
    isSandbox: false,
    purchasedAt: new Date(Date.now() - agoMs),
    raw: {},
  });
  if (agoMs > 0) {
    await database
      .update(storePurchase)
      .set({ createdAt: new Date(Date.now() - agoMs) })
      .where(eq(storePurchase.transactionId, transactionId));
  }
};

const givePaypal = async (tier: FederalStatus, status = "ACTIVE") => {
  const database = await db();
  await database.insert(paypalSubscription).values({
    id: nanoid(),
    createdById: USER,
    affectedUserId: USER,
    subscriptionId: nanoid(),
    federalStatus: tier,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

describeWithDatabase("federal status across real webhook sequences", () => {
  beforeEach(async () => {
    await resetTables(
      storeEntitlementState,
      storePurchase,
      paypalSubscription,
      userData,
    );
    await insertUsers([{ userId: USER, username: "seq", federalStatus: "NONE" }]);
  });

  it("grants, then gives the tier back on expiry", async () => {
    // Backdated so the receipt plainly predates the expiry: MySQL stamps createdAt and the
    // test stamps occurredAt, and nothing guarantees those two clocks agree to the ms.
    await buyFederal("GOLD", MINUTE);
    expect(await statusOf()).toBe("GOLD");
    await revokeFederalStatus(await db(), USER, { occurredAt: new Date() });
    expect(await statusOf()).toBe("NONE");
  });

  it("does not strip a web subscription when the store one lapses", async () => {
    await givePaypal("NORMAL");
    await buyFederal("GOLD", MINUTE);
    expect(await statusOf()).toBe("GOLD");
    await revokeFederalStatus(await db(), USER, { occurredAt: new Date() });
    expect(await statusOf()).toBe("NORMAL");
  });

  it("keeps the tier when a late expiry lands after a resubscribe", async () => {
    // The subscription ended an hour ago and the player has already bought back in; the
    // expiry for the OLD period is only now being delivered.
    const endedAt = new Date(Date.now() - 60 * 60 * 1000);
    await buyFederal("GOLD", 2 * 60 * 60 * 1000); // the receipt that expired
    await buyFederal("GOLD"); // bought back in, just now
    // productId and store are what the webhook actually sends; omitting them here would
    // exercise a path production never takes.
    await revokeFederalStatus(await db(), USER, {
      occurredAt: endedAt,
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    expect(await statusOf()).toBe("GOLD");
  });

  it("lets a PayPal writer take the tier away once both sources have ended", async () => {
    await givePaypal("NORMAL");
    await buyFederal("GOLD", MINUTE);
    await revokeFederalStatus(await db(), USER, { occurredAt: new Date() });
    expect(await statusOf()).toBe("NORMAL");
    // now PayPal ends too: the spent store receipt must not hold the tier open
    const next = await storeFederalFloor(await db(), USER);
    expect(next).toBe("NONE");
  });

  it("keeps a live store subscription safe from a PayPal writer", async () => {
    await buyFederal("GOLD");
    await setFederalStatusWithStoreFloor(await db(), USER, "NONE");
    expect(await statusOf()).toBe("GOLD");
  });

  it("keeps a simultaneous store grant safe from a PayPal writer", async () => {
    const database = await db();
    await Promise.all([
      buyFederal("GOLD"),
      setFederalStatusWithStoreFloor(database, USER, "NONE"),
    ]);
    expect(await statusOf()).toBe("GOLD");
  });

  it("stops vouching once the receipt is older than the grace window", async () => {
    await buyFederal("GOLD", 70 * DAY);
    const next = await storeFederalFloor(await db(), USER);
    expect(next).toBe("NONE");
  });

  it("still vouches inside the billing-retry grace window", async () => {
    // A renewal that failed 40 days ago is still within the store's retry period.
    await buyFederal("GOLD", 40 * DAY);
    const next = await storeFederalFloor(await db(), USER);
    expect(next).toBe("GOLD");
  });

  it("retires the receipt an upgrade left behind", async () => {
    // NORMAL upgraded to GOLD a day later; when GOLD expires, the leftover NORMAL receipt
    // is spent too -- it was superseded, not merely older.
    await buyFederal("NORMAL", 2 * DAY);
    await buyFederal("GOLD", 1 * DAY);
    await revokeFederalStatus(await db(), USER, {
      occurredAt: new Date(),
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    expect(await statusOf()).toBe("NONE");
  });

  it("retires only the product that expired, not a concurrent one", async () => {
    // A tier change leaves the old product expiring while the new one is being billed, so
    // the surviving product is by definition the newer of the two. Both are stamped from
    // CURRENT_TIMESTAMP(3) without this, and two inserts can land in the same millisecond
    // -- which the cutoff, being inclusive, would then treat as superseded.
    await buyFederal("NORMAL", 1 * DAY);
    await buyFederal("GOLD");
    await revokeFederalStatus(await db(), USER, {
      occurredAt: new Date(),
      productId: "tnr_federal_normal",
      store: "APPLE",
    });
    expect(await statusOf()).toBe("GOLD");
  });

  it("does not let one store's expiry retire the other store's receipt", async () => {
    await buyFederal("GOLD", 0, "APPLE");
    await revokeFederalStatus(await db(), USER, {
      occurredAt: new Date(),
      productId: "tnr_federal_gold",
      store: "GOOGLE",
    });
    expect(await statusOf()).toBe("GOLD");
  });

  it("does not let a sandbox receipt vouch for anything", async () => {
    await grantStorePurchase(await db(), {
      userId: USER,
      transactionId: nanoid(),
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: true,
      purchasedAt: new Date(),
      raw: {},
    });
    // Recorded for the audit trail, but never accepted, so nothing vouches for a tier.
    expect(await storeFederalFloor(await db(), USER)).toBe("NONE");
  });

  it("is idempotent when the same expiry is delivered twice", async () => {
    await givePaypal("NORMAL");
    await buyFederal("GOLD", MINUTE);
    const at = new Date();
    await revokeFederalStatus(await db(), USER, { occurredAt: at });
    await revokeFederalStatus(await db(), USER, { occurredAt: at });
    expect(await statusOf()).toBe("NORMAL");
  });

  it("moves a restored subscription and recomputes both accounts", async () => {
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    await buyFederal("GOLD");

    const first = await transferStorePurchases(await db(), {
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
    });
    expect(first.rowsAffected).toBe(1);
    // RevenueCat retries the same TRANSFER; the second pass must be harmless while still
    // repairing either status write if the first response was lost.
    const retry = await transferStorePurchases(await db(), {
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
    });
    expect(retry.rowsAffected).toBe(0);

    const database = await db();
    const [source, destination, receipt] = await Promise.all([
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, USER),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, DESTINATION),
      }),
      database.query.storePurchase.findFirst({
        columns: { userId: true },
        where: eq(storePurchase.userId, DESTINATION),
      }),
    ]);
    expect(source?.federalStatus).toBe("NONE");
    expect(destination?.federalStatus).toBe("GOLD");
    expect(receipt?.userId).toBe(DESTINATION);
  });

  it("leaves a failed grant pending, then applies it exactly once on retry", async () => {
    const userId = "store-grant-retry";
    const transactionId = nanoid();
    await insertUsers([{ userId, username: "retry", federalStatus: "NONE" }]);
    const database = await db();
    const grant = {
      userId,
      transactionId,
      productId: "tnr_reps_tier1",
      store: "APPLE" as const,
      isSandbox: false,
      purchasedAt: new Date(),
      raw: {},
    };
    // Force the balance write to fail after the receipt insert has executed.
    const before = await database.query.userData.findFirst({
      columns: { reputationPoints: true },
      where: eq(userData.userId, userId),
    });
    const blockedAt = (before?.reputationPoints ?? 0) + 8;
    await database.execute(
      sql.raw(
        `ALTER TABLE UserData ADD CONSTRAINT fail_store_grant CHECK (userId <> '${userId}' OR reputationPoints < ${blockedAt})`,
      ),
    );
    try {
      await expect(grantStorePurchase(database, grant)).rejects.toThrow();
    } finally {
      await database.execute(
        sql.raw("ALTER TABLE UserData DROP CHECK fail_store_grant"),
      );
    }
    const pending = await database.query.storePurchase.findFirst({
      columns: { grantedAt: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(pending?.grantedAt).toBeNull();

    const retried = await grantStorePurchase(database, grant);
    expect(retried).toMatchObject({
      status: "granted",
      reputationPoints: 8,
    });
    await expect(grantStorePurchase(database, grant)).resolves.toEqual({
      status: "duplicate",
    });
    const [settled, user] = await Promise.all([
      database.query.storePurchase.findFirst({
        columns: { grantedAt: true },
        where: eq(storePurchase.transactionId, transactionId),
      }),
      database.query.userData.findFirst({
        columns: { reputationPoints: true },
        where: eq(userData.userId, userId),
      }),
    ]);
    expect(settled?.grantedAt).toBeInstanceOf(Date);
    expect(user?.reputationPoints).toBe(blockedAt);
  });

  it("credits one of two concurrent deliveries exactly once", async () => {
    const userId = "store-grant-concurrent";
    const transactionId = nanoid();
    await insertUsers([{ userId, username: "concurrent", federalStatus: "NONE" }]);
    const database = await db();
    const before = await database.query.userData.findFirst({
      columns: { reputationPoints: true },
      where: eq(userData.userId, userId),
    });
    const grant = {
      userId,
      transactionId,
      productId: "tnr_reps_tier1",
      store: "APPLE" as const,
      isSandbox: false,
      purchasedAt: new Date(),
      raw: {},
    };

    const outcomes = await Promise.all([
      grantStorePurchase(database, grant),
      grantStorePurchase(database, grant),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      "duplicate",
      "granted",
    ]);
    const user = await database.query.userData.findFirst({
      columns: { reputationPoints: true },
      where: eq(userData.userId, userId),
    });
    expect(user?.reputationPoints).toBe((before?.reputationPoints ?? 0) + 8);
  });

  it("does not grant a pending subscription after it has expired", async () => {
    const userId = "store-grant-expired";
    const transactionId = nanoid();
    await insertUsers([{ userId, username: "expired", federalStatus: "NONE" }]);
    const database = await db();
    const grant = {
      userId,
      transactionId,
      productId: "tnr_federal_gold",
      store: "APPLE" as const,
      isSandbox: false,
      purchasedAt: new Date(Date.now() - MINUTE),
      raw: {},
    };

    // Leave the receipt pending by rejecting the atomic status/claim statement.
    await database.execute(
      sql.raw(
        `ALTER TABLE UserData ADD CONSTRAINT fail_store_federal_grant CHECK (userId <> '${userId}' OR federalStatus <> 'GOLD')`,
      ),
    );
    try {
      await expect(grantStorePurchase(database, grant)).rejects.toThrow();
    } finally {
      await database.execute(
        sql.raw("ALTER TABLE UserData DROP CHECK fail_store_federal_grant"),
      );
    }

    await revokeFederalStatus(database, userId, {
      occurredAt: new Date(),
      productId: grant.productId,
      store: grant.store,
    });
    await expect(grantStorePurchase(database, grant)).resolves.toEqual({
      status: "ignored",
      reason: "Revoked purchase",
    });
    const [receipt, user] = await Promise.all([
      database.query.storePurchase.findFirst({
        columns: { grantedAt: true, revokedAt: true },
        where: eq(storePurchase.transactionId, transactionId),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, userId),
      }),
    ]);
    expect(receipt?.grantedAt).toBeNull();
    expect(receipt?.revokedAt).toBeInstanceOf(Date);
    expect(user?.federalStatus).toBe("NONE");
  });

  it("does not grant a subscription first delivered after its expiry", async () => {
    const userId = "store-grant-after-expiry";
    const database = await db();
    const endedAt = new Date(Date.now() - MINUTE);
    await insertUsers([{ userId, username: "late-expired", federalStatus: "NONE" }]);

    await revokeFederalStatus(database, userId, {
      occurredAt: endedAt,
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    const transactionId = nanoid();
    await expect(
      grantStorePurchase(database, {
        userId,
        transactionId,
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(endedAt.getTime() - MINUTE),
        raw: {},
      }),
    ).resolves.toEqual({ status: "ignored", reason: "Expired purchase" });

    const [receipt, user] = await Promise.all([
      database.query.storePurchase.findFirst({
        columns: { grantedAt: true, revokedAt: true },
        where: eq(storePurchase.transactionId, transactionId),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, userId),
      }),
    ]);
    expect(receipt?.grantedAt).toBeNull();
    expect(receipt?.revokedAt).toBeInstanceOf(Date);
    expect(user?.federalStatus).toBe("NONE");
  });

  it("allows a resubscription purchased after the recorded expiry", async () => {
    const userId = "store-resubscribe-after-expiry";
    const database = await db();
    const endedAt = new Date(Date.now() - MINUTE);
    await insertUsers([{ userId, username: "late-live", federalStatus: "NONE" }]);

    await revokeFederalStatus(database, userId, {
      occurredAt: endedAt,
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    await expect(
      grantStorePurchase(database, {
        userId,
        transactionId: nanoid(),
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(endedAt.getTime() + 1),
        raw: {},
      }),
    ).resolves.toMatchObject({ status: "granted", federalStatus: "GOLD" });
  });
});
