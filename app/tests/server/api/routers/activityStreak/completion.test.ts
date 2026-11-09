import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { queueEnergy } from "../../../../setup/queues";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import {
  actionLog,
  activityStreakConfig,
  activityStreakReward,
  userData,
  userQueue,
  userStreakProgress,
} from "@/drizzle/schema";
import { activityStreakRouter } from "@/server/api/routers/activityStreak";
import { ObjectiveReward } from "@/validators/rewards";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

describeWithDatabase("completed event pass configuration changes", () => {
  beforeEach(async () => {
    await resetTables(
      userQueue,
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

  it("applies scalar streak rewards while preserving queued training without a profile refetch", async () => {
    const db = await getTestDatabase();
    await queueEnergy("pass-user", [{ stat: "offence", energy: 10 }]);
    const user = (await db.query.userData.findFirst({
      where: eq(userData.userId, "pass-user"),
    }))!;
    const queue = await db.query.userQueue.findMany();
    const profile = { userData: { ...user, queue } };
    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    client.setQueryData(key, profile);
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        reads++;
        return profile;
      },
    });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await (
        await callerFor(activityStreakRouter, "pass-user")
      ).claimStreakDay({ configId: "pass" });
      expect(result.success).toBe(true);
      expect(result.userDelta?.money).toBe(200);
      await updateUserCache(client, key, result.userPatch, {
        revision,
        delta: result.userDelta,
      });
      const cached = client.getQueryData<typeof profile>(key)!.userData;
      const stored = (await db.query.userData.findFirst({
        where: eq(userData.userId, "pass-user"),
      }))!;
      expect(cached.money).toBe(stored.money);
      expect(cached.queue).toEqual(queue);
      expect(cached.curEnergy).toBe(stored.curEnergy);
      expect(reads).toBe(0);
      expect(
        (
          await (
            await callerFor(activityStreakRouter, "pass-user")
          ).claimStreakDay({ configId: "pass" })
        ).success,
      ).toBe(false);
    } finally {
      stop();
      client.clear();
    }
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

  it.each([2, 3])(
    "starts recurring day one after conversion to %i days and then advances",
    async (totalDays) => {
      const db = await getTestDatabase();
      const caller = await callerFor(activityStreakRouter, "pass-user");
      expect((await caller.claimStreakDay({ configId: "pass" })).success).toBe(true);
      await db
        .update(activityStreakConfig)
        .set({ streakType: "RECURRING", totalDays })
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
      // Advance the new cycle one day while keeping the event completion in its past.
      await db
        .update(actionLog)
        .set({ createdAt: hoursAgo(48) })
        .where(eq(actionLog.relatedId, "pass"));
      await db
        .update(userStreakProgress)
        .set({ startedAt: hoursAgo(24), lastClaimDate: hoursAgo(24) })
        .where(eq(userStreakProgress.id, "progress"));
      expect((await caller.getUserStreaks()).streaks[0]?.nextDayNumber).toBe(2);
      expect((await caller.claimStreakDay({ configId: "pass" })).success).toBe(true);
      const nextDay = await db.query.userData.findFirst({
        where: eq(userData.userId, "pass-user"),
      });
      expect(nextDay?.money).toBe((after?.money ?? 0) + 200);
    },
  );

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
