import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { inferProcedureInput } from "@trpc/server";
import { eq } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { UserCache } from "@/deltas/profile";
import { DMG_SETTING_DEFAULTS, HOSPITAL_BASE_HEAL_SECONDS } from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  gameSetting,
  jutsu,
  petSpecies,
  quest,
  questHistory,
  trainingLog,
  userCookingJob,
  userData,
  userJutsu,
  userPet,
  userQueue,
  userVote,
  village,
} from "@/drizzle/schema";
import { AUTO_CHECKOUT_MESSAGE, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { Pusher } from "@/libs/pusher";
import { fetchActionUser } from "@/queries/actionReadiness";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { withRequestScope } from "@/server/requestScope";
import * as liveActivity from "@/server/utils/push/liveActivity";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { statSchema } from "@/validators/combat";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { withAfterTasks } from "../../../../setup/after";
import { deferred } from "../../../../setup/deferred";
import {
  insertDefaultAiProfile,
  insertJutsus,
  insertQuests,
  insertUserPets,
  insertUsers,
  insertUserVotes,
} from "../../../../setup/factories";
import { queueEnergy, queueMasteries } from "../../../../setup/queues";
import { beforeStatements } from "../../../../setup/statements";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
  resolverOf,
} from "../../../../setup/testDatabase";

const userId = "arena-ready";
const aiId = "arena-ai";

// Exercise the full SQL resolver; authentication and Redis middleware have separate suites.
const arenaResolver = resolverOf(combatRouter.startArenaBattle);
const launch = (
  client: DrizzleClient,
  input: inferProcedureInput<typeof combatRouter.startArenaBattle> = { aiId },
) =>
  withAfterTasks({
    start: () =>
      withRequestScope(() =>
        arenaResolver({
          ctx: { drizzle: client, userId },
          input,
          type: "mutation",
          path: "combat.startArenaBattle",
        }),
      ),
  }).start();

const notificationReads = (statements: string[]) =>
  statements.filter((statement) =>
    /from `(?:Poll|MpvpBattleQueue)`|from `Quest` `quest`/.test(statement),
  );

