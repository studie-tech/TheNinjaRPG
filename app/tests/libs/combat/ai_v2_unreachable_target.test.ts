import { describe, it, expect } from "bun:test";
import { Grid, rectangle, ring } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import type { BattleUserState, ExtraState } from "@/libs/combat/types";
import { TerrainHex } from "@/libs/hexgrid";
import {
  ActionMoveTowardsOpponent,
  ActionWithEffectHighestPower,
  ConditionDistanceHigherThan,
} from "@/validators/ai";
import { makeAiBattle, makeAiUser } from "./helpers/aiScenario";
import { makeJutsu, makeTag } from "../../setup/combat";

/**
 * An AI whose chosen action turns out to be impossible must fall through to its
 * next rule instead of aborting the whole turn. Scenario: the player stands in a
 * corner and AIs occupy every neighbouring tile, so one more AI can neither step
 * closer nor reach with its range-1 basic attack, and its 60 AP jutsu is
 * unaffordable on 40 AP. Throwing there would surface as a repeating "Action Basic
 * Attack no longer possible" notification until the round timer passes the turn on.
 */

const PROFILE = "profile-dragon";
const HEAVY_JUTSU = "j-heavy";
const WIDTH = 13;
const HEIGHT = 9;

const mkUser = (over: Partial<BattleUserState>): BattleUserState =>
  makeAiUser({
    controllerId: "dragon-template", aiProfileId: PROFILE, villageId: "village-ai",
    longitude: 0, latitude: 0, originalLongitude: 0, originalLatitude: 0,
    level: 60, originalLevel: 60,
    ...over,
  });

const heavyJutsu = makeJutsu({
  id: HEAVY_JUTSU,
  name: "Heavy Strike",
  battleDescription: "%user strikes %target",
  jutsuType: "AI",
  range: 5,
  actionCostPerc: 60,
  effects: [makeTag("damage", {
    power: 40, powerPerLevel: 0,
    calculation: "formula", statTypes: ["None"], generalTypes: [], elements: [],
    rounds: 0, target: "INHERIT", friendlyFire: "ENEMIES", description: "dmg",
  })],
});

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
    isAi: false, aiProfileId: undefined, villageId: "village-player", direction: "left",
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

  return makeAiBattle({
    battleType: "QUEST", activeUserId: stuck.userId, width: WIDTH, height: HEIGHT,
    usersState: [player, ...blockers, stuck],
    extraState: {
      jutsus: { [HEAVY_JUTSU]: heavyJutsu },
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
      } as unknown as ExtraState["aiProfiles"],
    },
  });
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
