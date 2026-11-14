import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import type { RouterOutputs } from "@/app/_trpc/client";
import type { UserUpdate, UserUpdateOptions } from "@/deltas/profile";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  clan,
  item,
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  questHistory,
  territoryWar,
  trainingLog,
  userCookingJob,
  userData,
  userItem,
  userQueue,
  userVote,
  village,
} from "@/drizzle/schema";
import { calcEnergy } from "@/libs/profile";
import { Pusher } from "@/libs/pusher";
import { fetchBattle } from "@/queries/combat";
import { clanRouter } from "@/server/api/routers/clan";
import { homeRouter } from "@/server/api/routers/home";
import { profileRouter } from "@/server/api/routers/profile";
import { territoryWarRouter } from "@/server/api/routers/territoryWar";
import { cleanupTerritoryWarTeams } from "@/server/utils/territoryWar";

import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { IncreaseMaxPoolsTag } from "@/validators/combat";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import type { UserDeltaResponse } from "@/validators/userCache";
import {
  insertClans,
  insertDefaultAiProfile,
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../setup/factories";
import { queueEnergy } from "../../../setup/queues";
import { beforeStatements, interceptExecute } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const caller = (id = "leader") => callerFor(territoryWarRouter, id);
const team = async () => (await getTestDatabase()).query.mpvpBattleQueue.findFirst();
type Profile = RouterOutputs["profile"]["getUser"];
const clients: QueryClient[] = [];
const subscriptions: (() => void)[] = [];
const page = readFileSync(
  join(import.meta.dirname, "../../../../src/app/[shell]/territory-war/page.tsx"),
  "utf8",
);
const onSuccessSource = page.slice(
  page.indexOf("  const onSuccess ="),
  page.indexOf("  const create ="),
);
const transpiler = new (require("bun").Transpiler)({ loader: "tsx" }) as {
  transformSync(source: string): string;
};
const callbackFactory = transpiler.transformSync(
  `function createCallback() { ${onSuccessSource} return onSuccess; }`,
);

/** Exercise the page's shared callback with an observed profile and the production cache merger. */
const cachedProfile = (initial: Profile, read: () => Promise<Profile>) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const key = ["territory-war-cache-profile"];
  const refetch = vi.fn(read);
  client.setQueryData(key, initial);
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: refetch,
    staleTime: Infinity,
  });
  subscriptions.push(observer.subscribe(() => {}));
  const showMutationToast = vi.fn();
  const invalidate = vi.fn(async () => {});
  const onSuccess = new Function(
    "updateUser",
    "showMutationToast",
    "utils",
    `${callbackFactory}\nreturn createCallback();`,
  )(
    (update: UserUpdate | undefined, options: UserUpdateOptions) =>
      updateUserCache(client, key, update, options),
    showMutationToast,
    { territoryWar: { invalidate } },
  ) as (
    result: UserDeltaResponse,
    input: unknown,
    revision: number | undefined,
  ) => Promise<void>;
  return {
    refetch,
    showMutationToast,
    invalidate,
    prepare: () => prepareUserUpdate(client, key),
    onSuccess,
    current: () => client.getQueryData<Profile>(key)!,
  };
};

