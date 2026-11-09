import { fetchBattle } from "@/queries/combat";
import * as nextServer from "next/server";
import { eq, sql } from "drizzle-orm";
import superjson from "superjson";
import type { UserRecovery } from "@/validators/base";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
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
  userQueue,
} from "@/drizzle/schema";
import { captureCombatCacheSnapshot } from "@/deltas/combat";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import {
  combatEnergyRecoverySql,
  updateBattle,
  updateUser,
} from "@/libs/combat/database";
import { applyEffects } from "@/libs/combat/process";
import type { CompleteBattle } from "@/libs/combat/types";
import { alignBattle } from "@/libs/combat/turn";
import { calcBattleResult } from "@/libs/combat/settlement";
import type { UserEvent } from "@/layout/PusherHandler";
import { Pusher, type PusherClient } from "@/libs/pusher";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { updateUserCache } from "@/utils/userCache";
import { getTagSchema } from "@/validators/combat";
import {
  insertItems,
  insertUserItems,
  insertUsers,
  insertDefaultAiProfile,
} from "../../setup/factories";
import { queueEnergy, readEnergyQueue } from "../../setup/queues";
import { stubRateLimitTransport } from "../../setup/rateLimit";
import { beforeStatements, aroundStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
  makeEffect,
} from "../../setup/combat";
import { deferred } from "../../setup/deferred";
import { observeProfile, soloPveResult } from "./helpers/profileCache";

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
      userQueue,
      userData,
    );
    trigger.mockClear();
    vi.spyOn(await getTestDatabase(), "transaction").mockImplementation(() => {
      throw new Error("Combat settlement must not open a transaction");
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    // Rate limiting is external to settlement; SQL tests must not contact Redis.
    stubRateLimitTransport({ answerOtherRequests: true });
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

  it.each([0, 1, 8])(
    "persists %s unchanged surviving items in one batch",
    async (count) => {
      const database = await getTestDatabase();
      const snapshot = scenario(false);
      snapshot.battleType = "ARENA";
      snapshot.usersState[1]!.isAi = true;
      await insertItems([{ id: "carried", name: "Carried item" }]);
      const carried = Array.from({ length: count }, (_, index) => ({
        id: `carried-${index}`,
        itemId: "carried",
        userId: "winner",
        quantity: index + 1,
        durability: 100,
      }));
      if (carried.length) await insertUserItems(carried);
      snapshot.usersState[0]!.items = carried.map((row) => makeBattleUserItem(row));
      const result = calcBattleResult(snapshot, "winner")!;
      const { statements } = await recordQueries(() =>
        updateUser(database, pusher, snapshot, result, "winner"),
      );
      expect(
        statements.filter((statement) => /^update `UserItem` /i.test(statement)),
      ).toHaveLength(count > 0 ? 1 : 0);
      expect(
        statements.filter((statement) => /^update `UserData` /i.test(statement)),
      ).toHaveLength(1);
      const saved = await database.query.userItem.findMany();
      for (const row of carried)
        expect(saved.find((item) => item.id === row.id)).toMatchObject(row);
    },
  );

  it("persists distinct item changes while respecting concurrent merge claims and ownership", async () => {
    const database = await getTestDatabase();
    const snapshot = scenario(false);
    snapshot.battleType = "ARENA";
    snapshot.usersState[1]!.isAi = true;
    await insertItems([{ id: "carried", name: "Carried item" }]);
    const carried = Array.from({ length: 8 }, (_, index) => ({
      id: `carried-${index}`,
      itemId: "carried",
      userId: "winner",
      quantity: index + 2,
      durability: 100,
      experience: 37,
      level: 4,
    }));
    await insertUserItems([
      ...carried,
      {
        id: "unrelated",
        itemId: "carried",
        userId: "winner",
        quantity: 22,
        durability: 91,
      },
    ]);
    snapshot.usersState[0]!.items = carried.map((row, index) =>
      makeBattleUserItem({
        ...row,
        quantity: row.quantity - 1,
        durability: 90 - index,
      }),
    );
    snapshot.usersState[0]!.items.push(
      makeBattleUserItem({ id: "missing", itemId: "carried" }),
    );
    const result = calcBattleResult(snapshot, "winner")!;
    const client = beforeStatements(database, userItem, [
      async () => {
        await database
          .update(userItem)
          .set({ quantity: 0 })
          .where(eq(userItem.id, "carried-0"));
        await database
          .update(userItem)
          .set({ quantity: -1 })
          .where(eq(userItem.id, "carried-1"));
        await database
          .update(userItem)
          .set({ userId: "loser" })
          .where(eq(userItem.id, "carried-2"));
      },
    ]);
    await updateUser(client, pusher, snapshot, result, "winner");
    const saved = await database.query.userItem.findMany();
    for (const [index, row] of carried.entries())
      expect(saved.find((item) => item.id === row.id)).toMatchObject({
        ...row,
        userId: index === 2 ? "loser" : "winner",
        quantity:
          index === 0
            ? 0
            : index === 1
              ? -1
              : index === 2
                ? row.quantity
                : row.quantity - 1,
        durability: index < 3 ? 100 : 90 - index,
      });
    expect(saved.find((item) => item.id === "unrelated")).toMatchObject({
      quantity: 22,
      durability: 91,
    });
    expect(saved.find((item) => item.id === "missing")).toBeUndefined();
  });

  it("increments unranked PvP records once across settlement retries", async () => {
    const snapshot = scenario(false);
    snapshot.battleType = "COMBAT";
    await (await getTestDatabase()).insert(battle).values(snapshot);
    await settle(structuredClone(snapshot));
    expect(await settle(structuredClone(snapshot))).toBeNull();
    const stored = await (await getTestDatabase()).query.battle.findFirst({
      where: eq(battle.id, snapshot.id),
    });
    await settle(stored as CompleteBattle, "loser");
    const users = await (await getTestDatabase()).query.userData.findMany();
    expect(users.find((user) => user.userId === "winner")?.pvpWins).toBe(1);
    expect(users.find((user) => user.userId === "loser")?.pvpLosses).toBe(1);
  });

  it("keeps AI combat out of player PvP records", async () => {
    const snapshot = scenario(false);
    snapshot.battleType = "COMBAT";
    snapshot.usersState[1]!.isAi = true;
    await (await getTestDatabase()).insert(battle).values(snapshot);
    await settle(snapshot);
    const user = await (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    });
    expect(user?.pvpWins).toBe(0);
    expect(user?.pvpLosses).toBe(0);
  });

  it("keeps finished imbuement effects in the accepted compact profile after persisted battle settlement", async () => {
    const database = await getTestDatabase();
    await insertUsers([
      {
        userId: "imbue-player",
        username: "ImbuePlayer",
        rank: "JONIN",
        level: 10,
        status: "AWAKE",
        isOutlaw: true,
        pveFights: 10,
        curHealth: 100,
        curChakra: 100,
        curStamina: 100,
        curEnergy: 10,
        regeneration: 0,
        ninjutsuMastery: 100,
      },
      {
        userId: "imbue-ai",
        username: "ImbueAI",
        isAi: true,
        isSummon: false,
        inArena: true,
        rank: "NONE",
        level: 1,
        curHealth: 100,
      },
    ]);
    await insertItems([
      {
        id: "imbue-chest",
        itemType: "ARMOR",
        slot: "CHEST",
        canBeImbued: true,
        maxDurability: 100,
        effects: [],
      },
      {
        id: "imbue-crystal",
        itemType: "CRYSTAL",
        effects: [
          getTagSchema("increasemastery").parse({
            masteryTypes: ["Ninjutsu"],
            power: 10,
            powerPerLevel: 0,
            calculation: "static",
          }),
          getTagSchema("increasemaxpools").parse({
            poolsAffected: ["Energy"],
            power: 100,
            powerPerLevel: 0,
            calculation: "static",
          }),
        ],
      },
    ]);
    await insertUserItems([
      {
        id: "imbue-stack",
        userId: "imbue-player",
        itemId: "imbue-chest",
        quantity: 1,
        equipped: "CHEST",
        durability: 100,
      },
    ]);
    await database.insert(userItemImbuement).values({
      id: "imbue-row",
      userItemId: "imbue-stack",
      imbuementItemId: "imbue-crystal",
      craftingFinishedAt: new Date(Date.now() - 86_400_000),
    });
    await insertDefaultAiProfile();
    const original = (
      await fetchUpdatedUser({ client: database, userId: "imbue-player" })
    ).user!;
    const started = await initiateBattle(
      { client: database, userIds: ["imbue-player"], targetIds: ["imbue-ai"] },
      "ARENA",
    );
    expect(started.success).toBe(true);
    const snapshot = (await fetchBattle(database, started.battleId!))!;
    const serializedDate =
      snapshot.extraState.profileCacheSnapshots!["imbue-player"]!.masterySources
        .items![0]!.imbuements![0]!.craftingFinishedAt;
    expect(typeof serializedDate).toBe("string");
    snapshot.usersState.find((user) => !user.isAi)!.curHealth = 100;
    const enemy = snapshot.usersState.find((user) => user.isAi)!;
    enemy.curHealth = 0;
    enemy.leftBattle = true;
    const result = soloPveResult(snapshot, "imbue-player");
    await updateUser(database, pusher, snapshot, result, "imbue-player");
    expect(result.profileUpdate).toBeDefined();

    const current = {
      ...original,
      status: "BATTLE" as const,
      battleId: started.battleId!,
    };
    const profile = observeProfile(
      { userData: current, notifications: [] },
      async () => ({
        userData: (await fetchUpdatedUser({ client: database, userId: "imbue-player" }))
          .user,
      }),
    );
    try {
      await profile.apply(result.profileUpdate);
      const cached = profile.user();
      const authoritative = (
        await fetchUpdatedUser({ client: database, userId: "imbue-player" })
      ).user!;
      expect(authoritative.maxEnergy).toBe(650);
      expect(authoritative.effectiveMasteries.ninjutsuMastery).toBe(110);
      expect(cached.maxEnergy).toBe(authoritative.maxEnergy);
      expect(cached.effectiveMasteries).toEqual(authoritative.effectiveMasteries);
      expect(cached.items[0]!.durability).toBe(authoritative.items[0]!.durability);
      expect(authoritative.items[0]!.durability).toBe(100);
      expect(cached.status).toBe<NonNullable<UserWithRelations>["status"]>("AWAKE");
      expect(cached.battleId).toBeNull();
      expect(profile.client.getQueryState(profile.key)?.isInvalidated).toBe(false);
      expect(profile.reads()).toBe(0);
    } finally {
      profile.close();
    }
  });

  it.each([
    { status: "AWAKE", admission: "socket" },
    { status: "AWAKE", admission: "response" },
    { status: "AWAKE", admission: "profile" },
    { status: "ASLEEP", admission: "response" },
    { status: "ASLEEP", admission: "socket" },
    { status: "HOSPITALIZED", admission: "response" },
    { status: "HOSPITALIZED", admission: "socket" },
  ] as const)(
    "applies arena admission and settlement without a profile read (%s)",
    async ({ status, admission }) => {
      const database = await getTestDatabase();
      const events = vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      events.mockClear();
      await insertUsers([
        {
          userId: "counter-player",
          username: "CounterPlayer",
          rank: "NONE",
          level: 1,
          status,
          autoWakeUp: true,
          isOutlaw: true,
          pveFights: 10,
          curHealth: 100,
          maxHealth: 100,
          curChakra: 100,
          maxChakra: 100,
          curStamina: 100,
          maxStamina: 100,
          curEnergy: 10,
          regeneration: 1,
          regenAt: new Date(Date.now() - 60_000),
        },
        {
          userId: "counter-ai",
          username: "CounterAI",
          isAi: true,
          isSummon: false,
          inArena: true,
          rank: "NONE",
          level: 1,
          curHealth: 100,
        },
      ]);
      await insertDefaultAiProfile();
      const original = (await database.query.userData.findFirst({
        where: eq(userData.userId, "counter-player"),
      }))!;
      const initial = {
        ...original,
        items: [],
        titles: [],
        questData: [],
        userQuests: [],
        completedQuests: [],
      } as unknown as NonNullable<UserWithRelations>;
      const profile = observeProfile({ userData: initial }, async () => ({
        userData: (
          await fetchUpdatedUser({ client: database, userId: "counter-player" })
        ).user,
      }));
      const { client, key } = profile;
      try {
        const revision = profile.revision();
        const started = await initiateBattle(
          {
            client: database,
            userIds: ["counter-player"],
            targetIds: ["counter-ai"],
            actionUserId: "counter-player",
          },
          "ARENA",
        );
        expect(started.success).toBe(true);
        const packet = events.mock.calls.find(
          ([channel, event, data]) =>
            channel === "counter-player" &&
            event === "event" &&
            typeof data === "object" &&
            "type" in data &&
            data.type === "battle",
        )?.[2] as UserEvent;
        expect(packet).toMatchObject({ type: "battle", battleId: started.battleId });
        const delivered = JSON.parse(JSON.stringify(packet)) as UserEvent;
        const userRecovery = delivered.userRecovery
          ? superjson.deserialize<UserRecovery>(delivered.userRecovery)
          : undefined;
        if (status !== "AWAKE") expect(userRecovery).toEqual(started.userRecovery);
        expect(
          events.mock.calls.find(
            ([channel, event, data]) =>
              channel === "counter-ai" &&
              event === "event" &&
              typeof data === "object" &&
              "type" in data &&
              data.type === "battle",
          )?.[2],
        ).not.toHaveProperty("userRecovery");
        const snapshot = (await database.query.battle.findFirst({
          where: eq(battle.id, started.battleId!),
        }))! as CompleteBattle;
        const baseline = snapshot.extraState.profileCacheSnapshots?.["counter-player"];
        expect(baseline?.pveFights).toBe(10);
        const inBattle = (await database.query.userData.findFirst({
          where: eq(userData.userId, "counter-player"),
        }))!;
        expect(inBattle.pveFights).toBe(11);
        expect(baseline?.curEnergy).toBe(inBattle.curEnergy);
        expect(new Date(baseline!.regenAt).getTime()).toBe(inBattle.regenAt.getTime());
        if (admission === "response")
          await updateUserCache(client, key, started, { revision, refetch: false });
        else if (admission === "profile")
          await updateUserCache(client, key, { ...inBattle });
        else
          await updateUserCache(
            client,
            key,
            { status: "BATTLE", battleId: packet.battleId },
            {
              refetch: false,
              userRecovery,
            },
          );
        expect(profile.user()).toMatchObject({
          status: "BATTLE",
          battleId: started.battleId,
          pveFights: admission === "socket" ? 10 : 11,
        });
        expect(profile.reads()).toBe(0);
        snapshot.usersState.find((user) => !user.isAi)!.curHealth = 100;
        const enemy = snapshot.usersState.find((user) => user.isAi)!;
        enemy.curHealth = 0;
        enemy.leftBattle = true;
        const result = soloPveResult(snapshot, "counter-player");
        const settlement = await recordQueries(() =>
          updateUser(database, pusher, snapshot, result, "counter-player"),
        );
        expect(
          settlement.statements.some((statement) => /^select\b/i.test(statement)),
        ).toBe(false);
        const after = (await database.query.userData.findFirst({
          where: eq(userData.userId, "counter-player"),
        }))!;
        expect(after.pveFights).toBe(11);
        expect(result.profileUpdate?.userPatch.pveFights).toBe(after.pveFights);
        // MySQL fractional-tick division rounds at four decimal places.
        expect(result.profileUpdate?.userPatch.curEnergy).toBeCloseTo(
          after.curEnergy,
          3,
        );
        await profile.apply(result.profileUpdate);
        const cached = profile.user();
        expect(cached).toMatchObject({
          status: "AWAKE",
          battleId: null,
          pveFights: after.pveFights,
          money: after.money,
          experience: after.experience,
          earnedExperience: after.earnedExperience,
        });
        expect(cached.curEnergy).toBeCloseTo(after.curEnergy, 3);
        expect(cached.regenAt.getTime()).toBe(after.regenAt.getTime());
        expect(client.getQueryState(key)?.isInvalidated).toBe(false);
        expect(profile.reads()).toBe(0);
      } finally {
        profile.close();
      }
    },
  );

  it("returns confirmed compact PvE progression only for the player whose battle guard commits", async () => {
    const database = await getTestDatabase();
    const snapshot = scenario(true);
    snapshot.battleType = "ARENA";
    snapshot.usersState[1]!.isAi = true;
    snapshot.usersState[0]!.rank = "NONE";
    const original = (await database.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    }))!;
    snapshot.extraState.profileCacheSnapshots = {
      winner: captureCombatCacheSnapshot({ ...original, items: [] }),
    };
    snapshot.extraState.energyCapacity = { winner: 100 };
    snapshot.extraState.energyRegeneration = { winner: 0 };
    const result = soloPveResult(snapshot, "winner");
    result.money = -0.5;
    result.experience = 0.75;
    result.earnedExperience = 0.25;
    result.seichiSilver = 0.5;
    result.curHealth = 90.75;
    result.curChakra = 80.25;
    result.curStamina = 70.5;
    await updateUser(database, pusher, snapshot, result, "winner");
    const after = (await database.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    }))!;
    expect(result.profileUpdate?.userId).toBe("winner");
    expect(result.profileUpdate?.userPatch.curEnergy).toBe(after.curEnergy);
    expect(result.profileUpdate?.userPatch.regenAt).toEqual(after.regenAt);
    expect(result.profileUpdate?.userDelta.money).toBe(after.money - original.money);
    expect(result.profileUpdate?.userDelta.experience).toBe(
      after.experience - original.experience,
    );
    expect(result.profileUpdate?.userDelta.earnedExperience).toBe(
      after.earnedExperience - original.earnedExperience,
    );
    expect(result.profileUpdate?.userDelta.seichiSilver).toBe(
      after.seichiSilver - original.seichiSilver,
    );
    expect(result.profileUpdate?.userPatch.curHealth).toBe(after.curHealth);
    expect(result.profileUpdate?.userPatch.curChakra).toBe(after.curChakra);
    expect(result.profileUpdate?.userPatch.curStamina).toBe(after.curStamina);
    expect(result.profileUpdate?.userDelta.ninjutsuMastery).toBe(
      after.ninjutsuMastery - original.ninjutsuMastery,
    );
    expect(result.profileUpdate?.baseline).not.toHaveProperty("masterySources");
    const replay = { ...result, profileUpdate: undefined };
    await updateUser(database, pusher, snapshot, replay, "winner");
    expect(replay.profileUpdate).toBeUndefined();
    expect(
      (await database.query.userData.findFirst({
        where: eq(userData.userId, "winner"),
      }))!.money,
    ).toBe(after.money);
  });

  it("omits PvE cache rewards when the player has already joined a replacement battle", async () => {
    const database = await getTestDatabase();
    const snapshot = scenario(true);
    snapshot.battleType = "ARENA";
    snapshot.usersState[1]!.isAi = true;
    const original = (await database.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    }))!;
    snapshot.extraState.profileCacheSnapshots = {
      winner: captureCombatCacheSnapshot({ ...original, items: [] }),
    };
    snapshot.extraState.energyCapacity = { winner: 100 };
    snapshot.extraState.energyRegeneration = { winner: 0 };
    const result = soloPveResult(snapshot, "winner");
    await database
      .update(userData)
      .set({ battleId: "replacement" })
      .where(eq(userData.userId, "winner"));
    await updateUser(database, pusher, snapshot, result, "winner");
    expect(result.profileUpdate).toBeUndefined();
    expect(
      (await database.query.userData.findFirst({
        where: eq(userData.userId, "winner"),
      }))!.battleId,
    ).toBe("replacement");
  });

  it("does not credit Energy regeneration on a forced profile refresh during combat", async () => {
    const database = await getTestDatabase();
    const regenAt = new Date(Date.now() - 120_000);
    await database
      .update(userData)
      .set({ regenAt, regeneration: 3 })
      .where(eq(userData.userId, "winner"));
    await database.insert(battle).values(scenario(false));
    const { user } = await fetchUpdatedUser({
      client: database,
      userId: "winner",
      forceRegen: true,
    });
    expect(user?.curEnergy).toBe(10);
    const after = await database.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    });
    expect(after?.curEnergy).toBe(10);
    expect(after?.regenAt.getTime()).toBe(regenAt.getTime());
  });

  it("does not let a delayed profile refresh reopen combat or grant Energy", async () => {
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ status: "AWAKE", battleId: null })
      .where(eq(userData.userId, "winner"));
    // Bootstrap profile rows before delaying only the regeneration write.
    await fetchUpdatedUser({ client: database, userId: "winner", forceRegen: true });
    await database
      .update(userData)
      .set({ regenAt: new Date(Date.now() - 120_000), regeneration: 3 })
      .where(eq(userData.userId, "winner"));
    let enteredCombat = false;
    const delayedDatabase = beforeStatements(
      database,
      userData,
      [
        async () => {
          enteredCombat = true;
          await database
            .update(userData)
            .set({ status: "BATTLE", battleId: "settlement" })
            .where(eq(userData.userId, "winner"));
        },
      ],
      { when: (set) => "primaryElement" in set },
    );
    const { user } = await fetchUpdatedUser({
      client: delayedDatabase,
      userId: "winner",
      forceRegen: true,
    });
    expect(enteredCombat).toBe(true);
    expect(user?.status).toBe("BATTLE");
    const after = await database.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    });
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

  it.each([45, 75])(
    "restarts regeneration after %s seconds in combat",
    async (seconds) => {
      const snapshot = scenario(false);
      snapshot.extraState.energyCapacity = { winner: 100 };
      const database = await getTestDatabase();
      const regenAt = new Date(Date.now() - seconds * 1000);
      await database
        .update(userData)
        .set({ regenAt, regeneration: 3 })
        .where(eq(userData.userId, "winner"));
      await database.insert(battle).values(snapshot);
      const settlementStartedAt = Date.now();
      await settle(snapshot);
      const settlementFinishedAt = Date.now();
      const after = await database.query.userData.findFirst({
        where: eq(userData.userId, "winner"),
      });
      expect(after!.curEnergy).toBeGreaterThanOrEqual(10 + (seconds * 3) / 60);
      expect(after!.curEnergy).toBeLessThanOrEqual(10 + (seconds * 3) / 60 + 0.1);
      expect(after?.regenAt.getTime()).toBeGreaterThanOrEqual(settlementStartedAt);
      expect(after?.regenAt.getTime()).toBeLessThanOrEqual(settlementFinishedAt);
    },
  );

  it("uses preloaded boosted recovery, preserves queued training, and cannot replay release", async () => {
    const db = await getTestDatabase();
    const queue = [{ stat: "offence" as const, energy: 20 }];
    await db
      .update(userData)
      .set({
        regenAt: new Date(Date.now() - 120_000),
        regeneration: 3,
        offence: 10,
      })
      .where(eq(userData.userId, "winner"));
    await queueEnergy("winner", queue);
    const snapshot = scenario(true);
    snapshot.extraState.energyRegeneration = { winner: 6 };
    snapshot.extraState.energyCapacity = { winner: 1000 };
    snapshot.extraState.energyRewardEligible = true;
    await db.insert(battle).values(snapshot);
    const result = (await settle(snapshot))!;
    const after = (await db.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    }))!;
    expect(after.curEnergy).toBeGreaterThanOrEqual(272);
    expect(after.curEnergy).toBeLessThan(272.1);
    expect(await readEnergyQueue("winner")).toEqual(queue);
    expect(after.offence).toBe(10 + result.offence);
    expect(after.curHealth).toBe(result.curHealth);
    expect(after.curChakra).toBe(result.curChakra);
    expect(after.curStamina).toBe(result.curStamina);
    await updateUser(db, pusher, snapshot, result, "winner");
    const repeated = (await db.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    }))!;
    expect(repeated.curEnergy).toBe(after.curEnergy);
    expect(repeated.regenAt).toEqual(after.regenAt);
  });

  it("cannot grant recovery or overwrite a newer battle during late release", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({
        battleId: "new-battle",
        regenAt: new Date(Date.now() - 120_000),
        regeneration: 3,
      })
      .where(eq(userData.userId, "winner"));
    const snapshot = scenario(true);
    const result = calcBattleResult(snapshot, "winner", [])!;
    await updateUser(db, pusher, snapshot, result, "winner");
    const after = await db.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    });
    expect(after?.curEnergy).toBe(10);
    expect(after?.battleId).toBe("new-battle");
    expect(after?.status).toBe("BATTLE");
  });

  it("preserves stored geared Energy when legacy battle capacity metadata is missing", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ curEnergy: 150, maxEnergy: 100 })
      .where(eq(userData.userId, "winner"));
    const snapshot = scenario(true);
    await db.insert(battle).values(snapshot);
    await settle(snapshot);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "winner") }))
        ?.curEnergy,
    ).toBe(150);
  });

  it("does not grant negative elapsed recovery from a future clock", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ regenAt: new Date(Date.now() + 120_000), regeneration: 3 })
      .where(eq(userData.userId, "winner"));
    const snapshot = scenario(true);
    await db.insert(battle).values(snapshot);
    await settle(snapshot);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "winner") }))
        ?.curEnergy,
    ).toBe(10);
  });

  it("releases raid teammates with Energy recovery and hospital handling only once", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ regenAt: new Date(Date.now() - 120_000), regeneration: 3 })
      .where(eq(userData.userId, "loser"));
    const snapshot = scenario(true);
    snapshot.battleType = "RAID";
    snapshot.extraState.energyRegeneration = { loser: 6 };
    snapshot.extraState.energyCapacity = { loser: 100 };
    snapshot.usersState.push(
      makeBattleUser("boss", {
        isAi: true,
        isSummon: false,
        curHealth: 0,
        leftBattle: true,
      }),
    );
    await db.insert(battle).values(snapshot);
    await settle(snapshot);
    const after = (await db.query.userData.findFirst({
      where: eq(userData.userId, "loser"),
    }))!;
    expect(after.curEnergy).toBeGreaterThanOrEqual(22);
    expect(after.curEnergy).toBeLessThan(22.1);
    expect(after.status).toBe("HOSPITALIZED");
    expect(after.curHealth).toBe(0);
    expect(after.battleId).toBeNull();
    expect(await settle(snapshot)).toBeNull();
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, "loser") }))
        ?.curEnergy,
    ).toBe(after.curEnergy);
  });

  it("orphan recovery credits base Energy without advancing queued stats or other pools", async () => {
    const db = await getTestDatabase();
    const queue = [{ stat: "offence" as const, energy: 20 }];
    await db
      .update(userData)
      .set({
        regeneration: 3,
        regenAt: new Date(Date.now() - 120_000),
        curHealth: 5,
        curChakra: 6,
        curStamina: 7,
      })
      .where(eq(userData.userId, "winner"));
    await queueEnergy("winner", queue);
    // The cleaner uses this same guarded release when battle metadata is absent.
    await db
      .update(userData)
      .set({
        curEnergy: combatEnergyRecoverySql(),
        regenAt: sql`NOW(3)`,
        battleId: null,
        status: "AWAKE",
      })
      .where(eq(userData.userId, "winner"));
    const after = (await db.query.userData.findFirst({
      where: eq(userData.userId, "winner"),
    }))!;
    expect(after.curEnergy).toBeGreaterThanOrEqual(16);
    expect(after.curEnergy).toBeLessThan(16.1);
    expect([after.curHealth, after.curChakra, after.curStamina]).toEqual([5, 6, 7]);
    expect(await readEnergyQueue("winner")).toEqual(queue);
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
      await insertDefaultAiProfile();
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
      const { promise: cleanupGate, resolve: releaseCleanup } = deferred<void>();
      const { promise: rewardReady, resolve: rewardWritten } = deferred<void>();
      const client = aroundStatements(
        aroundStatements(
          database,
          logBattleLengths,
          async (run) => {
            await cleanupGate;
            return run();
          },
          { operations: ["insert"] },
        ),
        userData,
        async (run) => {
          const result = await run();
          rewardWritten();
          return result;
        },
        { operations: ["update"] },
      );
      const api = callerForDatabase(combatRouter, "winner", client);
      const request =
        route === "getBattle"
          ? api.getBattle({ battleId: snapshot.id })
          : api.performAction({ battleId: snapshot.id });
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
      const client = aroundStatements(
        database,
        battle,
        async (run) => {
          if (++attempts === 1)
            throw new Error("Deadlock found when trying to get lock");
          return run();
        },
        { operations: ["delete"] },
      );
      const api = callerForDatabase(combatRouter, "winner", client);
      const response =
        route === "getBattle"
          ? await api.getBattle({ battleId: snapshot.id })
          : await api.performAction({ battleId: snapshot.id });
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
      snapshot.extraState.energyCapacity = { winner: 1000, loser: 1000 };
      snapshot.extraState.energyRegeneration = { winner: 3, loser: 0 };
      await (await getTestDatabase())
        .update(userData)
        .set({ regenAt: new Date(Date.now() - 120_000) })
        .where(eq(userData.userId, "winner"));
      await (await getTestDatabase()).insert(battle).values(snapshot);
      const results = await Promise.allSettled([
        settle(structuredClone(snapshot)),
        settle(structuredClone(snapshot)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled" && r.value)).toHaveLength(
        1,
      );
      expect(await balance()).toBe(109600);
      const winner = await (await getTestDatabase()).query.userData.findFirst({
        where: eq(userData.userId, "winner"),
      });
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
