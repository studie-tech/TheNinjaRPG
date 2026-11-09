import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  getJutsuTrainingTimers,
  getTrainingJutsus,
  getUnchangedJutsuTrainingQueue,
} from "@/deltas/jutsu";
import { TERRITORY_WAR_BOOST_PERCENT } from "@/drizzle/constants";
import {
  jutsu,
  jutsuLoadout,
  userData,
  userJutsu,
  userQueue,
  userVote,
  village,
} from "@/drizzle/schema";
import { calcJutsuTrainTime } from "@/libs/train";
import {
  updateJutsuLoadoutForAppendJutsuIdToLoadoutAtomically,
  updateJutsuLoadoutForRemoveJutsuIdFromLoadoutAtomically,
  updateUserJutsuForStartTraining,
} from "@/queries/jutsu";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { profileRouter } from "@/server/api/routers/profile";
import {
  insertJutsus,
  insertUsers,
  insertUserVotes,
} from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "timer-trainee";
const villageId = "timer-home";
const jutsuId = "timer-jutsu";
const info = { jutsuRank: "D" as const, requiredRank: "STUDENT" as const };
const trainingUser = { senseiId: null, rank: "JONIN" as const };
const boostDivisor = 1 + TERRITORY_WAR_BOOST_PERCENT / 100;

const setBoost = async (boosted: boolean) => {
  const db = await getTestDatabase();
  await db
    .update(village)
    .set({ territoryWarBoostUntil: boosted ? new Date(Date.now() + 3_500_000) : null })
    .where(eq(village.id, villageId));
};

const readTimer = async () =>
  (await (await callerFor(profileRouter, userId)).getSidebarTimers()).jutsuTraining!;

