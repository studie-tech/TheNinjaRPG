import { describe, it, expect } from "vitest";
import { Grid, rectangle } from "honeycomb-grid";
import { applyPoolAdjustmentsToBase } from "@/libs/combat/util";
import { performAIaction } from "@/libs/combat/ai_v2";
import { TerrainHex } from "@/libs/hexgrid";
import type { BattleUserState, CompleteBattle, UserEffect } from "@/libs/combat/types";
import { ActionUseSpecificJutsu, ActionEndTurn, AiRule, ConditionPlayerWithinRange, ConditionSummonWithinRange, ConditionSpecificRound, ConditionHealthBelow, getBackupRules, enforceExtraRules, type AvailableTarget, type ZodAllAiCondition } from "@/validators/ai";
const DAMAGE_JUTSU = "j-damage";
const PROFILE = "profile-1";

const mkUser = (over: Partial<BattleUserState>): BattleUserState =>
  ({
    userId: "x", username: "x", controllerId: "x",
    isAi: true, isSummon: false, isPiloted: false,
    curHealth: 5000, maxHealth: 5000, curChakra: 5000, maxChakra: 5000,
    curStamina: 5000, maxStamina: 5000,
    fledBattle: false, leftBattle: false, longitude: 1, latitude: 1,
    actionPoints: 100, effects: [], jutsus: [], items: [], basicActions: [],
    round: 0, direction: "right", isAggressor: false,
    highestGenerals: [], iAmHere: true, level: 10,
    originalLevel: 10, originalMoney: 0, originalLongitude: 1, originalLatitude: 1,
    isOriginal: true, usedGenerals: {}, usedStats: {}, moneyStolen: 0,
    allyVillage: false, usedActions: [], initiative: 0,
    relationIds: [], warIds: [],
    offence: 100, defence: 100, ninjutsuMastery: 100, genjutsuMastery: 100,
    taijutsuMastery: 100, bukijutsuMastery: 100, bloodlineMastery: 100, sageMastery: 100,
    strength: 100, intelligence: 100, willpower: 100, speed: 100,
    ...over,
  }) as unknown as BattleUserState;

const damageJutsu = {
  id: DAMAGE_JUTSU,
  name: "Test Strike",
  image: "", description: "", battleDescription: "%user strikes %target",
  jutsuType: "NORMAL", jutsuRank: "D", requiredRank: "STUDENT", requiredLevel: 1,
  target: "CHARACTER", range: 20, method: "SINGLE", cooldown: 0,
  actionCostPerc: 40, staminaCost: 10, chakraCost: 0, healthCost: 0,
  staminaCostReducePerLvl: 0, chakraCostReducePerLvl: 0, healthCostReducePerLvl: 0,
  extraBaseCost: 0, jutsuWeapon: "NONE", bloodlineId: null, villageId: null,
  hidden: false, injectableInBattle: false, battleUsageType: "BOTH",
  effects: [{
    type: "damage", power: 20, powerPerLevel: 0, level: 1,
    calculation: "formula", statTypes: ["Ninjutsu"], generalTypes: [], elements: [],
    rounds: 0, target: "INHERIT", friendlyFire: "ALL", description: "dmg",
  }],
};

const mkBattle = (human: BattleUserState): CompleteBattle =>
  ({
    id: "b1", battleType: "ARENA", round: 1, version: 1, activeUserId: human.userId,
    createdAt: new Date(0), updatedAt: new Date(0), roundStartAt: new Date(0),
    background: "", width: 10, height: 10, rewardScaling: 1, forceKeepPools: false,
    usersState: [
      human,
      mkUser({ userId: "foe", username: "Foe", controllerId: "foe",
        longitude: 3, latitude: 3 }),
    ],
    usersEffects: [], groundEffects: [],
    extraState: {
      jutsus: { [DAMAGE_JUTSU]: damageJutsu },
      jutsuReskins: {}, items: {}, bloodlines: {}, villages: {}, anbuSquads: {},
      keystoneItems: {}, wars: {}, relations: {}, clans: {},
      userQuests: {}, completedQuests: {}, questData: {}, bounties: {}, bountySignups: {},
      aiProfiles: {
        [PROFILE]: {
          id: PROFILE, name: "always strike", includeDefaultRules: false,
          rules: [{
            conditions: [],
            action: ActionUseSpecificJutsu.parse({
              jutsuId: DAMAGE_JUTSU,
              target: "CLOSEST_OPPONENT",
            }),
          }],
        },
      },
    },
  }) as unknown as CompleteBattle;


