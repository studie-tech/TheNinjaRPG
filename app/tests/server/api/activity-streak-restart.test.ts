// @vitest-environment node
import { setSystemTime } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COST_STREAK_CATCHUP_DAY } from "@/drizzle/constants";
import {
  actionLog,
  activityStreakConfig,
  activityStreakReward,
  userData,
  userStreakProgress,
  userQueue,
} from "@/drizzle/schema";
import { activityStreakRouter } from "@/server/api/routers/activityStreak";
import { ObjectiveReward } from "@/validators/rewards";
import { insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import { queueEnergy } from "../../setup/queues";

describeWithDatabase("recurring streak cycle timing", () => {
  beforeEach(async () => {
    setSystemTime(new Date("2026-10-01T12:00:00Z"));
    await resetTables(
      userQueue,
      actionLog,
      userStreakProgress,
      activityStreakReward,
      activityStreakConfig,
      userData,
    );
    await insertUsers([{ userId: "streak-user", money: 1000, reputationPoints: 10 }]);
    const db = await getTestDatabase();
    await db.insert(activityStreakConfig).values({
      id: "recurring",
      name: "Recurring",
      streakType: "RECURRING",
      totalDays: 2,
    });
    await db.insert(activityStreakReward).values(
      [1, 2, 3, 4].map((day) => ({
        id: `reward-${day}`,
        configId: "recurring",
        dayNumber: day,
        rewards: ObjectiveReward.parse({ reward_money: day * 100 }),
      })),
    );
    await db.insert(userStreakProgress).values({
      id: "progress",
      userId: "streak-user",
      configId: "recurring",
      currentDay: 1,
      startedAt: new Date("2026-09-30T12:00:00Z"),
      lastClaimDate: new Date("2026-09-30T12:00:00Z"),
    });
  });

  afterEach(() => {
    setSystemTime();
    vi.restoreAllMocks();
  });

  it("uses newly inserted first-claim progress without reading it back", async () => {
    const database = await getTestDatabase();
    await database
      .delete(userStreakProgress)
      .where(eq(userStreakProgress.id, "progress"));
    const reads = vi.spyOn(database.query.userStreakProgress, "findFirst");
    const result = await (
      await callerFor(activityStreakRouter, "streak-user")
    ).claimStreakDay({ configId: "recurring" });
    expect(result).toMatchObject({ success: true, userDelta: { money: 100 } });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(
      (
        await database.query.userData.findFirst({
          where: eq(userData.userId, "streak-user"),
        })
      )?.money,
    ).toBe(1100);
  });

  it("loads a competing first-claim row after duplicate creation without paying again", async () => {
    const database = await getTestDatabase();
    await database
      .delete(userStreakProgress)
      .where(eq(userStreakProgress.id, "progress"));
    const raced = beforeStatements(database, userStreakProgress, [
      async () =>
        database
          .insert(userStreakProgress)
          .values({
            id: "winning-first-claim",
            userId: "streak-user",
            configId: "recurring",
            currentDay: 1,
            lastClaimDate: new Date(),
            startedAt: new Date(),
          }),
    ]);
    const result = await callerForDatabase(
      activityStreakRouter,
      "streak-user",
      raced,
    ).claimStreakDay({ configId: "recurring" });
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(
      (
        await database.query.userData.findFirst({
          where: eq(userData.userId, "streak-user"),
        })
      )?.money,
    ).toBe(1000);
    expect(
      (
        await database.query.userStreakProgress.findFirst({
          where: eq(userStreakProgress.userId, "streak-user"),
        })
      )?.currentDay,
    ).toBe(1);
  });

  it("returns the accepted daily payout as a delta and does not repeat it after a rejected claim", async () => {
    const caller = await callerFor(activityStreakRouter, "streak-user");
    const first = await caller.claimStreakDay({ configId: "recurring" });
    expect(first).toMatchObject({
      success: true,
      userDelta: { money: 200, reputationPoints: 0 },
    });
    const second = await caller.claimStreakDay({ configId: "recurring" });
    expect(second.success).toBe(false);
    expect(second.userDelta).toBeUndefined();
  });

  it("keeps reconciliation for a claim that can advance queued training", async () => {
    const database = await getTestDatabase();
    await queueEnergy("streak-user", [{ stat: "offence", energy: 10 }]);
    const result = await (
      await callerFor(activityStreakRouter, "streak-user")
    ).claimStreakDay({ configId: "recurring" });
    expect(result.success).toBe(true);
    expect(result.userDelta).toBeUndefined();
  });

  it("applies current defaults to legacy stored rewards before returning a payout delta", async () => {
    const database = await getTestDatabase();
    await database
      .update(activityStreakReward)
      .set({
        rewards: sql`JSON_REMOVE(${activityStreakReward.rewards}, '$.reward_sage_modes', '$.reward_sage_mastery_experience')`,
      })
      .where(eq(activityStreakReward.id, "reward-2"));
    const result = await (
      await callerFor(activityStreakRouter, "streak-user")
    ).claimStreakDay({ configId: "recurring" });
    expect(result).toMatchObject({ success: true, userDelta: { money: 200 } });
    const user = await database.query.userData.findFirst({
      where: eq(userData.userId, "streak-user"),
    });
    expect(user?.money).toBe(1200);
  });

  it.each(["2026-10-02T12:01:00Z", "2026-10-05T12:01:00Z"])(
    "starts the next cycle at its first free claim on %s, without offering a paid day two",
    async (restartAt) => {
      const db = await getTestDatabase();
      const caller = await callerFor(activityStreakRouter, "streak-user");
      expect((await caller.claimStreakDay({ configId: "recurring" })).success).toBe(
        true,
      );
      // Completing a cycle must not allow its first reward again on the same UTC day.
      expect((await caller.claimStreakDay({ configId: "recurring" })).success).toBe(
        false,
      );
      setSystemTime(new Date(restartAt));
      expect((await caller.getUserStreaks()).streaks[0]).toMatchObject({
        currentDay: 0,
        canClaimToday: true,
        needsCatchUp: false,
      });
      expect((await caller.claimStreakDay({ configId: "recurring" })).success).toBe(
        true,
      );
      expect((await caller.getUserStreaks()).streaks[0]).toMatchObject({
        currentDay: 1,
        alreadyClaimedToday: true,
        canClaimToday: false,
        theoreticalMaxDay: 1,
        needsCatchUp: false,
        daysToGo: 0,
        startedAt: new Date(restartAt),
      });
      // A stale or crafted paid request must not turn the false offer into a charge.
      expect(
        (await caller.claimStreakDay({ configId: "recurring", payCatchUp: true }))
          .success,
      ).toBe(false);
      const user = await db.query.userData.findFirst({
        where: eq(userData.userId, "streak-user"),
      });
      expect(user?.reputationPoints).toBe(10);
      expect(user?.money).toBe(1300);
    },
  );

  it("continues the restarted cycle for free across UTC rollover within the grace period", async () => {
    const caller = await callerFor(activityStreakRouter, "streak-user");
    expect((await caller.claimStreakDay({ configId: "recurring" })).success).toBe(true);
    setSystemTime(new Date("2026-10-02T23:59:00Z"));
    expect((await caller.claimStreakDay({ configId: "recurring" })).success).toBe(true);
    setSystemTime(new Date("2026-10-03T00:01:00Z"));
    expect((await caller.getUserStreaks()).streaks[0]).toMatchObject({
      currentDay: 1,
      canClaimToday: true,
      needsCatchUp: false,
    });
    expect((await caller.claimStreakDay({ configId: "recurring" })).success).toBe(true);
    const db = await getTestDatabase();
    const user = await db.query.userData.findFirst({
      where: eq(userData.userId, "streak-user"),
    });
    expect(user?.reputationPoints).toBe(10);
    expect(user?.money).toBe(1500);
  });

  it("preserves paid catch-up for genuinely missed days and charges once per reward", async () => {
    const db = await getTestDatabase();
    await db
      .update(activityStreakConfig)
      .set({ totalDays: 4 })
      .where(eq(activityStreakConfig.id, "recurring"));
    await db
      .update(userStreakProgress)
      .set({
        startedAt: new Date("2026-09-28T12:00:00Z"),
        lastClaimDate: new Date("2026-09-28T12:00:00Z"),
      })
      .where(eq(userStreakProgress.id, "progress"));
    const caller = await callerFor(activityStreakRouter, "streak-user");
    expect((await caller.getUserStreaks()).streaks[0]).toMatchObject({
      needsCatchUp: true,
      daysToGo: 3,
    });
    for (const daysToGo of [2, 1, 0]) {
      expect(
        (await caller.claimStreakDay({ configId: "recurring", payCatchUp: true }))
          .success,
      ).toBe(true);
      expect((await caller.getUserStreaks()).streaks[0]?.daysToGo).toBe(daysToGo);
    }
    expect(
      (await caller.claimStreakDay({ configId: "recurring", payCatchUp: true }))
        .success,
    ).toBe(false);
    const user = await db.query.userData.findFirst({
      where: eq(userData.userId, "streak-user"),
    });
    expect(user?.reputationPoints).toBe(10 - 3 * COST_STREAK_CATCHUP_DAY);
    expect(user?.money).toBe(1900);
  });

  it("keeps event-pass catch-up anchored to purchase rather than the first claim", async () => {
    const db = await getTestDatabase();
    await db
      .update(activityStreakConfig)
      .set({ streakType: "EVENT_PASS" })
      .where(eq(activityStreakConfig.id, "recurring"));
    const purchasedAt = new Date("2026-09-28T12:00:00Z");
    await db
      .update(userStreakProgress)
      .set({ currentDay: 0, startedAt: purchasedAt, lastClaimDate: null })
      .where(eq(userStreakProgress.id, "progress"));
    const caller = await callerFor(activityStreakRouter, "streak-user");
    expect((await caller.claimStreakDay({ configId: "recurring" })).success).toBe(true);
    expect((await caller.getUserStreaks()).streaks[0]).toMatchObject({
      startedAt: purchasedAt,
      needsCatchUp: true,
      daysToGo: 1,
    });
  });

  it("lets only one concurrent claim start the next recurring cycle", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(activityStreakRouter, "streak-user");
    expect((await caller.claimStreakDay({ configId: "recurring" })).success).toBe(true);
    setSystemTime(new Date("2026-10-02T12:01:00Z"));
    const results = await Promise.all([
      caller.claimStreakDay({ configId: "recurring" }),
      caller.claimStreakDay({ configId: "recurring" }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await caller.getUserStreaks()).streaks[0]).toMatchObject({
      currentDay: 1,
      needsCatchUp: false,
    });
    const user = await db.query.userData.findFirst({
      where: eq(userData.userId, "streak-user"),
    });
    expect(user?.money).toBe(1300);
    expect(user?.reputationPoints).toBe(10);
  });
});
