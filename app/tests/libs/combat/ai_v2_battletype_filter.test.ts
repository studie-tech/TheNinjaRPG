import { describe, it, expect, vi } from "vitest";
import { Grid, rectangle } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import { ActionUseSpecificJutsu } from "@/validators/ai";
import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";

/**
 * Integration cover for the ai_v2 candidate filter -- the CALL SITE, not just the
 * predicate. Deleting the filter must fail something, otherwise an AI in an
 * auto-resolved battle burns its turn casting a summon that summon() then
 * refuses, and re-casts it every round because does_not_have_summon stays true.
 *
 * The ARENA case is a positive control: if the AI stops casting the summon there
 * for unrelated reasons, that test fails too and this file cannot go vacuous.
 */

import { TerrainHex } from "@/libs/hexgrid";

const SUMMON_JUTSU = "j-summon";
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
    highestOffence: "ninjutsuOffence", highestDefence: "ninjutsuDefence",
    highestGenerals: [], iAmHere: true, level: 10,
    originalLevel: 10, originalMoney: 0, originalLongitude: 1, originalLatitude: 1,
    isOriginal: true, usedGenerals: {}, usedStats: {}, moneyStolen: 0,
    allyVillage: false, usedActions: [], initiative: 0,
    relationIds: [], warIds: [],
    ninjutsuOffence: 100, ninjutsuDefence: 100, genjutsuOffence: 100,
    genjutsuDefence: 100, taijutsuOffence: 100, taijutsuDefence: 100,
    bukijutsuOffence: 100, bukijutsuDefence: 100,
    strength: 100, intelligence: 100, willpower: 100, speed: 100,
    ...over,
  }) as unknown as BattleUserState;

const summonJutsu = {
  id: SUMMON_JUTSU,
  name: "Test Summon",
  image: "", description: "", battleDescription: "summons",
  jutsuType: "NORMAL", jutsuRank: "D", requiredRank: "STUDENT", requiredLevel: 1,
  target: "EMPTY_GROUND", range: 4, method: "SINGLE", cooldown: 0,
  actionCostPerc: 40, staminaCost: 0, chakraCost: 0, healthCost: 0,
  staminaCostReducePerLvl: 0, chakraCostReducePerLvl: 0, healthCostReducePerLvl: 0,
  extraBaseCost: 0, jutsuWeapon: "NONE", bloodlineId: null, villageId: null,
  hidden: false, injectableInBattle: false, battleUsageType: "BOTH",
  effects: [{
    type: "summon", aiId: "creature-1", aiHp: 1000, rounds: 4,
    power: 70, powerPerLevel: 0, level: 1, calculation: "percentage",
    target: "INHERIT", friendlyFire: "ENEMIES", description: "summon",
  }],
};

const mkBattle = (battleType: string): CompleteBattle =>
  ({
    id: "b1", battleType, round: 1, version: 1, activeUserId: "ai1",
    createdAt: new Date(0), updatedAt: new Date(0), roundStartAt: new Date(0),
    background: "", width: 10, height: 10, rewardScaling: 1, forceKeepPools: false,
    usersState: [
      mkUser({ userId: "ai1", username: "Caster", controllerId: "ai1",
        aiProfileId: PROFILE, longitude: 2, latitude: 2,
        jutsus: [{ id: "uj1", jutsuId: SUMMON_JUTSU, level: 1, experience: 0,
                   equipped: true, lastUsedRound: -99, originalCooldown: 0 }] }),
      mkUser({ userId: "foe", username: "Foe", controllerId: "foe", isAi: false,
        longitude: 6, latitude: 6 }),
      // Hidden clone-source template the summon tag would copy from.
      mkUser({ userId: "tmpl", username: "Creature", controllerId: "creature-1",
        isSummon: true, isSummonTemplate: true, curHealth: 0,
        longitude: 0, latitude: 0 }),
    ],
    usersEffects: [], groundEffects: [],
    extraState: {
      jutsus: { [SUMMON_JUTSU]: summonJutsu },
      jutsuReskins: {}, items: {}, bloodlines: {}, villages: {}, anbuSquads: {},
      keystoneItems: {}, wars: {}, relations: {}, clans: {},
      userQuests: {}, completedQuests: {}, questData: {}, bounties: {}, bountySignups: {},
      aiProfiles: {
        [PROFILE]: {
          id: PROFILE, name: "always summon", includeDefaultRules: false,
          rules: [{
            conditions: [],
            // EMPTY_GROUND jutsu: aim at a free tile, not at the opponent's
            // occupied one, or insertAction rejects it before the filter matters.
            action: ActionUseSpecificJutsu.parse({
              jutsuId: SUMMON_JUTSU,
              target: "EMPTY_GROUND_CLOSEST_TO_SELF",
            }),
          }],
        },
      },
    },
  }) as unknown as CompleteBattle;

/**
 * Assert on what the AI SELECTED, not on the resulting ground effect. Counting
 * summon ground effects looks equivalent but is not: performBattleAction runs
 * applyEffects (actions.ts:1373), so summon()'s own auto-battle backstop sweeps
 * the effect in the same pass -- the count is 0 in KAGE_AI whether or not the
 * candidate filter exists, which makes that assertion blind to this filter.
 */
const actionPickedByAi = (battleType: string) => {
  const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
  const { nextActionId } = performAIaction(mkBattle(battleType), grid, "ai1");
  return nextActionId;
};

describe("ai_v2 candidate filter by battle type", () => {
  it("POSITIVE CONTROL: the AI does pick the summon in ARENA", () => {
    // If this fails, the assertions below prove nothing -- fix this one first.
    expect(actionPickedByAi("ARENA")).toBe(SUMMON_JUTSU);
  });

  it("never picks the summon in KAGE_AI", () => {
    expect(actionPickedByAi("KAGE_AI")).not.toBe(SUMMON_JUTSU);
  });

  it("never picks the summon in CLAN_CHALLENGE", () => {
    expect(actionPickedByAi("CLAN_CHALLENGE")).not.toBe(SUMMON_JUTSU);
  });
});