const setup = (target: AvailableTarget = "CLOSEST_OPPONENT", conditions: ZodAllAiCondition[] = []) => {
  const actor = mkUser({ userId: "actor", controllerId: "actor", villageId: "ally", aiProfileId: PROFILE,
    longitude: 1, latitude: 1,
    jutsus: [{ id: "uj1", jutsuId: DAMAGE_JUTSU, level: 1, experience: 0, equipped: true, lastUsedRound: -99, originalCooldown: 0 }],
  });
  const battle = mkBattle(actor);
  battle.usersState = [actor,
    mkUser({ userId: "boss", controllerId: "boss", villageId: "enemy", longitude: 4, latitude: 1, maxHealth: 9000, curHealth: 3000 }),
    mkUser({ userId: "minion", controllerId: "minion", villageId: "enemy", longitude: 3, latitude: 1, maxHealth: 2000, curHealth: 800 }),
    mkUser({ userId: "ally-boss", controllerId: "ally-boss", villageId: "ally", longitude: 1, latitude: 3, maxHealth: 10000 }),
    mkUser({ userId: "ally-minion", controllerId: "ally-minion", villageId: "ally", longitude: 1, latitude: 2, maxHealth: 1000, curHealth: 1000 }),
  ];
  battle.extraState.aiProfiles[PROFILE]!.rules = [
    { conditions, action: ActionUseSpecificJutsu.parse({ jutsuId: DAMAGE_JUTSU, target }) },
    { conditions: [], action: ActionEndTurn.parse({}) },
  ];
  const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
  return { battle, grid, run: () => performAIaction(battle, grid, "actor") };
};

