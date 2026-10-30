import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as combat from "@/routers/combat";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  conversation,
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  user2conversation,
  userData,
  userQueue,
} from "@/drizzle/schema";
import * as raidQueries from "@/queries/raids";
import { getRaidChatConversationId } from "@/libs/raids";
import { Pusher } from "@/libs/pusher";
import { raidsRouter } from "@/server/api/routers/raids";
import { profileRouter } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";
import { AllObjectives, RaidObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";
import { beforeStatements } from "../../../../setup/statements";
import { fetchUpdatedUser } from "@/routers/profile";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { queueEnergy } from "../../../../setup/queues";
import { countUserReads } from "../../../../setup/userReads";

describe("raid join cache reconciliation", () => {
  beforeEach(() => { stubRateLimitTransport(); });
  afterEach(() => vi.restoreAllMocks());
  const databaseFor = (pendingQueue: boolean, canClaim = true) => {
    const userRead = vi.fn().mockResolvedValue({
      villageId: "queue-village",
      sector: 7,
      status: "AWAKE",
      isBanned: false,
      energyQueueHead: 0,
      energyQueueTail: pendingQueue ? 1 : 0,
    });
    const insert = vi.fn(() => ({
      values: () => ({ onDuplicateKeyUpdate: async () => ({ rowsAffected: 1 }) }),
    }));
    return {
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
      update: () => ({
        set: () => ({ where: async () => ({ rowsAffected: canClaim ? 1 : 0 }) }),
      }),
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
});

describeWithDatabase("raid join committed queue", () => {
  beforeEach(() => { stubRateLimitTransport(); });
  beforeEach(async () => {
    await resetTables(
      userQueue,
      user2conversation,
      conversation,
      mpvpBattleUser,
      mpvpBattleQueue,
      quest,
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
  afterEach(() => { resetServerModuleStubs(); vi.restoreAllMocks(); });
  it("applies fresh virtual achievement progress from raid admission to the warmed profile", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED", rank: "JONIN", level: 50, primaryElement: "Fire", secondaryElement: "Water", reputationPointsTotal: 10 }).where(eq(userData.userId, "queue-sql-user"));
    await db.update(mpvpBattleQueue).set({ createdAt: new Date(0) }).where(eq(mpvpBattleQueue.id, "cache-team"));
    await db.insert(mpvpBattleUser).values({ id: "starter", userId: "queue-sql-user", clanBattleId: "cache-team", side: "ATTACKER", slot: 0 });
    await insertQuests([{
      id: "cache-reputation-achievement", name: "Reputation", questType: "achievement", hidden: false,
      content: { objectives: [AllObjectives.parse({ id: "reputation", task: "reputation_points", value: 1000 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] },
    }]);
    const profile = await (await callerFor(profileRouter, "queue-sql-user")).getUser();
    const valueOf = (trackers: NonNullable<typeof profile.userData>["questData"] | undefined) => trackers?.find((entry) => entry.id === "cache-reputation-achievement")?.goals.find((goal) => goal.id === "reputation")?.value;
    expect(valueOf(profile.userData?.questData)).toBe(10);
    await db.update(userData).set({ reputationPointsTotal: 20 }).where(eq(userData.userId, "queue-sql-user"));
    vi.spyOn(combat, "initiateBattle").mockImplementation(async () => {
      await db.update(userData).set({ status: "BATTLE", battleId: "started-raid" }).where(eq(userData.userId, "queue-sql-user"));
      return { success: true, message: "Started", battleId: "started-raid", requiresUserRefresh: false,
        userPatch: { status: "BATTLE", battleId: "started-raid" }, userDelta: {},
      };
    });
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    const refetch = vi.fn();
    client.setQueryDefaults(key, { queryFn: refetch });
    client.setQueryData(key, profile);
    const revision = prepareUserUpdate(client, key);
    const result = await (await callerFor(raidsRouter, "queue-sql-user")).startRaidBattle({ teamId: "cache-team" });
    expect(result.success).toBe(true);
    expect(valueOf(result.userPatch?.questData)).toBe(20);
    expect(result.userPatch?.persistedQuestData).toBeUndefined();
    expect(result.achievementProgress?.some((entry) => entry.questId === "cache-reputation-achievement")).toBe(true);
    await updateUserCache(client, key, result.userPatch, { revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
    const cached = client.getQueryData<typeof profile>(key);
    expect(valueOf(cached?.userData?.questData)).toBe(20);
    expect(cached?.achievementProgress).toEqual(result.achievementProgress);
    expect(refetch).not.toHaveBeenCalled();
    client.clear();
  });

  it("preserves the started battle and queue receipt when admission requires canonical recovery", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "queue-sql-user"));
    await db.update(mpvpBattleQueue).set({ createdAt: new Date(0) }).where(eq(mpvpBattleQueue.id, "cache-team"));
    await db.insert(mpvpBattleUser).values({ id: "starter", userId: "queue-sql-user", clanBattleId: "cache-team", side: "ATTACKER", slot: 0 });
    await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    vi.spyOn(combat, "initiateBattle").mockImplementation(async () => {
      await db.update(userData).set({ status: "BATTLE", battleId: "confirmed-raid" }).where(eq(userData.userId, "queue-sql-user"));
      return { success: true, message: "Started", battleId: "confirmed-raid", requiresUserRefresh: false };
    });
    const api = await callerFor(raidsRouter, "queue-sql-user");
    const result = await api.startRaidBattle({ teamId: "cache-team" });
    expect(result).toMatchObject({ success: true, battleId: "confirmed-raid" });
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "queue-sql-user") })).toMatchObject({ status: "BATTLE", battleId: "confirmed-raid" });
    expect(await db.query.mpvpBattleQueue.findFirst({ where: eq(mpvpBattleQueue.id, "cache-team") })).toMatchObject({ battleId: "confirmed-raid" });
    expect((await api.startRaidBattle({ teamId: "cache-team" })).success).toBe(false);
    expect(combat.initiateBattle).toHaveBeenCalledTimes(1);
  });
  it("recovers the actor after expired-raid cleanup without returning the queued snapshot", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "queue-sql-user"));
    await db.update(mpvpBattleQueue).set({ createdAt: new Date(0) }).where(eq(mpvpBattleQueue.id, "cache-team"));
    await db.insert(mpvpBattleUser).values({ id: "starter", userId: "queue-sql-user", clanBattleId: "cache-team", side: "ATTACKER", slot: 0 });
    const profile = await callerFor(profileRouter, "queue-sql-user");
    const initial = await profile.getUser();
    expect(initial.userData?.status).toBe("QUEUED");
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    client.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(client, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await db.update(quest).set({ raidEndsAt: new Date(0) }).where(eq(quest.id, "cache-raid"));
      const revision = prepareUserUpdate(client, key);
      const result = await (await callerFor(raidsRouter, "queue-sql-user")).startRaidBattle({ teamId: "cache-team" });
      expect(result).toMatchObject({ success: false, message: "This raid has ended" });
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      expect(await db.query.userData.findFirst({ where: eq(userData.userId, "queue-sql-user") })).toMatchObject({ status: "AWAKE" });
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
      expect(await db.query.mpvpBattleQueue.findMany()).toHaveLength(0);
      await updateUserCache(client, key, result.userPatch, { revision, delta: result.userDelta });
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(client.getQueryData<typeof initial>(key)?.userData?.status).toBe("AWAKE");
    } finally { unsubscribe(); client.clear(); }
  });
  it.each([{ success: true, requiresUserRefresh: false }, { success: true, requiresUserRefresh: true }, { success: false, requiresUserRefresh: false }])("reconciles raid admission according to its settlement contract (%j)", async ({ success, requiresUserRefresh }) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "queue-sql-user"));
    await db.update(mpvpBattleQueue).set({ createdAt: new Date(0) }).where(eq(mpvpBattleQueue.id, "cache-team"));
    await db.insert(mpvpBattleUser).values({ id: "starter", userId: "queue-sql-user", clanBattleId: "cache-team", side: "ATTACKER", slot: 0 });
    await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    vi.spyOn(combat, "initiateBattle").mockImplementation(async () => {
      await db.update(userData).set({ status: success ? "BATTLE" : "QUEUED", battleId: success ? "started-raid" : null, curEnergy: 17, pveFights: 5 }).where(eq(userData.userId, "queue-sql-user"));
      return success ? { success: true, message: "Started", battleId: "started-raid", requiresUserRefresh,
        userPatch: requiresUserRefresh ? undefined : { status: "BATTLE", battleId: "started-raid", curEnergy: 17 },
        userDelta: requiresUserRefresh ? undefined : { pveFights: 1 },
      } : { success: false, message: "Admission rejected" };
    });
    const result = await (await callerFor(raidsRouter, "queue-sql-user")).startRaidBattle({ teamId: "cache-team" });
    expect(result.success).toBe(success);
    if (success && !requiresUserRefresh) {
      expect(result).toMatchObject({ userDelta: { pveFights: 1 }, userPatch: { status: "BATTLE", battleId: "started-raid", curEnergy: 17 } });
      expect(result.userPatch).not.toHaveProperty("items");
      expect(result.userPatch).not.toHaveProperty("bloodline");
    } else {
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
    }
  });

  it.each(["queued", "unchanged", "changed"] as const)("reconciles ready-up through its actual callback after %s SQL", async (outcome) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: outcome === "queued" ? "QUEUED" : "AWAKE", regeneration: 0, travelFinishAt: null, battleId: null }).where(eq(userData.userId, "queue-sql-user"));
    if (outcome === "queued") await db.insert(mpvpBattleUser).values({ id: "ready-member", userId: "queue-sql-user", clanBattleId: "cache-team", side: "ATTACKER", slot: 0 });
    const profile = await callerFor(profileRouter, "queue-sql-user");
    const initial = await profile.getUser();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = [["profile", "getUser"], { type: "query" }];
    cache.setQueryData(key, initial);
    const getUser = vi.fn(() => profile.getUser());
    const observer = new QueryObserver(cache, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const stop = observer.subscribe(() => undefined);
    const updateUser = vi.fn((patch: UserPatch | undefined, options: UserUpdateOptions) => updateUserCache(cache, key, patch, options));
    const leaf = { invalidate: vi.fn(async () => undefined) };
    const source = readFileSync(join(import.meta.dirname, "../../../../../src/layout/RaidBrowser.tsx"), "utf8");
    const callbacks = source.slice(source.indexOf("api.raids.readyToQueue.useMutation(")).match(/useMutation\((\{[\s\S]*?\n    \})\);/)?.[1];
    if (!callbacks) throw new Error("Ready-up callbacks not found");
    const options = new Function("recoverUser", "prepareUserUpdate", "updateUser", "util", "setIsReadyToQueue", "showMutationToast", `return (${callbacks});`)(
      vi.fn(), () => prepareUserUpdate(cache, key), updateUser,
      { raids: { getUserRaidQueue: leaf, getActiveRaidTeams: leaf } }, vi.fn(), vi.fn(),
    ) as { onMutate: () => number | undefined; onSuccess: (data: unknown, input: unknown, revision: number | undefined) => void };
    const client = outcome === "changed"
      ? beforeStatements(db, userData, [async () => { await db.update(userData).set({ status: "ASLEEP" }).where(eq(userData.userId, "queue-sql-user")); }])
      : db;
    if (outcome === "unchanged") {
      const execute = raidQueries.updateUserDataForReadyToQueue2;
      // Execute the real no-op, then expose the valid zero-change result reported in production.
      vi.spyOn(raidQueries, "updateUserDataForReadyToQueue2").mockImplementation(((...args: Parameters<typeof execute>) => Promise.resolve(execute(...args)).then(() => ({ rowsAffected: 0 }))) as unknown as typeof execute);
    }
    const counted = countUserReads(client);
    try {
      const revision = options.onMutate();
      const measured = await recordQueries(() => callerForDatabase(raidsRouter, "queue-sql-user", counted.client).readyToQueue());
      const result = measured.result;
      expect(result.success).toBe(true);
      expect(counted.getReads()).toBe(1);
      expect(result.userDelta).toBeUndefined();
      if (outcome === "queued") expect(result.userPatch).toMatchObject({ status: "AWAKE", battleId: null, travelFinishAt: null });
      else expect(result.userPatch).toBeUndefined();
      options.onSuccess(result, undefined, revision);
      await updateUser.mock.results[0]?.value;
      expect(updateUser).toHaveBeenCalledTimes(1);
      expect(getUser).toHaveBeenCalledTimes(outcome === "queued" ? 0 : 1);
      const saved = await db.query.userData.findFirst({ where: eq(userData.userId, "queue-sql-user") });
      expect(cache.getQueryData<typeof initial>(key)?.userData?.status).toBe(saved?.status);
      expect(saved?.status).toBe(outcome === "changed" ? "ASLEEP" : "AWAKE");
      expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
    } finally { stop(); cache.clear(); }
  });

  it("confirms a newer battle when ready-up's guarded cleanup loses", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [async () => {
      await db.update(userData).set({ status: "BATTLE", battleId: "newer-battle" }).where(eq(userData.userId, "queue-sql-user"));
    }]);
    const result = await callerForDatabase(raidsRouter, "queue-sql-user", client).readyToQueue();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
  });

  it("confirms the guarded wake when leaving after a newer combat starts", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "queue-sql-user"));
    await db.insert(mpvpBattleUser).values({ id: "leaver", userId: "queue-sql-user", clanBattleId: "cache-team", side: "ATTACKER", slot: 0 });
    await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    const snapshot = await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    stubProfile("fetchUpdatedUser", async () => snapshot);
    const client = beforeStatements(db, userData, [async () => {
      await db.update(userData).set({ status: "BATTLE", battleId: "newer-battle" }).where(eq(userData.userId, "queue-sql-user"));
    }]);
    const result = await callerForDatabase(raidsRouter, "queue-sql-user", client).leaveRaidQueue();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
  });

  for (const pendingQueue of [false, true]) {
    it(`commits queue and chat membership without settling unrelated training, training=${pendingQueue}`, async () => {
      const db = await getTestDatabase();
      if (pendingQueue) await queueEnergy("queue-sql-user", [{ stat: "offence", energy: 10 }]);
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
