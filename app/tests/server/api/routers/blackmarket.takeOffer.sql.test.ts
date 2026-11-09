import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { REP_TRADE_MIN_LEVEL, RYO_CAP } from "@/drizzle/constants";
import { actionLog, ryoTrade, userData } from "@/drizzle/schema";
import { blackMarketRouter } from "@/server/api/routers/blackmarket";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const BUYER = "ryo-buyer";
const SELLER = "ryo-seller";
const RIVAL = "ryo-rival";
const OFFER = "ryo-offer";
const REPS = 10;
const RYO = 5_000;

const balances = async () => {
  const database = await getTestDatabase();
  const rows = await database
    .select({
      userId: userData.userId,
      money: userData.money,
      bank: userData.bank,
      reputationPoints: userData.reputationPoints,
    })
    .from(userData);
  return Object.fromEntries(rows.map(({ userId, ...row }) => [userId, row]));
};

const purchaser = async () =>
  (
    await (
      await getTestDatabase()
    ).query.ryoTrade.findFirst({ where: eq(ryoTrade.id, OFFER) })
  )?.purchaserUserId;

const logs = async () =>
  (await (await getTestDatabase()).select().from(actionLog)).map(
    (log) => log.relatedMsg,
  );

/** Buy the offer through a client that runs `race` just before the first write touching RyoTrade. */
const takeOfferAfter = async (race?: () => Promise<unknown>) => {
  const database = await getTestDatabase();
  const client = race ? beforeStatements(database, ryoTrade, [race]) : database;
  return callerForDatabase(blackMarketRouter, BUYER, client).takeOffer({
    offerId: OFFER,
  });
};

describeWithDatabase("blackmarket.takeOffer", () => {
  beforeEach(async () => {
    await resetTables(actionLog, ryoTrade, userData);
    await insertUsers([
      {
        userId: BUYER,
        username: "Buyer",
        level: REP_TRADE_MIN_LEVEL,
        money: RYO,
        reputationPoints: 0,
      },
      {
        userId: SELLER,
        username: "Seller",
        level: REP_TRADE_MIN_LEVEL,
        bank: 100,
        reputationPoints: 0,
      },
      { userId: RIVAL, username: "Rival", level: REP_TRADE_MIN_LEVEL, money: RYO },
    ]);
    await (await getTestDatabase()).insert(ryoTrade).values({
      id: OFFER,
      creatorUserId: SELLER,
      repsForSale: REPS,
      requestedRyo: RYO,
      ryoPerRep: RYO / REPS,
    });
  });

  it("moves the ryo and reputation and claims the offer", async () => {
    const before = await balances();
    const result = await takeOfferAfter();
    expect(result).toMatchObject({
      success: true,
      message: `Bought ${REPS} reputation points for ${RYO} ryo.`,
    });
    expect(await balances()).toEqual({
      ...before,
      [BUYER]: { ...before[BUYER]!, money: 0, reputationPoints: REPS },
      [SELLER]: { ...before[SELLER]!, bank: 100 + RYO },
    });
    expect(await purchaser()).toBe(BUYER);
    expect(await logs()).toEqual([`Trade completed: ${RYO} ryo`]);
  });

  it("rejects before writing when the seller's bank cannot hold the payment", async () => {
    await (await getTestDatabase())
      .update(userData)
      .set({ bank: RYO_CAP })
      .where(eq(userData.userId, SELLER));
    const before = await balances();
    const result = await takeOfferAfter();
    expect(result).toEqual({
      success: false,
      message: "Seller's bank is at capacity - trade cannot proceed",
    });
    expect(await balances()).toEqual(before);
    expect(await purchaser()).toBeNull();
  });

  it("rejects before writing when the seller's account is gone", async () => {
    await (await getTestDatabase()).delete(userData).where(eq(userData.userId, SELLER));
    const before = await balances();
    const result = await takeOfferAfter();
    expect(result).toEqual({
      success: false,
      message: "Seller account no longer exists",
    });
    expect(await balances()).toEqual(before);
    expect(await purchaser()).toBeNull();
  });

  it("moves nothing when another buyer claims the offer first", async () => {
    const database = await getTestDatabase();
    const before = await balances();
    const result = await takeOfferAfter(() =>
      database
        .update(ryoTrade)
        .set({ purchaserUserId: RIVAL })
        .where(eq(ryoTrade.id, OFFER)),
    );
    expect(result).toEqual({
      success: false,
      message: "The offer was taken or a balance changed. Please try again",
    });
    expect(await balances()).toEqual(before);
    expect(await purchaser()).toBe(RIVAL);
    expect(await logs()).toEqual([]);
  });

  it("moves nothing when the buyer's pocket drains before the trade", async () => {
    const database = await getTestDatabase();
    const before = await balances();
    const result = await takeOfferAfter(() =>
      database
        .update(userData)
        .set({ money: RYO - 1 })
        .where(eq(userData.userId, BUYER)),
    );
    const after = await balances();
    expect(result).toEqual({
      success: false,
      message: "The offer was taken or a balance changed. Please try again",
    });
    expect(after).toEqual({
      ...before,
      [BUYER]: { ...before[BUYER]!, money: RYO - 1 },
    });
    expect(await purchaser()).toBeNull();
    expect(await logs()).toEqual([]);
  });

  it("moves nothing when the seller's bank fills before the trade", async () => {
    const database = await getTestDatabase();
    const before = await balances();
    const result = await takeOfferAfter(() =>
      database
        .update(userData)
        .set({ bank: RYO_CAP - RYO + 1 })
        .where(eq(userData.userId, SELLER)),
    );
    const after = await balances();
    expect(result).toEqual({
      success: false,
      message: "The offer was taken or a balance changed. Please try again",
    });
    expect(after).toEqual({
      ...before,
      [SELLER]: { ...before[SELLER]!, bank: RYO_CAP - RYO + 1 },
    });
    expect(await purchaser()).toBeNull();
    expect(await logs()).toEqual([]);
  });
});
