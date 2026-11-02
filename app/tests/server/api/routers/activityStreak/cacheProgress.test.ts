import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { getClaimedStreaks } from "@/deltas/activityStreak";
import { actionLog, activityStreakConfig, activityStreakReward, userData, userStreakProgress } from "@/drizzle/schema";
import { activityStreakRouter } from "@/server/api/routers/activityStreak";
import { ObjectiveReward } from "@/validators/rewards";
import { insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const now = new Date("2026-11-02T12:00:00Z");
/** Anchor claim scenarios away from the daily rollover and continuity threshold. */
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000);

describeWithDatabase("confirmed streak progress cache", () => {
  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(actionLog, userStreakProgress, activityStreakReward, activityStreakConfig, userData);
    await insertUsers([{ userId: "cache-streak", reputationPoints: 100 }]);
  });
  afterEach(() => setSystemTime());

  it.each(["normal", "catch-up", "reset", "new recurring cycle", "recurring completion", "pass completion", "first claim"] as const)(
    "matches the canonical streak view after %s", async scenario => {
      const db = await getTestDatabase();
      const streakType = scenario === "pass completion" ? "EVENT_PASS" : "RECURRING";
      await db.insert(activityStreakConfig).values({ id: "config", name: "Streak", totalDays: 4, streakType });
      await db.insert(activityStreakReward).values([1, 2, 3, 4].map(dayNumber => ({
        id: `reward-${dayNumber}`, configId: "config", dayNumber, rewards: ObjectiveReward.parse({ reward_money: dayNumber }),
      })));
      if (scenario !== "first claim") await db.insert(userStreakProgress).values({
        id: "progress", configId: "config", userId: "cache-streak",
        currentDay: scenario.includes("completion") ? 3 : scenario === "new recurring cycle" ? 0 : 1,
        startedAt: daysAgo(scenario === "normal" ? 1 : 5),
        lastClaimDate: daysAgo(scenario === "catch-up" || scenario === "reset" ? 3 : 1),
      });
      const api = await callerFor(activityStreakRouter, "cache-streak"), before = await api.getUserStreaks();
      const result = await api.claimStreakDay({ configId: "config", payCatchUp: scenario === "catch-up", reset: scenario === "reset" });
      expect(result.success, result.message).toBe(true);
      expect(result.streakUpdate).toBeDefined();
      const next = getClaimedStreaks(before, result.streakUpdate!, now);
      if (scenario === "first claim") expect(next).toBeUndefined();
      else {
        expect(next).toEqual(await api.getUserStreaks());
        expect(getClaimedStreaks(before, result.streakUpdate!, new Date(now.getTime() + 86400000))).toBeUndefined();
        expect(getClaimedStreaks({ ...before, streaks: before.streaks.map(row => ({ ...row, currentDay: 99 })) }, result.streakUpdate!, now)).toBeUndefined();
      }
    },
  );
});
