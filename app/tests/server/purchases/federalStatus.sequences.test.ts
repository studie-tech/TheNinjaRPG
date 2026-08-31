// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  paypalSubscription,
  storePurchase,
  userData,
} from "@/drizzle/schema";
import type { FederalStatus, StorePlatform } from "@/drizzle/constants";
import {
  federalStatusWithStoreFloor,
  grantStorePurchase,
  revokeFederalStatus,
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
    raw: {},
  });
  if (agoMs > 0) {
    // Only the receipt just written. Backdating every row for the user would flatten the
    // timestamps these sequences turn on, and the upgrade case would pass without ever
    // having two receipts at different moments.
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
    await resetTables(storePurchase, paypalSubscription, userData);
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
    const next = await federalStatusWithStoreFloor(await db(), USER, "NONE");
    expect(next).toBe("NONE");
  });

  it("keeps a live store subscription safe from a PayPal writer", async () => {
    await buyFederal("GOLD");
    const next = await federalStatusWithStoreFloor(await db(), USER, "NONE");
    expect(next).toBe("GOLD");
  });

  it("stops vouching once the receipt is older than the grace window", async () => {
    await buyFederal("GOLD", 70 * DAY);
    const next = await federalStatusWithStoreFloor(await db(), USER, "NONE");
    expect(next).toBe("NONE");
  });

  it("still vouches inside the billing-retry grace window", async () => {
    // A renewal that failed 40 days ago is still within the store's retry period.
    await buyFederal("GOLD", 40 * DAY);
    const next = await federalStatusWithStoreFloor(await db(), USER, "NONE");
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
      raw: {},
    });
    // Recorded for the audit trail, but never accepted, so nothing vouches for a tier.
    expect(await federalStatusWithStoreFloor(await db(), USER, "NONE")).toBe("NONE");
  });

  it("is idempotent when the same expiry is delivered twice", async () => {
    await givePaypal("NORMAL");
    await buyFederal("GOLD", MINUTE);
    const at = new Date();
    await revokeFederalStatus(await db(), USER, { occurredAt: at });
    await revokeFederalStatus(await db(), USER, { occurredAt: at });
    expect(await statusOf()).toBe("NORMAL");
  });
});
