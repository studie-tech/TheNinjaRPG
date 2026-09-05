// @vitest-environment node

import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  paypalSubscription,
  storeEntitlementRevocation,
  storeEntitlementState,
  storePurchase,
  storePurchaseTransfer,
  storeUserIdAlias,
  userData,
} from "@/drizzle/schema";
import type { FederalStatus, StorePlatform } from "@/drizzle/constants";
import { env } from "@/env/server.mjs";
import {
  extendStoreSubscription,
  grantStorePurchase,
  migrateStoreEntitlementStates,
  migrateStorePurchaseTransfers,
  reconcileStorePurchaseOwner,
  reconcileFederalStatuses,
  revokeFederalStatus,
  setFederalStatusWithStoreFloor,
  storeFederalFloor,
  type StoreTransfer,
  transferStorePurchases as persistStoreTransfer,
} from "@/server/utils/purchases/grant";
import { insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  openTestDatabaseConnection,
  resetTables,
  runRawSql,
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
const ORIGINAL_SANDBOX_USER_IDS = env.STORE_SANDBOX_USER_IDS;

const db = () => getTestDatabase();

const transferStorePurchases = (
  client: Parameters<typeof persistStoreTransfer>[0],
  transfer: Omit<StoreTransfer, "eventId"> & { eventId?: string },
) =>
  persistStoreTransfer(client, {
    ...transfer,
    eventId:
      transfer.eventId ??
      [
        transfer.fromUserIds.join(","),
        transfer.toUserIds.join(","),
        transfer.store ?? "ALL",
        transfer.occurredAt.toISOString(),
      ].join(":"),
  });

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
): Promise<string> => {
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
  return transactionId;
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
    env.STORE_SANDBOX_USER_IDS = ORIGINAL_SANDBOX_USER_IDS;
    await resetTables(
      storeEntitlementState,
      storeEntitlementRevocation,
      storePurchaseTransfer,
      storeUserIdAlias,
      storePurchase,
      paypalSubscription,
      userData,
    );
    await insertUsers([{ userId: USER, username: "seq", federalStatus: "NONE" }]);
  });

  afterEach(() => {
    env.STORE_SANDBOX_USER_IDS = ORIGINAL_SANDBOX_USER_IDS;
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

  it("keeps a renewal that starts exactly when the expired period ends", async () => {
    const database = await db();
    const endedAt = new Date(Date.now() - MINUTE);
    const oldTransactionId = nanoid();
    const renewalTransactionId = nanoid();

    await grantStorePurchase(database, {
      userId: USER,
      transactionId: oldTransactionId,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: false,
      purchasedAt: new Date(endedAt.getTime() - DAY),
      raw: {},
    });
    await grantStorePurchase(database, {
      userId: USER,
      transactionId: renewalTransactionId,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: false,
      purchasedAt: endedAt,
      raw: {},
    });

    await revokeFederalStatus(database, USER, {
      occurredAt: endedAt,
      productId: "tnr_federal_gold",
      store: "APPLE",
    });

    const [oldReceipt, renewalReceipt] = await Promise.all([
      database.query.storePurchase.findFirst({
        columns: { revokedAt: true },
        where: eq(storePurchase.transactionId, oldTransactionId),
      }),
      database.query.storePurchase.findFirst({
        columns: { grantedAt: true, revokedAt: true },
        where: eq(storePurchase.transactionId, renewalTransactionId),
      }),
    ]);
    expect(oldReceipt?.revokedAt).toBeInstanceOf(Date);
    expect(renewalReceipt?.grantedAt).toBeInstanceOf(Date);
    expect(renewalReceipt?.revokedAt).toBeNull();
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

  it("does not use receipt age after an explicit paid-through date has ended", async () => {
    const transactionId = await buyFederal("GOLD");
    const database = await db();
    await database
      .update(storePurchase)
      .set({ expiresAt: new Date(Date.now() - MINUTE) })
      .where(eq(storePurchase.transactionId, transactionId));

    expect(await storeFederalFloor(database, USER)).toBe("NONE");
    await setFederalStatusWithStoreFloor(database, USER, "NONE");
    expect(await statusOf()).toBe("NONE");
  });

  it("keeps and restores an old receipt when the store extends its paid-through date", async () => {
    const transactionId = await buyFederal("GOLD", 70 * DAY);
    const database = await db();
    await database
      .update(userData)
      .set({ federalStatus: "NONE" })
      .where(eq(userData.userId, USER));

    await extendStoreSubscription(database, {
      userId: USER,
      store: "APPLE",
      productId: "tnr_federal_gold",
      expirationAt: new Date(Date.now() + 30 * DAY),
      transactionId,
    });

    expect(await storeFederalFloor(database, USER)).toBe("GOLD");
    expect(await statusOf()).toBe("GOLD");
  });

  it("still vouches inside the billing-retry grace window", async () => {
    // A renewal that failed 40 days ago is still within the store's retry period.
    await buyFederal("GOLD", 40 * DAY);
    const next = await storeFederalFloor(await db(), USER);
    expect(next).toBe("GOLD");
  });

  it("keeps a cancelled web subscription until its paid period runs out", async () => {
    // Cancelling on the web sets status without moving updatedAt, and the player has paid
    // through the period. Dropping them at the next reconcile would take away time they
    // already bought.
    const database = await db();
    await givePaypal("GOLD", "CANCELLED");
    await database
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, USER));
    await reconcileFederalStatuses(database);
    expect(await statusOf()).toBe("GOLD");
  });

  it("keeps the paid period when a store event lands inside it", async () => {
    // The grace has to hold in both writers. A store revocation or transfer during the
    // cancelled-but-paid window recomputes the column through setFederalStatusWithStoreFloor,
    // and that path counts only ACTIVE PayPal rows -- so without the same gate it would
    // write NONE, which the reconcile then refuses to undo.
    const database = await db();
    await givePaypal("GOLD", "CANCELLED");
    await database
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, USER));
    await setFederalStatusWithStoreFloor(database, USER, "NONE");
    expect(await statusOf()).toBe("GOLD");
  });

  it("drops the tier when the paid period is genuinely over", async () => {
    // The grace keys on updatedAt as the last payment. A subscription the cron has marked
    // finished carries a marker at least 31 days old -- that is the only kind of row it
    // selects -- so the window has closed and the tier must go, whichever writer runs.
    const database = await db();
    await givePaypal("GOLD", "CANCELLED");
    await database
      .update(paypalSubscription)
      .set({ updatedAt: new Date(Date.now() - 40 * DAY) })
      .where(eq(paypalSubscription.affectedUserId, USER));
    await database
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, USER));
    await setFederalStatusWithStoreFloor(database, USER, "NONE");
    expect(await statusOf()).toBe("NONE");
    await database
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, USER));
    await reconcileFederalStatuses(database);
    expect(await statusOf()).toBe("NONE");
  });

  it("keeps the PayPal period underneath a store tier that ends", async () => {
    // Cancelled SILVER on the web, still inside its paid window, then a store GOLD on top.
    // When the store subscription ends, the SILVER they paid for has to reappear -- gated
    // on the exact column value it could not, because the column still read GOLD.
    const database = await db();
    await givePaypal("SILVER", "CANCELLED");
    await database
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, USER));
    await setFederalStatusWithStoreFloor(database, USER, "NONE");
    expect(await statusOf()).toBe("SILVER");
  });

  it("does not raise anyone above the tier they already hold", async () => {
    // The other edge of "at least": a recent GOLD row must not lift someone sitting on
    // SILVER, or the grace becomes a restore.
    const database = await db();
    await givePaypal("GOLD", "CANCELLED");
    await database
      .update(userData)
      .set({ federalStatus: "SILVER" })
      .where(eq(userData.userId, USER));
    await setFederalStatusWithStoreFloor(database, USER, "NONE");
    expect(await statusOf()).not.toBe("GOLD");
  });

  it("lets a web downgrade land instead of holding the higher tier", async () => {
    // Cancel GOLD, then subscribe SILVER. The grace must not hold GOLD over a caller that
    // is naming a real tier, or the branch changes what the web flow has always done.
    const database = await db();
    await givePaypal("GOLD", "CANCELLED");
    await database
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, USER));
    await setFederalStatusWithStoreFloor(database, USER, "SILVER");
    expect(await statusOf()).toBe("SILVER");
  });

  it("does not hand a tier back to someone already cleared", async () => {
    // The other half: the same cancelled row must not restore a tier once it is gone, or
    // a reconcile would undo every revocation for anyone holding a stale subscription.
    const database = await db();
    await givePaypal("GOLD", "CANCELLED");
    await database
      .update(userData)
      .set({ federalStatus: "NONE" })
      .where(eq(userData.userId, USER));
    await reconcileFederalStatuses(database);
    expect(await statusOf()).toBe("NONE");
  });

  it("acknowledges an extension for a period it has already retired", async () => {
    // RevenueCat redelivers for days and retries a 5xx. Once the period an event describes
    // is retired there is nothing a retry can repair, so it has to be acknowledged rather
    // than answered with an error -- and the payload need not name a transaction we stored.
    const database = await db();
    await buyFederal("GOLD", MINUTE);
    await revokeFederalStatus(database, USER, {
      occurredAt: new Date(),
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    await expect(
      extendStoreSubscription(database, {
        userId: USER,
        store: "APPLE",
        productId: "tnr_federal_gold",
        expirationAt: new Date(Date.now() - 2 * MINUTE),
      }),
    ).resolves.toBeUndefined();
  });

  it("retries an extension asking for coverage beyond anything retired", async () => {
    // Every resubscriber has an old retired receipt, so acknowledging on its mere presence
    // would drop a real extension whose purchase webhook has not landed yet. Coverage past
    // what we hold means the period is one we have not recorded, and the retry is what
    // lets it arrive.
    const database = await db();
    await buyFederal("GOLD", MINUTE);
    await revokeFederalStatus(database, USER, {
      occurredAt: new Date(),
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    await expect(
      extendStoreSubscription(database, {
        userId: USER,
        store: "APPLE",
        productId: "tnr_federal_gold",
        expirationAt: new Date(Date.now() + DAY),
      }),
    ).rejects.toThrow(/No live receipt to extend/);
  });

  it("still asks for a retry when the purchase has not arrived yet", async () => {
    // The other side of the same branch: no receipt at all may only mean the grant webhook
    // is still in flight, and throwing is what lets a later retry find it.
    const database = await db();
    await expect(
      extendStoreSubscription(database, {
        userId: USER,
        store: "APPLE",
        productId: "tnr_federal_gold",
        expirationAt: new Date(Date.now() + DAY),
      }),
    ).rejects.toThrow(/No live receipt to extend/);
  });

  it("does not shorten a receipt from a period it only guessed at", async () => {
    // No transaction id to match on, so the candidate loop picks the newest live receipt.
    // An expiry in the past must not be written onto it: a NULL expiresAt means "open,
    // covered by the fallback window" everywhere else, and shortening it here would end an
    // entitlement the player is still paying for.
    const database = await db();
    await buyFederal("GOLD", MINUTE);
    await extendStoreSubscription(database, {
      userId: USER,
      store: "APPLE",
      productId: "tnr_federal_gold",
      expirationAt: new Date(Date.now() - DAY),
    });
    const receipt = await database.query.storePurchase.findFirst({
      columns: { expiresAt: true },
      where: eq(storePurchase.userId, USER),
    });
    expect(receipt?.expiresAt ?? null).toBeNull();
    expect(await storeFederalFloor(database, USER)).toBe("GOLD");
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

  it("isolates a delayed production purchase from sandbox expiry and transfer history", async () => {
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const purchasedAt = new Date(Date.now() - 3 * MINUTE);
    const endedAt = new Date(Date.now() - 2 * MINUTE);
    await revokeFederalStatus(database, USER, {
      eventId: "sandbox-expiry-before-production",
      occurredAt: endedAt,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: true,
    });
    await transferStorePurchases(database, {
      eventId: "sandbox-transfer-before-production",
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      isSandbox: true,
      occurredAt: new Date(Date.now() - MINUTE),
    });

    const transactionId = "production-after-sandbox-history";
    await expect(
      grantStorePurchase(database, {
        userId: USER,
        transactionId,
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt,
        raw: {},
      }),
    ).resolves.toMatchObject({ status: "granted", federalStatus: "GOLD" });
    const receipt = await database.query.storePurchase.findFirst({
      columns: { userId: true, revokedAt: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(receipt).toEqual({ userId: USER, revokedAt: null });
  });

  it("isolates a delayed sandbox purchase from production expiry and transfer history", async () => {
    env.STORE_SANDBOX_USER_IDS = USER;
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const purchasedAt = new Date(Date.now() - 3 * MINUTE);
    await revokeFederalStatus(database, USER, {
      eventId: "production-expiry-before-sandbox",
      occurredAt: new Date(Date.now() - 2 * MINUTE),
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: false,
    });
    await transferStorePurchases(database, {
      eventId: "production-transfer-before-sandbox",
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      isSandbox: false,
      occurredAt: new Date(Date.now() - MINUTE),
    });

    const transactionId = "sandbox-after-production-history";
    await expect(
      grantStorePurchase(database, {
        userId: USER,
        transactionId,
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: true,
        purchasedAt,
        raw: {},
      }),
    ).resolves.toMatchObject({ status: "granted", federalStatus: "GOLD" });
    const receipt = await database.query.storePurchase.findFirst({
      columns: { userId: true, revokedAt: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(receipt).toEqual({ userId: USER, revokedAt: null });
  });

  it("stores identical lifecycle event ids independently in both environments", async () => {
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const occurredAt = new Date(Date.now() - MINUTE);
    for (const isSandbox of [false, true]) {
      await revokeFederalStatus(database, USER, {
        eventId: "same-expiry-event",
        occurredAt,
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox,
      });
      await transferStorePurchases(database, {
        eventId: "same-transfer-event",
        fromUserIds: [USER],
        toUserIds: [DESTINATION],
        store: "APPLE",
        isSandbox,
        occurredAt: new Date(),
      });
    }

    const [revocations, states, transfers] = await Promise.all([
      database.query.storeEntitlementRevocation.findMany({
        columns: { isSandbox: true },
        where: eq(storeEntitlementRevocation.eventId, "same-expiry-event"),
      }),
      database.query.storeEntitlementState.findMany({
        columns: { isSandbox: true },
        where: eq(storeEntitlementState.userId, USER),
      }),
      database.query.storePurchaseTransfer.findMany({
        columns: { isSandbox: true },
        where: eq(storePurchaseTransfer.eventId, "same-transfer-event"),
      }),
    ]);
    expect(revocations.map((row) => row.isSandbox).sort()).toEqual([false, true]);
    expect(states.map((row) => row.isSandbox).sort()).toEqual([false, true]);
    expect(transfers.map((row) => row.isSandbox).sort()).toEqual([false, true]);
  });

  it("withdraws an allowlisted sandbox tier when its receipt transfers to an ordinary account", async () => {
    env.STORE_SANDBOX_USER_IDS = USER;
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const purchasedAt = new Date(Date.now() - 3 * MINUTE);
    const transactionId = nanoid();
    await grantStorePurchase(database, {
      userId: USER,
      transactionId,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: true,
      purchasedAt,
      raw: {},
    });

    await transferStorePurchases(database, {
      eventId: "sandbox-transfer-away",
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      isSandbox: true,
      occurredAt: new Date(purchasedAt.getTime() + MINUTE),
    });

    const receipt = await database.query.storePurchase.findFirst({
      columns: { userId: true, acceptedAt: true, grantedAt: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(receipt?.userId).toBe(DESTINATION);
    expect(receipt?.acceptedAt).toBeNull();
    expect(receipt?.grantedAt).toBeInstanceOf(Date);
    expect(await storeFederalFloor(database, DESTINATION)).toBe("NONE");
    const destination = await database.query.userData.findFirst({
      columns: { federalStatus: true },
      where: eq(userData.userId, DESTINATION),
    });
    expect(destination?.federalStatus).toBe("NONE");

    // Even a stale acceptance marker from an older deployment cannot make a sandbox
    // receipt count for an account which is not currently allowlisted.
    await database
      .update(storePurchase)
      .set({ acceptedAt: new Date() })
      .where(eq(storePurchase.transactionId, transactionId));
    expect(await storeFederalFloor(database, DESTINATION)).toBe("NONE");
    await database
      .update(userData)
      .set({ federalStatus: "GOLD" })
      .where(eq(userData.userId, DESTINATION));
    await reconcileFederalStatuses(database);
    const reconciledDestination = await database.query.userData.findFirst({
      columns: { federalStatus: true },
      where: eq(userData.userId, DESTINATION),
    });
    expect(reconciledDestination?.federalStatus).toBe("NONE");
  });

  it("restores sandbox acceptance when the receipt transfers back to its allowlisted owner", async () => {
    env.STORE_SANDBOX_USER_IDS = USER;
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const purchasedAt = new Date(Date.now() - 4 * MINUTE);
    const transactionId = nanoid();
    await grantStorePurchase(database, {
      userId: USER,
      transactionId,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: true,
      purchasedAt,
      raw: {},
    });
    await transferStorePurchases(database, {
      eventId: "sandbox-transfer-away-before-return",
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      isSandbox: true,
      occurredAt: new Date(purchasedAt.getTime() + MINUTE),
    });
    await transferStorePurchases(database, {
      eventId: "sandbox-transfer-return",
      fromUserIds: [DESTINATION],
      toUserIds: [USER],
      store: "APPLE",
      isSandbox: true,
      occurredAt: new Date(purchasedAt.getTime() + 2 * MINUTE),
    });

    const receipt = await database.query.storePurchase.findFirst({
      columns: { userId: true, acceptedAt: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(receipt?.userId).toBe(USER);
    expect(receipt?.acceptedAt).toBeInstanceOf(Date);
    expect(await statusOf()).toBe("GOLD");
  });

  it("expires a returned sandbox receipt by its actual owner, not the payload user", async () => {
    env.STORE_SANDBOX_USER_IDS = USER;
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const purchasedAt = new Date(Date.now() - 4 * MINUTE);
    const transactionId = nanoid();
    await grantStorePurchase(database, {
      userId: USER,
      transactionId,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: true,
      purchasedAt,
      raw: {},
    });
    await transferStorePurchases(database, {
      eventId: "sandbox-expiry-transfer-away",
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      isSandbox: true,
      occurredAt: new Date(purchasedAt.getTime() + MINUTE),
    });
    await transferStorePurchases(database, {
      eventId: "sandbox-expiry-transfer-return",
      fromUserIds: [DESTINATION],
      toUserIds: [USER],
      store: "APPLE",
      isSandbox: true,
      occurredAt: new Date(purchasedAt.getTime() + 2 * MINUTE),
    });

    // RevenueCat may still name the transfer source. The exact receipt says who owns the
    // entitlement now, and that account is the one whose tier must be recomputed.
    await revokeFederalStatus(database, DESTINATION, {
      eventId: "sandbox-expiry-after-return",
      occurredAt: new Date(),
      productId: "tnr_federal_gold",
      store: "APPLE",
      transactionId,
      isSandbox: true,
    });

    const receipt = await database.query.storePurchase.findFirst({
      columns: { userId: true, revokedAt: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(receipt?.userId).toBe(USER);
    expect(receipt?.revokedAt).toBeInstanceOf(Date);
    expect(await statusOf()).toBe("NONE");
  });

  it("retires a sandbox receipt at its ordinary owner so a later return cannot revive it", async () => {
    env.STORE_SANDBOX_USER_IDS = USER;
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const purchasedAt = new Date(Date.now() - 4 * MINUTE);
    const transactionId = nanoid();
    await grantStorePurchase(database, {
      userId: USER,
      transactionId,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: true,
      purchasedAt,
      raw: {},
    });
    await transferStorePurchases(database, {
      eventId: "sandbox-expiry-at-ordinary-owner",
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      isSandbox: true,
      occurredAt: new Date(purchasedAt.getTime() + MINUTE),
    });

    // The event still names the original allowlisted account, while the receipt itself
    // has moved. Expiry must use that receipt owner and retire it even though B was never
    // eligible to receive the sandbox tier.
    await revokeFederalStatus(database, USER, {
      eventId: "sandbox-expiry-before-return",
      occurredAt: new Date(purchasedAt.getTime() + 2 * MINUTE),
      productId: "tnr_federal_gold",
      store: "APPLE",
      transactionId,
      isSandbox: true,
    });
    await transferStorePurchases(database, {
      eventId: "sandbox-return-after-expiry",
      fromUserIds: [DESTINATION],
      toUserIds: [USER],
      store: "APPLE",
      isSandbox: true,
      occurredAt: new Date(purchasedAt.getTime() + 3 * MINUTE),
    });

    const receipt = await database.query.storePurchase.findFirst({
      columns: { userId: true, acceptedAt: true, revokedAt: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(receipt?.userId).toBe(DESTINATION);
    expect(receipt?.acceptedAt).toBeNull();
    expect(receipt?.revokedAt).toBeInstanceOf(Date);
    expect(await statusOf()).toBe("NONE");
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

    const transferredAt = new Date();
    const transferEventId = nanoid();
    const first = await transferStorePurchases(await db(), {
      eventId: transferEventId,
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: transferredAt,
    });
    expect(first.rowsAffected).toBe(1);
    // RevenueCat retries the same TRANSFER; the second pass must be harmless while still
    // repairing either status write if the first response was lost.
    const retry = await transferStorePurchases(await db(), {
      eventId: transferEventId,
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      // Even a malformed retry cannot replace the stable event's first cutoff.
      occurredAt: new Date(transferredAt.getTime() + MINUTE),
    });
    expect(retry.rowsAffected).toBe(0);

    const database = await db();
    const [source, destination, receipt, redirect] = await Promise.all([
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
      database.query.storePurchaseTransfer.findFirst({
        columns: { eventId: true, transferredAt: true },
        where: eq(storePurchaseTransfer.eventId, transferEventId),
      }),
    ]);
    expect(source?.federalStatus).toBe("NONE");
    expect(destination?.federalStatus).toBe("GOLD");
    expect(receipt?.userId).toBe(DESTINATION);
    expect(redirect?.transferredAt.getTime()).toBe(transferredAt.getTime());
  });

  it("routes only purchases made before an Apple transfer and leaves later purchases", async () => {
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const transferredAt = new Date();
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: transferredAt,
    });

    const transactionId = nanoid();
    const grant = {
      userId: USER,
      transactionId,
      productId: "tnr_federal_gold",
      store: "APPLE" as const,
      isSandbox: false,
      purchasedAt: new Date(transferredAt.getTime() - MINUTE),
      raw: {},
    };
    await expect(grantStorePurchase(database, grant)).resolves.toMatchObject({
      status: "granted",
      federalStatus: "GOLD",
    });
    await expect(grantStorePurchase(database, grant)).resolves.toEqual({
      status: "duplicate",
    });

    // A purchase made after the transfer belongs to the source account again. Likewise,
    // an Apple app_id-inferred transfer must not capture a later Google purchase.
    await grantStorePurchase(database, {
      ...grant,
      transactionId: nanoid(),
      productId: "tnr_federal_silver",
      store: "GOOGLE",
      purchasedAt: new Date(transferredAt.getTime() + MINUTE),
    });
    await grantStorePurchase(database, {
      ...grant,
      transactionId: nanoid(),
      productId: "tnr_federal_normal",
      purchasedAt: new Date(transferredAt.getTime() + MINUTE),
    });
    const [source, destination, receipts, redirects] = await Promise.all([
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, USER),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, DESTINATION),
      }),
      database.query.storePurchase.findMany({
        columns: { userId: true },
      }),
      database.query.storePurchaseTransfer.findMany({
        columns: { store: true, destinationUserId: true },
      }),
    ]);
    expect(source?.federalStatus).toBe("SILVER");
    expect(destination?.federalStatus).toBe("GOLD");
    expect(receipts.map((receipt) => receipt.userId).sort()).toEqual(
      [DESTINATION, USER, USER].sort(),
    );
    expect(redirects).toEqual([
      { store: "APPLE", destinationUserId: DESTINATION },
    ]);
  });

  it("applies delayed extension and expiry events to a transferred receipt owner", async () => {
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const transactionId = await buyFederal("GOLD", MINUTE);
    const transferredAt = new Date();
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: transferredAt,
    });
    const extendedUntil = new Date(Date.now() + DAY);
    await extendStoreSubscription(database, {
      userId: USER,
      store: "APPLE",
      productId: "tnr_federal_gold",
      expirationAt: extendedUntil,
      transactionId,
    });
    const fallbackExtension = new Date(Date.now() + 2 * DAY);
    await extendStoreSubscription(database, {
      userId: USER,
      store: "APPLE",
      productId: "tnr_federal_gold",
      expirationAt: fallbackExtension,
    });
    const extended = await database.query.storePurchase.findFirst({
      columns: { userId: true, expiresAt: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(extended?.userId).toBe(DESTINATION);
    expect(extended?.expiresAt?.getTime()).toBe(fallbackExtension.getTime());

    await revokeFederalStatus(database, USER, {
      occurredAt: new Date(),
      productId: "tnr_federal_gold",
      store: "APPLE",
      transactionId,
    });
    // A retry naming the now-revoked transaction is an acknowledged no-op.
    await revokeFederalStatus(database, USER, {
      occurredAt: new Date(Date.now() + MINUTE),
      productId: "tnr_federal_gold",
      store: "APPLE",
      transactionId,
    });
    const [receipt, source, destination] = await Promise.all([
      database.query.storePurchase.findFirst({
        columns: { userId: true, revokedAt: true },
        where: eq(storePurchase.transactionId, transactionId),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, USER),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, DESTINATION),
      }),
    ]);
    expect(receipt?.userId).toBe(DESTINATION);
    expect(receipt?.revokedAt).toBeInstanceOf(Date);
    expect(source?.federalStatus).toBe("NONE");
    expect(destination?.federalStatus).toBe("NONE");
  });

  it("preserves transfer history while following chronological ownership hops", async () => {
    const finalDestination = "federal-transfer-final-destination";
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
      {
        userId: finalDestination,
        username: "final-destination",
        federalStatus: "NONE",
      },
    ]);
    const database = await db();
    const firstTransferAt = new Date(Date.now() - 2 * MINUTE);
    const secondTransferAt = new Date();
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: firstTransferAt,
    });
    await transferStorePurchases(database, {
      fromUserIds: [DESTINATION],
      toUserIds: [finalDestination],
      store: "APPLE",
      occurredAt: secondTransferAt,
    });

    const beforeFirst = nanoid();
    const betweenTransfers = nanoid();
    await grantStorePurchase(database, {
      userId: USER,
      transactionId: beforeFirst,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: false,
      purchasedAt: new Date(firstTransferAt.getTime() - MINUTE),
      raw: {},
    });
    await grantStorePurchase(database, {
      userId: USER,
      transactionId: betweenTransfers,
      productId: "tnr_federal_silver",
      store: "APPLE",
      isSandbox: false,
      purchasedAt: new Date(firstTransferAt.getTime() + MINUTE),
      raw: {},
    });
    const [oldReceipt, laterReceipt, flattened] = await Promise.all([
      database.query.storePurchase.findFirst({
        columns: { userId: true },
        where: eq(storePurchase.transactionId, beforeFirst),
      }),
      database.query.storePurchase.findFirst({
        columns: { userId: true },
        where: eq(storePurchase.transactionId, betweenTransfers),
      }),
      database.query.storePurchaseTransfer.findFirst({
        columns: { destinationUserId: true, transferredAt: true },
        where: and(
          eq(storePurchaseTransfer.sourceUserId, USER),
          eq(storePurchaseTransfer.store, "APPLE"),
        ),
      }),
    ]);
    expect(oldReceipt?.userId).toBe(finalDestination);
    expect(laterReceipt?.userId).toBe(USER);
    expect(flattened?.destinationUserId).toBe(DESTINATION);
    expect(flattened?.transferredAt.getTime()).toBe(firstTransferAt.getTime());
  });

  it("renames every historical transfer source and destination", async () => {
    const database = await db();
    const newUserId = "renamed-federal-user";
    const otherSource = "other-transfer-source";
    const older = new Date(Date.now() - MINUTE);
    const newer = new Date();
    await database.insert(storePurchaseTransfer).values([
      {
        id: nanoid(),
        eventId: nanoid(),
        sourceUserId: USER,
        destinationUserId: "older-owner",
        store: "APPLE",
        transferredAt: older,
      },
      {
        id: nanoid(),
        eventId: nanoid(),
        sourceUserId: newUserId,
        destinationUserId: "newer-owner",
        store: "APPLE",
        transferredAt: newer,
      },
      {
        id: nanoid(),
        eventId: nanoid(),
        sourceUserId: otherSource,
        destinationUserId: USER,
        store: "GOOGLE",
        transferredAt: older,
      },
      {
        id: nanoid(),
        eventId: nanoid(),
        sourceUserId: newUserId,
        destinationUserId: USER,
        store: "GOOGLE",
        transferredAt: newer,
      },
    ]);

    await migrateStorePurchaseTransfers(database, USER, newUserId);
    const aliases = await database.query.storePurchaseTransfer.findMany({
      columns: {
        sourceUserId: true,
        destinationUserId: true,
        store: true,
        transferredAt: true,
      },
    });
    expect(aliases).toHaveLength(3);
    expect(aliases).toEqual(
      expect.arrayContaining([
        {
          sourceUserId: newUserId,
          destinationUserId: "older-owner",
          store: "APPLE",
          transferredAt: older,
        },
        {
          sourceUserId: newUserId,
          destinationUserId: "newer-owner",
          store: "APPLE",
          transferredAt: newer,
        },
        {
          sourceUserId: otherSource,
          destinationUserId: newUserId,
          store: "GOOGLE",
          transferredAt: older,
        },
      ]),
    );
  });

  it("routes delayed grants through repeated source ownership epochs", async () => {
    const olderDestination = "federal-transfer-older-destination";
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
      {
        userId: olderDestination,
        username: "older-destination",
        federalStatus: "NONE",
      },
    ]);
    const database = await db();
    const newerAt = new Date();
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: newerAt,
    });
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [olderDestination],
      store: "APPLE",
      occurredAt: new Date(newerAt.getTime() - MINUTE),
    });

    const olderAt = new Date(newerAt.getTime() - MINUTE);
    const beforeBoth = nanoid();
    const between = nanoid();
    const afterBoth = nanoid();
    for (const [transactionId, purchasedAt] of [
      [beforeBoth, new Date(olderAt.getTime() - MINUTE)],
      [between, new Date(olderAt.getTime() + 1)],
      [afterBoth, new Date(newerAt.getTime() + MINUTE)],
    ] as const) {
      await grantStorePurchase(database, {
        userId: USER,
        transactionId,
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt,
        raw: {},
      });
    }
    const [redirects, receipts] = await Promise.all([
      database.query.storePurchaseTransfer.findMany({
        columns: { destinationUserId: true, transferredAt: true },
        where: eq(storePurchaseTransfer.sourceUserId, USER),
      }),
      database.query.storePurchase.findMany({
        columns: { transactionId: true, userId: true },
      }),
    ]);
    expect(redirects).toHaveLength(2);
    expect(Object.fromEntries(receipts.map((row) => [row.transactionId, row.userId])))
      .toEqual({
        [beforeBoth]: olderDestination,
        [between]: DESTINATION,
        [afterBoth]: USER,
      });

    await revokeFederalStatus(database, USER, {
      occurredAt: newerAt,
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    const betweenReceipt = await database.query.storePurchase.findFirst({
      columns: { revokedAt: true },
      where: eq(storePurchase.transactionId, between),
    });
    expect(betweenReceipt?.revokedAt).toBeInstanceOf(Date);
  });

  it("re-homes a receipt when an older transfer arrives after a newer one", async () => {
    const olderDestination = "federal-transfer-delayed-destination";
    await insertUsers([
      { userId: DESTINATION, username: "newer-owner", federalStatus: "NONE" },
      {
        userId: olderDestination,
        username: "older-owner",
        federalStatus: "NONE",
      },
    ]);
    const database = await db();
    const olderAt = new Date(Date.now() - MINUTE);
    const newerAt = new Date();
    const transactionId = await buyFederal("GOLD", 2 * MINUTE);

    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: newerAt,
    });
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [olderDestination],
      store: "APPLE",
      occurredAt: olderAt,
    });

    const [receipt, source, olderOwner, newerOwner] = await Promise.all([
      database.query.storePurchase.findFirst({
        columns: { userId: true },
        where: eq(storePurchase.transactionId, transactionId),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, USER),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, olderDestination),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, DESTINATION),
      }),
    ]);
    expect(receipt?.userId).toBe(olderDestination);
    expect(source?.federalStatus).toBe("NONE");
    expect(olderOwner?.federalStatus).toBe("GOLD");
    expect(newerOwner?.federalStatus).toBe("NONE");
  });

  it("serializes deliberately overlapped transfer reconciliation", async () => {
    const finalDestination = "federal-transfer-final-destination";
    await insertUsers([
      { userId: DESTINATION, username: "middle-owner", federalStatus: "NONE" },
      { userId: finalDestination, username: "final-owner", federalStatus: "NONE" },
    ]);
    const database = await db();
    const transactionId = await buyFederal("GOLD", 2 * MINUTE);
    const firstConnection = await openTestDatabaseConnection();
    const secondConnection = await openTestDatabaseConnection();
    const barrierConnection = await openTestDatabaseConnection();
    const firstEventId = nanoid();
    const barrier = `transfer_reconcile_${nanoid()}`;
    const trigger = `pause_transfer_${nanoid().replaceAll("-", "_")}`;
    await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
    await runRawSql(`
      CREATE TRIGGER ${trigger} BEFORE INSERT ON StorePurchaseTransfer FOR EACH ROW
      BEGIN
        IF NEW.eventId = '${firstEventId}' THEN
          SET @transfer_wait = GET_LOCK('${barrier}', 10);
          SET @transfer_release = RELEASE_LOCK('${barrier}');
        END IF;
      END
    `);
    try {
      const olderAt = new Date(Date.now() - MINUTE);
      const first = transferStorePurchases(firstConnection.database, {
        eventId: firstEventId,
        fromUserIds: [USER],
        toUserIds: [DESTINATION],
        store: "APPLE",
        occurredAt: olderAt,
      });
      await barrierConnection.waitForNamedLockWaiter(barrier);

      let secondFinished = false;
      const second = transferStorePurchases(secondConnection.database, {
        eventId: nanoid(),
        fromUserIds: [DESTINATION],
        toUserIds: [finalDestination],
        store: "APPLE",
        occurredAt: new Date(olderAt.getTime() + 1),
      }).finally(() => {
        secondFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(secondFinished).toBe(false);
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);

      await expect(first).resolves.toMatchObject({ destinationUserId: DESTINATION });
      await expect(second).resolves.toMatchObject({
        destinationUserId: finalDestination,
      });
      const [receipt, source, middle, destination] = await Promise.all([
        database.query.storePurchase.findFirst({
          columns: { userId: true },
          where: eq(storePurchase.transactionId, transactionId),
        }),
        database.query.userData.findFirst({
          columns: { federalStatus: true },
          where: eq(userData.userId, USER),
        }),
        database.query.userData.findFirst({
          columns: { federalStatus: true },
          where: eq(userData.userId, DESTINATION),
        }),
        database.query.userData.findFirst({
          columns: { federalStatus: true },
          where: eq(userData.userId, finalDestination),
        }),
      ]);
      expect(receipt?.userId).toBe(finalDestination);
      expect(source?.federalStatus).toBe("NONE");
      expect(middle?.federalStatus).toBe("NONE");
      expect(destination?.federalStatus).toBe("GOLD");
    } finally {
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
      await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
      await Promise.all([
        firstConnection.close(),
        secondConnection.close(),
        barrierConnection.close(),
      ]);
    }
  });

  it("serializes a grant through A to B with a concurrent B to C transfer", async () => {
    const middleUserId = "overlap-grant-middle";
    const finalUserId = "overlap-grant-final";
    await insertUsers([
      { userId: middleUserId, username: "grant-middle", federalStatus: "NONE" },
      { userId: finalUserId, username: "grant-final", federalStatus: "NONE" },
    ]);
    const database = await db();
    const firstTransferAt = new Date(Date.now() - MINUTE);
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [middleUserId],
      store: "APPLE",
      occurredAt: firstTransferAt,
    });

    const grantConnection = await openTestDatabaseConnection();
    const transferConnection = await openTestDatabaseConnection();
    const barrierConnection = await openTestDatabaseConnection();
    const transactionId = nanoid();
    const barrier = `grant_transfer_${nanoid()}`;
    const trigger = `pause_grant_transfer_${nanoid().replaceAll("-", "_")}`;
    await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
    await runRawSql(`
      CREATE TRIGGER ${trigger} BEFORE INSERT ON StorePurchase FOR EACH ROW
      BEGIN
        IF NEW.transactionId = '${transactionId}' THEN
          SET @grant_transfer_wait = GET_LOCK('${barrier}', 10);
          SET @grant_transfer_release = RELEASE_LOCK('${barrier}');
        END IF;
      END
    `);
    try {
      const grant = grantStorePurchase(grantConnection.database, {
        userId: USER,
        transactionId,
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(firstTransferAt.getTime() - MINUTE),
        raw: {},
      });
      await barrierConnection.waitForNamedLockWaiter(barrier);

      let transferFinished = false;
      const transfer = transferStorePurchases(transferConnection.database, {
        fromUserIds: [middleUserId],
        toUserIds: [finalUserId],
        store: "APPLE",
        occurredAt: new Date(),
      }).finally(() => {
        transferFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(transferFinished).toBe(false);
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);

      await expect(grant).resolves.toMatchObject({ status: "granted" });
      await expect(transfer).resolves.toMatchObject({ destinationUserId: finalUserId });
      const [receipt, middle, final] = await Promise.all([
        database.query.storePurchase.findFirst({
          columns: { userId: true },
          where: eq(storePurchase.transactionId, transactionId),
        }),
        database.query.userData.findFirst({
          columns: { federalStatus: true },
          where: eq(userData.userId, middleUserId),
        }),
        database.query.userData.findFirst({
          columns: { federalStatus: true },
          where: eq(userData.userId, finalUserId),
        }),
      ]);
      expect(receipt?.userId).toBe(finalUserId);
      expect(middle?.federalStatus).toBe("NONE");
      expect(final?.federalStatus).toBe("GOLD");
    } finally {
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
      await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
      await Promise.all([
        grantConnection.close(),
        transferConnection.close(),
        barrierConnection.close(),
      ]);
    }
  });

  it("lets a two-connection CAS loser observe the winning receipt owner", async () => {
    const destinationUserId = "cas-owner-destination";
    await insertUsers([
      { userId: destinationUserId, username: "cas-owner", federalStatus: "NONE" },
    ]);
    const database = await db();
    const transactionId = await buyFederal("GOLD", 2 * MINUTE);
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [destinationUserId],
      store: "APPLE",
      occurredAt: new Date(Date.now() - MINUTE),
    });
    const receipt = await database.query.storePurchase.findFirst({
      columns: { id: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    if (!receipt) throw new Error("Missing CAS test receipt");
    await database
      .update(storePurchase)
      .set({ userId: USER })
      .where(eq(storePurchase.id, receipt.id));

    const firstConnection = await openTestDatabaseConnection();
    const secondConnection = await openTestDatabaseConnection();
    const barrierConnection = await openTestDatabaseConnection();
    const barrier = `receipt_cas_${nanoid()}`;
    const trigger = `pause_receipt_cas_${nanoid().replaceAll("-", "_")}`;
    await barrierConnection.query(`SELECT GET_LOCK('${barrier}', 10)`);
    await runRawSql(`
      CREATE TRIGGER ${trigger} BEFORE UPDATE ON StorePurchase FOR EACH ROW
      BEGIN
        IF OLD.id = '${receipt.id}' AND OLD.userId = '${USER}' AND NEW.userId = '${destinationUserId}' THEN
          SET @receipt_cas_wait = GET_LOCK('${barrier}', 10);
          SET @receipt_cas_release = RELEASE_LOCK('${barrier}');
        END IF;
      END
    `);
    try {
      const winner = reconcileStorePurchaseOwner(firstConnection.database, receipt.id);
      await barrierConnection.waitForNamedLockWaiter(barrier);
      const loser = reconcileStorePurchaseOwner(secondConnection.database, receipt.id);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);

      await expect(Promise.all([winner, loser])).resolves.toEqual([
        expect.objectContaining({ userId: destinationUserId }),
        expect.objectContaining({ userId: destinationUserId }),
      ]);
    } finally {
      await barrierConnection.query(`SELECT RELEASE_LOCK('${barrier}')`);
      await runRawSql(`DROP TRIGGER IF EXISTS ${trigger}`);
      await Promise.all([
        firstConnection.close(),
        secondConnection.close(),
        barrierConnection.close(),
      ]);
    }
  });

  it("allows ownership to transfer back after time advances", async () => {
    await insertUsers([
      { userId: DESTINATION, username: "temporary-owner", federalStatus: "NONE" },
    ]);
    const database = await db();
    const firstAt = new Date(Date.now() - MINUTE);
    const secondAt = new Date();
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: firstAt,
    });
    await transferStorePurchases(database, {
      fromUserIds: [DESTINATION],
      toUserIds: [USER],
      store: "APPLE",
      occurredAt: secondAt,
    });
    const transactionId = nanoid();
    await expect(
      grantStorePurchase(database, {
        userId: USER,
        transactionId,
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(firstAt.getTime() - MINUTE),
        raw: {},
      }),
    ).resolves.toMatchObject({ status: "granted" });
    const receipt = await database.query.storePurchase.findFirst({
      columns: { userId: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(receipt?.userId).toBe(USER);
  });

  it("orders equal-timestamp transfer edges deterministically", async () => {
    const equalDestination = "zz-equal-transfer-owner";
    await insertUsers([
      { userId: equalDestination, username: "equal-owner", federalStatus: "NONE" },
    ]);
    const database = await db();
    const occurredAt = new Date();
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [equalDestination],
      store: "APPLE",
      occurredAt,
    });
    await transferStorePurchases(database, {
      fromUserIds: [equalDestination],
      toUserIds: [USER],
      store: "APPLE",
      occurredAt,
    });
    const transactionId = nanoid();
    await grantStorePurchase(database, {
      userId: USER,
      transactionId,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: false,
      purchasedAt: new Date(occurredAt.getTime() - MINUTE),
      raw: {},
    });
    const receipt = await database.query.storePurchase.findFirst({
      columns: { userId: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(receipt?.userId).toBe(USER);
  });

  it("repairs federal status when expiration retry finds the receipt revoked", async () => {
    const database = await db();
    const transactionId = await buyFederal("GOLD", MINUTE);
    await database.execute(
      sql.raw(
        `ALTER TABLE UserData ADD CONSTRAINT fail_store_recompute CHECK (userId <> '${USER}' OR federalStatus <> 'NONE')`,
      ),
    );
    const scope = {
      occurredAt: new Date(),
      productId: "tnr_federal_gold",
      store: "APPLE" as const,
      transactionId,
    };
    try {
      await expect(revokeFederalStatus(database, USER, scope)).rejects.toThrow();
    } finally {
      await database.execute(
        sql.raw("ALTER TABLE UserData DROP CHECK fail_store_recompute"),
      );
    }
    const receipt = await database.query.storePurchase.findFirst({
      columns: { revokedAt: true },
      where: eq(storePurchase.transactionId, transactionId),
    });
    expect(receipt?.revokedAt).toBeInstanceOf(Date);
    expect(await statusOf()).toBe("GOLD");

    await revokeFederalStatus(database, USER, scope);
    expect(await statusOf()).toBe("NONE");
  });

  it("merges colliding entitlement watermarks before a user-id rename", async () => {
    const database = await db();
    const newUserId = "renamed-entitlement-user";
    const older = new Date(Date.now() - MINUTE);
    const newer = new Date();
    await database.insert(storeEntitlementState).values([
      {
        id: nanoid(),
        userId: USER,
        store: "APPLE",
        revokedThrough: newer,
      },
      {
        id: nanoid(),
        userId: newUserId,
        store: "APPLE",
        revokedThrough: older,
      },
    ]);

    await migrateStoreEntitlementStates(database, USER, newUserId);
    const states = await database.query.storeEntitlementState.findMany();
    expect(states).toHaveLength(1);
    expect(states[0]?.userId).toBe(newUserId);
    expect(states[0]?.revokedThrough.getTime()).toBe(newer.getTime());
  });

  it("carries an expiry watermark across a transfer before delayed purchase delivery", async () => {
    await insertUsers([
      { userId: DESTINATION, username: "destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const endedAt = new Date(Date.now() - MINUTE);
    await revokeFederalStatus(database, USER, {
      occurredAt: endedAt,
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    await transferStorePurchases(database, {
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: new Date(),
    });

    await expect(
      grantStorePurchase(database, {
        userId: USER,
        transactionId: nanoid(),
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(endedAt.getTime() - MINUTE),
        raw: {},
      }),
    ).resolves.toEqual({ status: "ignored", reason: "Expired purchase" });
    const [destination, receipt] = await Promise.all([
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, DESTINATION),
      }),
      database.query.storePurchase.findFirst({
        columns: { userId: true, revokedAt: true },
      }),
    ]);
    expect(destination?.federalStatus).toBe("NONE");
    expect(receipt?.userId).toBe(DESTINATION);
    expect(receipt?.revokedAt).toBeInstanceOf(Date);
  });

  it("applies expiry delivered before an older transfer to the original ownership epoch", async () => {
    await insertUsers([
      { userId: DESTINATION, username: "epoch-destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const purchasedAt = new Date(Date.now() - 3 * MINUTE);
    const transferredAt = new Date(Date.now() - 2 * MINUTE);
    const endedAt = new Date(Date.now() - MINUTE);

    // Delivery order is expiry(t2), transfer(t1), purchase(p), while event order is
    // p < t1 < t2. The expiry initially lands on the original id because the delayed
    // ownership event has not been observed yet.
    await revokeFederalStatus(database, USER, {
      eventId: "expiry-before-delayed-transfer",
      occurredAt: endedAt,
      productId: "tnr_federal_gold",
      store: "APPLE",
    });
    await transferStorePurchases(database, {
      eventId: "delayed-transfer",
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: transferredAt,
    });
    await expect(
      grantStorePurchase(database, {
        userId: USER,
        transactionId: "delayed-ended-period",
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt,
        raw: {},
      }),
    ).resolves.toEqual({ status: "ignored", reason: "Expired purchase" });
    const receipt = await database.query.storePurchase.findFirst({
      where: eq(storePurchase.transactionId, "delayed-ended-period"),
    });
    expect(receipt?.userId).toBe(DESTINATION);
    expect(receipt?.grantedAt).toBeNull();
    expect(receipt?.revokedAt).toBeInstanceOf(Date);
  });

  it("does not spill a post-transfer new-purchase expiry onto the old owner epoch", async () => {
    await insertUsers([
      { userId: DESTINATION, username: "isolated-destination", federalStatus: "NONE" },
    ]);
    const database = await db();
    const transferredAt = new Date(Date.now() - 3 * MINUTE);
    await transferStorePurchases(database, {
      eventId: "epoch-boundary-transfer",
      fromUserIds: [USER],
      toUserIds: [DESTINATION],
      store: "APPLE",
      occurredAt: transferredAt,
    });
    const newerTransactionId = "post-transfer-period";
    await grantStorePurchase(database, {
      userId: USER,
      transactionId: newerTransactionId,
      productId: "tnr_federal_gold",
      store: "APPLE",
      isSandbox: false,
      purchasedAt: new Date(transferredAt.getTime() + MINUTE),
      raw: {},
    });
    await revokeFederalStatus(database, USER, {
      eventId: "post-transfer-expiry",
      occurredAt: new Date(),
      productId: "tnr_federal_gold",
      store: "APPLE",
      transactionId: newerTransactionId,
    });

    await expect(
      grantStorePurchase(database, {
        userId: USER,
        transactionId: "old-transferred-live-period",
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(transferredAt.getTime() - MINUTE),
        expiresAt: new Date(Date.now() + DAY),
        raw: {},
      }),
    ).resolves.toMatchObject({ status: "granted" });
    const oldReceipt = await database.query.storePurchase.findFirst({
      where: eq(storePurchase.transactionId, "old-transferred-live-period"),
    });
    expect(oldReceipt?.userId).toBe(DESTINATION);
    expect(oldReceipt?.grantedAt).toBeInstanceOf(Date);
  });

  it("bulk reconciliation downgrades expired GOLD to a live store SILVER", async () => {
    const goldTransactionId = await buyFederal("GOLD");
    const database = await db();
    await database
      .update(storePurchase)
      .set({ expiresAt: new Date(Date.now() - MINUTE) })
      .where(eq(storePurchase.transactionId, goldTransactionId));
    await buyFederal("SILVER");
    expect(await statusOf()).toBe("GOLD");

    await reconcileFederalStatuses(database);
    expect(await statusOf()).toBe("SILVER");
  });

  it("bulk reconciliation downgrades expired GOLD to live PayPal NORMAL", async () => {
    const goldTransactionId = await buyFederal("GOLD");
    const database = await db();
    await database
      .update(storePurchase)
      .set({ expiresAt: new Date(Date.now() - MINUTE) })
      .where(eq(storePurchase.transactionId, goldTransactionId));
    await givePaypal("NORMAL");
    expect(await statusOf()).toBe("GOLD");

    await reconcileFederalStatuses(database);
    expect(await statusOf()).toBe("NORMAL");
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

    const firstConnection = await openTestDatabaseConnection();
    const secondConnection = await openTestDatabaseConnection();
    const outcomes = await Promise.all([
      grantStorePurchase(firstConnection.database, grant),
      grantStorePurchase(secondConnection.database, grant),
    ]).finally(async () => {
      await Promise.all([firstConnection.close(), secondConnection.close()]);
    });
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

  it("retires a delayed grant whose explicit paid-through date already ended", async () => {
    const userId = "store-grant-past-paid-through";
    const database = await db();
    const endedAt = new Date(Date.now() - MINUTE);
    await insertUsers([{ userId, username: "late-explicit", federalStatus: "NONE" }]);

    const transactionId = nanoid();
    await expect(
      grantStorePurchase(database, {
        userId,
        transactionId,
        productId: "tnr_federal_gold",
        store: "APPLE",
        isSandbox: false,
        purchasedAt: new Date(endedAt.getTime() - DAY),
        expiresAt: endedAt,
        raw: {},
      }),
    ).resolves.toEqual({ status: "ignored", reason: "Expired purchase" });

    const [receipt, user] = await Promise.all([
      database.query.storePurchase.findFirst({
        columns: { grantedAt: true, revokedAt: true, expiresAt: true },
        where: eq(storePurchase.transactionId, transactionId),
      }),
      database.query.userData.findFirst({
        columns: { federalStatus: true },
        where: eq(userData.userId, userId),
      }),
    ]);
    expect(receipt?.expiresAt?.getTime()).toBe(endedAt.getTime());
    expect(receipt?.grantedAt).toBeNull();
    expect(receipt?.revokedAt).toBeInstanceOf(Date);
    expect(user?.federalStatus).toBe("NONE");
  });

  it("allows a resubscription purchased at the recorded expiry boundary", async () => {
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
        purchasedAt: endedAt,
        raw: {},
      }),
    ).resolves.toMatchObject({ status: "granted", federalStatus: "GOLD" });
  });
});
