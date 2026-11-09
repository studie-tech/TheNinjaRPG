import { afterEach, beforeEach, expect, it, setSystemTime } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { getClaimedStreaks } from "@/deltas/activityStreak";
import { STREAK_CONTINUITY_HOURS } from "@/drizzle/constants";
import {
  actionLog,
  activityStreakConfig,
  activityStreakReward,
  userData,
  userStreakProgress,
} from "@/drizzle/schema";
import { activityStreakRouter } from "@/server/api/routers/activityStreak";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";
import { ObjectiveReward } from "@/validators/rewards";
import { insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const now = new Date("2026-11-02T12:00:00Z");
/** Anchor claim scenarios away from the daily rollover and continuity threshold. */
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000);

describeWithDatabase("confirmed streak progress cache", () => {
  beforeEach(async () => {
    setSystemTime(now);
    await resetTables(
      actionLog,
      userStreakProgress,
      activityStreakReward,
      activityStreakConfig,
      userData,
    );
    await insertUsers([{ userId: "cache-streak", reputationPoints: 100 }]);
  });
  afterEach(() => setSystemTime());

  it.each([
    "normal",
    "catch-up",
    "reset",
    "new recurring cycle",
    "recurring completion",
    "pass completion",
    "first claim",
  ] as const)("matches the canonical streak view after %s", async (scenario) => {
    const db = await getTestDatabase();
    const streakType = scenario === "pass completion" ? "EVENT_PASS" : "RECURRING";
    await db
      .insert(activityStreakConfig)
      .values({ id: "config", name: "Streak", totalDays: 4, streakType });
    await db.insert(activityStreakReward).values(
      [1, 2, 3, 4].map((dayNumber) => ({
        id: `reward-${dayNumber}`,
        configId: "config",
        dayNumber,
        rewards: ObjectiveReward.parse({ reward_money: dayNumber }),
      })),
    );
    if (scenario !== "first claim")
      await db.insert(userStreakProgress).values({
        id: "progress",
        configId: "config",
        userId: "cache-streak",
        currentDay: scenario.includes("completion")
          ? 3
          : scenario === "new recurring cycle"
            ? 0
            : 1,
        startedAt: daysAgo(scenario === "normal" ? 1 : 5),
        lastClaimDate: daysAgo(scenario === "catch-up" || scenario === "reset" ? 3 : 1),
      });
    const api = await callerFor(activityStreakRouter, "cache-streak"),
      before = await api.getUserStreaks();
    const result = await api.claimStreakDay({
      configId: "config",
      payCatchUp: scenario === "catch-up",
      reset: scenario === "reset",
    });
    expect(result.success, result.message).toBe(true);
    expect(result.streakUpdate).toBeDefined();
    const next = getClaimedStreaks(before, result.streakUpdate!, now);
    if (scenario === "first claim") expect(next).toBeUndefined();
    else {
      expect(next).toEqual(await api.getUserStreaks());
      expect(
        getClaimedStreaks(
          before,
          result.streakUpdate!,
          new Date(now.getTime() + 86400000),
        ),
      ).toBeUndefined();
      expect(
        getClaimedStreaks(
          {
            ...before,
            streaks: before.streaks.map((row) => ({ ...row, currentDay: 99 })),
          },
          result.streakUpdate!,
          now,
        ),
      ).toBeUndefined();
    }
  });

  it.each(["continuity", "elapsed day", "UTC rollover"] as const)(
    "refetches when another streak crosses its %s boundary",
    async (boundary) => {
      const db = await getTestDatabase();
      const loadedAt =
        boundary === "UTC rollover" ? new Date("2026-11-02T23:59:59Z") : now;
      const boundaryAt = new Date(loadedAt.getTime() + 1000);
      setSystemTime(loadedAt);
      await db.insert(activityStreakConfig).values([
        { id: "claimed", name: "Claimed", totalDays: 4, streakType: "RECURRING" },
        { id: "other", name: "Other", totalDays: 4, streakType: "EVENT_PASS" },
      ]);
      await db.insert(userStreakProgress).values([
        {
          id: "claimed-progress",
          configId: "claimed",
          userId: "cache-streak",
          currentDay: 1,
          startedAt: new Date(loadedAt.getTime() - 86400000),
          lastClaimDate: new Date(loadedAt.getTime() - 86400000),
        },
        {
          id: "other-progress",
          configId: "other",
          userId: "cache-streak",
          currentDay: 1,
          startedAt:
            boundary === "elapsed day"
              ? new Date(boundaryAt.getTime() - 86400000)
              : daysAgo(5),
          lastClaimDate:
            boundary === "continuity"
              ? new Date(boundaryAt.getTime() - STREAK_CONTINUITY_HOURS * 3600000)
              : loadedAt,
        },
      ]);
      const api = await callerFor(activityStreakRouter, "cache-streak");
      const before = await api.getUserStreaks();
      // Midnight can pass before the server handles the claim; other deadlines can pass in flight.
      if (boundary === "UTC rollover") setSystemTime(boundaryAt);
      const result = await api.claimStreakDay({ configId: "claimed" });
      expect(result.success, result.message).toBe(true);
      if (boundary !== "UTC rollover") {
        expect(
          getClaimedStreaks(
            before,
            result.streakUpdate!,
            new Date(boundaryAt.getTime() - 1),
          ),
        ).toEqual(await api.getUserStreaks());
      }
      setSystemTime(boundaryAt);
      const canonical = await api.getUserStreaks();
      expect(canonical.streaks.find((row) => row.configId === "other")).toMatchObject(
        boundary === "UTC rollover"
          ? { canClaimToday: true, alreadyClaimedToday: false }
          : { canClaimToday: false, needsCatchUp: true },
      );
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } },
      });
      const key = [["activityStreak", "getUserStreaks"], { type: "query" }];
      client.setQueryData(key, before);
      let reads = 0;
      const stop = new QueryObserver(client, {
        queryKey: key,
        queryFn: () => {
          reads++;
          return api.getUserStreaks();
        },
      }).subscribe(() => {});
      try {
        expect(
          await updateQueryCache<typeof before>(
            client,
            key,
            (current) => getClaimedStreaks(current, result.streakUpdate!, boundaryAt),
            { revision: prepareQueryUpdate(client, key) },
          ),
        ).toBe(false);
        expect(reads).toBe(1);
        expect(client.getQueryData(key)).toEqual(canonical);
      } finally {
        stop();
        client.clear();
      }
    },
  );
});
