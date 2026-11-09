import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import {
  gameSetting,
  quest,
  questHistory,
  trainingLog,
  userCookingJob,
  userData,
  userQueue,
  userVote,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { fetchActionUser } from "@/queries/actionReadiness";
import { profileRouter } from "@/server/api/routers/profile";
import { stealthRouter } from "@/server/api/routers/stealth";
import { prepareActionReadiness } from "@/server/utils/actionReadiness";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { insertUsers, insertUserVotes } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "recovery-hydration";
const key = ["profile", userId];
const counters = {
  dailyMissions: 0,
  dailyErrands: 0,
  dailyMedicalMissions: 0,
  dailyWarMissions: 0,
  dailyArenaFights: 0,
  dailyPvpMissions: 0,
  dailySageActivations: 0,
  dailyOverworldQuestRolls: 0,
};

describeWithDatabase("hydrated recovery cache reconciliation", () => {
  beforeEach(async () => {
    await resetTables(
      gameSetting,
      questHistory,
      quest,
      trainingLog,
      userCookingJob,
      userQueue,
      userVote,
      userData,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await insertUsers([
      {
        userId,
        username: userId,
        status: "ASLEEP",
        rank: "JONIN",
        level: 50,
        isOutlaw: true,
        primaryElement: "Fire",
        secondaryElement: "Water",
        regeneration: 0,
        money: 100,
        regenAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await insertUserVotes([{ userId }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["cooking", "queue", "elements", "elementInit", "daily"] as const)(
    "applies known %s recovery fields without reading the profile",
    async (scenario) => {
      const db = await getTestDatabase();
      if (scenario === "cooking")
        await db.insert(userCookingJob).values({
          id: "meal",
          userId,
          experience: 30,
          finishesAt: new Date(Date.now() + 3600_000),
        });
      if (scenario === "queue")
        await db.insert(userQueue).values({
          id: "deleted-training",
          userId,
          kind: "JUTSU",
          position: 1,
          jutsuId: "deleted",
          reservedRyo: 30,
          startsAt: new Date(Date.now() + 3600_000),
          finishesAt: new Date(Date.now() + 3601_000),
        });
      const profile = await callerFor(profileRouter, userId);
      const initial = await profile.getUser();
      // These values belong to the already-rendered tab, before another request or cron settles them.
      if (scenario === "elements")
        Object.assign(initial!.userData!, {
          primaryElement: null,
          secondaryElement: null,
        });
      if (scenario === "daily")
        Object.assign(
          initial!.userData!,
          Object.fromEntries(Object.keys(counters).map((field) => [field, 10])),
        );
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      cache.setQueryData(key, initial);
      const read = vi.fn(() => profile.getUser());
      const observer = new QueryObserver(cache, {
        queryKey: key,
        staleTime: Infinity,
        queryFn: read,
      });
      const stop = observer.subscribe(() => {});
      try {
        const revision = prepareUserUpdate(cache, key);
        if (scenario === "cooking")
          await db.update(userCookingJob).set({ finishesAt: new Date(0) });
        if (scenario === "queue")
          await db
            .update(userQueue)
            .set({ startsAt: new Date(0), finishesAt: new Date(1000) });
        if (scenario === "daily")
          await db.update(userData).set(counters).where(eq(userData.userId, userId));
        if (scenario === "elementInit")
          await db
            .update(userData)
            .set({
              primaryElement: null,
              secondaryElement: null,
              regenAt: new Date(Date.now() - 360_000),
              updatedAt: new Date(Date.now() - 360_000),
            })
            .where(eq(userData.userId, userId));
        const result = await (await callerFor(stealthRouter, userId)).activateStealth();
        expect(result.success).toBe(true);
        expect(result.userRecovery).toBeDefined();
        const applied = await updateUserCache(
          cache,
          key,
          { stealthActive: true, stealthActivatedAt: result.data!.stealthActivatedAt },
          { revision, userRecovery: result.userRecovery },
        );
        const saved = (await db.query.userData.findFirst({
          where: eq(userData.userId, userId),
        }))!;
        const cached = cache.getQueryData<typeof initial>(key)!.userData!;
        expect(cached).toMatchObject({
          status: "AWAKE",
          stealthActive: true,
          cookingExperience: saved.cookingExperience,
          primaryElement: saved.primaryElement,
          secondaryElement: saved.secondaryElement,
          money: scenario === "queue" ? initial!.userData!.money : saved.money,
          ...counters,
        });
        expect(read).not.toHaveBeenCalled();
        expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
        expect(cached.cookingJobs).toHaveLength(0);
        expect(cached.queue).toHaveLength(0);
        if (scenario === "cooking") {
          expect(saved.cookingExperience).toBe(30);
          expect(read).not.toHaveBeenCalled();
        } else if (scenario === "queue") {
          expect(saved.money).toBe(130);
          expect(result.userRecovery?.requiresUserRefresh).toBe(true);
          expect(applied).toBe(false);
        } else if (scenario === "elementInit") {
          expect(saved.primaryElement).not.toBeNull();
          expect(saved.secondaryElement).not.toBeNull();
          expect(saved.secondaryElement).not.toBe(saved.primaryElement);
          expect(result.userRecovery?.requiresUserRefresh).toBe(true);
          expect(applied).toBe(false);
        } else expect(read).not.toHaveBeenCalled();
      } finally {
        stop();
        cache.clear();
      }
    },
  );

  it("projects known raw recovery after earlier settlement without forcing a profile read", async () => {
    const db = await getTestDatabase();
    const initial = await fetchActionUser(db, userId);
    await db
      .update(userData)
      .set({ cookingExperience: 30, ...counters })
      .where(eq(userData.userId, userId));
    const ready = prepareActionReadiness(await fetchActionUser(db, userId), []);
    const cache = new QueryClient();
    cache.setQueryData(key, { userData: initial, notifications: [] });
    const read = vi.fn();
    const observer = new QueryObserver(cache, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: read,
    });
    const stop = observer.subscribe(() => {});
    try {
      expect(
        await updateUserCache(
          cache,
          key,
          { money: 90 },
          { revision: prepareUserUpdate(cache, key), userRecovery: ready.userRecovery },
        ),
      ).toBe(true);
      expect(read).not.toHaveBeenCalled();
      expect(
        cache.getQueryData<{ userData: typeof initial }>(key)?.userData,
      ).toMatchObject({
        status: "AWAKE",
        money: 90,
        cookingExperience: 30,
        ...counters,
      });
    } finally {
      stop();
      cache.clear();
    }
  });
});
