import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as nextServer from "next/server";
import { SHRINE_BATTLE_LOBBY_SECONDS } from "@/drizzle/constants";
import {
  aiProfile,
  anbuSquad,
  battle,
  battleAction,
  battleHistory,
  clan,
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  raidParticipation,
  userData,
  village,
  villageAlliance,
} from "@/drizzle/schema";
import { calcBattleResult } from "@/libs/combat/settlement";
import { Pusher } from "@/libs/pusher";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { raidsRouter } from "@/server/api/routers/raids";
import { shrineRouter } from "@/server/api/routers/shrine";
import { RaidObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { deferred } from "../../../../setup/deferred";
import {
  insertClans,
  insertDefaultAiProfile,
  insertQuests,
  insertUsers,
} from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { aroundStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const participants = ["credit-actor", "credit-ally", "credit-enemy"];
const winners = participants.slice(0, 2);

/** Read persisted faction counters to verify that settlement writes reached the DB. */
const factionTotals = async (userId: string) => {
  const db = await getTestDatabase();
  const [home, squad, family] = await Promise.all([
    db.query.village.findFirst({ where: eq(village.id, userId) }),
    db.query.anbuSquad.findFirst({ where: eq(anbuSquad.id, userId) }),
    db.query.clan.findFirst({ where: eq(clan.id, userId) }),
  ]);
  return {
    tokens: home!.tokens,
    anbuPoints: squad!.points,
    anbuActivity: squad!.pvpActivity,
    clanPoints: family!.points,
    clanActivityPoints: family!.activityPoints,
    clanActivity: family!.pvpActivity,
  };
};

describeWithDatabase("combat team faction rewards", () => {
  beforeEach(async () => {
    await resetTables(
      battleAction,
      battleHistory,
      battle,
      mpvpBattleUser,
      mpvpBattleQueue,
      aiProfile,
      raidParticipation,
      quest,
      userData,
      clan,
      anbuSquad,
      villageAlliance,
      village,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(nextServer, "after").mockImplementation(() => {});
    stubRateLimitTransport({ answerOtherRequests: true });
    const db = await getTestDatabase();
    await db.insert(village).values(
      participants.map((id, index) => ({
        id,
        name: id,
        sector: index + 1,
        kageId: id,
        tokens: 1000,
      })),
    );
    await insertClans(
      winners.map((id) => ({
        id,
        villageId: id,
        leaderId: id,
        leaderOrderId: `${id}-order`,
        points: 10,
        activityPoints: 20,
        pvpActivity: 4,
      })),
    );
    await db.insert(anbuSquad).values(
      winners.map((id) => ({
        id,
        name: id,
        image: "",
        villageId: id,
        leaderId: id,
        leaderOrderId: `${id}-order`,
        kageOrderId: `${id}-kage-order`,
        points: 30,
        pvpActivity: 3,
      })),
    );
    await insertUsers(
      participants.map((userId) => ({
        userId,
        username: userId,
        villageId: userId,
        status: "QUEUED",
        rank: "JONIN",
        clanId: winners.includes(userId) ? userId : null,
        anbuId: winners.includes(userId) ? userId : null,
        experience: 1000,
        pvpStreak: 1,
        curHealth: 100,
        maxHealth: 100,
        curChakra: 100,
        maxChakra: 100,
        curStamina: 100,
        maxStamina: 100,
        sector: 335,
      })),
    );
    await insertDefaultAiProfile();
    await db.insert(villageAlliance).values({
      id: "credit-hostile",
      villageIdA: participants[0]!,
      villageIdB: participants[2]!,
      status: "ENEMY",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["SHRINE_WAR", "COMBAT"] as const)(
    "%s pays acting and polling teammates once after the battle claim",
    async (battleType) => {
      const db = await getTestDatabase();
      const actorId = participants[0]!;
      const allyId = participants[1]!;
      const enemyId = participants[2]!;
      if (battleType === "SHRINE_WAR") {
        await db.insert(mpvpBattleQueue).values({
          id: "credit-lobby",
          battleType: "SHRINE_BATTLE",
          attackerEntityId: actorId,
          defenderEntityId: enemyId,
          sector: 335,
          createdAt: new Date(Date.now() - (SHRINE_BATTLE_LOBBY_SECONDS + 1) * 1000),
        });
        await db.insert(mpvpBattleUser).values(
          participants.map((userId, index) => ({
            id: `${userId}-queue`,
            clanBattleId: "credit-lobby",
            userId,
            side: index < 2 ? ("ATTACKER" as const) : ("DEFENDER" as const),
            slot: index % 2,
          })),
        );
      } else {
        await db.update(userData).set({ status: "AWAKE" });
      }
      const started =
        battleType === "SHRINE_WAR"
          ? await (await callerFor(shrineRouter, actorId)).initiateShrineBattle({
              shrineBattleId: "credit-lobby",
            })
          : await initiateBattle(
              { client: db, userIds: winners, targetIds: [enemyId] },
              "COMBAT",
            );
      expect(started.success, started.message).toBe(true);
      const saved = (await db.query.battle.findFirst({
        where: eq(battle.id, started.battleId!),
      }))!;
      expect(saved.usersState.find((u) => u.userId === allyId)?.direction).toBe(
        saved.usersState.find((u) => u.userId === actorId)?.direction,
      );
      // The last opponent has just fallen; both surviving teammates must settle.
      saved.usersState.find((u) => u.userId === enemyId)!.curHealth = 0;
      await db
        .update(battle)
        .set({
          usersState: saved.usersState,
          activeUserId: actorId,
          createdAt: new Date(Date.now() - 1000),
          roundStartAt: new Date(),
          updatedAt: new Date(Date.now() + 1000),
        })
        .where(eq(battle.id, saved.id));
      const actor = await callerFor(combatRouter, actorId);
      const ally = await callerFor(combatRouter, allyId);
      const acting = await actor.performAction({ battleId: saved.id });
      if (!("result" in acting) || !acting.result)
        throw new Error("Expected acting settlement");
      const polls = await Promise.all([
        ally.getBattle({ battleId: saved.id }),
        ally.getBattle({ battleId: saved.id }),
      ]);
      expect(polls.filter((p) => p.result)).toHaveLength(1);
      const polling = polls.find((p) => p.result)!.result!;
      for (const [userId, result] of [
        [actorId, acting.result],
        [allyId, polling],
      ] as const) {
        expect(result.didWin).toBe(1);
        expect(result.clanPoints).toBeGreaterThan(0);
        if (battleType === "COMBAT") {
          expect(result.villageTokens).toBeGreaterThan(0);
          expect(result.anbuPoints).toBeGreaterThan(0);
        }
        expect(await factionTotals(userId)).toEqual({
          tokens: 1000 + result.villageTokens,
          anbuPoints: 30 + result.anbuPoints,
          anbuActivity: 3 + Number(result.pvpStreak > 0),
          clanPoints: 10 + result.clanPoints,
          clanActivityPoints: 20 + result.clanPoints,
          clanActivity: 5,
        });
        expect(
          await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
        ).toMatchObject({ status: "AWAKE", battleId: null });
        const paid = await factionTotals(userId);
        const api = userId === actorId ? actor : ally;
        expect((await api.getBattle({ battleId: saved.id })).result).toBeNull();
        await api.performAction({ battleId: saved.id });
        expect(await factionTotals(userId)).toEqual(paid);
      }
      expect(polling.clanPoints).toBe(acting.result.clanPoints);
    },
  );
  /** Start a public raid and arrange its terminal state to exercise settlement eligibility. */
  const startDecidedRaid = async (teammateState?: "dead" | "fled" | "settled") => {
    const db = await getTestDatabase();
    const [actorId, allyId, enemyId] = participants as [string, string, string];
    await db.update(userData).set({ isAi: true }).where(eq(userData.userId, enemyId));
    await insertQuests([
      {
        id: "credit-raid",
        name: "Raid",
        questType: "raid",
        raidBossCurrentHealth: 100,
        raidBossMaxHealth: 100,
        raidEndsAt: new Date(Date.now() + 3600000),
        content: {
          objectives: [
            RaidObjective.parse({
              id: "raid-goal",
              task: "open_raid",
              sector: 335,
              opponentAIs: [{ ids: [enemyId], number: 100, quantity: 1 }],
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await db.insert(mpvpBattleQueue).values({
      id: "credit-raid-lobby",
      battleType: "RAID_BATTLE",
      attackerEntityId: "credit-raid",
      defenderEntityId: "credit-raid",
      sector: 335,
      createdAt: new Date(Date.now() - 120000),
    });
    await db.insert(mpvpBattleUser).values(
      winners.map((userId, slot) => ({
        id: `${userId}-raid-queue`,
        clanBattleId: "credit-raid-lobby",
        userId,
        side: "ATTACKER" as const,
        slot,
      })),
    );
    const started = await (await callerFor(raidsRouter, actorId)).startRaidBattle({
      teamId: "credit-raid-lobby",
    });
    expect(started.success, started.message).toBe(true);
    const saved = (await db.query.battle.findFirst({
      where: eq(battle.id, started.battleId!),
    }))!;
    saved.usersState.find((u) => u.controllerId === enemyId)!.curHealth = 0;
    const teammate = saved.usersState.find((u) => u.userId === allyId)!;
    if (teammateState === "dead") teammate.curHealth = 0;
    if (teammateState === "fled") teammate.fledBattle = true;
    if (teammateState === "settled") teammate.leftBattle = true;
    await db
      .update(battle)
      .set({
        usersState: saved.usersState,
        activeUserId: actorId,
        createdAt: new Date(Date.now() - 1000),
        roundStartAt: new Date(),
        updatedAt: new Date(Date.now() + 1000),
      })
      .where(eq(battle.id, saved.id));
    return saved;
  };

  it.each(["performAction", "getBattle"] as const)(
    "RAID %s pays surviving teammates before deleting their only settlement path",
    async (route) => {
      const db = await getTestDatabase();
      const saved = await startDecidedRaid();
      const actor = await callerFor(combatRouter, winners[0]!);
      const ally = await callerFor(combatRouter, winners[1]!);
      const predicted = winners.map(
        (id) => calcBattleResult(structuredClone(saved), id)!,
      );
      expect(predicted[1]!.didWin).toBe(1);
      expect(predicted[1]!.clanPoints).toBeGreaterThan(0);
      const allyBefore = (await db.query.userData.findFirst({
        where: eq(userData.userId, winners[1]!),
      }))!;
      if (route === "performAction") await actor.performAction({ battleId: saved.id });
      else await actor.getBattle({ battleId: saved.id });
      for (const [index, id] of winners.entries()) {
        const result = predicted[index]!;
        expect(await factionTotals(id)).toEqual({
          tokens: 1000 + result.villageTokens,
          anbuPoints: 30 + result.anbuPoints,
          anbuActivity: 3 + Number(result.pvpStreak > 0),
          clanPoints: 10 + result.clanPoints,
          clanActivityPoints: 20 + result.clanPoints,
          clanActivity: 5,
        });
      }
      // Raid cleanup still owns only the teammate's pools/status, not personal or threshold rewards.
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, winners[1]!) }),
      ).toMatchObject({
        status: "AWAKE",
        battleId: null,
        money: allyBefore.money,
        experience: allyBefore.experience,
      });
      expect(
        await db.query.raidParticipation.findFirst({
          where: eq(raidParticipation.userId, winners[1]!),
        }),
      ).toBeUndefined();
      expect(await ally.getBattle({ battleId: saved.id })).toEqual({
        battle: null,
        result: null,
      });
      const paid = await factionTotals(winners[1]!);
      await ally.performAction({ battleId: saved.id });
      await actor.performAction({ battleId: saved.id });
      expect(await factionTotals(winners[1]!)).toEqual(paid);
    },
  );

  it.each(["actor", "ally"] as const)(
    "RAID rejects a stale %s finalizer captured before the winning deletion claim",
    async (staleUser) => {
      const db = await getTestDatabase();
      const saved = await startDecidedRaid();
      // Pause one finalizer at deletion so the other deterministically wins the claim.
      const { promise: gate, resolve: unblock } = deferred<void>();
      const { promise: ready, resolve: reached } = deferred<void>();
      const staleClient = aroundStatements(
        db,
        battle,
        async (run) => {
          reached();
          await gate;
          return run();
        },
        { operations: ["delete"] },
      );
      const staleApi = callerForDatabase(
        combatRouter,
        winners[staleUser === "actor" ? 0 : 1]!,
        staleClient,
      );
      const staleRequest =
        staleUser === "actor"
          ? staleApi.performAction({ battleId: saved.id })
          : staleApi.getBattle({ battleId: saved.id });
      try {
        await ready;
        if (staleUser === "actor")
          await (await callerFor(combatRouter, winners[1]!)).getBattle({
            battleId: saved.id,
          });
        else
          await (await callerFor(combatRouter, winners[0]!)).performAction({
            battleId: saved.id,
          });
      } finally {
        unblock();
      }
      expect(await staleRequest).toEqual(
        staleUser === "actor" ? { updateClient: true } : { battle: null, result: null },
      );
      const predicted = calcBattleResult(structuredClone(saved), winners[1]!)!;
      expect((await factionTotals(winners[1]!)).clanPoints).toBe(
        10 + predicted.clanPoints,
      );
      expect((await factionTotals(winners[0]!)).clanPoints).toBe(
        10 + predicted.clanPoints,
      );
    },
  );

  it.each(["dead", "fled", "settled"] as const)(
    "RAID grants no faction credit to a %s teammate",
    async (state) => {
      const saved = await startDecidedRaid(state);
      const before = await factionTotals(winners[1]!);
      await (await callerFor(combatRouter, winners[0]!)).performAction({
        battleId: saved.id,
      });
      expect(await factionTotals(winners[1]!)).toEqual(before);
    },
  );
});
