import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import type { UserPatch, UserUpdateOptions } from "@/deltas/profile";
import {
  conversation,
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  raidDamageThreshold,
  raidParticipation,
  user2conversation,
  userData,
  userQueue,
} from "@/drizzle/schema";
import { AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { Pusher } from "@/libs/pusher";
import { getRaidChatConversationId } from "@/libs/raids";
import * as raidQueries from "@/queries/raids";
import * as combat from "@/routers/combat";
import { fetchUpdatedUser } from "@/routers/profile";
import { profileRouter } from "@/server/api/routers/profile";
import { raidsRouter } from "@/server/api/routers/raids";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { AllObjectives, RaidObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import { queueEnergy } from "../../../../setup/queues";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";
import { countUserReads } from "../../../../setup/userReads";

describe("raid join cache reconciliation", () => {
  beforeEach(() => {
    stubRateLimitTransport();
    stubProfile("fetchAllGameSettings", async () => []);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });
  const databaseFor = (pendingQueue: boolean, canClaim = true) => {
    const actor = {
      villageId: "queue-village",
      sector: 7,
      status: "AWAKE",
      isBanned: false,
      energyQueueHead: 0,
      energyQueueTail: pendingQueue ? 1 : 0,
    };
    const userRead = vi.fn().mockResolvedValue(actor);
    const insert = vi.fn(() => ({
      values: () => ({ onDuplicateKeyUpdate: async () => ({ rowsAffected: 1 }) }),
    }));
    return {
      actor,
      query: {
        userData: { findFirst: userRead },
        quest: {
          findFirst: async () => ({
            id: "cache-raid",
            name: "Cache Raid",
            raidEndsAt: new Date(Date.now() + 60000),
            raidBossCurrentHealth: 100,
            content: {
              objectives: [
                RaidObjective.parse({
                  id: "cache-objective",
                  task: "open_raid",
                  sector: 7,
                  opponentAIs: [{ ids: ["boss"], number: 100, quantity: 1 }],
                }),
              ],
            },
          }),
        },
        mpvpBattleQueue: { findFirst: async () => ({ id: "cache-team", queue: [] }) },
      },
      select: () => ({
        from: () => ({ innerJoin: () => ({ where: async () => [] }) }),
      }),
      update: vi.fn(() => ({
        set: () => ({ where: async () => ({ rowsAffected: canClaim ? 1 : 0 }) }),
      })),
      insert,
    };
  };
  for (const pendingQueue of [false, true]) {
    it(`returns a confirmed queue transition without post-reading the actor, training=${pendingQueue}`, async () => {
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      const db = databaseFor(pendingQueue);
      const result = await callerForDatabase(
        raidsRouter,
        "queue-user",
        db as never,
      ).joinRaidQueue({ questId: "cache-raid", teamId: "cache-team" });
      expect(result.success).toBe(true);
      expect(result.userDelta).toEqual({});
      expect(result.userPatch).toMatchObject({ status: "QUEUED" });
      expect(db.query.userData.findFirst).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledTimes(3);
    });
  }
  it("does not return a queue patch or insert membership after the status claim fails", async () => {
    const db = databaseFor(false, false);
    const result = await callerForDatabase(
      raidsRouter,
      "queue-user",
      db as never,
    ).joinRaidQueue({ questId: "cache-raid", teamId: "cache-team" });
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(db.insert).not.toHaveBeenCalled();
  });
  it.each(["missing raid", "full team", "wrong sector", "inactive status"])(
    "confirms unchanged profile data for a rejected join: %s",
    async (reason) => {
      const db = databaseFor(false);
      if (reason === "missing raid")
        vi.spyOn(db.query.quest, "findFirst").mockResolvedValue(undefined as never);
      if (reason === "full team")
        vi.spyOn(db.query.mpvpBattleQueue, "findFirst").mockResolvedValue({
          id: "cache-team",
          queue: [{}, {}, {}],
        } as never);
      if (reason === "wrong sector") db.actor.sector = 8;
      if (reason === "inactive status") db.actor.status = "ASLEEP";
      const result = await callerForDatabase(
        raidsRouter,
        "queue-user",
        db as never,
      ).joinRaidQueue({ questId: "cache-raid", teamId: "cache-team" });
      expect(result).toMatchObject({
        success: false,
        userDelta: {},
        userExpected: { status: db.actor.status },
      });
      expect(result.userPatch).toBeUndefined();
      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.query.userData.findFirst).toHaveBeenCalledTimes(1);
    },
  );
});

describeWithDatabase("raid join committed queue", () => {
  beforeEach(() => {
    stubRateLimitTransport();
    stubProfile("fetchAllGameSettings", async () => []);
  });
  beforeEach(async () => {
    await resetTables(
      userQueue,
      user2conversation,
      conversation,
      mpvpBattleUser,
      mpvpBattleQueue,
      quest,
      raidDamageThreshold,
      raidParticipation,
      userData,
    );
    await insertUsers([{ userId: "queue-sql-user", status: "AWAKE", sector: 7 }]);
    await insertQuests([
      {
        id: "cache-raid",
        name: "Cache Raid",
        questType: "raid",
        raidEndsAt: new Date(Date.now() + 60000),
        raidBossCurrentHealth: 100,
        content: {
          objectives: [
            RaidObjective.parse({
              id: "cache-objective",
              task: "open_raid",
              sector: 7,
              opponentAIs: [{ ids: ["boss"], number: 100, quantity: 1 }],
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    const db = await getTestDatabase();
    await db.insert(mpvpBattleQueue).values({
      id: "cache-team",
      battleType: "RAID_BATTLE",
      attackerEntityId: "cache-raid",
      defenderEntityId: "cache-raid",
      sector: 7,
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });
  for (const failure of ["missing team", "full team", "chat failure"] as const) {
    it.each([false, true])(
      `reports only confirmed recovery after ${failure}, started=%s`,
      async (started) => {
        const db = await getTestDatabase();
        await db
          .update(userData)
          .set({ status: "ASLEEP", regeneration: 0 })
          .where(eq(userData.userId, "queue-sql-user"));
        const enterBattle = async () => {
          if (started)
            await db
              .update(userData)
              .set({ status: "BATTLE", battleId: "newer-battle" })
              .where(eq(userData.userId, "queue-sql-user"));
        };
        let client = db;
        if (failure === "chat failure") {
          client = beforeStatements(db, user2conversation, [
            async () => {
              await enterBattle();
              throw new Error("Chat membership failed");
            },
          ]);
        } else {
          const readTeam = db.query.mpvpBattleQueue.findFirst.bind(
            db.query.mpvpBattleQueue,
          );
          let reads = 0;
          vi.spyOn(db.query.mpvpBattleQueue, "findFirst").mockImplementation((async (
            ...args: Parameters<typeof readTeam>
          ) => {
            if (++reads === 2) {
              await enterBattle();
              if (failure === "missing team")
                await db
                  .delete(mpvpBattleQueue)
                  .where(eq(mpvpBattleQueue.id, "cache-team"));
              else
                await db.insert(mpvpBattleUser).values(
                  [0, 1, 2].map((slot) => ({
                    id: `full-${slot}`,
                    userId: `other-${slot}`,
                    clanBattleId: "cache-team",
                    side: "ATTACKER" as const,
                    slot,
                  })),
                );
            }
            return readTeam(...args);
          }) as unknown as typeof readTeam);
        }
        const counted = countUserReads(client);
        const result = await callerForDatabase(
          raidsRouter,
          "queue-sql-user",
          counted.client,
        ).joinRaidQueue({ questId: "cache-raid", teamId: "cache-team" });
        expect(result).toMatchObject({
          success: false,
          actionNotice: AUTO_WAKE_MESSAGE,
        });
        expect(counted.getReads()).toBe(1);
        if (started)
          expect(result.userRecovery).toEqual({
            userId: "queue-sql-user",
            requiresUserRefresh: true,
          });
        else
          expect(result.userRecovery?.activity).toMatchObject({
            status: "AWAKE",
            battleId: null,
          });
        const saved = await db.query.userData.findFirst({
          where: eq(userData.userId, "queue-sql-user"),
        });
        expect(saved).toMatchObject({
          status: started ? "BATTLE" : "AWAKE",
          battleId: started ? "newer-battle" : null,
        });

        const cache = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });
        const key = [["profile", "getUser"], { type: "query" }];
        const cached = { userData: saved };
        cache.setQueryData(key, cached);
        const getUser = vi.fn(async () => cached);
        const observer = new QueryObserver(cache, {
          queryKey: key,
          queryFn: getUser,
          staleTime: Infinity,
        });
        const stop = observer.subscribe(() => undefined);
        try {
          await updateUserCache(cache, key, result, {
            revision: prepareUserUpdate(cache, key),
            delta: result.userDelta,
          });
          expect(getUser).not.toHaveBeenCalled();
          expect(cache.getQueryData<typeof cached>(key)?.userData?.status).toBe(
            saved?.status,
          );
        } finally {
          stop();
          cache.clear();
        }
      },
    );
  }
  it.each([false, true])(
    "refreshes a rejected ready-up only when cached activity differs, stale=%s",
    async (stale) => {
      const db = await getTestDatabase();
      const traveling = {
        status: "TRAVEL" as const,
        travelFinishAt: new Date(Date.now() + 3600000),
      };
      if (!stale)
        await db
          .update(userData)
          .set(traveling)
          .where(eq(userData.userId, "queue-sql-user"));
      const profile = await callerFor(profileRouter, "queue-sql-user");
      const initial = await profile.getUser();
      if (stale)
        await db
          .update(userData)
          .set(traveling)
          .where(eq(userData.userId, "queue-sql-user"));
      const cache = new QueryClient();
      const key = [["profile", "getUser"], { type: "query" }];
      cache.setQueryData(key, initial);
      const getUser = vi.fn(() => profile.getUser());
      const observer = new QueryObserver(cache, {
        queryKey: key,
        queryFn: getUser,
        staleTime: Infinity,
      });
      const stop = observer.subscribe(() => undefined);
      try {
        const revision = prepareUserUpdate(cache, key);
        const { result, statements } = await recordQueries(() =>
          callerForDatabase(raidsRouter, "queue-sql-user", db).readyToQueue(),
        );
        expect(result).toMatchObject({
          success: false,
          userDelta: {},
          userExpected: { status: "TRAVEL" },
        });
        expect(
          statements.some((statement) => /^\s*(update|insert|delete)/i.test(statement)),
        ).toBe(false);
        await updateUserCache(cache, key, result, { revision });
        expect(getUser).toHaveBeenCalledTimes(stale ? 1 : 0);
        expect(cache.getQueryData<typeof initial>(key)?.userData?.status).toBe(
          "TRAVEL",
        );
      } finally {
        stop();
        cache.clear();
      }
    },
  );

  it("returns settled training with a rejected reward claim without a profile read", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ isOutlaw: true })
      .where(eq(userData.userId, "queue-sql-user"));
    const profile = await callerFor(profileRouter, "queue-sql-user");
    const initial = await profile.getUser();
    await queueEnergy("queue-sql-user", [{ stat: "offence", energy: 10 }]);
    const cache = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    cache.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(cache, {
      queryKey: key,
      queryFn: getUser,
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(cache, key);
      const result = await callerForDatabase(
        raidsRouter,
        "queue-sql-user",
        db,
      ).claimDamageReward({ questId: "cache-raid", thresholdId: "missing" });
      expect(result).toMatchObject({ success: false, userDelta: {} });
      await updateUserCache(cache, key, result, { revision });
      const saved = (await db.query.userData.findFirst({
        where: eq(userData.userId, "queue-sql-user"),
      }))!;
      expect(saved.energyQueueHead).toBeGreaterThan(initial.userData!.energyQueueHead);
      expect(cache.getQueryData<typeof initial>(key)?.userData).toMatchObject({
        offence: saved.offence,
        energyQueueHead: saved.energyQueueHead,
      });
      expect(getUser).not.toHaveBeenCalled();
    } finally {
      stop();
      cache.clear();
    }
  });

  it("refreshes rewards when another claim wins after the opening snapshot", async () => {
    const db = await getTestDatabase();
    await db.insert(raidParticipation).values({
      id: "cache-participation",
      userId: "queue-sql-user",
      questId: "cache-raid",
      damageDealt: 100,
    });
    await db.insert(raidDamageThreshold).values({
      id: "cache-threshold",
      questId: "cache-raid",
      damageRequired: 1,
      rewards: ObjectiveReward.parse({}),
    });
    const profile = await callerFor(profileRouter, "queue-sql-user");
    const initial = await profile.getUser();
    const raced = beforeStatements(db, raidParticipation, [
      async () => {
        await db
          .update(raidParticipation)
          .set({ rewardsClaimed: ["cache-threshold"] })
          .where(eq(raidParticipation.userId, "queue-sql-user"));
        await db
          .update(userData)
          .set({ money: 50 })
          .where(eq(userData.userId, "queue-sql-user"));
      },
    ]);
    const cache = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    cache.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(cache, {
      queryKey: key,
      queryFn: getUser,
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(cache, key);
      const result = await callerForDatabase(
        raidsRouter,
        "queue-sql-user",
        raced,
      ).claimDamageReward({ questId: "cache-raid", thresholdId: "cache-threshold" });
      expect(result.success).toBe(false);
      expect(result.userDelta).toBeUndefined();
      await updateUserCache(cache, key, result, { revision });
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(cache.getQueryData<typeof initial>(key)?.userData?.money).toBe(50);
    } finally {
      stop();
      cache.clear();
    }
  });
  it("applies fresh virtual achievement progress from raid admission to the warmed profile", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({
        status: "QUEUED",
        rank: "JONIN",
        level: 50,
        primaryElement: "Fire",
        secondaryElement: "Water",
        reputationPointsTotal: 10,
      })
      .where(eq(userData.userId, "queue-sql-user"));
    await db
      .update(mpvpBattleQueue)
      .set({ createdAt: new Date(0) })
      .where(eq(mpvpBattleQueue.id, "cache-team"));
    await db.insert(mpvpBattleUser).values({
      id: "starter",
      userId: "queue-sql-user",
      clanBattleId: "cache-team",
      side: "ATTACKER",
      slot: 0,
    });
    await insertQuests([
      {
        id: "cache-reputation-achievement",
        name: "Reputation",
        questType: "achievement",
        hidden: false,
        content: {
          objectives: [
            AllObjectives.parse({
              id: "reputation",
              task: "reputation_points",
              value: 1000,
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    const profile = await (await callerFor(profileRouter, "queue-sql-user")).getUser();
    const reputationOf = (
      trackers: NonNullable<typeof profile.userData>["questData"] | undefined,
    ) =>
      trackers
        ?.find((entry) => entry.id === "cache-reputation-achievement")
        ?.goals.find((goal) => goal.id === "reputation")?.value;
    expect(reputationOf(profile.userData?.questData)).toBe(10);
    await db
      .update(userData)
      .set({ reputationPointsTotal: 20 })
      .where(eq(userData.userId, "queue-sql-user"));
    vi.spyOn(combat, "initiateBattle").mockImplementation(async () => {
      await db
        .update(userData)
        .set({ status: "BATTLE", battleId: "started-raid" })
        .where(eq(userData.userId, "queue-sql-user"));
      return {
        success: true,
        message: "Started",
        battleId: "started-raid",
        requiresUserRefresh: false,
        userPatch: { status: "BATTLE", battleId: "started-raid" },
        userDelta: {},
      };
    });
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    const refetch = vi.fn();
    client.setQueryDefaults(key, { queryFn: refetch });
    client.setQueryData(key, profile);
    const revision = prepareUserUpdate(client, key);
    const result = await (
      await callerFor(raidsRouter, "queue-sql-user")
    ).startRaidBattle({ teamId: "cache-team" });
    expect(result.success).toBe(true);
    expect(reputationOf(result.userPatch?.questData)).toBe(20);
    expect(result.userPatch).not.toHaveProperty("persistedQuestData");
    expect(
      result.achievementProgress?.some(
        (entry) => entry.questId === "cache-reputation-achievement",
      ),
    ).toBe(true);
    await updateUserCache(client, key, result.userPatch, {
      revision,
      delta: result.userDelta,
      achievementProgress: result.achievementProgress,
    });
    const cached = client.getQueryData<typeof profile>(key);
    expect(reputationOf(cached?.userData?.questData)).toBe(20);
    expect(cached?.achievementProgress).toEqual(result.achievementProgress);
    expect(refetch).not.toHaveBeenCalled();
    client.clear();
  });

  it("preserves the started battle and queue receipt when admission requires canonical recovery", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "queue-sql-user"));
    await db
      .update(mpvpBattleQueue)
      .set({ createdAt: new Date(0) })
      .where(eq(mpvpBattleQueue.id, "cache-team"));
    await db.insert(mpvpBattleUser).values({
      id: "starter",
      userId: "queue-sql-user",
      clanBattleId: "cache-team",
      side: "ATTACKER",
      slot: 0,
    });
    await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    vi.spyOn(combat, "initiateBattle").mockImplementation(async () => {
      await db
        .update(userData)
        .set({ status: "BATTLE", battleId: "confirmed-raid" })
        .where(eq(userData.userId, "queue-sql-user"));
      return {
        success: true,
        message: "Started",
        battleId: "confirmed-raid",
        requiresUserRefresh: false,
      };
    });
    const api = await callerFor(raidsRouter, "queue-sql-user");
    const result = await api.startRaidBattle({ teamId: "cache-team" });
    expect(result).toMatchObject({ success: true, battleId: "confirmed-raid" });
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(
      await db.query.userData.findFirst({
        where: eq(userData.userId, "queue-sql-user"),
      }),
    ).toMatchObject({ status: "BATTLE", battleId: "confirmed-raid" });
    expect(
      await db.query.mpvpBattleQueue.findFirst({
        where: eq(mpvpBattleQueue.id, "cache-team"),
      }),
    ).toMatchObject({ battleId: "confirmed-raid" });
    expect((await api.startRaidBattle({ teamId: "cache-team" })).success).toBe(false);
    expect(combat.initiateBattle).toHaveBeenCalledTimes(1);
  });
  it("recovers the actor after expired-raid cleanup without returning the queued snapshot", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "queue-sql-user"));
    await db
      .update(mpvpBattleQueue)
      .set({ createdAt: new Date(0) })
      .where(eq(mpvpBattleQueue.id, "cache-team"));
    await db.insert(mpvpBattleUser).values({
      id: "starter",
      userId: "queue-sql-user",
      clanBattleId: "cache-team",
      side: "ATTACKER",
      slot: 0,
    });
    const profile = await callerFor(profileRouter, "queue-sql-user");
    const initial = await profile.getUser();
    expect(initial.userData?.status).toBe("QUEUED");
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: getUser,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await db
        .update(quest)
        .set({ raidEndsAt: new Date(0) })
        .where(eq(quest.id, "cache-raid"));
      const revision = prepareUserUpdate(client, key);
      const result = await (
        await callerFor(raidsRouter, "queue-sql-user")
      ).startRaidBattle({ teamId: "cache-team" });
      expect(result).toMatchObject({ success: false, message: "This raid has ended" });
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      expect(
        await db.query.userData.findFirst({
          where: eq(userData.userId, "queue-sql-user"),
        }),
      ).toMatchObject({ status: "AWAKE" });
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
      expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(0);
      await updateUserCache(client, key, result.userPatch, {
        revision,
        delta: result.userDelta,
      });
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(client.getQueryData<typeof initial>(key)?.userData?.status).toBe("AWAKE");
    } finally {
      unsubscribe();
      client.clear();
    }
  });
  it.each([
    { success: true, requiresUserRefresh: false },
    { success: true, requiresUserRefresh: true },
    { success: false, requiresUserRefresh: false },
  ])(
    "reconciles raid admission according to its settlement contract (%j)",
    async ({ success, requiresUserRefresh }) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({ status: "QUEUED" })
        .where(eq(userData.userId, "queue-sql-user"));
      await db
        .update(mpvpBattleQueue)
        .set({ createdAt: new Date(0) })
        .where(eq(mpvpBattleQueue.id, "cache-team"));
      await db.insert(mpvpBattleUser).values({
        id: "starter",
        userId: "queue-sql-user",
        clanBattleId: "cache-team",
        side: "ATTACKER",
        slot: 0,
      });
      await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
      vi.spyOn(combat, "initiateBattle").mockImplementation(async () => {
        await db
          .update(userData)
          .set({
            status: success ? "BATTLE" : "QUEUED",
            battleId: success ? "started-raid" : null,
            curEnergy: 17,
            pveFights: 5,
          })
          .where(eq(userData.userId, "queue-sql-user"));
        return success
          ? {
              success: true,
              message: "Started",
              battleId: "started-raid",
              requiresUserRefresh,
              userPatch: requiresUserRefresh
                ? undefined
                : { status: "BATTLE", battleId: "started-raid", curEnergy: 17 },
              userDelta: requiresUserRefresh ? undefined : { pveFights: 1 },
            }
          : { success: false, message: "Admission rejected" };
      });
      const result = await (
        await callerFor(raidsRouter, "queue-sql-user")
      ).startRaidBattle({ teamId: "cache-team" });
      expect(result.success).toBe(success);
      if (success && !requiresUserRefresh) {
        expect(result).toMatchObject({
          userDelta: { pveFights: 1 },
          userPatch: { status: "BATTLE", battleId: "started-raid", curEnergy: 17 },
        });
        expect(result.userPatch).not.toHaveProperty("items");
        expect(result.userPatch).not.toHaveProperty("bloodline");
      } else {
        expect(result.userPatch).toBeUndefined();
        expect(result.userDelta).toBeUndefined();
      }
    },
  );

  it.each(["queued", "unchanged", "changed"] as const)(
    "reconciles ready-up through its actual callback after %s SQL",
    async (outcome) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({
          status: outcome === "queued" ? "QUEUED" : "AWAKE",
          regeneration: 0,
          travelFinishAt: null,
          battleId: null,
        })
        .where(eq(userData.userId, "queue-sql-user"));
      if (outcome === "queued")
        await db.insert(mpvpBattleUser).values({
          id: "ready-member",
          userId: "queue-sql-user",
          clanBattleId: "cache-team",
          side: "ATTACKER",
          slot: 0,
        });
      const profile = await callerFor(profileRouter, "queue-sql-user");
      const initial = await profile.getUser();
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const key = [["profile", "getUser"], { type: "query" }];
      cache.setQueryData(key, initial);
      const getUser = vi.fn(() => profile.getUser());
      const observer = new QueryObserver(cache, {
        queryKey: key,
        queryFn: getUser,
        staleTime: Infinity,
      });
      const stop = observer.subscribe(() => undefined);
      const updateUser = vi.fn(
        (patch: UserPatch | undefined, options: UserUpdateOptions) =>
          updateUserCache(cache, key, patch, options),
      );
      const leaf = { invalidate: vi.fn(async () => undefined) };
      const source = readFileSync(
        join(import.meta.dirname, "../../../../../src/layout/RaidBrowser.tsx"),
        "utf8",
      );
      const callbacks = source
        .slice(source.indexOf("api.raids.readyToQueue.useMutation("))
        .match(/useMutation\((\{[\s\S]*?\n    \})\);/)?.[1];
      if (!callbacks) throw new Error("Ready-up callbacks not found");
      const options = new Function(
        "recoverUser",
        "prepareUserUpdate",
        "updateUser",
        "util",
        "setIsReadyToQueue",
        "showMutationToast",
        `return (${callbacks});`,
      )(
        vi.fn(),
        () => prepareUserUpdate(cache, key),
        updateUser,
        { raids: { getUserRaidQueue: leaf, getActiveRaidTeams: leaf } },
        vi.fn(),
        vi.fn(),
      ) as {
        onMutate: () => number | undefined;
        onSuccess: (
          data: unknown,
          input: unknown,
          revision: number | undefined,
        ) => void;
      };
      const client =
        outcome === "changed"
          ? beforeStatements(db, userData, [
              async () => {
                await db
                  .update(userData)
                  .set({ status: "ASLEEP" })
                  .where(eq(userData.userId, "queue-sql-user"));
              },
            ])
          : db;
      if (outcome === "unchanged") {
        const execute = raidQueries.updateUserDataForReadyToQueue2;
        // Execute the real no-op, then expose the valid zero-change result reported in production.
        vi.spyOn(raidQueries, "updateUserDataForReadyToQueue2").mockImplementation(((
          ...args: Parameters<typeof execute>
        ) =>
          Promise.resolve(execute(...args)).then(() => ({
            rowsAffected: 0,
          }))) as unknown as typeof execute);
      }
      const counted = countUserReads(client);
      try {
        const revision = options.onMutate();
        const measured = await recordQueries(() =>
          callerForDatabase(
            raidsRouter,
            "queue-sql-user",
            counted.client,
          ).readyToQueue(),
        );
        const result = measured.result;
        expect(result.success).toBe(true);
        expect(counted.getReads()).toBe(1);
        expect(result.userDelta).toBeUndefined();
        if (outcome === "queued")
          expect(result.userPatch).toMatchObject({
            status: "AWAKE",
            battleId: null,
            travelFinishAt: null,
          });
        else expect(result.userPatch).toBeUndefined();
        options.onSuccess(result, undefined, revision);
        await updateUser.mock.results[0]?.value;
        expect(updateUser).toHaveBeenCalledTimes(1);
        expect(getUser).toHaveBeenCalledTimes(outcome === "queued" ? 0 : 1);
        const saved = await db.query.userData.findFirst({
          where: eq(userData.userId, "queue-sql-user"),
        });
        expect(cache.getQueryData<typeof initial>(key)?.userData?.status).toBe(
          saved?.status,
        );
        expect(saved?.status).toBe(outcome === "changed" ? "ASLEEP" : "AWAKE");
        expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
      } finally {
        stop();
        cache.clear();
      }
    },
  );

  it("rejects a lost recovery before ready-up cleanup or wake-up feedback", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "ASLEEP", autoWakeUp: true })
      .where(eq(userData.userId, "queue-sql-user"));
    await db.insert(mpvpBattleUser).values({
      id: "ready-member",
      userId: "queue-sql-user",
      clanBattleId: "cache-team",
      side: "ATTACKER",
      slot: 0,
    });
    const client = beforeStatements(db, userData, [
      async () => {
        await db
          .update(userData)
          .set({ status: "BATTLE", battleId: "newer-battle" })
          .where(eq(userData.userId, "queue-sql-user"));
      },
    ]);
    const result = await callerForDatabase(
      raidsRouter,
      "queue-sql-user",
      client,
    ).readyToQueue();
    expect(result.success).toBe(false);
    expect(result.actionNotice).toBeUndefined();
    expect(result.message).not.toContain("woke you up");
    expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(1);
    expect(
      await db.query.userData.findFirst({
        where: eq(userData.userId, "queue-sql-user"),
      }),
    ).toMatchObject({ status: "BATTLE", battleId: "newer-battle" });
  });

  it("confirms a newer battle when ready-up's guarded cleanup loses", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [
      async () => {
        await db
          .update(userData)
          .set({ status: "BATTLE", battleId: "newer-battle" })
          .where(eq(userData.userId, "queue-sql-user"));
      },
    ]);
    const result = await callerForDatabase(
      raidsRouter,
      "queue-sql-user",
      client,
    ).readyToQueue();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
  });

  it("removes the team when its last member leaves", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "queue-sql-user"));
    await db.insert(mpvpBattleUser).values({
      id: "leaver",
      userId: "queue-sql-user",
      clanBattleId: "cache-team",
      side: "ATTACKER",
      slot: 0,
    });
    const result = await (
      await callerFor(raidsRouter, "queue-sql-user")
    ).leaveRaidQueue();
    expect(result.success).toBe(true);
    expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(0);
  });

  it("keeps the team for a member who joins while the last one leaves", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "queue-sql-user"));
    await db.insert(mpvpBattleUser).values({
      id: "leaver",
      userId: "queue-sql-user",
      clanBattleId: "cache-team",
      side: "ATTACKER",
      slot: 0,
    });
    // The joiner lands after the leaver's row is gone and before the empty-team cleanup.
    const client = beforeStatements(
      db,
      mpvpBattleQueue,
      [
        async () => {
          await db.insert(mpvpBattleUser).values({
            id: "joiner",
            userId: "queue-joiner",
            clanBattleId: "cache-team",
            side: "ATTACKER",
            slot: 1,
          });
        },
      ],
      { operations: ["delete"] },
    );
    const result = await callerForDatabase(
      raidsRouter,
      "queue-sql-user",
      client,
    ).leaveRaidQueue();
    expect(result.success).toBe(true);
    expect(await db.query.mpvpBattleQueue.findMany()).toEqual([
      expect.objectContaining({ id: "cache-team" }),
    ]);
    expect(await db.query.mpvpBattleUser.findMany()).toEqual([
      expect.objectContaining({ id: "joiner" }),
    ]);
  });

  it("confirms the guarded wake when leaving after a newer combat starts", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "QUEUED" })
      .where(eq(userData.userId, "queue-sql-user"));
    await db.insert(mpvpBattleUser).values({
      id: "leaver",
      userId: "queue-sql-user",
      clanBattleId: "cache-team",
      side: "ATTACKER",
      slot: 0,
    });
    await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    const snapshot = await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    stubProfile("fetchUpdatedUser", async () => snapshot);
    const client = beforeStatements(db, userData, [
      async () => {
        await db
          .update(userData)
          .set({ status: "BATTLE", battleId: "newer-battle" })
          .where(eq(userData.userId, "queue-sql-user"));
      },
    ]);
    const result = await callerForDatabase(
      raidsRouter,
      "queue-sql-user",
      client,
    ).leaveRaidQueue();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
  });

  for (const pendingQueue of [false, true]) {
    it(`commits queue and chat membership without settling unrelated training, training=${pendingQueue}`, async () => {
      const db = await getTestDatabase();
      if (pendingQueue)
        await queueEnergy("queue-sql-user", [{ stat: "offence", energy: 10 }]);
      const reads = vi.spyOn(db.query.userData, "findFirst");
      const result = await (
        await callerFor(raidsRouter, "queue-sql-user")
      ).joinRaidQueue({ questId: "cache-raid", teamId: "cache-team" });
      expect(result.success).toBe(true);
      expect(result.userDelta).toEqual({});
      expect(result.userPatch).toMatchObject({ status: "QUEUED" });
      expect(reads).toHaveBeenCalledTimes(1);
      const [saved, membership, chat] = await Promise.all([
        db.query.userData.findFirst({ where: eq(userData.userId, "queue-sql-user") }),
        db.query.mpvpBattleUser.findFirst({
          where: eq(mpvpBattleUser.userId, "queue-sql-user"),
        }),
        db.query.user2conversation.findFirst({
          where: eq(user2conversation.userId, "queue-sql-user"),
        }),
      ]);
      expect(saved?.status).toBe("QUEUED");
      expect(membership?.clanBattleId).toBe("cache-team");
      expect(chat?.conversationId).toBe(getRaidChatConversationId("cache-raid"));
    });
  }
});