describeWithDatabase("arena readiness reads", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(liveActivity, "pushActivityUpdate").mockResolvedValue(undefined);
    await resetTables(
      battle,
      battleHistory,
      aiProfile,
      gameSetting,
      questHistory,
      quest,
      trainingLog,
      userCookingJob,
      userQueue,
      userJutsu,
      userPet,
      petSpecies,
      jutsu,
      userVote,
      userData,
      village,
    );
    const client = await getTestDatabase();
    const now = new Date();
    await insertUsers([
      {
        userId,
        rank: "JONIN",
        level: 50,
        status: "AWAKE",
        isOutlaw: true,
        sector: 0,
        money: 1000,
        updatedAt: now,
        regenAt: now,
        defaultAutoCombat: true,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
      {
        userId: aiId,
        isAi: true,
        isSummon: false,
        inArena: true,
        rank: "JONIN",
        level: 50,
      },
    ]);
    await insertUserVotes([{ userId, lastVoteAt: now }]);
    await client
      .insert(village)
      .values({ id: "arena", name: "Arena", sector: 0, kageId: "" });
    await insertDefaultAiProfile();
    await client.insert(gameSetting).values(
      Object.entries(DMG_SETTING_DEFAULTS).map(([name, value]) => ({
        id: name,
        name,
        value,
        time: now,
      })),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  for (const status of ["ASLEEP", "HOSPITALIZED"] as const) {
    for (const queued of ["idle", "energy", "mastery", "both", "companion"] as const) {
      it(`patches ${status} battle admission and ${queued} progression ${queued === "companion" ? "while preserving unknown companion state" : "without a getUser read"}`, async () => {
        const database = await getTestDatabase();
        await database
          .update(userData)
          .set({
            status,
            curHealth: 1,
            maxHealth: 1000,
            curEnergy: 100,
            curChakra: 1,
            curStamina: 1,
            regeneration: 1,
            regenAt: new Date(0),
          })
          .where(eq(userData.userId, userId));
        if (["energy", "both", "companion"].includes(queued))
          await queueEnergy(userId, [{ stat: "offence", energy: 100 }]);
        if (["mastery", "both"].includes(queued)) {
          await database
            .update(userData)
            .set({
              currentlyTrainingMastery: "ninjutsuMastery",
              trainingSpeed: "15min",
              masteryTrainingStartedAt: new Date(Date.now() - 16 * 60_000),
            })
            .where(eq(userData.userId, userId));
          await queueMasteries(userId, [{ stat: "genjutsuMastery", speed: "1hr" }]);
        }
        if (queued === "companion") {
          await database
            .insert(petSpecies)
            .values({ id: "arena-companion-species", name: "Fox", description: "Fox" });
          await insertUserPets([
            {
              id: "arena-companion",
              userId,
              name: "Fox",
              speciesId: "arena-companion-species",
              generationStatus: "READY",
              artRank: 1,
              avatar: "https://uploadthing.b-cdn.net/f/arena-companion",
            },
          ]);
          await database
            .update(userData)
            .set({ activePetId: "arena-companion", petExperience: 25 })
            .where(eq(userData.userId, userId));
        }
        const initial = await fetchActionUser(database, userId);
        const cache = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        const key = ["profile", userId];
        cache.setQueryData(key, { userData: initial, notifications: [] });
        let reads = 0;
        const observer = new QueryObserver(cache, {
          queryKey: key,
          staleTime: Infinity,
          queryFn: async () => {
            reads++;
            return {
              userData: await fetchActionUser(database, userId),
              notifications: [],
            };
          },
        });
        const unsubscribe = observer.subscribe(() => {});
        try {
          const revision = prepareUserUpdate(cache, key);
          const result = await launch(database);
          expect(result).toMatchObject({ success: true, userRecovery: { userId } });
          const applied = await updateUserCache(cache, key, result, { revision });
          const saved = (await database.query.userData.findFirst({
            where: eq(userData.userId, userId),
          }))!;
          expect(reads).toBe(0);
          expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
          const projected = cache.getQueryData<UserCache>(key)?.userData;
          expect(applied).toBe(!(queued === "companion" && status === "HOSPITALIZED"));
          expect(projected).toMatchObject({
            status: "BATTLE",
            battleId: saved.battleId,
            curHealth: saved.curHealth,
            curChakra: saved.curChakra,
            curStamina: saved.curStamina,
            curEnergy: saved.curEnergy,
            experience: saved.experience,
            petExperience:
              queued === "companion" && status === "HOSPITALIZED"
                ? initial.petExperience
                : saved.petExperience,
            offence: saved.offence,
            pveFights: saved.pveFights,
            energyQueueHead: saved.energyQueueHead,
            masteryQueueHead: saved.masteryQueueHead,
            ninjutsuMastery: saved.ninjutsuMastery,
            currentlyTrainingMastery: saved.currentlyTrainingMastery,
            masteryTrainingStartedAt: saved.masteryTrainingStartedAt,
            trainingSpeed: saved.trainingSpeed,
            dailyTrainings: saved.dailyTrainings,
          });
          expect(projected?.regenAt.getTime()).toBe(saved.regenAt.getTime());
        } finally {
          unsubscribe();
          cache.clear();
        }
      });
    }
  }

  it("marks only the requesting fighter's originating socket", async () => {
    const database = await getTestDatabase();
    const trigger = vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const result = await launch(database, { aiId, originSocketId: "origin-tab" });
    expect(result.success).toBe(true);
    const events = trigger.mock.calls.filter(
      ([, event, data]) =>
        event === "event" &&
        typeof data === "object" &&
        "type" in data &&
        data.type === "battle",
    );
    expect(events.find(([channel]) => channel === userId)?.[2]).toMatchObject({
      originSocketId: "origin-tab",
    });
    expect(events.find(([channel]) => channel === aiId)?.[2]).not.toHaveProperty(
      "originSocketId",
    );
  });

  it("projects committed battle activity without guessing a dropped job refund or reading the profile", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ status: "ASLEEP" })
      .where(eq(userData.userId, userId));
    await database.insert(userQueue).values({
      id: "deleted-arena-job",
      userId,
      kind: "JUTSU",
      position: 1,
      jutsuId: "deleted",
      reservedRyo: 30,
      startsAt: new Date(Date.now() + 3600_000),
      finishesAt: new Date(Date.now() + 3601_000),
    });
    const initial = await fetchActionUser(database, userId);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["arena-outer-settlement"];
    cache.setQueryData(key, { userData: initial, notifications: [] });
    const read = vi.fn(async () => ({
      userData: await fetchActionUser(database, userId),
      notifications: [],
    }));
    const observer = new QueryObserver(cache, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: read,
    });
    const stop = observer.subscribe(() => {});
    try {
      const revision = prepareUserUpdate(cache, key);
      await database
        .update(userQueue)
        .set({ startsAt: new Date(0), finishesAt: new Date(1000) });
      const result = await launch(database);
      expect(result.success).toBe(true);
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      await updateUserCache(cache, key, result, { revision });
      expect(read).not.toHaveBeenCalled();
      expect(cache.getQueryData<UserCache>(key)?.userData).toEqual({
        ...initial,
        ...result.userRecovery?.activity,
      });
      expect(result.userRecovery?.activity).toMatchObject({
        status: "BATTLE",
        battleId: result.battleId,
      });
      expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
      expect(
        await database.query.userData.findFirst({ where: eq(userData.userId, userId) }),
      ).toMatchObject({
        status: "BATTLE",
        money: initial.money + 30,
      });
    } finally {
      stop();
      cache.clear();
    }
  });

  it("omits display alerts and reads achievements once across readiness and battle preload", async () => {
    const client = await getTestDatabase();
    const { result, statements } = await recordQueries(() => launch(client));
    expect(result.success).toBe(true);
    expect(notificationReads(statements)).toEqual([]);
    expect(
      statements.filter(
        (statement) =>
          /from `Quest` where/.test(statement) &&
          statement.includes("`Quest`.`questType` =") &&
          statement.includes("`Quest`.`hidden`"),
      ),
    ).toHaveLength(1);
    const saved = (await client.query.battle.findFirst())!;
    expect(saved.battleType).toBe("ARENA");
    expect(
      saved.usersState.find((user) => user.controllerId === userId)?.isAutoCombat,
    ).toBe(true);
  });

  it.each(["ASLEEP", "HOSPITALIZED"] as const)(
    "commits explicit %s recovery in the existing battle claim without extra read or write phases",
    async (status) => {
      const client = await getTestDatabase();
      const start = () =>
        withAfterTasks({
          start: () =>
            withRequestScope(() =>
              initiateBattle(
                { client, userIds: [userId], targetIds: [aiId], actionUserId: userId },
                "ARENA",
              ),
            ),
        }).start();
      // Warm shared content caches before comparing the two actor states.
      expect((await start()).success).toBe(true);
      await resetTables(battle, battleHistory);
      await client
        .update(userData)
        .set({ status: "AWAKE", battleId: null })
        .where(eq(userData.userId, userId));
      const awake = await recordQueries(start);
      expect(awake.result.success).toBe(true);
      await resetTables(battle, battleHistory);
      await client
        .update(userData)
        .set({
          status,
          battleId: null,
          curHealth: 1,
          maxHealth: 1000,
          autoWakeUp: true,
          regeneration: 0,
          regenAt: new Date(Date.now() - (HOSPITAL_BASE_HEAL_SECONDS + 1) * 1000),
        })
        .where(eq(userData.userId, userId));
      const recovered = await recordQueries(start);
      expect(recovered.result).toMatchObject({
        success: true,
        actionNotice: status === "ASLEEP" ? AUTO_WAKE_MESSAGE : AUTO_CHECKOUT_MESSAGE,
      });
      const reads = (queries: string[]) =>
        queries.filter((query) => /^select /i.test(query));
      const actorWrites = (queries: string[]) =>
        queries.filter((query) => /^update `UserData` /i.test(query));
      expect(reads(recovered.statements).length).toBe(reads(awake.statements).length);
      expect(actorWrites(awake.statements)).toHaveLength(1);
      expect(actorWrites(recovered.statements)).toHaveLength(1);
      expect(actorWrites(recovered.statements)[0]).toContain("`status`");
      const owner = (await client.query.userData.findFirst({
        where: eq(userData.userId, userId),
      }))!;
      expect(owner.status).toBe("BATTLE");
      expect(owner.money).toBe(1000);
      if (status === "HOSPITALIZED") {
        expect(owner.curHealth).toBe(owner.maxHealth);
        expect(
          (await client.query.battle.findFirst())?.usersState.find(
            (user) => user.controllerId === userId,
          )?.curHealth,
        ).toBe(1000);
      }
    },
  );

  for (const direct of [false, true]) {
    it(`ends hospital recovery once for ${direct ? "direct" : "arena endpoint"} battle admission`, async () => {
      const client = await getTestDatabase();
      await client
        .update(userData)
        .set({
          status: "HOSPITALIZED",
          curHealth: 1,
          maxHealth: 1000,
          regenAt: new Date(0),
        })
        .where(eq(userData.userId, userId));
      const result = direct
        ? await withAfterTasks({
            start: () =>
              withRequestScope(() =>
                initiateBattle(
                  {
                    client,
                    userIds: [userId],
                    targetIds: [aiId],
                    actionUserId: userId,
                  },
                  "ARENA",
                ),
              ),
          }).start()
        : await launch(client);
      expect(result).toMatchObject({
        success: true,
        actionNotice: AUTO_CHECKOUT_MESSAGE,
      });
      expect(
        await client.query.userData.findFirst({ where: eq(userData.userId, userId) }),
      ).toMatchObject({ status: "BATTLE", curHealth: 1000 });
      expect(liveActivity.pushActivityUpdate).toHaveBeenCalledTimes(1);
      expect(liveActivity.pushActivityUpdate).toHaveBeenCalledWith(
        client,
        [userId],
        "hospital",
        { title: "Recovered", endsAt: expect.any(Date) },
        "end",
      );
    });

    it(`logs completed training once while waking for ${direct ? "direct" : "arena endpoint"} battle admission`, async () => {
      const client = await getTestDatabase();
      await client
        .update(userData)
        .set({ status: "ASLEEP", autoWakeUp: true, curEnergy: 100, regeneration: 0 })
        .where(eq(userData.userId, userId));
      await queueEnergy(userId, [{ stat: "offence", energy: 100 }]);
      const result = direct
        ? await withAfterTasks({
            start: () =>
              withRequestScope(() =>
                initiateBattle(
                  {
                    client,
                    userIds: [userId],
                    targetIds: [aiId],
                    actionUserId: userId,
                  },
                  "ARENA",
                ),
              ),
          }).start()
        : await launch(client);
      expect(result).toMatchObject({ success: true, actionNotice: AUTO_WAKE_MESSAGE });
      expect(
        await client.query.trainingLog.findMany({
          where: eq(trainingLog.userId, userId),
        }),
      ).toEqual([expect.objectContaining({ userId, stat: "offence" })]);
      if (direct)
        expect(
          (await client.query.battle.findFirst())?.extraState.profileCacheSnapshots?.[
            userId
          ]?.hadTrainingQueue,
        ).toBe(true);
      expect(liveActivity.pushActivityUpdate).not.toHaveBeenCalled();
    });
  }

  it.each([
    { status: "ASLEEP", autoWakeUp: false, message: "asleep" },
    { status: "HOSPITALIZED", autoWakeUp: true, message: "in the hospital" },
  ] as const)("rejects unavailable actors before battle writes: %j", async (patch) => {
    const client = await getTestDatabase();
    await client
      .update(userData)
      .set({
        status: patch.status,
        autoWakeUp: patch.autoWakeUp,
        curHealth: 1,
        maxHealth: 1000,
        regenAt: new Date(),
      })
      .where(eq(userData.userId, userId));
    const recorded = await recordQueries(() =>
      initiateBattle(
        { client, userIds: [userId], targetIds: [aiId], actionUserId: userId },
        "ARENA",
      ),
    );
    expect(recorded.result).toMatchObject({
      success: false,
      message: expect.stringContaining(patch.message),
    });
    expect(
      recorded.statements.filter((query) => /^(?:update|insert|delete) /i.test(query)),
    ).toEqual([]);
    expect(
      await client.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    ).toMatchObject({ status: patch.status, money: 1000 });
  });

  it("keeps background initiation strict without explicit actor recovery", async () => {
    const client = await getTestDatabase();
    await client
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: true })
      .where(eq(userData.userId, userId));
    expect(
      await initiateBattle({ client, userIds: [userId], targetIds: [aiId] }, "ARENA"),
    ).toMatchObject({ success: false, message: expect.stringContaining("asleep") });
    expect(await client.query.battle.findMany()).toEqual([]);
  });

  it("retains display alert reads for ordinary profile callers", async () => {
    const client = await getTestDatabase();
    const { statements } = await recordQueries(() =>
      fetchUpdatedUser({ client, userId }),
    );
    expect(notificationReads(statements)).toHaveLength(3);
  });

  it("starts the AI lookup while the readiness participant read is still pending", async () => {
    const client = await getTestDatabase();
    const { promise: pending, resolve: release } = deferred<void>();
    let aiReadStarted = false;
    let readinessReadStarted = false;
    const { promise: readiness, resolve: signalReadiness } = deferred<void>();
    const original = client.query.userData.findFirst.bind(client.query.userData);
    vi.spyOn(client.query.userData, "findFirst").mockImplementation(((
      options: Parameters<typeof original>[0],
    ) => {
      if (options?.with) {
        readinessReadStarted = true;
        signalReadiness();
        return pending.then(() => original(options)) as ReturnType<typeof original>;
      }
      if (options?.where && typeof options.where !== "function")
        aiReadStarted ||= new MySqlDialect()
          .sqlToQuery(options.where)
          .params.includes(aiId);
      return original(options);
    }) as typeof original);
    const started = launch(client);
    try {
      // Wait for the readiness read to be held without relying on database timings.
      await readiness;
      expect(readinessReadStarted).toBe(true);
      expect(aiReadStarted).toBe(true);
    } finally {
      release();
      await started;
    }
  });

  it("settles due queues, cooking receipts and regeneration before freezing combatants", async () => {
    const client = await getTestDatabase();
    const past = new Date(Date.now() - 360_000);
    await client
      .update(userData)
      .set({
        updatedAt: past,
        regenAt: past,
        regeneration: 100,
        curHealth: 1,
        maxHealth: 1000,
        cookingExperience: 0,
      })
      .where(eq(userData.userId, userId));
    await client
      .insert(userCookingJob)
      .values({ id: "cooked", userId, experience: 7, finishesAt: past });
    await insertJutsus([{ id: "retired", name: "Retired", hidden: true }]);
    await client.insert(userQueue).values({
      id: "due",
      userId,
      kind: "JUTSU",
      position: 1,
      jutsuId: "retired",
      reservedRyo: 100,
      durationSeconds: 60,
      startsAt: past,
      finishesAt: past,
    });
    expect((await launch(client, { aiId, autoCombat: false })).success).toBe(true);
    const saved = (await client.query.battle.findFirst())!;
    const actor = saved.usersState.find((user) => user.controllerId === userId)!;
    expect(actor.curHealth).toBeGreaterThan(1);
    expect(!!actor.isAutoCombat).toBe(false);
    const owner = (await client.query.userData.findFirst({
      where: eq(userData.userId, userId),
    }))!;
    expect(owner.cookingExperience).toBe(7);
    expect(owner.money).toBe(1100);
    expect(await client.query.userCookingJob.findMany()).toEqual([]);
    expect(await client.query.userQueue.findMany()).toEqual([]);
  });

  it("retains quest progression while omitting display alerts", async () => {
    const client = await getTestDatabase();
    await insertQuests([
      {
        id: "arena-level",
        questType: "achievement",
        content: {
          objectives: [
            SimpleObjective.parse({ id: "level", task: "user_level", value: 50 }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    const updated = await fetchUpdatedUser({
      client,
      userId,
      includeNotifications: false,
    });
    expect(
      updated.user?.userQuests.some((entry) => entry.questId === "arena-level"),
    ).toBe(true);
    expect(
      updated.trackerResults?.trackers.some((tracker) => tracker.id === "arena-level"),
    ).toBe(true);
    expect((await launch(client)).success).toBe(true);
  });

  it("keeps the final participant claim when another action changes status after readiness", async () => {
    const client = await getTestDatabase();
    const raced = beforeStatements(client, userData, [
      () =>
        client
          .update(userData)
          .set({ status: "ASLEEP" })
          .where(eq(userData.userId, userId)),
    ]);
    expect((await launch(raced)).success).toBe(false);
    expect(await client.query.battle.findMany()).toEqual([]);
    expect(
      await client.query.userData.findFirst({ where: eq(userData.userId, userId) }),
    ).toMatchObject({ status: "ASLEEP", battleId: null });
  });

  for (const status of ["ASLEEP", "HOSPITALIZED"] as const) {
    it.each(["target moved", "actor moved", "actor entered another battle"] as const)(
      `projects only confirmed ${status} recovery after a partial participant claim: %s`,
      async (race) => {
        const client = await getTestDatabase();
        const targetId = "partial-claim-target";
        await client
          .update(userData)
          .set({
            status,
            sector: 100,
            longitude: 5,
            latitude: 5,
            curHealth: 1,
            maxHealth: 1000,
            curEnergy: 100,
            regeneration: 0,
            autoWakeUp: true,
            regenAt: new Date(0),
            immunityUntil: new Date(0),
          })
          .where(eq(userData.userId, userId));
        await insertUsers([
          {
            userId: targetId,
            username: targetId,
            rank: "JONIN",
            level: 50,
            status: "AWAKE",
            sector: 100,
            longitude: 5,
            latitude: 5,
            immunityUntil: new Date(0),
          },
        ]);
        await queueEnergy(userId, [{ stat: "offence", energy: 100 }]);
        const initial = await fetchActionUser(client, userId);
        const raced = beforeStatements(client, userData, [
          () =>
            client
              .update(userData)
              .set({ longitude: 6 })
              .where(eq(userData.userId, race === "actor moved" ? userId : targetId)),
          ...(race === "actor entered another battle"
            ? [
                () =>
                  client
                    .update(userData)
                    .set({ status: "BATTLE", battleId: "later-battle" })
                    .where(eq(userData.userId, userId)),
              ]
            : []),
        ]);
        const cache = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        const key = ["partial-battle-recovery", userId];
        cache.setQueryData(key, { userData: initial, notifications: [] });
        const read = vi.fn(async () => ({
          userData: await fetchActionUser(client, userId),
          notifications: [],
        }));
        const observer = new QueryObserver(cache, {
          queryKey: key,
          staleTime: Infinity,
          queryFn: read,
        });
        const stop = observer.subscribe(() => {});
        try {
          const revision = prepareUserUpdate(cache, key);
          const recorded = await recordQueries(() =>
            withAfterTasks({
              start: () =>
                withRequestScope(() =>
                  initiateBattle(
                    {
                      client: raced,
                      userIds: [userId],
                      targetIds: [targetId],
                      actionUserId: userId,
                      sector: 100,
                      longitude: 5,
                      latitude: 5,
                    },
                    "COMBAT",
                  ),
                ),
            }).start(),
          );
          const result = recorded.result;
          expect(result.success, result.message).toBe(false);
          expect(result.message).toContain("Attack failed, did the target move?");
          expect(result.userRecovery).toMatchObject({
            userId,
            requiresUserRefresh: true,
          });
          expect(result.userRecovery?.userPatch).toBeUndefined();
          await updateUserCache(cache, key, result, { revision });
          expect(read).not.toHaveBeenCalled();
          expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
          const saved = (await client.query.userData.findFirst({
            where: eq(userData.userId, userId),
          }))!;
          const target = (await client.query.userData.findFirst({
            where: eq(userData.userId, targetId),
          }))!;
          expect(target).toMatchObject({ status: "AWAKE", battleId: null });
          expect(await client.query.battle.findMany()).toEqual([]);
          expect(await client.query.battleHistory.findMany()).toEqual([]);
          expect(await client.query.trainingLog.findMany()).toHaveLength(
            race === "actor moved" ? 0 : 1,
          );
          expect(saved.energyQueueHead).toBe(
            initial.energyQueueHead + (race === "actor moved" ? 0 : 1),
          );
          if (race === "target moved") {
            expect(result.actionNotice).toBe(
              status === "ASLEEP" ? AUTO_WAKE_MESSAGE : AUTO_CHECKOUT_MESSAGE,
            );
            expect(result.userRecovery?.activity).toMatchObject({
              status: "AWAKE",
              battleId: null,
            });
            expect(saved).toMatchObject({ status: "AWAKE", battleId: null });
            expect(cache.getQueryData<UserCache>(key)?.userData).toEqual({
              ...initial,
              ...result.userRecovery?.activity,
            });
            expect(liveActivity.pushActivityUpdate).toHaveBeenCalledTimes(
              status === "HOSPITALIZED" ? 1 : 0,
            );
          } else {
            expect(result.actionNotice).toBeUndefined();
            expect(result.userRecovery?.activity).toBeUndefined();
            expect(cache.getQueryData<UserCache>(key)?.userData).toEqual(initial);
            expect(saved).toMatchObject(
              race === "actor moved"
                ? { status, battleId: null }
                : { status: "BATTLE", battleId: "later-battle" },
            );
            expect(liveActivity.pushActivityUpdate).not.toHaveBeenCalled();
          }
        } finally {
          stop();
          cache.clear();
        }
      },
    );
  }

  it.each([{ isBanned: true }])("preserves arena rejection for %j", async (patch) => {
    const client = await getTestDatabase();
    await client.update(userData).set(patch).where(eq(userData.userId, userId));
    expect((await launch(client)).success).toBe(false);
    expect(await client.query.battle.findMany()).toEqual([]);
  });

  it("rejects AI templates no longer available in the arena", async () => {
    const client = await getTestDatabase();
    await client
      .update(userData)
      .set({ inArena: false })
      .where(eq(userData.userId, aiId));
    expect(await launch(client)).toMatchObject({
      success: false,
      message: "No AI found",
    });
    expect(await client.query.battle.findMany()).toEqual([]);
  });

  for (const battleType of ["ARENA", "TRAINING"] as const) {
    it.each([{ inArena: false }, { isAi: false }, { isSummon: true }])(
      `rejects a selected ${battleType} target changed during readiness: %j`,
      async (patch) => {
        const client = await getTestDatabase();
        const { promise: pending, resolve: release } = deferred<void>();
        const { promise: selection, resolve: selected } = deferred<void>();
        const original = client.query.userData.findFirst.bind(client.query.userData);
        vi.spyOn(client.query.userData, "findFirst").mockImplementation(((
          options: Parameters<typeof original>[0],
        ) => {
          if (options?.with)
            return pending.then(() => original(options)) as ReturnType<typeof original>;
          if (
            options?.where &&
            typeof options.where !== "function" &&
            new MySqlDialect().sqlToQuery(options.where).params.includes(aiId)
          ) {
            return Promise.resolve(original(options)).then((row) => {
              expect(row?.userId).toBe(aiId);
              selected();
              return row;
            }) as ReturnType<typeof original>;
          }
          return original(options);
        }) as typeof original);
        const started = launch(client, {
          aiId,
          ...(battleType === "TRAINING" ? { stats: statSchema.parse({}) } : {}),
        });
        try {
          await selection;
          await client.update(userData).set(patch).where(eq(userData.userId, aiId));
        } finally {
          release();
        }
        expect(await started).toMatchObject({ success: false, message: "No AI found" });
        expect(await client.query.battle.findMany()).toEqual([]);
        expect(await client.query.battleHistory.findMany()).toEqual([]);
        expect(await original({ where: eq(userData.userId, userId) })).toMatchObject({
          status: "AWAKE",
          battleId: null,
        });
      },
    );

    it.each([{ inArena: false }, { isAi: false }, { isSummon: true }])(
      `rejects an unavailable ${battleType} target on direct initiation: %j`,
      async (patch) => {
        const client = await getTestDatabase();
        await client.update(userData).set(patch).where(eq(userData.userId, aiId));
        const result = await initiateBattle(
          { client, userIds: [userId], targetIds: [aiId] },
          battleType,
        );
        expect(result).toMatchObject({ success: false, message: "No AI found" });
        expect(await client.query.battle.findMany()).toEqual([]);
        expect(await client.query.battleHistory.findMany()).toEqual([]);
      },
    );

    it(`rejects a missing ${battleType} target on direct initiation`, async () => {
      const client = await getTestDatabase();
      await client.delete(userData).where(eq(userData.userId, aiId));
      expect(
        await initiateBattle(
          { client, userIds: [userId], targetIds: [aiId] },
          battleType,
        ),
      ).toMatchObject({ success: false, message: "No AI found" });
      expect(await client.query.battle.findMany()).toEqual([]);
    });
  }

  it("starts training against an eligible arena template", async () => {
    const client = await getTestDatabase();
    expect((await launch(client, { aiId, stats: statSchema.parse({}) })).success).toBe(
      true,
    );
    expect(await client.query.battle.findFirst()).toMatchObject({
      battleType: "TRAINING",
    });
  });
});
