import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { paypalSubscription, userData } from "@/drizzle/schema";
import { paypalRouter } from "@/server/api/routers/paypal";
import { calcFedUgradeCost, fedStatusRepsCost } from "@/utils/paypal";
import { insertUsers } from "../../../setup/factories";
import type { DrizzleClient } from "@/server/db";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** Reputation-funded subscriptions charge once per entitlement, even under concurrent requests. */
const BUYER = "reps-buyer";
const GIFTEE = "reps-giftee";
const ATTEMPTS = 5;

const readUser = async (userId: string) =>
  (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, userId) });
const readSubscriptions = async () =>
  (await getTestDatabase()).query.paypalSubscription.findMany();

/** A client whose user reads still show the giftee without a subscription. */
const staleGifteeClient = (database: DrizzleClient): DrizzleClient =>
  new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "query") return Reflect.get(target, property, receiver);
      const findFirst: typeof target.query.userData.findFirst = (async (
        ...args: Parameters<typeof target.query.userData.findFirst>
      ) => {
        const row = await target.query.userData.findFirst(...args);
        return row?.userId === GIFTEE ? { ...row, federalStatus: "NONE" } : row;
      }) as unknown as typeof target.query.userData.findFirst;
      return { ...target.query, userData: { findFirst } };
    },
  });

describeWithDatabase("reputation-funded subscriptions", () => {
  beforeEach(async () => {
    await resetTables(paypalSubscription, userData);
  });

  it("charges a single purchase when concurrent requests buy the same entitlement", async () => {
    const cost = fedStatusRepsCost("GOLD");
    await insertUsers([
      { userId: BUYER, username: BUYER, reputationPoints: cost * ATTEMPTS },
    ]);
    const caller = await callerFor(paypalRouter, BUYER);
    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () =>
        caller.subscribeWithReps({ expectedUserId: BUYER, userId: BUYER, status: "GOLD" }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => result.success)).toMatchObject({ userDelta: { reputationPoints: -cost }, userPatch: { federalStatus: "GOLD" } });
    expect(await readUser(BUYER)).toMatchObject({
      federalStatus: "GOLD",
      reputationPoints: cost * (ATTEMPTS - 1),
    });
    expect(await readSubscriptions()).toHaveLength(1);
  });

  it("never overdraws reputation when concurrent gifts exceed the balance", async () => {
    const cost = fedStatusRepsCost("NORMAL");
    const giftees = Array.from({ length: ATTEMPTS }, (_, index) => `${GIFTEE}-${index}`);
    await insertUsers([
      { userId: BUYER, username: BUYER, reputationPoints: cost },
      ...giftees.map((userId) => ({ userId, username: userId })),
    ]);
    const caller = await callerFor(paypalRouter, BUYER);
    const results = await Promise.all(
      giftees.map((userId) => caller.subscribeWithReps({ expectedUserId: BUYER, userId, status: "NORMAL" })),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => result.success)).toMatchObject({ userDelta: { reputationPoints: -cost }, userPatch: {} });
    expect(await readUser(BUYER)).toMatchObject({ reputationPoints: 0 });
    const subscriptions = await readSubscriptions();
    expect(subscriptions).toHaveLength(1);
    const granted = await Promise.all(giftees.map(readUser));
    expect(granted.filter((user) => user?.federalStatus === "NORMAL")).toHaveLength(1);
    expect(granted.find((user) => user?.federalStatus === "NORMAL")?.userId).toBe(
      subscriptions[0]?.affectedUserId,
    );
  });

  it("rolls back the charge when the target already holds a subscription", async () => {
    const cost = fedStatusRepsCost("SILVER");
    await insertUsers([
      { userId: BUYER, username: BUYER, reputationPoints: cost },
      { userId: GIFTEE, username: GIFTEE, federalStatus: "NONE" },
    ]);
    // The giftee subscribes after the read: the router sees NONE, the row holds NORMAL
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ federalStatus: "NORMAL" })
      .where(eq(userData.userId, GIFTEE));
    const caller = callerForDatabase(paypalRouter, BUYER, staleGifteeClient(database));
    const result = await caller.subscribeWithReps({ expectedUserId: BUYER, userId: GIFTEE, status: "SILVER" });
    expect(result.success).toBe(false);
    expect(await readUser(BUYER)).toMatchObject({ reputationPoints: cost });
    expect(await readSubscriptions()).toHaveLength(0);
  });

  it("charges one upgrade when concurrent requests upgrade the same subscription", async () => {
    const cost = calcFedUgradeCost("NORMAL", "GOLD") ?? 0;
    await insertUsers([
      {
        userId: BUYER,
        username: BUYER,
        federalStatus: "NORMAL",
        reputationPoints: cost * ATTEMPTS,
        reputationPointsTotal: cost * ATTEMPTS,
      },
    ]);
    await (await getTestDatabase()).insert(paypalSubscription).values({
      id: "reps-subscription",
      createdById: BUYER,
      affectedUserId: BUYER,
      federalStatus: "NORMAL",
      subscriptionId: "reps-subscription",
      status: "ACTIVE",
    });
    const caller = await callerFor(paypalRouter, BUYER);
    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () =>
        caller.upgradeSubscription({ userId: BUYER, plan: "GOLD" }),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => result.success)).toMatchObject({ userPatch: { federalStatus: "GOLD", reputationPoints: cost * (ATTEMPTS - 1), reputationPointsTotal: cost * (ATTEMPTS - 1) }, userDelta: {} });
    expect(await readUser(BUYER)).toMatchObject({
      federalStatus: "GOLD",
      reputationPoints: cost * (ATTEMPTS - 1),
      reputationPointsTotal: cost * (ATTEMPTS - 1),
    });
    expect(await readSubscriptions()).toEqual([
      expect.objectContaining({ federalStatus: "GOLD" }),
    ]);
  });

  it("rejects an upgrade without debiting when the balance is short", async () => {
    const cost = calcFedUgradeCost("SILVER", "GOLD") ?? 0;
    await insertUsers([
      { userId: BUYER, username: BUYER, federalStatus: "SILVER", reputationPoints: cost - 1 },
    ]);
    await (await getTestDatabase()).insert(paypalSubscription).values({
      id: "reps-subscription",
      createdById: BUYER,
      affectedUserId: BUYER,
      federalStatus: "SILVER",
      subscriptionId: "reps-subscription",
      status: "ACTIVE",
    });
    const caller = await callerFor(paypalRouter, BUYER);
    const result = await caller.upgradeSubscription({ userId: BUYER, plan: "GOLD" });
    expect(result.success).toBe(false);
    expect(await readUser(BUYER)).toMatchObject({
      federalStatus: "SILVER",
      reputationPoints: cost - 1,
    });
    expect(await readSubscriptions()).toEqual([
      expect.objectContaining({ federalStatus: "SILVER" }),
    ]);
  });
});
