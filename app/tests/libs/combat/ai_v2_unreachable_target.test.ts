import { describe, it, expect } from "bun:test";
import { Grid, rectangle, ring } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";
import { TerrainHex } from "@/libs/hexgrid";
import {
  ActionMoveTowardsOpponent,
  ActionWithEffectHighestPower,
  ConditionDistanceHigherThan,
} from "@/validators/ai";

/**
 * An AI whose chosen action turns out to be impossible must fall through to its
 * next rule instead of aborting the whole turn. Scenario: the player stands in a
 * corner and AIs occupy every neighbouring tile, so one more AI can neither step
 * closer nor reach with its range-1 basic attack, and its 60 AP jutsu is
 * unaffordable on 40 AP. Throwing there surfaced as an "Action Basic Attack no
 * longer possible" notification that the client re-fired every second until the
 * round timer passed the turn on.
 */

const PROFILE = "profile-dragon";
const HEAVY_JUTSU = "j-heavy";
const WIDTH = 13;
const HEIGHT = 9;

const mkUser = (over: Partial<BattleUserState>): BattleUserState =>
  ({
    userId: "x", username: "x", controllerId: "dragon-template",
    isAi: true, isSummon: false, isPiloted: false, aiProfileId: PROFILE,
    curHealth: 5000, maxHealth: 5000, curChakra: 5000, maxChakra: 5000,
    curStamina: 5000, maxStamina: 5000, villageId: "village-ai",
    fledBattle: false, leftBattle: false, longitude: 0, latitude: 0,
    actionPoints: 100, effects: [], jutsus: [], items: [], basicActions: [],
    round: 0, direction: "right", isAggressor: false,
    highestGenerals: [], iAmHere: true, level: 60,
    originalLevel: 60, originalMoney: 0, originalLongitude: 0, originalLatitude: 0,
    isOriginal: true, usedGenerals: {}, usedStats: {}, moneyStolen: 0,
    allyVillage: false, usedActions: [], initiative: 0,
    relationIds: [], warIds: [],
    offence: 100, defence: 100,
    ninjutsuMastery: 100, genjutsuMastery: 100, taijutsuMastery: 100,
    bukijutsuMastery: 100, bloodlineMastery: 100, sageMastery: 100,
    strength: 100, intelligence: 100, willpower: 100, speed: 100,
    ...over,
  }) as unknown as BattleUserState;

const heavyJutsu = {
  id: HEAVY_JUTSU,
  name: "Heavy Strike",
  image: "", description: "", battleDescription: "%user strikes %target",
  jutsuType: "AI", jutsuRank: "D", requiredRank: "STUDENT", requiredLevel: 1,
  target: "OTHER_USER", range: 5, method: "SINGLE", cooldown: 0,
  actionCostPerc: 60, staminaCost: 0, chakraCost: 0, healthCost: 0,
  staminaCostReducePerLvl: 0, chakraCostReducePerLvl: 0, healthCostReducePerLvl: 0,
  extraBaseCost: 0, jutsuWeapon: "NONE", bloodlineId: null, villageId: null,
  hidden: false, injectableInBattle: false, battleUsageType: "BOTH",
  effects: [{
    type: "damage", power: 40, powerPerLevel: 0, level: 1,
    calculation: "formula", statTypes: ["Highest"], generalTypes: [], elements: [],
    rounds: 0, target: "INHERIT", friendlyFire: "ENEMIES", description: "dmg",
  }],
};

/** Places the player in a corner, fills every neighbouring tile, and parks one AI behind them. */
const mkCorneredBattle = (grid: Grid<TerrainHex>) => {
  const corner = grid.getHex({ col: 0, row: 0 });
  if (!corner) throw new Error("Grid has no corner tile");
  const neighbours = grid.traverse(ring({ center: [corner.q, corner.r], radius: 1 })).toArray();
  const outerRing = grid.traverse(ring({ center: [corner.q, corner.r], radius: 2 })).toArray();
  const behind = outerRing[0];
  if (!behind || neighbours.length === 0) throw new Error("Unexpected grid layout");

  const player = mkUser({
    userId: "user_player", username: "Player", controllerId: "user_player",
    isAi: false, aiProfileId: undefined, villageId: "village-player",
    longitude: corner.col, latitude: corner.row,
  });
  const blockers = neighbours.map((hex, i) =>
    mkUser({
      userId: `dragon-${i}`, username: "Baby Diamond",
      longitude: hex.col, latitude: hex.row,
    }),
  );
  const stuck = mkUser({
    userId: "dragon-stuck", username: "Baby Diamond",
    longitude: behind.col, latitude: behind.row,
    // Spent 60 AP on a jutsu already: only 20 AP basics remain affordable
    actionPoints: 40,
    jutsus: [{ id: "uj1", jutsuId: HEAVY_JUTSU, level: 1, experience: 0,
               equipped: true, lastUsedRound: -99, originalCooldown: 0 }],
  } as Partial<BattleUserState>);

  return {
    id: "b1", battleType: "QUEST", round: 1, version: 1, activeUserId: stuck.userId,
    createdAt: new Date(0), updatedAt: new Date(0), roundStartAt: new Date(0),
    background: "", width: WIDTH, height: HEIGHT, rewardScaling: 1, forceKeepPools: false,
    usersState: [player, ...blockers, stuck],
    usersEffects: [], groundEffects: [],
    extraState: {
      jutsus: { [HEAVY_JUTSU]: heavyJutsu },
      jutsuReskins: {}, items: {}, bloodlines: {}, villages: {}, anbuSquads: {},
      keystoneItems: {}, wars: {}, relations: {}, clans: {},
      userQuests: {}, completedQuests: {}, questData: {}, bounties: {}, bountySignups: {},
      aiProfiles: {
        [PROFILE]: {
          id: PROFILE, name: "baby diamond", includeDefaultRules: true,
          rules: [
            {
              conditions: [ConditionDistanceHigherThan.parse({ value: 2 })],
              action: ActionMoveTowardsOpponent.parse({}),
            },
            {
              conditions: [],
              action: ActionWithEffectHighestPower.parse({ effect: "damage" }),
            },
          ],
        },
      },
    },
  } as unknown as CompleteBattle;
};

describe("performAIaction with an unreachable target", () => {
  it("ends the turn instead of throwing when the chosen attack is out of reach", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: WIDTH, height: HEIGHT }));
    const battle = mkCorneredBattle(grid);

    const { nextBattle, nextActionId, aiDescriptions } = performAIaction(
      battle,
      grid,
      "dragon-stuck",
    );

    const stuck = nextBattle.usersState.find((u) => u.userId === "dragon-stuck");
    const player = nextBattle.usersState.find((u) => u.userId === "user_player");
    expect(nextActionId).toBe("wait");
    expect(stuck?.curHealth).toBe(5000);
    expect(player?.curHealth).toBe(5000);
    expect(aiDescriptions.join(" ")).not.toMatch(/give up/);
  });

  it("still attacks with the same rules when the opponent is in reach", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: WIDTH, height: HEIGHT }));
    const battle = mkCorneredBattle(grid);
    const adjacent = battle.usersState.find((u) => u.userId === "dragon-0");
    if (adjacent) adjacent.actionPoints = 40;

    const { nextBattle, nextActionId } = performAIaction(battle, grid, "dragon-0");

    const player = nextBattle.usersState.find((u) => u.userId === "user_player");
    expect(nextActionId).toBe("basicAttack");
    expect(player?.curHealth).toBeLessThan(5000);
  });
});
