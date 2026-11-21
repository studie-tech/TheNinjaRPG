import { describe, expect, it } from "bun:test";
import { insertAction } from "@/libs/combat/actions";
import { applyEffects } from "@/libs/combat/process";
import type { CombatAction, CompleteBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { SummonTag } from "@/validators/combat";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
} from "../../setup/combat";
import { makeSummonTemplate } from "./helpers/summon";

/**
 * A jutsu may carry several summon tags (e.g. a bloodline that calls two creatures
 * at once). insertAction realizes every tag on the one EMPTY_GROUND target tile, so
 * the first creature takes that tile and each further creature is placed on the
 * nearest empty tile instead of stacking on top of it.
 */

const PLAYER_ID = "player1";
const FIRST_AI = "ai-tortoise";
const SECOND_AI = "ai-king";

/** Provide the innate effects read when a template becomes a live summon. */
const mkTemplate = (aiId: string, username: string) => ({
  ...makeSummonTemplate(aiId, username),
  effects: [],
});

/** Put a caster and two dormant summon templates in a fixed arena. */
const mkBattle = (): CompleteBattle =>
  makeCompleteBattle({
    activeUserId: PLAYER_ID,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    roundStartAt: new Date("2026-01-01T00:00:00Z"),
    width: 10,
    height: 10,
    round: 1,
    usersState: [
      makeBattleUser(PLAYER_ID, {
        username: "Player",
        isAi: false,
        direction: "left",
        longitude: 2,
        latitude: 2,
        initiative: 10,
        effects: [],
      }),
      mkTemplate(FIRST_AI, "Tortoise"),
      mkTemplate(SECOND_AI, "King"),
    ],
    groundEffects: [],
    extraState: { bloodlines: {}, jutsus: {}, items: {} },
  });

/** Give one targeted jutsu a summon tag for each requested creature. */
const summonAction = (aiIds: string[]): CombatAction =>
  makeCombatAction({
    id: "zoo-jutsu",
    name: "Summoning: Zoo",
    target: "EMPTY_GROUND",
    method: "SINGLE",
    range: 2,
    level: 1,
    effects: aiIds.map((aiId) =>
      SummonTag.parse({ aiId, aiHp: 500, power: 50, rounds: 3 }),
    ),
  });

/** Resolve a real cast and expose its creatures, effects and placement grid. */
const cast = (aiIds: string[], target = { longitude: 4, latitude: 2 }) => {
  const battle = mkBattle();
  const grid = getBattleGrid(20, battle);
  const inserted = insertAction({
    battle,
    grid,
    action: summonAction(aiIds),
    actorId: PLAYER_ID,
    ...target,
  });
  expect(inserted).toBe(true);
  const { newBattle } = applyEffects(battle, PLAYER_ID);
  const spawned = newBattle.usersState.filter(
    (u) => u.isSummon && !u.isSummonTemplate && u.controllerId === PLAYER_ID,
  );
  return { battle: newBattle, spawned, grid };
};

describe("a jutsu with several summon tags", () => {
  it("spawns every creature from one cast", () => {
    const { spawned } = cast([FIRST_AI, SECOND_AI]);
    expect(spawned.map((u) => u.summonSourceId).sort()).toEqual(
      [FIRST_AI, SECOND_AI].sort(),
    );
  });

  it("keeps the first creature on the target tile and puts the next on an adjacent empty tile", () => {
    const { spawned, grid } = cast([FIRST_AI, SECOND_AI]);
    const first = spawned.find((u) => u.summonSourceId === FIRST_AI)!;
    const second = spawned.find((u) => u.summonSourceId === SECOND_AI)!;
    expect({ col: first.longitude, row: first.latitude }).toEqual({ col: 4, row: 2 });
    expect({ col: second.longitude, row: second.latitude }).not.toEqual({
      col: 4,
      row: 2,
    });
    const firstHex = grid.getHex({ col: first.longitude, row: first.latitude })!;
    const secondHex = grid.getHex({ col: second.longitude, row: second.latitude })!;
    expect(grid.distance(firstHex, secondHex)).toBe(1);
    // The second creature never lands on the caster either.
    expect({ col: second.longitude, row: second.latitude }).not.toEqual({
      col: 2,
      row: 2,
    });
  });

  it("places the creatures on the same tiles on every cast", () => {
    const positions = () =>
      cast([FIRST_AI, SECOND_AI])
        .spawned.map((u) => `${u.summonSourceId}@${u.longitude},${u.latitude}`)
        .sort();
    expect(positions()).toEqual(positions());
  });

  it("leaves the ground effects on the tiles their creatures stand on", () => {
    const { battle, spawned } = cast([FIRST_AI, SECOND_AI]);
    for (const creature of spawned) {
      const effect = battle.groundEffects.find(
        (e) => e.type === "summon" && e.summonedUserId === creature.userId,
      );
      expect(effect).toBeDefined();
      expect({ col: effect!.longitude, row: effect!.latitude }).toEqual({
        col: creature.longitude,
        row: creature.latitude,
      });
    }
  });
});

describe("a jutsu with one summon tag", () => {
  it("spawns its creature on the target tile", () => {
    const { spawned } = cast([FIRST_AI], { longitude: 3, latitude: 3 });
    expect(spawned).toHaveLength(1);
    expect({ col: spawned[0]!.longitude, row: spawned[0]!.latitude }).toEqual({
      col: 3,
      row: 3,
    });
  });
});
