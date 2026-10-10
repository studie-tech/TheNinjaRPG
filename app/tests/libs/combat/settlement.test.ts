// @vitest-environment node
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import * as nextServer from "next/server";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  aiProfile,
  battle,
  battleAction,
  battleHistory,
  logBattleLengths,
  item,
  userData,
  userItem,
  userItemImbuement,
} from "@/drizzle/schema";
import { captureCombatCacheSnapshot, combatProfilePatch } from "@/libs/combat/userCache";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import { combatEnergyRecoverySql, updateBattle, updateUser } from "@/libs/combat/database";
import { applyEffects } from "@/libs/combat/process";
import type { CompleteBattle } from "@/libs/combat/types";
import { alignBattle, calcBattleResult } from "@/libs/combat/util";
import { Pusher, type PusherClient } from "@/libs/pusher";
import { combatRouter, fetchBattle, initiateBattle } from "@/server/api/routers/combat";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { getTagSchema } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
} from "./helpers/battleScenario";

const trigger = vi.fn(async () => {});
const pusher = { trigger } as unknown as PusherClient;
const scenario = (final: boolean) =>
  makeCompleteBattle({
    id: "settlement",
    activeUserId: "winner",
    width: 13,
    height: 9,
    version: 1,
    rewardScaling: 1,
    background: "default",
    createdAt: new Date(),
    updatedAt: new Date(),
    roundStartAt: new Date(),
    usersState: [
      makeBattleUser("winner", {
        direction: "left",
        rank: "JONIN",
        rankedLp: 100,
        rankedStreak: 0,
        rankedWins: 0,
        villageId: "red",
        curHealth: 100,
        money: 100000,
        pvpStreak: 0,
        originalMoney: 100000,
        sector: 335,
        isAi: false,
        isSummon: false,
      }),
      makeBattleUser("loser", {
        rank: "JONIN",
        rankedLp: 100,
        rankedStreak: 0,
        rankedWins: 0,
        villageId: "blue",
        curHealth: 0,
        leftBattle: final,
        money: 100000,
        pvpStreak: 0,
        originalMoney: 100000,
        sector: 335,
        isAi: false,
        isSummon: false,
      }),
    ],
  });

const settle = async (snapshot: CompleteBattle, userId = "winner", fail = false) => {
  const client = await getTestDatabase();
  const result = calcBattleResult(snapshot, userId, []);
  if (!result) return null;
  result.money = userId === "winner" ? 9600 : -9600;
  const claim = await updateBattle(
    client,
    result,
    userId,
    snapshot,
    snapshot.version,
    pusher,
  );
  if (!claim) return null;
  const { finishBattle } = claim;
  await Promise.all([
    finishBattle(),
    updateUser(client, pusher, snapshot, result, userId),
  ]);
  if (fail) throw new Error("Later reward failed");
  return result;
};

const balance = async (userId = "winner") =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({ where: eq(userData.userId, userId) })
  )?.money;
const persisted = async () =>
  (await getTestDatabase()).query.battle.findFirst({
    where: eq(battle.id, "settlement"),
  });

