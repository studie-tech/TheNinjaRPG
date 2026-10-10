// @vitest-environment node

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HIDEOUT_TOWN_UPGRADE } from "@/drizzle/constants";
import { actionLog, clan, userData, userQueue } from "@/drizzle/schema";
import { clanRouter } from "@/server/api/routers/clan";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { queueEnergy } from "../../setup/queues";

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
            repTreasury: HIDEOUT_TOWN_UPGRADE - 10,
          })
          .mockResolvedValueOnce(clanUpdate),
      },
    },
    update: vi.fn(() => ({
      set: () => ({ where: async () => ({ rowsAffected: 1 }) }),
    })),
    insert: vi.fn(() => ({ values: async () => ({ rowsAffected: 1 }) })),
  });

  it("returns the confirmed transfer without reading the actor balance", async () => {
    const database = databaseFor({ money: 700 }, { id: "clan-cache-clan", bank: 800 });
    const caller = callerForDatabase(clanRouter, "clan-cache-user", database as never);
    const result = await caller.toBank({ clanId: "clan-cache-clan", amount: 250 });
    expect(result).toMatchObject({
      success: true,
      userDelta: { money: -250, clan: { id: "clan-cache-clan", bank: 250 } },
    });
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.clan.findFirst).toHaveBeenCalledTimes(1);
  });

  for (const amount of [0.5, 1.5, 1.6]) {
    it(`rejects a fractional deposit of ${amount} before reading or writing balances`, async () => {
      const database = databaseFor({}, {});
      const caller = callerForDatabase(clanRouter, "clan-cache-user", database as never);
      await expect(
        caller.toBank({ clanId: "clan-cache-clan", amount }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(database.query.userData.findFirst).not.toHaveBeenCalled();
      expect(database.query.clan.findFirst).not.toHaveBeenCalled();
      expect(database.update).not.toHaveBeenCalled();
      expect(database.insert).not.toHaveBeenCalled();
    });
  }

  it("returns the capped confirmed donation without reading the actor balance", async () => {
    const database = databaseFor(
      { reputationPoints: 85 },
      { id: "clan-cache-clan", repTreasury: HIDEOUT_TOWN_UPGRADE },
    );
    const caller = callerForDatabase(clanRouter, "clan-cache-user", database as never);
    const result = await caller.clanDonate({
      clanId: "clan-cache-clan",
      reputationPoints: 50,
    });
    expect(result).toMatchObject({
      success: true,
      userDelta: { reputationPoints: -10, clan: { id: "clan-cache-clan", repTreasury: 10 } },
    });
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.clan.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("clan missing bank rejection", () => {
  it("refunds a debit when the clan credit did not commit", async () => {
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
      update: vi.fn((table: unknown) => ({
        set: () => ({ where: async () => ({ rowsAffected: table === clan ? 0 : 1 }) }),
      })),
    };
    const caller = callerForDatabase(clanRouter, "gone-bank-user", database as never);
    const result = await caller.toBank({ clanId: "gone-bank", amount: 25 });
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(result.userPatch?.clan).toBeUndefined();
    expect(database.update.mock.calls.map(([table]) => table)).toEqual([
      userData,
      clan,
      userData,
    ]);
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.clan.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("clan zero-cost cache responses", () => {
  for (const [endpoint, requested, treasury] of [
    ["clanDonate", 0, 0],
    ["clanDonate", 50, HIDEOUT_TOWN_UPGRADE],
    ["toBank", 0, 0],
  ] as const) {
    it(`${endpoint} skips reads and writes for ${requested} requested with treasury ${treasury}`, async () => {
      const userRead = vi.fn().mockResolvedValue({
        userId: "clan-zero-user",
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
        update: vi.fn(() => ({
          set: () => ({ where: async () => ({ rowsAffected: 1 }) }),
        })),
        insert: vi.fn(() => ({ values: async () => ({ rowsAffected: 1 }) })),
      };
      const caller = callerForDatabase(clanRouter, "clan-zero-user", database as never);
      const result = await (endpoint === "clanDonate"
        ? caller.clanDonate({ clanId: "clan-zero-clan", reputationPoints: requested })
        : caller.toBank({ clanId: "clan-zero-clan", amount: 0 }));
      expect(result).toMatchObject({
        success: true,
        userDelta: {},
        userPatch: { clan: { id: "clan-zero-clan" } },
      });
      expect(userRead).toHaveBeenCalledTimes(1);
      expect(clanRead).toHaveBeenCalledTimes(1);
      expect(database.update).not.toHaveBeenCalled();
      expect(database.insert).not.toHaveBeenCalled();
    });
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
    const database = await getTestDatabase();
    await database.insert(clan).values({
      id: "clan-cache-clan",
      name: "Cache Clan",
      image: "/clan.png",
      founderId: "clan-cache-user",
      leaderId: "clan-cache-user",
      leaderOrderId: "clan-cache-order",
      villageId: "clan-cache-village",
      bank: 500,
      repTreasury: HIDEOUT_TOWN_UPGRADE - 10,
    });
  });

  it("returns both confirmed deltas after depositing ryo", async () => {
    const caller = await callerFor(clanRouter, "clan-cache-user");
    const result = await caller.toBank({ clanId: "clan-cache-clan", amount: 250 });
    expect(result).toMatchObject({
      success: true,
      userDelta: { money: -250, clan: { id: "clan-cache-clan", bank: 250 } },
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
      userDelta: { reputationPoints: -10, clan: { id: "clan-cache-clan", repTreasury: 10 } },
    });
  });

  for (const endpoint of ["toBank", "clanDonate"] as const) {
    it(`${endpoint} keeps profile refreshes for a pending energy queue`, async () => {
      const db = await getTestDatabase();
      await queueEnergy("clan-cache-user", [{ stat: "offence", energy: 10 }]);
      const caller = await callerFor(clanRouter, "clan-cache-user");
      const result = await (endpoint === "toBank"
        ? caller.toBank({ clanId: "clan-cache-clan", amount: 250 })
        : caller.clanDonate({ clanId: "clan-cache-clan", reputationPoints: 50 }));
      expect(result.success).toBe(true);
      expect(result.userDelta).toBeUndefined();
      expect(result.userPatch?.clan).toBeUndefined();
    });
  }

  afterEach(() => vi.restoreAllMocks());

  it("refunds the deposit without erasing an independent currency grant", async () => {
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
    expect(result.message).toContain("refunded");
    expect(result.userDelta).toBeUndefined();
    expect(result.userPatch?.clan).toBeUndefined();
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
    expect(result.userDelta).toBeUndefined();
    expect(result.userPatch?.clan).toBeUndefined();
  });
});
