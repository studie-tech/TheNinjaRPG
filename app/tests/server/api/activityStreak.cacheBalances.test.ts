// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  actionLog,
  activityStreakConfig,
  userData,
  userStreakProgress,
} from "@/drizzle/schema";
import { activityStreakRouter } from "@/server/api/routers/activityStreak";
import { insertUsers } from "../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const userId = "event-pass-cache-player";
const configId = "event-pass-cache-config";

describeWithDatabase("event pass cache balances", () => {
  beforeEach(async () => {
    await resetTables(userStreakProgress, activityStreakConfig, actionLog, userData);
    await insertUsers([{ userId, money: 100, reputationPoints: 50, seichiSilver: 25 }]);
    const db = await getTestDatabase();
    await db.insert(activityStreakConfig).values({
      id: configId,
      name: "Cache Pass",
      streakType: "EVENT_PASS",
      totalDays: 1,
      isActive: true,
      ryoCost: 0,
      repsCost: 0,
      seichiSilverCost: 0,
    });
    stubProfile("fetchUser", async () => {
      const user = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      // An unrelated currency write must survive both the purchase and the profile patch.
      await db
        .update(userData)
        .set({ money: sql`${userData.money} + 7` })
        .where(eq(userData.userId, userId));
      return user;
    });
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  for (const cost of [0, 10]) {
    it(`reads only charged balances for a ${cost}-ryo pass`, async () => {
      const db = await getTestDatabase();
      await db
        .update(activityStreakConfig)
        .set({ ryoCost: cost })
        .where(eq(activityStreakConfig.id, configId));
      const reads = vi.spyOn(db.query.userData, "findFirst");
      const caller = await callerFor(activityStreakRouter, userId);
      const result = await caller.purchaseEventPass({ configId });
      expect(result.success).toBe(true);
      expect(reads).toHaveBeenCalledTimes(cost ? 2 : 1);
      expect(result.userUpdate).toEqual(cost ? { money: 107 - cost } : {});
      const stored = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      expect(stored).toMatchObject({
        money: 107 - cost,
        reputationPoints: 50,
        seichiSilver: 25,
      });
      expect(
        await db.query.userStreakProgress.findFirst({
          where: eq(userStreakProgress.configId, configId),
        }),
      ).toBeDefined();
    });
  }
});