describe("AI targeting and clauses", () => {
  it.each([
    ["HIGHEST_MAX_HEALTH_ALLY", "ally-boss"],
    ["HIGHEST_MAX_HEALTH_OPPONENT", "boss"],
    ["LOWEST_HEALTH_OPPONENT", "minion"],
    ["LOWEST_MAX_HEALTH_ALLY", "ally-minion"],
    ["CLOSEST_OPPONENT", "minion"],
    ["CLOSEST_ALLY", "actor"],
    ["SELF", "actor"],
  ] as const)("%s selects %s", (target, id) => {
    const { battle, run } = setup(target);
    const initial = battle.usersState.map((user) => ({ id: user.userId, health: user.curHealth }));
    const result = run();
    expect(result.nextActionId).toBe(DAMAGE_JUTSU);
    for (const before of initial) {
      const after = result.nextBattle.usersState.find((user) => user.userId === before.id)!;
      if (before.id === id) expect(after.curHealth).toBeLessThan(before.health);
      else expect(after.curHealth).toBe(before.health);
    }
  });

  it("ignores dead and fled targets", () => {
    const { battle, run } = setup("HIGHEST_MAX_HEALTH_OPPONENT");
    battle.usersState.push(
      mkUser({ userId: "dead", villageId: "enemy", maxHealth: 99999, curHealth: 0 }),
      mkUser({ userId: "fled", villageId: "enemy", maxHealth: 99999, fledBattle: true }),
    );
    expect(run().nextBattle.usersState.find((user) => user.userId === "boss")!.curHealth).toBeLessThan(3000);
  });

  it("uses effective maximum health including active pool effects", () => {
    const { battle, run } = setup("HIGHEST_MAX_HEALTH_OPPONENT");
    battle.usersEffects.push({ id: "buff", type: "increasemaxpools", targetId: "minion", creatorId: "minion", power: 20000, powerPerLevel: 0, level: 1, calculation: "static", poolsAffected: ["Health"], rounds: 5 } as UserEffect);
    const minion = battle.usersState.find((user) => user.userId === "minion")!;
    applyPoolAdjustmentsToBase(minion, battle.usersEffects);
    const startingHealth = minion.curHealth;
    const result = run();
    expect(result.nextActionId).toBe(DAMAGE_JUTSU);
    expect(result.nextBattle.usersState.find((user) => user.userId === "boss")!.curHealth).toBe(3000);
    expect(result.nextBattle.usersState.find((user) => user.userId === "minion")!.curHealth).toBeLessThan(startingHealth);
  });

  for (const type of ["player", "summon"] as const) {
    const schema = type === "player" ? ConditionPlayerWithinRange : ConditionSummonWithinRange;
    it.each([[-1, false], [0, true], [1, false]])(`${type} range boundary offset %s matches %s`, (offset, expected) => {
      const { battle, grid, run } = setup();
      const enemy = battle.usersState.find((user) => user.userId === "minion")!;
      enemy.isAi = type !== "player";
      enemy.isSummon = type === "summon";
      const origin = grid.getHex({ col: 1, row: 1 })!;
      const destination = grid.getHex({ col: enemy.longitude, row: enemy.latitude })!;
      const distance = grid.distance(origin, destination);
      battle.extraState.aiProfiles[PROFILE]!.rules[0]!.conditions = [schema.parse({ minRange: distance + offset, maxRange: distance + offset })];
      expect(run().nextActionId).toBe(expected ? DAMAGE_JUTSU : "wait");
    });
    it(`${type} range excludes allies and dead enemies`, () => {
      const { battle, run } = setup("CLOSEST_OPPONENT", [schema.parse({ maxRange: 20 })]);
      for (const user of battle.usersState) { user.isAi = type !== "player"; user.isSummon = type === "summon"; }
      // Keep the actor AI-driven and both opponents dead.
      battle.usersState[0]!.isAi = true;
      battle.usersState[1]!.curHealth = 0;
      battle.usersState[2]!.curHealth = 0;
      battle.usersState[1]!.curHealth = 3000;
      battle.usersState[1]!.isAi = true;
      battle.usersState[1]!.isSummon = false;
      expect(run().nextActionId).toBe("wait");
    });
  }

  it.each([[1, 100, true], [2, 100, false], [1, 10, false]])("AND clauses round=%s health=%s", (round, health, matches) => {
    const { battle, run } = setup("CLOSEST_OPPONENT", [ConditionSpecificRound.parse({ value: round }), ConditionHealthBelow.parse({ value: health })]);
    battle.usersState[0]!.curHealth = 2500;
    expect(run().nextActionId).toBe(matches ? DAMAGE_JUTSU : "wait");
  });

  it.each(["EMPTY_GROUND_CLOSEST_TO_OPPONENT", "EMPTY_GROUND_CLOSEST_TO_SELF"] as const)("%s uses actual candidate tile distances", (target) => {
    const { battle, grid, run } = setup(target);
    const jutsu = battle.extraState.jutsus[DAMAGE_JUTSU]!;
    jutsu.target = "GROUND";
    jutsu.range = 2;
    jutsu.effects = [{ type: "move", power: 100, powerPerLevel: 0, target: "INHERIT" }] as typeof jutsu.effects;
    const { nextBattle, nextActionId } = run();
    expect(nextActionId).toBe(DAMAGE_JUTSU);
    const actor = nextBattle.usersState[0]!;
    const selected = grid.getHex({ col: actor.longitude, row: actor.latitude })!;
    const center = grid.getHex(target === "EMPTY_GROUND_CLOSEST_TO_SELF" ? { col: 1, row: 1 } : { col: 3, row: 1 })!;
    expect(grid.distance(selected, center)).toBe(1);
    expect(nextBattle.usersState.slice(1).some((user) => user.longitude === actor.longitude && user.latitude === actor.latitude)).toBe(false);
  });
});

describe("AI rule validation and compatibility", () => {
  it("accepts existing profiles without editor metadata", () => {
    const rule = { conditions: [], action: ActionEndTurn.parse({}) };
    expect(AiRule.parse(rule)).toEqual(rule);
  });
  it("rejects reversed, fractional, and negative ranges", () => {
    for (const condition of [{ minRange: 5, maxRange: 2 }, { minRange: -1 }, { maxRange: 1.5 }]) {
      expect(AiRule.safeParse({ conditions: [{ type: "player_within_range", ...condition }], action: ActionEndTurn.parse({}) }).success).toBe(false);
    }
  });
  it("does not duplicate catch-alls with editor metadata", () => {
    const rules = getBackupRules().map((rule, index) => ({ ...rule, id: `${index}`, group: { id: "group", name: "Fallback", note: "" } }));
    enforceExtraRules(rules, getBackupRules());
    expect(rules).toHaveLength(getBackupRules().length);
  });
});
