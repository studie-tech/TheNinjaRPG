import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import {
  COST_CHANGE_GENDER,
  COST_CHANGE_USERNAME,
  COST_CUSTOM_TITLE,
  getTavernColorChangeCost,
} from "@/drizzle/constants";
import { actionLog, userData, village } from "@/drizzle/schema";
import { blackMarketRouter } from "@/server/api/routers/blackmarket";
import { occupationRouter } from "@/server/api/routers/occupation";
import { profileRouter } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { countUserReads } from "../../setup/userReads";

const userId = "cosmetic-cache-user";
const reputationPoints = 100;
const purchases = [
  {
    name: "username",
    run: (client: DrizzleClient) => callerForDatabase(profileRouter, userId, client)
      .updateUsername({ username: "CacheName" }),
    userPatch: { username: "CacheName", reputationPoints: reputationPoints - COST_CHANGE_USERNAME },
    reads: 2,
  },
  {
    name: "custom title",
    run: (client: DrizzleClient) => callerForDatabase(blackMarketRouter, userId, client)
      .updateCustomTitle({ title: "Cache Fixture" }),
    userPatch: { customTitle: "Cache Fixture", reputationPoints: reputationPoints - COST_CUSTOM_TITLE },
    reads: 1,
  },
  {
    name: "gender",
    run: (client: DrizzleClient) => callerForDatabase(blackMarketRouter, userId, client)
      .changeUserGender({ gender: "Female" }),
    userPatch: { gender: "Female", reputationPoints: reputationPoints - COST_CHANGE_GENDER },
    reads: 1,
  },
  {
    name: "tavern username color",
    run: (client: DrizzleClient) => callerForDatabase(profileRouter, userId, client)
      .updateTavernColor({ target: "username", currentColor: "DEFAULT", color: "NAVY" }),
    userPatch: { tavernUsernameColor: "NAVY", reputationPoints: reputationPoints - getTavernColorChangeCost("NAVY") },
    reads: 1,
  },
];

describeWithDatabase("Committed cosmetic cache patches", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userData, village);
    await insertUsers([{ userId, username: "CacheUser", gender: "Other", reputationPoints } as never]);
  });

  it.each([...purchases])("returns only changed $name fields without another user read", async (purchase) => {
    const database = await getTestDatabase();
    const counted = countUserReads(database);
    const result = await purchase.run(counted.client);
    expect(result.success).toBe(true);
    expect(result.userPatch).toEqual<typeof purchase.userPatch>(purchase.userPatch);
    expect(counted.getReads()).toBe(purchase.reads);
    const saved = await database.query.userData.findFirst({ where: eq(userData.userId, userId) });
    for (const [field, value] of Object.entries(purchase.userPatch)) {
      expect(saved?.[field as keyof NonNullable<typeof saved>]).toEqual(value);
    }
  });

  it.each([...purchases])("rejects a concurrent balance change before the $name debit", async (purchase) => {
    const database = await getTestDatabase();
    const result = await purchase.run(beforeStatements(database, userData, [
      async () => {
        await database.update(userData).set({
          reputationPoints: sql`${userData.reputationPoints} + 1`,
        }).where(eq(userData.userId, userId));
      },
    ]));
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
    const saved = await database.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(saved?.reputationPoints).toBe(reputationPoints + 1);
    const logs = await database.query.actionLog.findMany({ where: eq(actionLog.userId, userId) });
    expect(logs).toHaveLength(0);
  });

  it("returns the exact second-precision occupation timestamp without another user read", async () => {
    const database = await getTestDatabase();
    const counted = countUserReads(database);
    const result = await callerForDatabase(occupationRouter, userId, counted.client)
      .selectOccupation({ occupation: "CRAFTING" });
    expect(result.success).toBe(true);
    expect(result.userPatch?.occupationSignupAt?.getMilliseconds()).toBe(0);
    expect(counted.getReads()).toBe(1);
    const saved = await database.query.userData.findFirst({
      columns: { occupation: true, occupationSignupAt: true },
      where: eq(userData.userId, userId),
    });
    expect(result.userPatch).toEqual<typeof saved>(saved);
  });

  it("rejects an intervening occupation change instead of resetting its cooldown", async () => {
    const database = await getTestDatabase();
    const signupAt = new Date("2026-01-02T03:04:05.000Z");
    const client = beforeStatements(database, userData, [async () => {
      await database.update(userData).set({ occupation: "CRAFTING", occupationSignupAt: signupAt })
        .where(eq(userData.userId, userId));
    }]);
    const result = await callerForDatabase(occupationRouter, userId, client)
      .selectOccupation({ occupation: "CRAFTING" });
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
    const saved = await database.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(saved?.occupationSignupAt).toEqual(signupAt);
  });

});
