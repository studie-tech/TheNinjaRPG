import { advanceEncounterWave } from "@/libs/combat/encounters";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import {
  aiProfile,
  battle,
  dungeon,
  dungeonMember,
  dungeonRun,
  item,
  jutsu,
  userData,
  userItem,
  userJutsu,
} from "@/drizzle/schema";
import { performAIaction } from "@/libs/combat/ai_v2";
import { calcActiveUser } from "@/libs/combat/actions";
import { getBattleGrid, maskBattle } from "@/libs/combat/util";

import { Pusher } from "@/libs/pusher";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { ActionUseSpecificJutsu } from "@/validators/ai";
import { makeTag } from "../../../../libs/combat/helpers/battleScenario";
import { dungeonBattleState, encounterWaveState, dungeonContent } from "../../../../setup/dungeon";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const MEMBERS = ["wave-a", "wave-b", "wave-c"];
const OPENER = "wave-opener";
const CASTER = "wave-caster";
const CREATURE = "wave-creature";
const MID = "wave-mid";
const HIGH = "wave-high";

describeWithDatabase("dungeon wave preparation", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      battle, aiProfile, dungeon, dungeonRun, dungeonMember, userData, item, userItem, jutsu, userJutsu,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([[false, false], [true, false], [false, true]] as const)("ends an initiated dungeon only after three completed missed rounds (publication failure: %p, tickets: %p)", async (publicationFails, hasTickets) => {
    if (publicationFails) vi.spyOn(Pusher.prototype, "trigger").mockRejectedValue(new Error("Pusher unavailable"));
    const client = await getTestDatabase();
    const meta = dungeonBattleState({
      runState: { ...dungeonBattleState().runState, memberIds: MEMBERS },
    });
    const content = dungeonContent();
    const waves = [{ aiIds: [OPENER], delayRounds: 0 }];
    const liftedUntil = new Date(Date.now() + 1800000);
    content.tiers[0]![0]!.waves = waves;
    content.requirements.requiredItemId = hasTickets ? "wave-ticket" : null;
    await insertUsers([
      ...MEMBERS.map((userId) => ({ userId, username: userId, status: "QUEUED" as const, level: 50, rank: "JONIN" as const, bracketImmunityLiftedUntil: liftedUntil })),
      { userId: OPENER, username: "Enemy", isAi: true, level: 50, rank: "JONIN" as const },
    ]);
    if (hasTickets) {
      await insertItems([{ id: "wave-ticket" }]);
      await insertUserItems(MEMBERS.map((userId) => ({ id: `ticket-${userId}`, userId, itemId: "wave-ticket", quantity: 1, equipped: "ITEM_1" as const })));
    }
    await client.insert(aiProfile).values({ id: "Default", userId: OPENER, rules: [] });
    await client.insert(dungeon).values({ id: "wave-definition", content, updatedAt: new Date() });
    await client.insert(dungeonRun).values({
      id: meta.runId, dungeonId: "wave-definition", leaderId: MEMBERS[0]!, content,
      state: meta.runState, status: "FIGHTING", version: meta.runVersion,
      battleId: "wave-fight", expiresAt: new Date(meta.expiresAt), createdAt: new Date(),
    });
    await client.insert(dungeonMember).values(MEMBERS.map((userId) => ({ runId: meta.runId, userId, activeUserId: userId })));
    const admission = await initiateBattle({
      client, cacheUserId: MEMBERS[0], userIds: MEMBERS, targetIds: [OPENER],
      coop: { kind: "dungeon", ...meta, content, battleId: "wave-fight", waves },
    }, "QUEST");
    expect(admission.success).toBe(true);
    expect(admission.requiresUserRefresh).toBe(hasTickets);
    if (hasTickets) {
      expect(admission.userPatch).toBeUndefined();
      expect(await client.query.userItem.findMany()).toHaveLength(0);
    }
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const initial = (await client.query.battle.findFirst())!;
    expect((await client.query.userData.findFirst({where: eq(userData.userId, MEMBERS[0]!)}))?.bracketImmunityPausedAt).not.toBeNull();
    expect(initial.round).toBe(1);
    expect(initial.extraState.dungeon?.lastActionRound).toEqual(Object.fromEntries(MEMBERS.map((id) => [id, 0])));
    const caller = await callerFor(combatRouter, MEMBERS[0]!);
    const missed: Record<string, number> = Object.fromEntries(MEMBERS.map((id) => [id, 0]));
    let outcome: Awaited<ReturnType<typeof caller.getBattle>> | undefined;
    for (let turn = 0; turn < 16; turn++) {
      const saved = await client.query.battle.findFirst();
      if (!saved) break;
      if (saved.activeUserId && MEMBERS.includes(saved.activeUserId))
        missed[saved.activeUserId] = (missed[saved.activeUserId] ?? 0) + 1;
      await client.update(battle).set({ roundStartAt: new Date(Date.now() - 60000) }).where(eq(battle.id, saved.id));
      outcome = await caller.getBattle({ battleId: saved.id });
      if (outcome.result) break;
    }
    expect(outcome?.result?.outcome).toBe("Lost");
    expect(outcome?.battle?.round).toBe(4);
    expect(Object.values(missed)).toEqual([3, 3, 3]);
    expect(outcome?.result?.notifications).toEqual([expect.stringContaining("took no actions for 3 rounds")]);
    expect((await client.query.dungeonRun.findFirst())?.status).toBe("ENDED");
    for (const member of await client.query.userData.findMany({where: inArray(userData.userId, MEMBERS)})) {
      expect(member.bracketImmunityPausedAt).toBeNull();
      expect(member.bracketImmunityLiftedUntil.getTime()).toBeGreaterThanOrEqual(liftedUntil.getTime());
    }
  });

  it.each(["distinct", "equal"] as const)(
    "schedules incoming enemies by %s initiative without interrupting the active turn",
    async (initiative) => {
      const client = await getTestDatabase();
      const meta = dungeonBattleState({
        runState: { ...dungeonBattleState().runState, memberIds: MEMBERS },
        lastActionRound: Object.fromEntries(MEMBERS.map((id) => [id, 0])),
      });
      const waves = [
        { aiIds: [OPENER], delayRounds: 0 },
        { aiIds: [MID, HIGH], delayRounds: 1 },
      ];
      const content = dungeonContent();
      content.tiers[0]![0]!.waves = waves;
      await client.insert(aiProfile).values({ id: "Default", userId: OPENER, rules: [] });
      await insertUsers([
        ...MEMBERS.map((userId) => ({ userId, username: userId, status: "QUEUED" as const, level: 50, rank: "JONIN" as const })),
        ...[OPENER, MID, HIGH].map((userId) => ({ userId, username: userId, isAi: true, level: 50, rank: "JONIN" as const })),
      ]);
      await client.insert(dungeon).values({ id: "wave-definition", content, updatedAt: new Date() });
      await client.insert(dungeonRun).values({
        id: meta.runId, dungeonId: "wave-definition", leaderId: MEMBERS[0]!, content,
        state: meta.runState, status: "FIGHTING", version: meta.runVersion,
        battleId: "wave-fight", expiresAt: new Date(meta.expiresAt), createdAt: new Date(),
      });
      await client.insert(dungeonMember).values(MEMBERS.map((userId) => ({ runId: meta.runId, userId, activeUserId: userId })));
      // The later wave is authored in ascending initiative order. Equal rolls
      // also exercise ties with the active member and between the new enemies.
      const rolls = initiative === "distinct"
        ? [0.1, 0.7, 0.5, 0.2, 0.4, 0.9]
        : [0.1, 0.7, 0.5, 0.2, 0.5, 0.5];
      const random = vi.spyOn(Math, "random").mockReturnValue(0.1);
      rolls.forEach((roll) => random.mockReturnValueOnce(roll));
      expect((await initiateBattle({
        client, userIds: MEMBERS, targetIds: waves.flatMap((wave) => wave.aiIds),
        coop: { kind: "dungeon", ...meta, battleId: "wave-fight", waves },
      }, "QUEST")).success).toBe(true);

      const saved = (await client.query.battle.findFirst())!;
      const opening = saved.usersState.find((user) => user.controllerId === OPENER && !user.isSummon)!;
      opening.curHealth = 0;
      saved.round = 1;
      saved.activeUserId = MEMBERS[2]!;
      saved.roundStartAt = new Date();
      const previousUsers = structuredClone(saved.usersState);
      expect(advanceEncounterWave(saved)).toBe(true);
      expect(saved.activeUserId).toBe(MEMBERS[2]!);
      expect(calcActiveUser(maskBattle(saved, MEMBERS[2]!)).actor.userId).toBe(MEMBERS[2]!);
      for (const previous of previousUsers) {
        expect(saved.usersState.find((user) => user.userId === previous.userId)).toEqual(previous);
      }
      expect(saved.extraState.encounter?.wave).toBe(2);
      expect(saved.extraState.encounter?.pendingWaves).toHaveLength(0);

      saved.usersState.find((user) => user.userId === MEMBERS[2])!.actionPoints = 0;
      const next = calcActiveUser(maskBattle(saved, MEMBERS[2]!));
      expect(next.actor.controllerId).toBe(MID);
      expect(next.changedActor).toBe(true);
      expect(saved.usersState.filter((user) => user.curHealth > 0).map((user) => user.controllerId)).toEqual(
        initiative === "distinct"
          ? [HIGH, MEMBERS[1]!, MEMBERS[2]!, MID, MEMBERS[0]!]
          : [MEMBERS[1]!, MEMBERS[2]!, MID, HIGH, MEMBERS[0]!],
      );
      saved.activeUserId = next.actor.userId;
      saved.usersState.find((user) => user.userId === next.actor.userId)!.actionPoints = 0;
      expect(calcActiveUser(maskBattle(saved, MID)).actor.controllerId).toBe(
        initiative === "distinct" ? MEMBERS[0]! : HIGH,
      );
    },
  );

  it.each(["opening", "later"] as const)(
    "summons a pristine creature after its %s wave combatant spends its loadout",
    async (wave) => {
      const client = await getTestDatabase();
      const meta = dungeonBattleState({
        runState: { ...dungeonBattleState().runState, memberIds: MEMBERS },
        lastActionRound: Object.fromEntries(MEMBERS.map((id) => [id, 0])),
      });
      const waves = wave === "opening"
        ? [{ aiIds: [CASTER, CREATURE], delayRounds: 0 }, { aiIds: [OPENER], delayRounds: 1 }]
        : [{ aiIds: [OPENER], delayRounds: 0 }, { aiIds: [CASTER, CREATURE], delayRounds: 1 }];
      const content = dungeonContent();
      content.tiers[0]![0]!.waves = waves;
      await client.insert(aiProfile).values({
        id: "Default", userId: CREATURE, includeDefaultRules: false,
        rules: [{ conditions: [], action: ActionUseSpecificJutsu.parse({
          jutsuId: "wave-summon", target: "EMPTY_GROUND_CLOSEST_TO_SELF",
        }) }],
      });
      await insertUsers([
        ...MEMBERS.map((userId) => ({ userId, username: userId, status: "QUEUED" as const, level: 50, rank: "JONIN" as const })),
        ...[OPENER, CASTER, CREATURE].map((userId) => ({
          userId, username: userId, isAi: true, level: 50, rank: "JONIN" as const,
          effects: userId === CREATURE ? [makeTag("increasemaxpools", {
            power: 75, powerPerLevel: 0, calculation: "static", poolsAffected: ["Chakra"],
          })] : [],
        })),
      ]);
      await insertItems([{ id: "wave-consumable", itemType: "CONSUMABLE", slot: "ITEM", destroyOnUse: true, effects: [] }]);
      await insertUserItems([{ id: "wave-owned-consumable", userId: CREATURE, itemId: "wave-consumable", equipped: "ITEM_1", quantity: 1 }]);
      await client.insert(jutsu).values([
        { id: "wave-technique", name: "Technique", description: "Technique", battleDescription: "Technique", image: "/jutsu.png", effects: [], target: "SELF", range: 0, requiredRank: "STUDENT", jutsuType: "NORMAL", cooldown: 5 },
        { id: "wave-summon", name: "Summon", description: "Summon", battleDescription: "Summon", image: "/jutsu.png", effects: [makeTag("summon", { aiId: CREATURE, aiHp: 500, power: 100, rounds: 3 })], target: "EMPTY_GROUND", range: 3, actionCostPerc: 40, requiredRank: "STUDENT", jutsuType: "NORMAL" },
      ]);
      await client.insert(userJutsu).values([
        { id: "wave-owned-technique", userId: CREATURE, jutsuId: "wave-technique", equipped: true },
        { id: "wave-owned-summon", userId: CASTER, jutsuId: "wave-summon", equipped: true },
      ]);
      await client.insert(dungeon).values({ id: "wave-definition", content, updatedAt: new Date() });
      await client.insert(dungeonRun).values({
        id: meta.runId, dungeonId: "wave-definition", leaderId: MEMBERS[0]!, content,
        state: meta.runState, status: "FIGHTING", version: meta.runVersion,
        battleId: "wave-fight", expiresAt: new Date(meta.expiresAt), createdAt: new Date(),
      });
      await client.insert(dungeonMember).values(MEMBERS.map((userId) => ({ runId: meta.runId, userId, activeUserId: userId })));
      expect((await initiateBattle({
        client, userIds: MEMBERS, targetIds: waves.flatMap((entry) => entry.aiIds),
        coop: { kind: "dungeon", ...meta, battleId: "wave-fight", waves },
      }, "QUEST")).success).toBe(true);

      // Read the persisted preload, rather than constructing a template in the test.
      const saved = (await client.query.battle.findFirst())!;
      saved.round = 1;
      if (wave === "later") {
        saved.usersState.find((u) => u.isAi && !u.isSummon)!.curHealth = 0;
        expect(advanceEncounterWave(saved)).toBe(true);
      }
      const enemy = saved.usersState.find((u) => u.controllerId === CREATURE && !u.isSummon)!;
      const caster = saved.usersState.find((u) => u.controllerId === CASTER && !u.isSummon)!;
      const pristine = saved.usersState.find((u) => u.controllerId === CREATURE && u.isSummonTemplate);
      expect(pristine).toBeDefined();
      expect(pristine?.userId).not.toBe(enemy.userId);
      expect(pristine?.curHealth).toBe(0);
      for (const source of [enemy, pristine!]) {
        expect(source.curChakra).toBe(source.maxChakra + 75);
        expect(source._prevChakraAdj).toBe(75);
        expect(saved.usersEffects.filter((effect) => effect.targetId === source.userId)).toEqual([
          expect.objectContaining({ type: "increasemaxpools", creatorId: source.userId, power: 75 }),
        ]);
      }
      enemy.curHealth = 0;
      enemy.actionPoints = 0;
      enemy.items[0]!.quantity = 0;
      enemy.jutsus[0]!.lastUsedRound = 1;
      const result = performAIaction(saved, getBattleGrid(1, saved), caster.userId);
      expect(result.nextActionId).toBe("wave-summon");
      const summoned = result.nextBattle.usersState.find(
        (u) => u.isSummon && !u.isSummonTemplate && u.controllerId === caster.userId,
      );
      expect(summoned).toBeDefined();
      expect(summoned?.actionPoints).toBe(100);
      expect(summoned?.items[0]?.quantity).toBe(1);
      expect(summoned?.jutsus[0]?.lastUsedRound).toBe(-5);
    },
  );
});