describeWithDatabase("Territory War participation", () => {
  beforeEach(async () => {
    await resetTables(
      questHistory,
      quest,
      userQueue,
      trainingLog,
      userItem,
      item,
      battleHistory,
      battle,
      mpvpBattleUser,
      mpvpBattleQueue,
      territoryWar,
      clan,
      village,
      userCookingJob,
      userVote,
      userData,
      aiProfile,
    );
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "home", name: "Home", sector: 1, kageId: "leader" },
      { id: "enemy", name: "Enemy", sector: 2, kageId: "rival" },
      {
        id: VILLAGE_SYNDICATE_ID,
        name: "Syndicate",
        sector: 3,
        kageId: "syndicate-chief",
      },
    ]);
    await insertUsers(
      ["leader", "ally", "third", "fourth", "rival"].map((id) => ({
        userId: id,
        username: id,
        villageId: id === "rival" ? "enemy" : "home",
        status: "AWAKE" as const,
        rank: "JONIN" as const,
        level: 50,
        sector: 100,
        curHealth: 5000,
        maxHealth: 5000,
        curChakra: 5000,
        maxChakra: 5000,
        curStamina: 5000,
        maxStamina: 5000,
        regeneration: 0,
      })),
    );
    await insertUsers([
      {
        userId: "guardian",
        username: "guardian",
        isAi: true,
        isWarCamp: true,
        level: 50,
        curHealth: 100,
        maxHealth: 100,
      },
    ]);
    await insertDefaultAiProfile({ userId: "default" });
    await db.insert(territoryWar).values({
      id: "event",
      predecessorId: "initial",
      sector: 100,
      guardianId: "guardian",
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 1800000),
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => {
    subscriptions.splice(0).forEach((stop) => stop());
    clients.splice(0).forEach((client) => client.clear());
    vi.restoreAllMocks();
  });

  for (const operation of ["createTeam", "joinTeam"] as const) {
    it.each(["capacity", "training"] as const)(
      `loads the complete recovery actor for ${operation}: %s`,
      async (scenario) => {
        const db = await getTestDatabase();
        if (operation === "joinTeam")
          expect(
            (await (await caller()).createTeam({ eventId: "event" })).success,
          ).toBe(true);
        const actorId = operation === "createTeam" ? "leader" : "ally";
        await db.update(village).set({ sector: 100 }).where(eq(village.id, "home"));
        const capacity = calcEnergy(50) + 200;
        await db
          .update(userData)
          .set({
            status: "ASLEEP",
            autoWakeUp: true,
            curEnergy: scenario === "capacity" ? capacity : 100,
            maxEnergy: capacity,
          })
          .where(eq(userData.userId, actorId));
        await insertItems([
          {
            id: "capacity-armor",
            itemType: "ARMOR",
            maxDurability: 100,
            effects: [
              IncreaseMaxPoolsTag.parse({
                poolsAffected: ["Energy"],
                power: 200,
                calculation: "static",
              }),
            ],
          },
        ]);
        await insertUserItems([
          {
            id: "armor",
            userId: actorId,
            itemId: "capacity-armor",
            equipped: "CHEST",
            durability: 100,
            level: 1,
          },
        ]);
        if (scenario === "training") {
          await queueEnergy(actorId, [{ stat: "offence", energy: 100 }]);
          await insertQuests([
            {
              id: "queued-stat-quest",
              questType: "daily",
              content: {
                objectives: [
                  SimpleObjective.parse({
                    id: "queued-stat-goal",
                    task: "stats_trained",
                    value: 1000,
                    description: "Train stats",
                    successDescription: "Done",
                  }),
                ],
                reward: ObjectiveReward.parse({}),
                sceneBackground: "",
                sceneCharacters: [],
              },
            },
          ]);
          await insertQuestHistory([
            { userId: actorId, questId: "queued-stat-quest", questType: "daily" },
          ]);
          await db
            .update(userData)
            .set({
              questData: [
                {
                  id: "queued-stat-quest",
                  startAt: new Date().toISOString(),
                  goals: [
                    {
                      id: "queued-stat-goal",
                      value: 0,
                      done: false,
                      collected: false,
                      recentlyDied: false,
                    },
                  ],
                },
              ],
            })
            .where(eq(userData.userId, actorId));
        }
        const before = (await db.query.userData.findFirst({
          where: eq(userData.userId, actorId),
        }))!;
        const actor = callerForDatabase(territoryWarRouter, actorId, db);
        const teamId = (await team())?.id;
        const { result, statements } = await recordQueries(() =>
          operation === "createTeam"
            ? actor.createTeam({ eventId: "event" })
            : actor.joinTeam({ teamId: teamId! }),
        );
        expect(result).toMatchObject({
          success: true,
          actionNotice: "This action woke you up.",
        });
        const saved = (await db.query.userData.findFirst({
          where: eq(userData.userId, actorId),
        }))!;
        expect(saved).toMatchObject({
          status: "QUEUED",
          maxEnergy: capacity,
          curEnergy: scenario === "capacity" ? capacity : 0,
        });
        if (scenario === "training") {
          expect(saved.offence).toBeGreaterThan(before.offence);
          expect(
            saved.questData?.find((tracker) => tracker.id === "queued-stat-quest")
              ?.goals[0]?.value,
          ).toBeCloseTo(saved.offence - before.offence);
          expect(saved.energyQueueHead).toBeGreaterThan(before.energyQueueHead);
          expect(await db.query.trainingLog.findMany()).toMatchObject([
            { userId: actorId, stat: "offence" },
          ]);
        }
        expect(
          statements.filter(
            (statement) =>
              /^select /i.test(statement) &&
              /from `UserData`/i.test(statement) &&
              /[`"]userId[`"]/.test(statement),
          ),
        ).toHaveLength(1);
      },
    );

    it(`preserves the recovery preference guard for ${operation}`, async () => {
      const db = await getTestDatabase();
      if (operation === "joinTeam")
        expect((await (await caller()).createTeam({ eventId: "event" })).success).toBe(
          true,
        );
      const actorId = operation === "createTeam" ? "leader" : "ally";
      await db.update(village).set({ sector: 100 }).where(eq(village.id, "home"));
      const teamId = (await team())?.id;
      await db
        .update(userData)
        .set({ status: "ASLEEP", autoWakeUp: true, curEnergy: 100 })
        .where(eq(userData.userId, actorId));
      await queueEnergy(actorId, [{ stat: "offence", energy: 100 }]);
      const before = (await db.query.userData.findFirst({
        where: eq(userData.userId, actorId),
      }))!;
      let interposed = false;
      const raced = interceptExecute(db, async (_query, run) => {
        if (!interposed) {
          interposed = true;
          await db
            .update(userData)
            .set({ autoWakeUp: false })
            .where(eq(userData.userId, actorId));
        }
        return run();
      });
      const actor = callerForDatabase(territoryWarRouter, actorId, raced);
      const result =
        operation === "createTeam"
          ? await actor.createTeam({ eventId: "event" })
          : await actor.joinTeam({ teamId: teamId! });
      expect(result.success).toBe(false);
      expect(result.actionNotice).toBeUndefined();
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, actorId) }),
      ).toMatchObject({
        status: "ASLEEP",
        autoWakeUp: false,
        curEnergy: 100,
        offence: before.offence,
        energyQueueHead: before.energyQueueHead,
      });
      expect(await db.query.trainingLog.findMany()).toEqual([]);
      expect(
        (await db.query.mpvpBattleUser.findMany()).some(
          (member) => member.userId === actorId,
        ),
      ).toBe(false);
    });
  }

  it("reads the notice and durable next opening without synchronizing or writing", async () => {
    const db = await getTestDatabase();
    const reader = callerForDatabase(territoryWarRouter, "leader", db);
    const active = await recordQueries(() => reader.getNotice());
    expect(active.result.event?.id).toBe("event");
    expect(active.result.nextStartsAt).toBeNull();
    expect(
      active.statements.filter((statement) => /from `TerritoryWar`/i.test(statement)),
    ).toHaveLength(1);
    expect(active.statements.every((statement) => /^select /i.test(statement))).toBe(
      true,
    );
    const resolvedAt = new Date(Date.now() - 1000);
    await db.update(territoryWar).set({ resolvedAt });
    expect(await reader.getNotice()).toEqual({
      event: null,
      nextStartsAt: new Date(resolvedAt.getTime() + 5 * 3_600_000),
    });
    await db.update(territoryWar).set({ resolvedAt: null, endsAt: new Date(0) });
    expect(await reader.getNotice()).toEqual({ event: null, nextStartsAt: null });
    await db.delete(territoryWar);
    expect(await reader.getNotice()).toEqual({ event: null, nextStartsAt: null });
  });

  it("validates sector and competitor and caps a team at three players", async () => {
    const leader = await caller();
    expect((await leader.createTeam({ eventId: "event" })).success).toBe(true);
    const id = (await team())!.id;
    expect((await (await caller("rival")).joinTeam({ teamId: id })).success).toBe(
      false,
    );
    expect((await (await caller("ally")).joinTeam({ teamId: id })).success).toBe(true);
    expect((await (await caller("third")).joinTeam({ teamId: id })).success).toBe(true);
    expect((await (await caller("fourth")).joinTeam({ teamId: id })).success).toBe(
      false,
    );
    expect(
      (
        await (
          await getTestDatabase()
        ).query.userData.findFirst({ where: eq(userData.userId, "fourth") })
      )?.status,
    ).toBe("AWAKE");
    expect((await leader.startBattle({ teamId: id })).success).toBe(true);
    const stored = (await (await getTestDatabase()).query.battle.findFirst())!;
    const snapshot = (await fetchBattle(await getTestDatabase(), stored.id))!;
    expect(
      snapshot.usersState.filter((user) => !user.isAi && !user.isSummon),
    ).toHaveLength(3);
    expect(
      snapshot.usersState.filter((user) => user.isAi && !user.isSummon),
    ).toHaveLength(1);
    expect(
      new Set(
        Object.values(snapshot.extraState.territoryWar!.competitors).map(
          (comp) => comp.id,
        ),
      ),
    ).toEqual(new Set(["village:home"]));
  });

  it.each(["missing", "expired", "resolved"] as const)(
    "confirms a read-only unavailable event rejection without profile hydration: %s",
    async (scenario) => {
      const db = await getTestDatabase();
      if (scenario === "expired")
        await db.update(territoryWar).set({ endsAt: new Date(0) });
      if (scenario === "resolved")
        await db.update(territoryWar).set({ resolvedAt: new Date() });
      const profile = callerForDatabase(profileRouter, "leader", db);
      const initial = await profile.getUser();
      const cache = cachedProfile(initial, () => profile.getUser());
      const revision = cache.prepare();
      await db.insert(userCookingJob).values({
        id: "unsettled-cooking",
        userId: "leader",
        experience: 23,
        finishesAt: new Date(0),
      });
      const measured = await recordQueries(() =>
        callerForDatabase(territoryWarRouter, "leader", db).createTeam({
          eventId: scenario === "missing" ? "missing" : "event",
        }),
      );
      expect(measured.result).toMatchObject({
        success: false,
        message: "This Territory War has ended",
        userDelta: {},
      });
      // Isolation, event and actor relations are independent reads; recovery settings
      // come from the instance cache the profile read filled.
      expect(measured.statements).toHaveLength(3);
      expect(
        measured.statements.every((statement) => /^select /i.test(statement)),
      ).toBe(true);
      await cache.onSuccess(measured.result, undefined, revision);
      expect(cache.refetch).not.toHaveBeenCalled();
      expect(cache.current().userData).toEqual(initial.userData);
      expect(cache.showMutationToast).toHaveBeenCalledWith(measured.result);
      expect(cache.invalidate).toHaveBeenCalledTimes(1);
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }),
      ).toMatchObject({ status: "AWAKE", cookingExperience: 0 });
      expect(await db.query.userCookingJob.findMany()).toHaveLength(1);
      expect(await team()).toBeUndefined();
    },
  );

  it("requires canonical recovery when a rejected Territory War launch settles Cooking", async () => {
    const db = await getTestDatabase();
    const leader = await caller();
    expect((await leader.createTeam({ eventId: "event" })).success).toBe(true);
    const id = (await team())!.id;
    expect((await (await caller("ally")).joinTeam({ teamId: id })).success).toBe(true);
    const profile = callerForDatabase(profileRouter, "leader", db);
    const cache = cachedProfile(await profile.getUser(), () => profile.getUser());
    const revision = cache.prepare();
    await db
      .update(userData)
      .set({ isBanned: true })
      .where(eq(userData.userId, "ally"));
    await db.insert(userCookingJob).values({
      id: "territory-cooking",
      userId: "leader",
      experience: 23,
      finishesAt: new Date(0),
    });
    const result = await leader.startBattle({ teamId: id });
    expect(result).toMatchObject({
      success: false,
      message:
        "All teammates must represent the same village or faction and be queued in the event sector",
    });
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    await cache.onSuccess(result, undefined, revision);
    expect(cache.refetch).toHaveBeenCalledTimes(1);
    expect(cache.current().userData).toMatchObject({
      cookingExperience: 23,
      cookingJobs: [],
      status: "QUEUED",
      battleId: null,
    });
    expect(cache.showMutationToast).toHaveBeenCalledWith(result);
    expect(cache.invalidate).toHaveBeenCalledTimes(1);
    expect(
      await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }),
    ).toMatchObject({ cookingExperience: 23, status: "QUEUED", battleId: null });
    expect(await db.query.userCookingJob.findMany()).toHaveLength(0);
    expect((await team())?.battleId).toBeNull();
  });

  it.each(["leave", "start", "expire"] as const)(
    "preserves an admitted teammate after creator rejection so they can %s",
    async (recovery) => {
      const db = await getTestDatabase();
      await db.update(userData).set({
        isOutlaw: true,
        villageId: VILLAGE_SYNDICATE_ID,
        latitude: 0,
        longitude: 0,
      });
      const ally = await caller("ally");
      let statements = 0;
      let id = "";
      const delayed = interceptExecute(db, async (_query, run) => {
        // The creator's membership is public before their separate status claim.
        if (++statements === 2) {
          const visible = await ally.getCurrent();
          expect(visible.teams).toHaveLength(1);
          id = visible.teams[0]!.id;
          expect((await ally.joinTeam({ teamId: id })).success).toBe(true);
          expect(
            (await (await callerFor(homeRouter, "leader")).toggleSleep()).success,
          ).toBe(true);
        }
        return run();
      });
      const created = await callerForDatabase(
        territoryWarRouter,
        "leader",
        delayed,
      ).createTeam({ eventId: "event" });
      expect(created.success).toBe(false);
      expect((await team())?.id).toBe(id);
      expect(
        (await ally.getCurrent()).teams[0]?.queue.map((member) => member.userId),
      ).toEqual(["ally"]);
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }))
          ?.status,
      ).toBe("ASLEEP");
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "ally") }))
          ?.status,
      ).toBe("QUEUED");
      if (recovery === "expire")
        await cleanupTerritoryWarTeams(db, new Date(Date.now() + 3600000));
      else
        expect(
          (
            await ally[recovery === "start" ? "startBattle" : "leaveTeam"]({
              teamId: id,
            })
          ).success,
        ).toBe(true);
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "ally") }))
          ?.status,
      ).toBe(recovery === "start" ? "BATTLE" : "AWAKE");
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(
        recovery === "start" ? 1 : 0,
      );
    },
  );

  it.each([false, true])(
    "cleans a failed creator's empty lobby only without a reservation: %s",
    async (reserved) => {
      const db = await getTestDatabase();
      const delayed = beforeStatements(db, mpvpBattleQueue, [
        async () => {
          await db
            .update(userData)
            .set({ status: "ASLEEP" })
            .where(eq(userData.userId, "leader"));
        },
        async () => {
          if (reserved) await db.update(mpvpBattleQueue).set({ battleId: "reserved" });
        },
      ]);
      const created = await callerForDatabase(
        territoryWarRouter,
        "leader",
        delayed,
      ).createTeam({ eventId: "event" });
      expect(created.success).toBe(false);
      expect(await db.query.mpvpBattleUser.findMany()).toEqual([]);
      expect((await team())?.battleId).toBe(reserved ? "reserved" : undefined);
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }))
          ?.status,
      ).toBe("ASLEEP");
    },
  );

  it("includes a member admitted just before the launch reservation", async () => {
    const db = await getTestDatabase();
    const leader = await caller();
    await leader.createTeam({ eventId: "event" });
    const id = (await team())!.id;
    const delayed = beforeStatements(db, mpvpBattleQueue, [
      async () => {
        expect((await (await caller("ally")).joinTeam({ teamId: id })).success).toBe(
          true,
        );
      },
    ]);
    const result = await callerForDatabase(
      territoryWarRouter,
      "leader",
      delayed,
    ).startBattle({ teamId: id });
    expect(result.success, result.message).toBe(true);
    const snapshot = (await fetchBattle(
      db,
      ("battleId" in result ? result.battleId : undefined)!,
    ))!;
    expect(
      snapshot.usersState
        .filter((user) => !user.isAi)
        .map((user) => user.userId)
        .sort(),
    ).toEqual(["ally", "leader"]);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "ally") }))
        ?.status,
    ).toBe("BATTLE");
  });

  it("keeps leader-first contested admissions recoverable and consistent with queued status", async () => {
    const db = await getTestDatabase();
    const ids = Array.from({ length: 7 }, (_, index) => `contender-${index}`);
    await insertUsers(
      ids.map((userId) => ({
        userId,
        villageId: "home",
        status: "AWAKE" as const,
        sector: 100,
      })),
    );
    const contenders = ids.map((id) => callerForDatabase(territoryWarRouter, id, db));
    const leader = await caller();
    for (let round = 0; round < 6; round += 1) {
      const created = await leader.createTeam({ eventId: "event" });
      expect(created.success).toBe(true);
      const id = (await team())!.id;
      const admissions = await Promise.allSettled(
        contenders.map((contender) => contender.joinTeam({ teamId: id })),
      );
      expect(admissions.every((result) => result.status === "fulfilled")).toBe(true);
      const members = await db.query.mpvpBattleUser.findMany();
      expect(members.length).toBeGreaterThanOrEqual(2);
      expect(members.length).toBeLessThanOrEqual(3);
      expect(members.some((member) => member.userId === "leader")).toBe(true);
      const queued = (await db.query.userData.findMany()).filter(
        (user) => user.status === "QUEUED",
      );
      expect(queued.map((user) => user.userId).sort()).toEqual(
        members.map((member) => member.userId).sort(),
      );
      expect(new Set(members.map((member) => member.slot)).size).toBe(members.length);
      await resetTables(mpvpBattleUser, mpvpBattleQueue);
      await db.update(userData).set({ status: "AWAKE" });
    }
  });

  it("resolves any outlaw clan and displays that competitor's active bonus", async () => {
    const db = await getTestDatabase();
    const until = new Date(Date.now() + 3600000);
    await insertClans([
      {
        id: "faction",
        name: "Faction",
        leaderId: "leader",
        villageId: VILLAGE_SYNDICATE_ID,
        territoryWarBoostUntil: until,
      },
    ]);
    await db
      .update(userData)
      .set({ isOutlaw: true, villageId: VILLAGE_SYNDICATE_ID, clanId: "faction" })
      .where(eq(userData.userId, "leader"));
    const current = await (await caller()).getCurrent();
    expect(current.competitor).toMatchObject({ id: "clan:faction", name: "Faction" });
    expect(current.boostUntil).toEqual(until);
    expect((await (await caller()).createTeam({ eventId: "event" })).success).toBe(
      true,
    );
    expect((await team())!.attackerEntityId).toBe("clan:faction");
    await db
      .update(userData)
      .set({ clanId: null })
      .where(eq(userData.userId, "leader"));
    expect((await (await caller()).getCurrent()).competitor.id).toBe(
      `village:${VILLAGE_SYNDICATE_ID}`,
    );
  });

  it.each([
    "active",
    "missing membership",
    "missing lobby",
    "missing event",
    "expired event",
  ] as const)("rolls back a partially launched team with %s", async (ownership) => {
    const db = await getTestDatabase();
    await insertClans([
      { id: "citizen-clan", name: "Citizens", leaderId: "leader", villageId: "home" },
    ]);
    await db.update(userData).set({ clanId: "citizen-clan" });
    const leader = await caller();
    expect((await leader.createTeam({ eventId: "event" })).success).toBe(true);
    const id = (await team())!.id;
    expect((await (await caller("ally")).joinTeam({ teamId: id })).success).toBe(true);
    const delayed = beforeStatements(db, userData, [
      async () => {
        const kicked = await (await callerFor(clanRouter, "leader")).kickMember({
          clanId: "citizen-clan",
          memberId: "ally",
        });
        expect(kicked.success, kicked.message).toBe(true);
      },
      async () => {
        if (ownership === "missing membership")
          await db.delete(mpvpBattleUser).where(eq(mpvpBattleUser.userId, "leader"));
        if (ownership === "missing lobby")
          await db.delete(mpvpBattleQueue).where(eq(mpvpBattleQueue.id, id));
        if (ownership === "missing event")
          await db.delete(territoryWar).where(eq(territoryWar.id, "event"));
        if (ownership === "expired event")
          await db
            .update(territoryWar)
            .set({ endsAt: new Date(Date.now() - 1000) })
            .where(eq(territoryWar.id, "event"));
      },
    ]);
    const failed = await callerForDatabase(
      territoryWarRouter,
      "leader",
      delayed,
    ).startBattle({ teamId: id });
    expect(failed.success).toBe(false);
    expect(await db.query.battle.findMany()).toEqual([]);
    const restored = (await db.query.userData.findFirst({
      where: eq(userData.userId, "leader"),
    }))!;
    expect(restored.battleId).toBeNull();
    expect(restored.status).toBe(ownership === "active" ? "QUEUED" : "AWAKE");
    if (ownership === "active") {
      expect((await team())!.battleId).toBeNull();
      expect(
        (await db.query.mpvpBattleUser.findMany()).map((member) => member.userId),
      ).toEqual(["leader"]);
      const retry = await leader.startBattle({ teamId: id });
      expect(retry.success, retry.message).toBe(true);
    }
  });

  it("allows leaving a waiting team and rejects a stale event", async () => {
    const db = await getTestDatabase();
    const leader = await caller();
    await leader.createTeam({ eventId: "event" });
    const id = (await team())!.id;
    expect((await leader.leaveTeam({ teamId: id })).success).toBe(true);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }))
        ?.status,
    ).toBe("AWAKE");
    await db.update(territoryWar).set({ resolvedAt: new Date() });
    expect((await leader.createTeam({ eventId: "event" })).success).toBe(false);
    expect((await leader.startBattle({ teamId: id })).success).toBe(false);
  });

  it.each([false, true])(
    "retries leave deadlocks while preserving a started reservation: %s",
    async (started) => {
      const db = await getTestDatabase();
      const leader = await caller();
      expect((await leader.createTeam({ eventId: "event" })).success).toBe(true);
      const id = (await team())!.id;
      if (started)
        await db
          .update(mpvpBattleQueue)
          .set({ battleId: "reserved" })
          .where(eq(mpvpBattleQueue.id, id));
      let attempts = 0;
      const delayed = beforeStatements(db, mpvpBattleQueue, [
        async () => {
          attempts++;
          throw new Error(
            "Deadlock found when trying to get lock; try restarting transaction",
          );
        },
        async () => {
          attempts++;
        },
      ]);
      const result = await callerForDatabase(
        territoryWarRouter,
        "leader",
        delayed,
      ).leaveTeam({ teamId: id });
      expect(attempts).toBe(2);
      expect(result.success).toBe(!started);
      expect((await db.query.mpvpBattleUser.findMany()).length).toBe(started ? 1 : 0);
      expect(
        (await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }))
          ?.status,
      ).toBe(started ? "QUEUED" : "AWAKE");
      expect((await leader.leaveTeam({ teamId: id })).success).toBe(false);
    },
  );

  it.each(["failed", "started", "replaced"] as const)(
    "retries reservation cleanup deadlocks after a %s launch",
    async (state) => {
      const db = await getTestDatabase();
      const leader = await caller();
      expect((await leader.createTeam({ eventId: "event" })).success).toBe(true);
      const id = (await team())!.id;
      let cleanupAttempts = 0;
      const delayed = beforeStatements(db, mpvpBattleQueue, [
        async () => {
          if (state !== "started")
            await db
              .update(userData)
              .set({ isBanned: true })
              .where(eq(userData.userId, "leader"));
        },
        async () => {
          cleanupAttempts++;
          if (state === "replaced")
            await db
              .update(mpvpBattleQueue)
              .set({ battleId: "replacement" })
              .where(eq(mpvpBattleQueue.id, id));
          throw new Error(
            "Deadlock found when trying to get lock; try restarting transaction",
          );
        },
        async () => {
          cleanupAttempts++;
        },
      ]);
      const result = await callerForDatabase(
        territoryWarRouter,
        "leader",
        delayed,
      ).startBattle({ teamId: id });
      expect(cleanupAttempts).toBe(2);
      expect(result.success).toBe(state === "started");
      const saved = (await team())!;
      const battles = await db.query.battle.findMany();
      expect(battles.length).toBe(state === "started" ? 1 : 0);
      expect(saved.battleId).toBe(
        state === "started"
          ? battles[0]!.id
          : state === "replaced"
            ? "replacement"
            : null,
      );
      if (state === "failed") {
        expect(result.message).toContain("All teammates must represent");
        await db
          .update(userData)
          .set({ isBanned: false })
          .where(eq(userData.userId, "leader"));
        const retry = await leader.startBattle({ teamId: id });
        expect(retry.success, retry.message).toBe(true);
      }
    },
  );
});
