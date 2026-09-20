// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import {
  actionLog,
  activityStreakConfig,
  activityStreakReward,
  userData,
  userStreakProgress,
} from "@/drizzle/schema";
import { activityStreakRouter } from "@/server/api/routers/activityStreak";
import { ObjectiveReward } from "@/validators/rewards";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

describeWithDatabase("completed event pass configuration changes", () => {
  beforeEach(async () => {
    await resetTables(
      actionLog,
      userStreakProgress,
      activityStreakReward,
      activityStreakConfig,
      userData,
    );
    await insertUsers([{ userId: "pass-user", money: 1000 }]);
    const db = await getTestDatabase();
    await db.insert(activityStreakConfig).values({
      id: "pass",
      name: "Event",
      streakType: "EVENT_PASS",
      totalDays: 2,
    });
    await db.insert(activityStreakReward).values(
      [1, 2].map((day) => ({
        id: `reward-${day}`,
        configId: "pass",
        dayNumber: day,
        rewards: ObjectiveReward.parse({ reward_money: day * 100 }),
      })),
    );
    await db.insert(userStreakProgress).values({
      id: "progress",
      userId: "pass-user",
      configId: "pass",
      currentDay: 1,
      startedAt: hoursAgo(72),
      lastClaimDate: hoursAgo(24),
    });
  });

  it("keeps an extended completed pass hidden and rejects normal, reset, and catch-up claims", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(activityStreakRouter, "pass-user");
    expect((await caller.claimStreakDay({ configId: "pass" })).success).toBe(true);
    await db
      .update(activityStreakConfig)
      .set({ totalDays: 3 })
      .where(eq(activityStreakConfig.id, "pass"));
    await db
      .update(userStreakProgress)
      .set({ lastClaimDate: hoursAgo(48) })
      .where(eq(userStreakProgress.id, "progress"));
    const before = await db.query.userData.findFirst({
      where: eq(userData.userId, "pass-user"),
    });
    const progressBefore = await db.query.userStreakProgress.findFirst({
      where: eq(userStreakProgress.id, "progress"),
    });
    for (const options of [{}, { reset: true }, { payCatchUp: true }]) {
      expect(
        await caller.claimStreakDay({ configId: "pass", ...options }),
      ).toMatchObject({
        success: false,
        message: "This event pass has already been completed",
      });
    }
    expect((await caller.getUserStreaks()).streaks).toHaveLength(0);
    expect(await caller.getAvailablePasses()).toHaveLength(0);
    expect(
      await db.query.userStreakProgress.findFirst({
        where: eq(userStreakProgress.id, "progress"),
      }),
    ).toEqual(progressBefore);
    const after = await db.query.userData.findFirst({
      where: eq(userData.userId, "pass-user"),
    });
    expect(after?.money).toBe(before?.money);
    expect(after?.reputationPoints).toBe(before?.reputationPoints);
  });

  it("grants day one after conversion to recurring without permitting a same-day double claim", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(activityStreakRouter, "pass-user");
    expect((await caller.claimStreakDay({ configId: "pass" })).success).toBe(true);
    await db
      .update(activityStreakConfig)
      .set({ streakType: "RECURRING" })
      .where(eq(activityStreakConfig.id, "pass"));
    expect((await caller.claimStreakDay({ configId: "pass" })).success).toBe(false);
    await db
      .update(userStreakProgress)
      .set({ lastClaimDate: hoursAgo(24) })
      .where(eq(userStreakProgress.id, "progress"));
    const before = await db.query.userData.findFirst({
      where: eq(userData.userId, "pass-user"),
    });
    expect((await caller.getUserStreaks()).streaks[0]).toMatchObject({
      currentDay: 0,
      nextDayNumber: 1,
      canClaimToday: true,
    });
    expect((await caller.claimStreakDay({ configId: "pass" })).success).toBe(true);
    const after = await db.query.userData.findFirst({
      where: eq(userData.userId, "pass-user"),
    });
    expect(after?.money).toBe((before?.money ?? 0) + 100);
    const progress = await db.query.userStreakProgress.findFirst({
      where: eq(userStreakProgress.id, "progress"),
    });
    expect(progress?.currentDay).toBe(1);
    expect(progress?.startedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("continues an unfinished extended pass", async () => {
    const db = await getTestDatabase();
    await db
      .update(activityStreakConfig)
      .set({ totalDays: 3 })
      .where(eq(activityStreakConfig.id, "pass"));
    const caller = await callerFor(activityStreakRouter, "pass-user");
    expect((await caller.getUserStreaks()).streaks[0]?.nextDayNumber).toBe(2);
    expect((await caller.claimStreakDay({ configId: "pass" })).success).toBe(true);
    expect(
      (
        await db.query.userStreakProgress.findFirst({
          where: eq(userStreakProgress.id, "progress"),
        })
      )?.currentDay,
    ).toBe(2);
  });
});
