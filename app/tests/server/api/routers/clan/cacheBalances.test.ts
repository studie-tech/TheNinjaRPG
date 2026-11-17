import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  CLAN_BOOST_CONFIG,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CLAN_POINT_RYO_RATE,
  FACTION_REPUTATION_TREASURY_LIMIT,
} from "@/drizzle/constants";
import { actionLog, clan, userData, userQueue } from "@/drizzle/schema";
import { clanRouter } from "@/server/api/routers/clan";
import { insertClans, insertUsers } from "../../../../setup/factories";
import { queueEnergy } from "../../../../setup/queues";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describe("clan committed cache responses", () => {
  const databaseFor = (userDelta: object, clanUpdate: object) => ({
    query: {
      userData: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            userId: "clan-cache-user",
            clanId: "clan-cache-clan",
            money: 1000,
            reputationPoints: 100,
            isOutlaw: true,
          })
          .mockResolvedValueOnce(userDelta),
      },
      clan: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "clan-cache-clan",
            repTreasury: FACTION_REPUTATION_TREASURY_LIMIT - 10,
          })
          .mockResolvedValueOnce(clanUpdate),
      },
    },
    execute: vi.fn(async () => ({ rowsAffected: 2 })),
    insert: vi.fn(() => ({ values: async () => ({ rowsAffected: 1 }) })),
  });

  it("returns the confirmed transfer without reading the actor balance", async () => {
    const database = databaseFor({ money: 700 }, { id: "clan-cache-clan", bank: 800 });
    const caller = callerForDatabase(clanRouter, "clan-cache-user", database as never);
    const result = await caller.toBank({ clanId: "clan-cache-clan", amount: 250 });
    expect(result).toMatchObject({
      success: true,
      userDelta: { money: -250, clan: { id: "clan-cache-clan", bank: 250 } },
      clanDelta: { id: "clan-cache-clan", bank: 250 },
    });
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.clan.findFirst).toHaveBeenCalledTimes(1);
  });

  for (const amount of [0.5, 1.5, 1.6]) {
    it(`rejects a fractional deposit of ${amount} before reading or writing balances`, async () => {
      const database = databaseFor({}, {});
      const caller = callerForDatabase(
        clanRouter,
        "clan-cache-user",
        database as never,
      );
      await expect(
        caller.toBank({ clanId: "clan-cache-clan", amount }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(database.query.userData.findFirst).not.toHaveBeenCalled();
      expect(database.query.clan.findFirst).not.toHaveBeenCalled();
      expect(database.execute).not.toHaveBeenCalled();
      expect(database.insert).not.toHaveBeenCalled();
    });
  }

  it("returns the capped confirmed donation without reading the actor balance", async () => {
    const database = databaseFor(
      { reputationPoints: 85 },
      { id: "clan-cache-clan", repTreasury: FACTION_REPUTATION_TREASURY_LIMIT },
    );
    const caller = callerForDatabase(clanRouter, "clan-cache-user", database as never);
    const result = await caller.clanDonate({
      clanId: "clan-cache-clan",
      reputationPoints: 50,
    });
    expect(result).toMatchObject({
      success: true,
      userDelta: {
        reputationPoints: -10,
        clan: { id: "clan-cache-clan", repTreasury: 10 },
      },
      clanDelta: { id: "clan-cache-clan", repTreasury: 10 },
    });
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.clan.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("clan missing bank rejection", () => {
  it("returns no cache changes when the joined deposit moves nothing", async () => {
    const database = {
      query: {
        userData: {
          findFirst: vi.fn().mockResolvedValue({
            userId: "gone-bank-user",
            clanId: "gone-bank",
            money: 100,
            isBanned: false,
          }),
        },
        clan: { findFirst: vi.fn().mockResolvedValue({ id: "gone-bank" }) },
      },
      execute: vi.fn(async () => ({ rowsAffected: 0 })),
      update: vi.fn(),
    };
    const caller = callerForDatabase(clanRouter, "gone-bank-user", database as never);
    const result = await caller.toBank({ clanId: "gone-bank", amount: 25 });
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(result.userPatch?.clan).toBeUndefined();
    expect(result.clanDelta).toBeUndefined();
    expect(database.execute).toHaveBeenCalledTimes(1);
    expect(database.update).not.toHaveBeenCalled();
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.clan.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("clan zero-cost cache responses", () => {
  for (const [endpoint, requested, treasury] of [
    ["clanDonate", 50, FACTION_REPUTATION_TREASURY_LIMIT],
    ["toBank", 0, 0],
  ] as const) {
    it.each([false, true])(
      `${endpoint} confirms no changes for ${requested} requested with treasury ${treasury} and queued training=%s`,
      async (hasTraining) => {
        const userRead = vi.fn().mockResolvedValue({
          userId: "clan-zero-user",
          energyQueueHead: 0,
          energyQueueTail: hasTraining ? 1 : 0,
          clanId: "clan-zero-clan",
          money: 100,
          reputationPoints: 100,
          isOutlaw: true,
          isBanned: false,
        });
        const clanRead = vi.fn().mockResolvedValue({
          id: "clan-zero-clan",
          repTreasury: treasury,
        });
        const database = {
          query: { userData: { findFirst: userRead }, clan: { findFirst: clanRead } },
          execute: vi.fn(async () => ({ rowsAffected: 2 })),
          insert: vi.fn(() => ({ values: async () => ({ rowsAffected: 1 }) })),
        };
        const caller = callerForDatabase(
          clanRouter,
          "clan-zero-user",
          database as never,
        );
        const result = await (endpoint === "clanDonate"
          ? caller.clanDonate({ clanId: "clan-zero-clan", reputationPoints: requested })
          : caller.toBank({ clanId: "clan-zero-clan", amount: 0 }));
        expect(result.success).toBe(true);
        expect(result.userDelta).toEqual({});
        expect(result.userPatch).toEqual({});
        expect(result.clanDelta).toEqual({ id: "clan-zero-clan" });
        expect(userRead).toHaveBeenCalledTimes(1);
        expect(clanRead).toHaveBeenCalledTimes(1);
        expect(database.execute).not.toHaveBeenCalled();
        expect(database.insert).not.toHaveBeenCalled();
      },
    );
  }
});

describeWithDatabase("clan mutation cache balances", () => {
  beforeEach(async () => {
    await resetTables(userQueue, actionLog, clan, userData);
    await insertUsers([
      {
        userId: "clan-cache-user",
        clanId: "clan-cache-clan",
        villageId: "clan-cache-village",
        money: 1000,
        reputationPoints: 100,
        isOutlaw: true,
      },
    ]);
    await insertClans([
      {
        id: "clan-cache-clan",
        name: "Cache Clan",
        leaderId: "clan-cache-user",
        villageId: "clan-cache-village",
        bank: 500,
        repTreasury: FACTION_REPUTATION_TREASURY_LIMIT - 10,
      },
    ]);
  });

  it("returns both confirmed deltas after depositing ryo", async () => {
    const caller = await callerFor(clanRouter, "clan-cache-user");
    const result = await caller.toBank({ clanId: "clan-cache-clan", amount: 250 });
    expect(result).toMatchObject({
      success: true,
      userDelta: { money: -250, clan: { id: "clan-cache-clan", bank: 250 } },
      clanDelta: { id: "clan-cache-clan", bank: 250 },
    });
  });

  it("returns the capped actual donation rather than the requested charge", async () => {
    const caller = await callerFor(clanRouter, "clan-cache-user");
    const result = await caller.clanDonate({
      clanId: "clan-cache-clan",
      reputationPoints: 50,
    });
    expect(result).toMatchObject({
      success: true,
      userDelta: {
        reputationPoints: -10,
        clan: { id: "clan-cache-clan", repTreasury: 10 },
      },
      clanDelta: { id: "clan-cache-clan", repTreasury: 10 },
    });
  });

  for (const endpoint of ["toBank", "clanDonate"] as const) {
    it(`${endpoint} keeps profile refreshes for a pending energy queue`, async () => {
      await queueEnergy("clan-cache-user", [{ stat: "offence", energy: 10 }]);
      const caller = await callerFor(clanRouter, "clan-cache-user");
      const result = await (endpoint === "toBank"
        ? caller.toBank({ clanId: "clan-cache-clan", amount: 250 })
        : caller.clanDonate({ clanId: "clan-cache-clan", reputationPoints: 50 }));
      expect(result.success).toBe(true);
      expect(result.userDelta).toBeUndefined();
      expect(result.userPatch?.clan).toBeUndefined();
      expect(result.clanDelta).toEqual(
        endpoint === "toBank"
          ? { id: "clan-cache-clan", bank: 250 }
          : { id: "clan-cache-clan", repTreasury: 10 },
      );
    });
  }

  afterEach(() => vi.restoreAllMocks());

  it("moves nothing and keeps an independent currency grant when the clan is gone", async () => {
    const db = await getTestDatabase();
    const actualRead = db.query.clan.findFirst.bind(db.query.clan);
    const reads = vi.spyOn(db.query.clan, "findFirst").mockImplementation((async (
      config: Parameters<typeof actualRead>[0],
    ) => {
      const snapshot = await actualRead(config);
      await db.delete(clan).where(eq(clan.id, "clan-cache-clan"));
      await db
        .update(userData)
        .set({ money: sql`${userData.money} + 7` })
        .where(eq(userData.userId, "clan-cache-user"));
      return snapshot;
    }) as never);
    const caller = await callerFor(clanRouter, "clan-cache-user");
    const result = await caller.toBank({ clanId: "clan-cache-clan", amount: 25 });
    expect(result.success).toBe(false);
    expect(result.message).toBe(
      "Ryo was not deposited; refresh the clan and check your pocket and membership",
    );
    expect(result.userDelta).toBeUndefined();
    expect(result.userPatch?.clan).toBeUndefined();
    expect(result.clanDelta).toBeUndefined();
    expect(reads).toHaveBeenCalledTimes(1);
    const stored = await db.query.userData.findFirst({
      where: eq(userData.userId, "clan-cache-user"),
    });
    expect(stored?.money).toBe(1007);
  });

  it("does not return a successful cache patch after rejecting insufficient funds", async () => {
    const caller = await callerFor(clanRouter, "clan-cache-user");
    const result = await caller.toBank({ clanId: "clan-cache-clan", amount: 1001 });
    expect(result.success).toBe(false);
    expect(result.clanDelta).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(result.userPatch?.clan).toBeUndefined();
  });
});

describeWithDatabase("clan treasury deltas", () => {
  const boostCost = CLAN_BOOST_CONFIG.trainingBoost.baseCost;
  const leaderOn = (database: Awaited<ReturnType<typeof getTestDatabase>>) =>
    callerForDatabase(clanRouter, "treasury-leader", database);
  const readClan = async () => {
    const database = await getTestDatabase();
    const [row] = await database
      .select({
        bank: clan.bank,
        points: clan.points,
        trainingBoost: clan.trainingBoost,
      })
      .from(clan)
      .where(eq(clan.id, "treasury-clan"));
    return row;
  };

  beforeEach(async () => {
    await resetTables(clan, userData);
    await insertUsers([
      {
        userId: "treasury-leader",
        clanId: "treasury-clan",
        villageId: "treasury-village",
        money: 1000,
      },
    ]);
    await insertClans([
      {
        id: "treasury-clan",
        leaderId: "treasury-leader",
        villageId: "treasury-village",
        bank: boostCost * 2,
        points: 10,
      },
    ]);
  });

  it("returns the committed boost purchase as a clan delta", async () => {
    const caller = await callerFor(clanRouter, "treasury-leader");
    const result = await caller.purchaseBoost({
      clanId: "treasury-clan",
      boostType: "trainingBoost",
    });
    expect(result).toEqual({
      success: true,
      message: "Training boost purchased",
      clanDelta: {
        id: "treasury-clan",
        bank: -boostCost,
        trainingBoost: CLAN_BOOST_PERCENT_PER_LEVEL,
      },
    });
    expect(await readClan()).toEqual({
      bank: boostCost,
      points: 10,
      trainingBoost: CLAN_BOOST_PERCENT_PER_LEVEL,
    });
  });

  it("returns no clan delta when another purchase raised the boost after the read", async () => {
    const database = await getTestDatabase();
    const racing = beforeStatements(database, clan, [
      () =>
        leaderOn(database).purchaseBoost({
          clanId: "treasury-clan",
          boostType: "trainingBoost",
        }),
    ]);
    const result = await leaderOn(racing).purchaseBoost({
      clanId: "treasury-clan",
      boostType: "trainingBoost",
    });
    expect(result.success).toBe(false);
    expect(result.clanDelta).toBeUndefined();
    expect(await readClan()).toEqual({
      bank: boostCost,
      points: 10,
      trainingBoost: CLAN_BOOST_PERCENT_PER_LEVEL,
    });
  });

  it("returns the committed point conversion as a clan delta", async () => {
    const caller = await callerFor(clanRouter, "treasury-leader");
    const result = await caller.convertPointsToRyo({
      clanId: "treasury-clan",
      points: 4,
    });
    expect(result).toMatchObject({
      success: true,
      clanDelta: { id: "treasury-clan", points: -4, bank: 4 * CLAN_POINT_RYO_RATE },
    });
    expect(await readClan()).toMatchObject({
      bank: boostCost * 2 + 4 * CLAN_POINT_RYO_RATE,
      points: 6,
    });
  });

  it("returns no clan delta when another conversion spent the points after the read", async () => {
    const database = await getTestDatabase();
    const racing = beforeStatements(database, clan, [
      () =>
        leaderOn(database).convertPointsToRyo({ clanId: "treasury-clan", points: 8 }),
    ]);
    const result = await leaderOn(racing).convertPointsToRyo({
      clanId: "treasury-clan",
      points: 4,
    });
    expect(result.success).toBe(false);
    expect(result.clanDelta).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await readClan()).toMatchObject({
      bank: boostCost * 2 + 8 * CLAN_POINT_RYO_RATE,
      points: 2,
    });
  });
});