describeWithDatabase("CAS combat settlement", () => {
  beforeEach(async () => {
    await resetTables(
      battle,
      battleAction,
      battleHistory,
      aiProfile,
      logBattleLengths,
      userItemImbuement,
      userItem,
      item,
      userData,
    );
    trigger.mockClear();
    vi.spyOn(await getTestDatabase(), "transaction").mockImplementation(() => {
      throw new Error("Combat settlement must not open a transaction");
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    // Rate limiting is external to settlement; SQL tests must not contact Redis.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/pipeline")
          ? [{ result: [59, 60] }]
          : { result: [59, 60] },
      ),
    );
    vi.spyOn(nextServer, "after").mockImplementation(() => {});
    await insertUsers(
      ["winner", "loser"].map((userId) => ({
        userId,
        username: userId,
        money: 100000,
        battleId: "settlement",
        status: "BATTLE",
        curEnergy: 10,
        maxEnergy: 100,
        regeneration: 0,
      })),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("keeps finished imbuement effects in the accepted compact profile after persisted battle settlement", async () => {
    const database = await getTestDatabase();
    await insertUsers([
      { userId: "imbue-player", username: "ImbuePlayer", rank: "JONIN", level: 10, status: "AWAKE", isOutlaw: true, pveFights: 10, curHealth: 100, curChakra: 100, curStamina: 100, curEnergy: 10, regeneration: 0, ninjutsuMastery: 100 },
      { userId: "imbue-ai", username: "ImbueAI", isAi: true, isSummon: false, rank: "NONE", level: 1, curHealth: 100 },
    ]);
    await insertItems([
      { id: "imbue-chest", itemType: "ARMOR", slot: "CHEST", canBeImbued: true, maxDurability: 100, effects: [] },
      { id: "imbue-crystal", itemType: "CRYSTAL", effects: [
        getTagSchema("increasemastery").parse({ masteryTypes: ["Ninjutsu"], power: 10, powerPerLevel: 0, calculation: "static" }),
        getTagSchema("increasemaxpools").parse({ poolsAffected: ["Energy"], power: 100, powerPerLevel: 0, calculation: "static" }),
      ] },
    ]);
    await insertUserItems([{ id: "imbue-stack", userId: "imbue-player", itemId: "imbue-chest", quantity: 1, equipped: "CHEST", durability: 100 }]);
    await database.insert(userItemImbuement).values({ id: "imbue-row", userItemId: "imbue-stack", imbuementItemId: "imbue-crystal", craftingFinishedAt: new Date(Date.now() - 86_400_000) });
    await database.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
    const original = (await fetchUpdatedUser({ client: database, userId: "imbue-player" })).user!;
    const started = await initiateBattle({ client: database, userIds: ["imbue-player"], targetIds: ["imbue-ai"] }, "ARENA");
    expect(started.success).toBe(true);
    const snapshot = (await fetchBattle(database, started.battleId!))!;
    const serializedDate = snapshot.extraState.profileCacheSnapshots!["imbue-player"]!.masterySources.items![0]!.imbuements![0]!.craftingFinishedAt;
    expect(typeof serializedDate).toBe("string");
    snapshot.usersState.find((user) => !user.isAi)!.curHealth = 100;
    const enemy = snapshot.usersState.find((user) => user.isAi)!;
    enemy.curHealth = 0;
    enemy.leftBattle = true;
    const result = calcBattleResult(snapshot, "imbue-player", [])!;
    // Relation rewards require profile reconciliation; isolate the eligible solo PvE outcome.
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    await updateUser(database, pusher, snapshot, result, "imbue-player");
    expect(result.profileUpdate).toBeDefined();

    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    const current = { ...original, status: "BATTLE" as const, battleId: started.battleId! };
    client.setQueryData(key, { userData: current, notifications: [] });
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
      queryFn: async () => { reads++; return { userData: (await fetchUpdatedUser({ client: database, userId: "imbue-player" })).user }; } });
    const close = observer.subscribe(() => {});
    try {
      await updateUserCache(client, key, (user) => combatProfilePatch(user, result.profileUpdate!), { revision: prepareUserUpdate(client, key), delta: result.profileUpdate!.userDelta });
      const cached = client.getQueryData<{ userData: typeof current }>(key)!.userData;
      const authoritative = (await fetchUpdatedUser({ client: database, userId: "imbue-player" })).user!;
      expect(authoritative.maxEnergy).toBe(650);
      expect(authoritative.effectiveMasteries.ninjutsuMastery).toBe(110);
      expect(cached.maxEnergy).toBe(authoritative.maxEnergy);
      expect(cached.effectiveMasteries).toEqual(authoritative.effectiveMasteries);
      expect(cached.items[0]!.durability).toBe(authoritative.items[0]!.durability);
      expect(authoritative.items[0]!.durability).toBe(100);
      expect(cached.status).toBe("AWAKE");
      expect(cached.battleId).toBeNull();
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      expect(reads).toBe(0);
    } finally {
      close();
      client.clear();
    }
  });

  it.each([false, true])("reconciles the initiation PvE counter after arena settlement (refreshed start: %s)", async (refreshed) => {
    const database = await getTestDatabase();
    await insertUsers([
      { userId: "counter-player", username: "CounterPlayer", rank: "NONE", level: 1, status: "AWAKE", isOutlaw: true, pveFights: 10, curHealth: 100, curChakra: 100, curStamina: 100, curEnergy: 10, regeneration: 0 },
      { userId: "counter-ai", username: "CounterAI", isAi: true, isSummon: false, rank: "NONE", level: 1, curHealth: 100 },
    ]);
    await database.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
    const original = (await database.query.userData.findFirst({ where: eq(userData.userId, "counter-player") }))!;
    const started = await initiateBattle({ client: database, userIds: ["counter-player"], targetIds: ["counter-ai"] }, "ARENA");
    expect(started.success).toBe(true);
    const snapshot = (await database.query.battle.findFirst({ where: eq(battle.id, started.battleId!) }))! as CompleteBattle;
    expect(snapshot.extraState.profileCacheSnapshots?.["counter-player"]?.pveFights).toBe(10);
    const inBattle = (await database.query.userData.findFirst({ where: eq(userData.userId, "counter-player") }))!;
    expect(inBattle.pveFights).toBe(11);
    snapshot.usersState.find((user) => !user.isAi)!.curHealth = 100;
    const enemy = snapshot.usersState.find((user) => user.isAi)!;
    enemy.curHealth = 0;
    enemy.leftBattle = true;
    const result = calcBattleResult(snapshot, "counter-player", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    await updateUser(database, pusher, snapshot, result, "counter-player");
    const after = (await database.query.userData.findFirst({ where: eq(userData.userId, "counter-player") }))!;
    expect(after.pveFights).toBe(11);
    expect(result.profileUpdate?.userPatch.pveFights).toBe(after.pveFights);

    const key = [["profile", "getUser"], { type: "query" }];
    const client = new QueryClient();
    const current = { ...(refreshed ? inBattle : original), items: [], questData: [], userQuests: [], completedQuests: [], status: "BATTLE", battleId: started.battleId } as unknown as NonNullable<UserWithRelations>;
    client.setQueryData(key, { userData: current });
    let reads = 0;
    const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
      queryFn: async () => { reads++; return { userData: { ...current, ...after } }; } });
    const close = observer.subscribe(() => {});
    try {
      await updateUserCache(client, key, (user) => combatProfilePatch(user, result.profileUpdate!), { revision: prepareUserUpdate(client, key), delta: result.profileUpdate!.userDelta });
      const cached = client.getQueryData<{ userData: typeof current }>(key)!.userData;
      expect(cached.pveFights).toBe(after.pveFights);
      expect(cached.status).toBe("AWAKE");
      expect(cached.battleId).toBeNull();
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      expect(reads).toBe(refreshed ? 1 : 0);
    } finally {
      close();
      client.clear();
    }
  });

  it("returns confirmed compact PvE progression only for the player whose battle guard commits", async () => {
    const database = await getTestDatabase();
    const snapshot = scenario(true);
    snapshot.battleType = "ARENA";
    snapshot.usersState[1]!.isAi = true;
    snapshot.usersState[0]!.rank = "NONE";
    const original = (await database.query.userData.findFirst({ where: eq(userData.userId, "winner") }))!;
    snapshot.extraState.profileCacheSnapshots = { winner: captureCombatCacheSnapshot({ ...original, items: [] }) };
    snapshot.extraState.energyCapacity = { winner: 100 };
    snapshot.extraState.energyRegeneration = { winner: 0 };
    const result = calcBattleResult(snapshot, "winner", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    result.money = -0.5; result.experience = 0.75; result.earnedExperience = 0.25; result.seichiSilver = 0.5;
    result.curHealth = 90.75; result.curChakra = 80.25; result.curStamina = 70.5;
    await updateUser(database, pusher, snapshot, result, "winner");
    const after = (await database.query.userData.findFirst({ where: eq(userData.userId, "winner") }))!;
    expect(result.profileUpdate?.userId).toBe("winner");
    expect(result.profileUpdate?.userPatch.curEnergy).toBe(after.curEnergy);
    expect(result.profileUpdate?.userPatch.regenAt).toEqual(after.regenAt);
    expect(result.profileUpdate?.userDelta.money).toBe(after.money - original.money);
    expect(result.profileUpdate?.userDelta.experience).toBe(after.experience - original.experience);
    expect(result.profileUpdate?.userDelta.earnedExperience).toBe(after.earnedExperience - original.earnedExperience);
    expect(result.profileUpdate?.userDelta.seichiSilver).toBe(after.seichiSilver - original.seichiSilver);
    expect(result.profileUpdate?.userPatch.curHealth).toBe(after.curHealth);
    expect(result.profileUpdate?.userPatch.curChakra).toBe(after.curChakra);
    expect(result.profileUpdate?.userPatch.curStamina).toBe(after.curStamina);
    expect(result.profileUpdate?.userDelta.ninjutsuMastery).toBe(after.ninjutsuMastery - original.ninjutsuMastery);
    expect(result.profileUpdate?.baseline).not.toHaveProperty("masterySources");
    const replay = { ...result, profileUpdate: undefined };
    await updateUser(database, pusher, snapshot, replay, "winner");
    expect(replay.profileUpdate).toBeUndefined();
    expect((await database.query.userData.findFirst({ where: eq(userData.userId, "winner") }))!.money).toBe(after.money);
  });

  it("omits PvE cache rewards when the player has already joined a replacement battle", async () => {
    const database = await getTestDatabase();
    const snapshot = scenario(true);
    snapshot.battleType = "ARENA";
    snapshot.usersState[1]!.isAi = true;
    const original = (await database.query.userData.findFirst({ where: eq(userData.userId, "winner") }))!;
    snapshot.extraState.profileCacheSnapshots = { winner: captureCombatCacheSnapshot({ ...original, items: [] }) };
    snapshot.extraState.energyCapacity = { winner: 100 };
    snapshot.extraState.energyRegeneration = { winner: 0 };
    const result = calcBattleResult(snapshot, "winner", [])!;
    result.villagePrestige = 0; result.villageTokens = 0; result.anbuPoints = 0; result.clanPoints = 0;
    await database.update(userData).set({ battleId: "replacement" }).where(eq(userData.userId, "winner"));
    await updateUser(database, pusher, snapshot, result, "winner");
    expect(result.profileUpdate).toBeUndefined();
    expect((await database.query.userData.findFirst({ where: eq(userData.userId, "winner") }))!.battleId).toBe("replacement");
  });

  it("does not credit Energy regeneration on a forced profile refresh during combat", async () => {
    const database = await getTestDatabase();
    const regenAt = new Date(Date.now() - 120_000);
    await database.update(userData).set({ regenAt, regeneration: 3 }).where(eq(userData.userId, "winner"));
    await database.insert(battle).values(scenario(false));
    const { user } = await fetchUpdatedUser({ client: database, userId: "winner", forceRegen: true });
    expect(user?.curEnergy).toBe(10);
    const after = await database.query.userData.findFirst({ where: eq(userData.userId, "winner") });
    expect(after?.curEnergy).toBe(10);
    expect(after?.regenAt.getTime()).toBe(regenAt.getTime());
  });

  it("does not let a delayed profile refresh reopen combat or grant Energy", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({status: "AWAKE", battleId: null}).where(eq(userData.userId, "winner"));
    // Bootstrap profile rows before delaying only the regeneration write.
    await fetchUpdatedUser({client: database, userId: "winner", forceRegen: true});
    await database.update(userData).set({regenAt: new Date(Date.now() - 120_000), regeneration: 3}).where(eq(userData.userId, "winner"));
    let enteredCombat = false;
    const delayedDatabase = new Proxy(database, {
      get(target, key, receiver) {
        if (key !== "update") return Reflect.get(target, key, receiver);
        return (table: Parameters<typeof database.update>[0]) => {
          const builder = database.update(table);
          return {
            set(values: Parameters<typeof builder.set>[0]) {
              const update = builder.set(values);
              return {
                async where(condition: Parameters<typeof update.where>[0]) {
                  if (table === userData && "primaryElement" in values && !enteredCombat) {
                    enteredCombat = true;
                    await database.update(userData).set({status: "BATTLE", battleId: "settlement"}).where(eq(userData.userId, "winner"));
                  }
                  return update.where(condition);
                },
              };
            },
          };
        };
      },
    });
    const {user} = await fetchUpdatedUser({client: delayedDatabase, userId: "winner", forceRegen: true});
    expect(enteredCombat).toBe(true);
    expect(user?.status).toBe("BATTLE");
    const after = await database.query.userData.findFirst({where: eq(userData.userId, "winner")});
    expect(after?.status).toBe("BATTLE");
    expect(after?.curEnergy).toBe(10);
  });

  it.each([100, 15])(
    "credits combat Energy within the preloaded capacity %s without changing base capacity",
    async (capacity) => {
      const database = await getTestDatabase();
      await database
        .update(userData)
        .set({ regenAt: new Date(Date.now() - 120_000), regeneration: 3 })
        .where(eq(userData.userId, "winner"));
      const snapshot = scenario(true);
      snapshot.extraState.energyCapacity = { winner: capacity };
      await database.insert(battle).values(snapshot);
      await settle(snapshot);
      const after = (await database.query.userData.findFirst({
        where: eq(userData.userId, "winner"),
      }))!;
      expect(after.curEnergy).toBeGreaterThanOrEqual(Math.min(capacity, 16));
      expect(after.curEnergy).toBeLessThanOrEqual(Math.min(capacity, 16.1));
      expect(after.maxEnergy).toBe(100);
    },
  );

  it.each([45, 75])("restarts regeneration after %s seconds in combat", async seconds => {
    const snapshot = scenario(false);
    snapshot.extraState.energyCapacity = { winner: 100 };
    const database = await getTestDatabase();
    const regenAt = new Date(Date.now() - seconds * 1000);
    await database.update(userData).set({regenAt, regeneration: 3}).where(eq(userData.userId, "winner"));
    await database.insert(battle).values(snapshot);
    const settlementStartedAt = Date.now();
    await settle(snapshot);
    const settlementFinishedAt = Date.now();
    const after = await database.query.userData.findFirst({where: eq(userData.userId, "winner")});
    expect(after!.curEnergy).toBeGreaterThanOrEqual(10 + seconds * 3 / 60);
    expect(after!.curEnergy).toBeLessThanOrEqual(10 + seconds * 3 / 60 + 0.1);
    expect(after?.regenAt.getTime()).toBeGreaterThanOrEqual(settlementStartedAt);
    expect(after?.regenAt.getTime()).toBeLessThanOrEqual(settlementFinishedAt);
  });

  it("uses preloaded boosted recovery, preserves queued training, and cannot replay release", async () => {
    const db = await getTestDatabase();
    const queue = [{ stat: "offence" as const, energy: 20 }];
    await db.update(userData).set({
      regenAt: new Date(Date.now() - 120_000), regeneration: 3,
      energyTrainingQueue: queue, offence: 10,
    }).where(eq(userData.userId, "winner"));
    const snapshot = scenario(true);
    snapshot.extraState.energyRegeneration = { winner: 6 };
    snapshot.extraState.energyCapacity = { winner: 1000 };
    snapshot.extraState.energyRewardEligible = true;
    await db.insert(battle).values(snapshot);
    const result = (await settle(snapshot))!;
    const after = (await db.query.userData.findFirst({ where: eq(userData.userId, "winner") }))!;
    expect(after.curEnergy).toBeGreaterThanOrEqual(272);
    expect(after.curEnergy).toBeLessThan(272.1);
    expect(after.energyTrainingQueue).toEqual(queue);
    expect(after.offence).toBe(10 + result.offence);
    expect(after.curHealth).toBe(result.curHealth);
    expect(after.curChakra).toBe(result.curChakra);
    expect(after.curStamina).toBe(result.curStamina);
    await updateUser(db, pusher, snapshot, result, "winner");
    const repeated = (await db.query.userData.findFirst({ where: eq(userData.userId, "winner") }))!;
    expect(repeated.curEnergy).toBe(after.curEnergy);
    expect(repeated.regenAt).toEqual(after.regenAt);
  });

  it("cannot grant recovery or overwrite a newer battle during late release", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ battleId: "new-battle", regenAt: new Date(Date.now() - 120_000), regeneration: 3 }).where(eq(userData.userId, "winner"));
    const snapshot = scenario(true);
    const result = calcBattleResult(snapshot, "winner", [])!;
    await updateUser(db, pusher, snapshot, result, "winner");
    const after = await db.query.userData.findFirst({ where: eq(userData.userId, "winner") });
    expect(after?.curEnergy).toBe(10);
    expect(after?.battleId).toBe("new-battle");
    expect(after?.status).toBe("BATTLE");
  });

  it("preserves stored geared Energy when legacy battle capacity metadata is missing", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ curEnergy: 150, maxEnergy: 100 }).where(eq(userData.userId, "winner"));
    const snapshot = scenario(true);
    await db.insert(battle).values(snapshot);
    await settle(snapshot);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "winner") }))?.curEnergy).toBe(150);
  });

  it("does not grant negative elapsed recovery from a future clock", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ regenAt: new Date(Date.now() + 120_000), regeneration: 3 }).where(eq(userData.userId, "winner"));
    const snapshot = scenario(true);
    await db.insert(battle).values(snapshot);
    await settle(snapshot);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "winner") }))?.curEnergy).toBe(10);
  });

  it("releases raid teammates with Energy recovery and hospital handling only once", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ regenAt: new Date(Date.now() - 120_000), regeneration: 3 }).where(eq(userData.userId, "loser"));
    const snapshot = scenario(true);
    snapshot.battleType = "RAID";
    snapshot.extraState.energyRegeneration = { loser: 6 };
    snapshot.extraState.energyCapacity = { loser: 100 };
    snapshot.usersState.push(makeBattleUser("boss", { isAi: true, isSummon: false, curHealth: 0, leftBattle: true }));
    await db.insert(battle).values(snapshot);
    await settle(snapshot);
    const after = (await db.query.userData.findFirst({ where: eq(userData.userId, "loser") }))!;
    expect(after.curEnergy).toBeGreaterThanOrEqual(22);
    expect(after.curEnergy).toBeLessThan(22.1);
    expect(after.status).toBe("HOSPITALIZED");
    expect(after.curHealth).toBe(0);
    expect(after.battleId).toBeNull();
    expect(await settle(snapshot)).toBeNull();
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "loser") }))?.curEnergy).toBe(after.curEnergy);
  });

  it("orphan recovery credits base Energy without advancing queued stats or other pools", async () => {
    const db = await getTestDatabase();
    const queue = [{ stat: "offence" as const, energy: 20 }];
    await db.update(userData).set({ regeneration: 3, regenAt: new Date(Date.now() - 120_000), curHealth: 5, curChakra: 6, curStamina: 7, energyTrainingQueue: queue }).where(eq(userData.userId, "winner"));
    // The cleaner uses this same guarded release when battle metadata is absent.
    await db.update(userData).set({ curEnergy: combatEnergyRecoverySql(), regenAt: sql`NOW(3)`, battleId: null, status: "AWAKE" }).where(eq(userData.userId, "winner"));
    const after = (await db.query.userData.findFirst({ where: eq(userData.userId, "winner") }))!;
    expect(after.curEnergy).toBeGreaterThanOrEqual(16);
    expect(after.curEnergy).toBeLessThan(16.1);
    expect([after.curHealth, after.curChakra, after.curStamina]).toEqual([5, 6, 7]);
    expect(after.energyTrainingQueue).toEqual(queue);
  });

  it.each([
    { type: "COMBAT", outcome: "Won", eligible: true, reward: 250 },
    { type: "COMBAT", outcome: "Lost", eligible: true, reward: 200 },
    { type: "RANKED_PVP", outcome: "Won", eligible: true, reward: 250 },
    { type: "RANKED_PVP", outcome: "Lost", eligible: true, reward: 200 },
    { type: "COMBAT", outcome: "Won", eligible: false, reward: 0 },
    { type: "SPARRING", outcome: "Won", eligible: true, reward: 0 },
    { type: "RANKED_SPARRING", outcome: "Won", eligible: true, reward: 0 },
    { type: "COMBAT", outcome: "Draw", eligible: true, reward: 0 },
    { type: "ARENA", outcome: "Won", eligible: true, reward: 0 },
    { type: "KAGE_AI", outcome: "Won", eligible: true, reward: 0 },
  ] as const)(
    "$type $outcome restores $reward Energy (eligible=$eligible)",
    async ({ type, outcome, eligible, reward }) => {
      const snapshot = scenario(false);
      snapshot.battleType = type;
      snapshot.extraState.energyRewardEligible = eligible;
      snapshot.extraState.energyCapacity = { winner: 1000, loser: 1000 };
      if (type === "ARENA" || type === "KAGE_AI") snapshot.usersState[1]!.isAi = true;
      if (outcome === "Draw") snapshot.usersState[0]!.curHealth = 0;
      const userId = outcome === "Lost" ? "loser" : "winner";
      const database = await getTestDatabase();
      await database.insert(battle).values(snapshot);
      const before = (await database.query.userData.findFirst({
        where: eq(userData.userId, userId),
      }))!;
      const result = await settle(structuredClone(snapshot), userId);
      expect(result?.outcome).toBe(outcome);
      expect(result?.energyReward).toBe(reward);
      const after = (await database.query.userData.findFirst({
        where: eq(userData.userId, userId),
      }))!;
      expect(after.curEnergy).toBe(10 + reward);
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      expect(
        (
          await claimUserSnapshot({
            client: database,
            userId,
            updatedAt: before.updatedAt,
            set: { curEnergy: before.curEnergy },
          })
        ).success,
      ).toBe(false);
      expect(await settle(structuredClone(snapshot), userId)).toBeNull();
      expect(
        (await database.query.userData.findFirst({
          where: eq(userData.userId, userId),
        }))!.curEnergy,
      ).toBe(10 + reward);
    },
  );

  it("reports the PvP Energy reward even when capacity limits restoration", async () => {
    const snapshot = scenario(false);
    snapshot.battleType = "COMBAT";
    snapshot.extraState.energyRewardEligible = true;
    snapshot.extraState.energyCapacity = { winner: 10, loser: 10 };
    const database = await getTestDatabase();
    await database.insert(battle).values(snapshot);
    expect((await settle(snapshot))?.energyReward).toBe(250);
    const user = await database.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    });
    expect(user?.curEnergy).toBe(10);
  });

  it.each([false, true])(
    "blocks Energy for a rematch in either direction (reverse=%s)",
    async (reverse) => {
      const database = await getTestDatabase();
      await database.update(userData).set({
        status: "AWAKE",
        battleId: null,
        rank: "JONIN",
        isOutlaw: true,
      });
      await database
        .insert(aiProfile)
        .values({ id: "Default", userId: "default-ai", rules: [] });
      await database.insert(battleHistory).values({
        battleId: "previous",
        battleType: "COMBAT",
        attackedId: reverse ? "loser" : "winner",
        defenderId: reverse ? "winner" : "loser",
        createdAt: new Date(),
      });
      const result = await initiateBattle(
        { client: database, userIds: ["winner"], targetIds: ["loser"] },
        "COMBAT",
      );
      expect(result.success, result.message).toBe(true);
      const saved = await database.query.battle.findFirst();
      expect(saved?.extraState.energyRewardEligible).toBe(false);
    },
  );

  it("getBattle settles a non-final result without an actor or round change exactly once", async () => {
    const snapshot = scenario(false);
    const aligned = alignBattle(structuredClone(snapshot), [], "winner");
    expect(aligned.changedActor).toBe(false);
    expect(aligned.progressRound).toBe(false);
    const expected = calcBattleResult(structuredClone(snapshot), "winner", [])!;
    expect(expected.money).toBeGreaterThan(0);
    await (await getTestDatabase()).insert(battle).values(snapshot);
    const api = await callerFor(combatRouter, "winner");
    const results = await Promise.all([
      api.getBattle({ battleId: snapshot.id }),
      api.getBattle({ battleId: snapshot.id }),
    ]);
    expect(results.filter((r) => r.result)).toHaveLength(1);
    expect(await balance()).toBe(100000 + expected.money);
    expect((await persisted())?.usersState[0]?.leftBattle).toBe(true);
    expect((await api.getBattle({ battleId: snapshot.id })).result).toBeNull();
  });

  it("performAction settles an already-decided arena match once", async () => {
    const snapshot = scenario(true);
    snapshot.battleType = "ARENA";
    snapshot.usersState[1]!.isAi = true;
    await (await getTestDatabase()).insert(battle).values(snapshot);
    const api = await callerFor(combatRouter, "winner");
    const response = await api.performAction({
      battleId: snapshot.id,
      version: 1,
    });
    if (!("result" in response) || !response.result)
      throw new Error("Expected settlement result");
    expect(response.result.didWin).toBe(1);
    expect(response.result.money).toBeGreaterThan(0);
    expect(await balance()).toBe(100000 + response.result.money);
    expect(await persisted()).toBeUndefined();
    await api.getBattle({ battleId: snapshot.id });
    expect(await balance()).toBe(100000 + response.result.money);
  });

  for (const route of ["getBattle", "performAction"] as const) {
    it(`${route} grants rewards while independent cleanup is still pending`, async () => {
      const snapshot = scenario(true);
      const database = await getTestDatabase();
      await database.insert(battle).values(snapshot);
      let releaseCleanup!: () => void;
      const cleanupGate = new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
      let rewardWritten!: () => void;
      const rewardReady = new Promise<void>((resolve) => {
        rewardWritten = resolve;
      });
      const client = new Proxy(database, {
        get(target, key, receiver) {
          if (key === "insert")
            return (table: Parameters<typeof database.insert>[0]) => {
              if (table !== logBattleLengths) return database.insert(table);
              return {
                values: (values: typeof logBattleLengths.$inferInsert) => ({
                  onDuplicateKeyUpdate: async (
                    config: Parameters<
                      ReturnType<
                        ReturnType<typeof database.insert>["values"]
                      >["onDuplicateKeyUpdate"]
                    >[0],
                  ) => {
                    await cleanupGate;
                    return database
                      .insert(logBattleLengths)
                      .values(values)
                      .onDuplicateKeyUpdate(config);
                  },
                }),
              };
            };
          if (key === "update")
            return (table: Parameters<typeof database.update>[0]) => {
              if (table !== userData) return database.update(table);
              return {
                set: (
                  values: Parameters<ReturnType<typeof database.update>["set"]>[0],
                ) => ({
                  where: async (
                    condition: Parameters<
                      ReturnType<ReturnType<typeof database.update>["set"]>["where"]
                    >[0],
                  ) => {
                    const result = await database
                      .update(userData)
                      .set(values)
                      .where(condition);
                    rewardWritten();
                    return result;
                  },
                }),
              };
            };
          return Reflect.get(target, key, receiver);
        },
      });
      const api = callerForDatabase(combatRouter, "winner", client);
      const request =
        route === "getBattle"
          ? api.getBattle({ battleId: snapshot.id })
          : api.performAction({ battleId: snapshot.id, version: 1 });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          rewardReady,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Rewards waited for cleanup")),
              2000,
            );
          }),
        ]);
        expect(await balance()).toBeGreaterThan(100000);
        expect(await database.query.logBattleLengths.findMany()).toHaveLength(0);
      } finally {
        clearTimeout(timer);
        releaseCleanup();
        await request;
      }
      expect(await database.query.logBattleLengths.findMany()).toHaveLength(1);
    });
  }

  for (const route of ["getBattle", "performAction"] as const) {
    it(`${route} retries a deadlocked claim without a transaction`, async () => {
      const snapshot = scenario(true);
      await (await getTestDatabase()).insert(battle).values(snapshot);
      let attempts = 0;
      const database = await getTestDatabase();
      const client = new Proxy(database, {
        get(target, key, receiver) {
          if (key !== "delete") return Reflect.get(target, key, receiver);
          return (...args: Parameters<typeof database.delete>) => {
            if (args[0] === battle && ++attempts === 1)
              throw new Error("Deadlock found when trying to get lock");
            return database.delete(...args);
          };
        },
      });
      const api = callerForDatabase(combatRouter, "winner", client);
      const response =
        route === "getBattle"
          ? await api.getBattle({ battleId: snapshot.id })
          : await api.performAction({ battleId: snapshot.id, version: 1 });
      if (!("result" in response) || !response.result)
        throw new Error("Expected settlement result");
      expect(attempts).toBe(2);
      expect(await balance()).toBe(100000 + response.result.money);
      expect(await persisted()).toBeUndefined();
    });
  }

  it("keeps the active player's idle-turn effects after another participant settles", async () => {
    // Three-way fight: "active" is idle on their turn with a ticking damage
    // effect, "fallen" was eliminated but has not settled yet.
    const snapshot = scenario(false);
    const now = new Date();
    snapshot.createdAt = now;
    snapshot.updatedAt = now;
    snapshot.roundStartAt = now;
    const participant = (userId: string, villageId: string, curHealth: number) =>
      makeBattleUser(userId, {
        villageId,
        curHealth,
        money: 100000,
        pvpStreak: 0,
        originalMoney: 100000,
        sector: 335,
        isAi: false,
        isSummon: false,
      });
    snapshot.usersState = [
      participant("active", "red", 100),
      participant("rival", "blue", 100),
      participant("fallen", "blue", 0),
    ];
    snapshot.activeUserId = "active";
    snapshot.usersEffects = [
      makeEffect(
        "damage",
        {
          power: 8,
          calculation: "static",
          rounds: 2,
          statTypes: [],
          generalTypes: [],
          elements: [],
        },
        {
          id: "dot-1",
          creatorId: "rival",
          targetId: "active",
          targetType: "user",
          isNew: false,
          castThisRound: false,
          createdRound: 1,
          level: 1,
        },
      ),
    ];
    const database = await getTestDatabase();
    await database.insert(battle).values(snapshot);
    await insertUsers(
      ["active", "rival", "fallen"].map((userId) => ({
        userId,
        username: userId,
        money: 100000,
        battleId: "settlement",
        status: "BATTLE",
      })),
    );
    // Eliminated participant settles while the active player is still on the clock.
    const fallen = await callerFor(combatRouter, "fallen");
    const settled = await fallen.getBattle({ battleId: snapshot.id });
    expect(settled.result).not.toBeNull();
    expect(settled.battle?.activeUserId).toBe("active");
    const saved = await persisted();
    expect(saved?.usersState.find((u) => u.userId === "fallen")?.leftBattle).toBe(true);
    // The active player has not acted; the row must not claim otherwise.
    expect(saved!.updatedAt.getTime()).toBeLessThanOrEqual(
      saved!.roundStartAt.getTime(),
    );
    // The active player's turn times out.
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(
      () => realNow() + (COMBAT_SECONDS + 1) * 1000,
    );
    // What the idle turn should do to "active": advance the round, then tick.
    const preview = structuredClone(saved) as CompleteBattle;
    alignBattle(preview, [], "rival");
    const tickedHealth = applyEffects(preview, "active").newBattle.usersState.find(
      (u) => u.userId === "active",
    )!.curHealth;
    expect(tickedHealth).toBeLessThan(100);
    const rival = await callerFor(combatRouter, "rival");
    const timedOut = await rival.getBattle({ battleId: snapshot.id });
    expect(timedOut.battle?.activeUserId).toBe("rival");
    expect(
      timedOut.battle?.usersState.find((u) => u.userId === "active")?.curHealth,
    ).toBe(tickedHealth);
    const waits = await database.query.battleAction.findMany({
      where: eq(battleAction.battleId, snapshot.id),
    });
    expect(waits.map((a) => a.description)).toEqual([
      "active stands and does nothing. ",
    ]);
  });

  for (const final of [false, true]) {
    it(`credits concurrent ${final ? "final" : "non-final"} results once`, async () => {
      const snapshot = scenario(final);
      snapshot.extraState.energyRewardEligible = true;
      snapshot.extraState.energyCapacity = {winner: 1000, loser: 1000};
      snapshot.extraState.energyRegeneration = {winner: 3, loser: 0};
      await (await getTestDatabase()).update(userData).set({ regenAt: new Date(Date.now() - 120_000) }).where(eq(userData.userId, "winner"));
      await (await getTestDatabase()).insert(battle).values(snapshot);
      const results = await Promise.allSettled([
        settle(structuredClone(snapshot)),
        settle(structuredClone(snapshot)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled" && r.value)).toHaveLength(
        1,
      );
      expect(await balance()).toBe(109600);
      const winner = await (await getTestDatabase()).query.userData.findFirst({where: eq(userData.userId, "winner")});
      expect(winner!.curEnergy).toBeGreaterThanOrEqual(266);
      expect(winner!.curEnergy).toBeLessThan(266.1);
      const saved = await persisted();
      if (final) {
        expect(saved).toBeUndefined();
        const logs = await (await getTestDatabase()).query.logBattleLengths.findMany();
        expect(logs.reduce((sum, row) => sum + row.count, 0)).toBe(1);
      } else {
        expect(saved?.version).toBe(2);
        expect(saved?.usersState[0]?.leftBattle).toBe(true);
        expect(await settle(saved as CompleteBattle)).toBeNull();
        // Another participant can settle from the committed snapshot.
        await settle(saved as CompleteBattle, "loser");
        expect(await balance("loser")).toBe(90400);
        expect(await persisted()).toBeUndefined();
      }
    });

    it(`does not replay a ${final ? "final" : "non-final"} claim after a later write fails`, async () => {
      const snapshot = scenario(final);
      await (await getTestDatabase()).insert(battle).values(snapshot);
      await expect(settle(structuredClone(snapshot), "winner", true)).rejects.toThrow(
        "Later reward failed",
      );
      expect(await balance()).toBe(109600);
      expect(await settle(structuredClone(snapshot))).toBeNull();
      expect(await balance()).toBe(109600);
      if (final) expect(await persisted()).toBeUndefined();
      else expect((await persisted())?.usersState[0]?.leftBattle).toBe(true);
    });
  }
});
