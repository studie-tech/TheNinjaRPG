// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HIDEOUT_TOWN_UPGRADE } from "@/drizzle/constants";
import { actionLog, clan, userData } from "@/drizzle/schema";
import { clanRouter } from "@/server/api/routers/clan";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

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
      userDelta: { money: -250 },
      clanUpdate: { id: "clan-cache-clan", bank: 800 },
    });
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.clan.findFirst).toHaveBeenCalledTimes(2);
  });

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
      userDelta: { reputationPoints: -10 },
      clanUpdate: { id: "clan-cache-clan", repTreasury: HIDEOUT_TOWN_UPGRADE },
    });
    expect(database.query.userData.findFirst).toHaveBeenCalledTimes(1);
    expect(database.query.clan.findFirst).toHaveBeenCalledTimes(2);
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
    expect(result.clanUpdate).toBeUndefined();
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
        clanUpdate: { id: "clan-zero-clan" },
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
    await resetTables(actionLog, clan, userData);
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

  it("returns both committed balances after depositing ryo", async () => {
    const caller = await callerFor(clanRouter, "clan-cache-user");
    const result = await caller.toBank({ clanId: "clan-cache-clan", amount: 250 });
    expect(result).toMatchObject({
      success: true,
      userDelta: { money: -250 },
      clanUpdate: { id: "clan-cache-clan", bank: 750 },
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
      userDelta: { reputationPoints: -10 },
      clanUpdate: { id: "clan-cache-clan", repTreasury: HIDEOUT_TOWN_UPGRADE },
    });
  });

  for (const endpoint of ["toBank", "clanDonate"] as const) {
    it(`${endpoint} keeps profile refreshes for a pending energy queue`, async () => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ energyTrainingQueue: [{ stat: "offence", energy: 10 }] })
        .where(eq(userData.userId, "clan-cache-user"));
      const caller = await callerFor(clanRouter, "clan-cache-user");
      const result = await (endpoint === "toBank"
        ? caller.toBank({ clanId: "clan-cache-clan", amount: 250 })
        : caller.clanDonate({ clanId: "clan-cache-clan", reputationPoints: 50 }));
      expect(result.success).toBe(true);
      expect(result.userDelta).toBeUndefined();
      expect(result.clanUpdate).toBeUndefined();
    });
  }

  it("does not return a successful cache patch after rejecting insufficient funds", async () => {
    const caller = await callerFor(clanRouter, "clan-cache-user");
    const result = await caller.toBank({ clanId: "clan-cache-clan", amount: 1001 });
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(result.clanUpdate).toBeUndefined();
  });
});
