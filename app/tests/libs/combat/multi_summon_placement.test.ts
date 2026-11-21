import { describe, expect, it } from "bun:test";
import { insertAction } from "@/libs/combat/actions";
import { applyEffects } from "@/libs/combat/process";
import type {
  BattleUserState,
  CombatAction,
  CompleteBattle,
  ReturnedBattle,
} from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { SummonTag } from "@/validators/combat";
import { makeCombatAction, makeCompleteBattle } from "../../setup/combat";

/**
 * A jutsu may carry several summon tags (e.g. a bloodline that calls two creatures
 * at once). insertAction realizes every tag on the one EMPTY_GROUND target tile, so
 * the first creature takes that tile and each further creature is placed on the
 * nearest empty tile instead of stacking on top of it.
 */

const PLAYER_ID = "player1";
const FIRST_AI = "ai-tortoise";
const SECOND_AI = "ai-king";

const mkTemplate = (aiId: string, username: string): BattleUserState =>
  ({
    userId: `${aiId}-template`,
    controllerId: aiId,
    username,
    isAi: true,
    isSummon: true,
    isSummonTemplate: true,
    isOriginal: true,
    level: 10,
    poolsMultiplier: 1,
    statsMultiplier: 1,
    bloodlineId: null,
    effects: [],
    curHealth: 0,
    maxHealth: 100,
    fledBattle: false,
    leftBattle: false,
    longitude: 0,
    latitude: 0,
    initiative: 0,
    offence: 100,
    defence: 100,
    ninjutsuMastery: 100,
    genjutsuMastery: 100,
    taijutsuMastery: 100,
    bukijutsuMastery: 100,
    bloodlineMastery: 100,
    sageMastery: 100,
    strength: 100,
    intelligence: 100,
    willpower: 100,
    speed: 100,
  }) as unknown as BattleUserState;

const mkPlayer = (): BattleUserState =>
  ({
    userId: PLAYER_ID,
    controllerId: PLAYER_ID,
    username: "Player",
    gender: "Male",
    isAi: false,
    isSummon: false,
    isOriginal: true,
    level: 10,
    villageId: "v1",
    direction: "left",
    longitude: 2,
    latitude: 2,
    initiative: 10,
    curHealth: 1000,
    maxHealth: 1000,
    curChakra: 1000,
    curStamina: 1000,
    actionPoints: 100,
    highestGenerals: ["strength"],
    fledBattle: false,
    leftBattle: false,
    usedActions: [],
    items: [],
    jutsus: [],
    basicActions: [],
    effects: [],
    usedGenerals: { strength: 0, intelligence: 0, willpower: 0, speed: 0 },
    usedStats: { offence: 0, defence: 0 },
  }) as unknown as BattleUserState;

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
      mkPlayer(),
      mkTemplate(FIRST_AI, "Tortoise"),
      mkTemplate(SECOND_AI, "King"),
    ],
    groundEffects: [],
    extraState: { bloodlines: {}, jutsus: {}, items: {} },
  });

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

const cast = (aiIds: string[], target = { longitude: 4, latitude: 2 }) => {
  const battle = mkBattle();
  const grid = getBattleGrid(20, battle as unknown as ReturnedBattle);
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