describeWithDatabase("jutsu training progress timestamps", () => {
  beforeEach(async () => {
    await resetTables(
      jutsuLoadout,
      userQueue,
      userJutsu,
      jutsu,
      userVote,
      userData,
      village,
    );
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: villageId, name: "Timer Home", sector: 1, kageId: userId });
    await insertUsers([
      {
        userId,
        username: userId,
        status: "AWAKE",
        rank: "JONIN",
        level: 50,
        villageId,
        sector: 1,
        money: 100_000,
        regenAt: new Date(),
      },
    ]);
    await insertUserVotes([{ userId }]);
    await insertJutsus([{ id: jutsuId, name: "Timer Jutsu", ...info }]);
  });

  it.each([false, true])(
    "retains the direct start across bonus changes and equip (initial boost=%s)",
    async (boosted) => {
      const db = await getTestDatabase();
      await setBoost(boosted);
      // An owned row's creation time belongs to an earlier level.
      await db.insert(userJutsu).values({
        id: "owned",
        userId,
        jutsuId,
        level: 1,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
      const before = Date.now();
      const api = await callerFor(jutsuRouter, userId);
      const profile = await callerFor(profileRouter, userId);
      // A settled profile is required for the confirmed training projection.
      await profile.getUser();
      const ownership = await api.getUserJutsus({});
      const queue = await api.getTrainingQueue();
      const timers = await profile.getSidebarTimers();
      const started = await (await callerFor(jutsuRouter, userId)).startTraining({
        jutsuId,
      });
      const after = Date.now();
      expect(started.success, started.message).toBe(true);
      expect(started.trainingUpdate).toBeDefined();
      expect(getTrainingJutsus(ownership, started.trainingUpdate!)).toEqual(
        await api.getUserJutsus({}),
      );
      expect(getUnchangedJutsuTrainingQueue(queue)).toEqual(
        await api.getTrainingQueue(),
      );
      expect(getJutsuTrainingTimers(timers, started.trainingUpdate!)).toEqual(
        await profile.getSidebarTimers(),
      );
      const timer = await readTimer();
      expect(timer.trainingStartedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(timer.trainingStartedAt.getTime()).toBeLessThanOrEqual(after);
      const duration =
        calcJutsuTrainTime(info, 1, trainingUser) / (boosted ? boostDivisor : 1);
      expect(
        timer.finishTraining.getTime() - timer.trainingStartedAt.getTime(),
      ).toBeCloseTo(duration, -1);

      await setBoost(!boosted);
      const equipped = await (await callerFor(jutsuRouter, userId)).toggleEquip({
        userJutsuId: "owned",
      });
      expect(equipped.success, equipped.message).toBe(true);
      const saved = (await db.query.userJutsu.findFirst({
        where: eq(userJutsu.id, "owned"),
      }))!;
      expect(saved.updatedAt.getTime()).toBeGreaterThan(
        timer.trainingStartedAt.getTime(),
      );
      expect(await readTimer()).toEqual(timer);
    },
  );

  it("permits only one level increment against the same owned baseline", async () => {
    const db = await getTestDatabase();
    await db.insert(userJutsu).values({ id: "owned", userId, jutsuId, level: 1 });
    const startsAt = new Date(),
      finishesAt = new Date(startsAt.getTime() + 60000);
    const writes = await Promise.all(
      [1, 2].map(() =>
        updateUserJutsuForStartTraining(
          db,
          startsAt,
          finishesAt,
          { id: "owned", level: 1 },
          { userId },
        ),
      ),
    );
    expect(writes.map((row) => row.rowsAffected).sort()).toEqual([0, 1]);
    expect(
      (await db.query.userJutsu.findFirst({ where: eq(userJutsu.id, "owned") }))?.level,
    ).toBe(2);
  });

  it("withholds loadout baseline confirmation across concurrent membership changes", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ jutsuLoadout: "active" })
      .where(eq(userData.userId, userId));
    await db
      .insert(jutsuLoadout)
      .values({ id: "active", userId, jutsuIds: ["remote"] });
    expect(
      (
        await updateJutsuLoadoutForAppendJutsuIdToLoadoutAtomically(
          db,
          "local",
          "active",
          userId,
          [],
        )
      ).rowsAffected,
    ).toBe(0);
    expect(
      (
        await updateJutsuLoadoutForAppendJutsuIdToLoadoutAtomically(
          db,
          "local",
          "active",
          userId,
        )
      ).rowsAffected,
    ).toBe(1);
    expect(
      (
        await updateJutsuLoadoutForRemoveJutsuIdFromLoadoutAtomically(
          db,
          "local",
          "active",
          userId,
          "local",
          ["local"],
        )
      ).rowsAffected,
    ).toBe(0);
    expect(
      (await db.query.jutsuLoadout.findFirst({ where: eq(jutsuLoadout.id, "active") }))
        ?.jutsuIds,
    ).toEqual(["remote", "local"]);
    expect(
      (
        await updateJutsuLoadoutForRemoveJutsuIdFromLoadoutAtomically(
          db,
          "local",
          "active",
          userId,
          "local",
          ["remote", "local"],
        )
      ).rowsAffected,
    ).toBe(1);
  });

  it.each([false, true])(
    "persists a newly learned direct start (boost=%s)",
    async (boosted) => {
      await setBoost(boosted);
      const before = Date.now();
      const started = await (await callerFor(jutsuRouter, userId)).startTraining({
        jutsuId,
      });
      const after = Date.now();
      expect(started.success, started.message).toBe(true);
      const timer = await readTimer();
      expect(timer.trainingStartedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(timer.trainingStartedAt.getTime()).toBeLessThanOrEqual(after);
    },
  );

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ] as const)(
    "retains a queued level's boundary across bonus changes (owned=%s, boost=%s)",
    async (owned, boosted) => {
      const db = await getTestDatabase();
      await setBoost(boosted);
      const startsAt = new Date(Date.now() - 10_000);
      if (owned)
        await db.insert(userJutsu).values({
          id: "owned",
          userId,
          jutsuId,
          level: 1,
          finishTraining: startsAt,
          createdAt: new Date(0),
        });
      await db.insert(userQueue).values({
        id: "queued",
        userId,
        jutsuId,
        kind: "JUTSU",
        position: 1,
        reservedRyo: 500,
        durationSeconds: 60,
        startsAt,
        finishesAt: new Date(startsAt.getTime() + 60_000),
      });
      // The sidebar itself settles due levels, including backdated offline starts.
      const timer = await readTimer();
      expect(timer.trainingStartedAt).toEqual(startsAt);
      expect(timer.finishTraining.getTime() - startsAt.getTime()).toBeCloseTo(
        calcJutsuTrainTime(info, owned ? 1 : 0, trainingUser) /
          (boosted ? boostDivisor : 1),
        -1,
      );
      expect(await db.query.userQueue.findMany()).toHaveLength(0);
      await setBoost(!boosted);
      expect(await readTimer()).toEqual(timer);
    },
  );

  it("keeps the inferred interval for existing rows without a saved start", async () => {
    const db = await getTestDatabase();
    const finishTraining = new Date(Date.now() + 120_000);
    await db.insert(userJutsu).values({
      id: "legacy",
      userId,
      jutsuId,
      level: 2,
      finishTraining,
      createdAt: new Date(0),
      updatedAt: new Date(),
    });
    await setBoost(true);
    const timer = await readTimer();
    expect(timer.trainingStartedAt.getTime()).toBe(
      finishTraining.getTime() - calcJutsuTrainTime(info, 1, trainingUser),
    );
    expect(timer.finishTraining).toEqual(finishTraining);
  });
});
