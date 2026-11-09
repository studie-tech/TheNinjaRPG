import { describe, expect, it } from "bun:test";

/**
 * `damageBarrier` consumes `barrierAbsorb` as a 0-1 fraction. The single-target
 * path supplies that fraction (getBarriersBetween normalizes absorbPercentage to
 * `value / 100`), and the AOE path must assign the same fraction: the raw 1-100
 * `absorbPercentage` integer would make AOE hits deal ~100x the intended damage
 * to barriers, instantly destroying them.
 */

import { insertAction } from "@/libs/combat/actions";
import type {
  CombatAction,
  CompleteBattle,
  GroundEffect,
  ReturnedBattle,
} from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { DamageTag } from "@/validators/combat";
import { makeCombatAction } from "../../setup/combat";

const ABSORB_PERCENTAGE = 50;

const makeActor = () => ({
  userId: "actor",
  username: "Actor",
  gender: "Male",
  villageId: "village-1",
  direction: "left",
  level: 100,
  longitude: 0,
  latitude: 0,
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
  usedGenerals: { strength: 0, intelligence: 0, willpower: 0, speed: 0 },
  usedStats: {
    offence: 0,
    defence: 0,
  },
});

/** Enemy barrier sitting one tile away from the actor. */
const makeBarrier = (): GroundEffect =>
  ({
    id: "barrier-1",
    type: "barrier",
    creatorId: "enemy",
    longitude: 1,
    latitude: 0,
    level: 0,
    power: 10,
    absorbPercentage: ABSORB_PERCENTAGE,
    curHealth: 100000,
    maxHealth: 100000,
    isNew: false,
    castThisRound: false,
    createdRound: 0,
    barrierAbsorb: 0,
    actionId: "barrier-action",
    rounds: 10,
  }) as unknown as GroundEffect;

const makeBattle = (): CompleteBattle =>
  ({
    id: "battle-1",
    battleType: "COMBAT",
    width: 5,
    height: 5,
    round: 1,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2020-01-01T00:00:00Z"),
    roundStartAt: new Date("2020-01-01T00:00:00Z"),
    extraState: {} as CompleteBattle["extraState"],
    usersState: [makeActor()],
    usersEffects: [],
    groundEffects: [makeBarrier()],
  }) as unknown as CompleteBattle;

/** AOE damage action centered on the barrier tile. */
const makeAoeDamageAction = (): CombatAction =>
  makeCombatAction({
    id: "aoe-jutsu",
    name: "AOE Blast",
    target: "OPPONENT",
    method: "AOE_CIRCLE_SPAWN",
    range: 3,
    level: 1,
    effects: [DamageTag.parse({})],
  });

describe("AOE barrier absorption scaling", () => {
  it("assigns barrierAbsorb as a 0-1 fraction (absorbPercentage / 100), not the raw percentage", () => {
    const battle = makeBattle();
    const grid = getBattleGrid(20, battle as unknown as ReturnedBattle);

    const result = insertAction({
      battle,
      grid,
      action: makeAoeDamageAction(),
      actorId: "actor",
      longitude: 1,
      latitude: 0,
    });

    // The AOE must actually have reached the barrier.
    expect(result).toBe(true);
    const barrierEffect = battle.usersEffects.find(
      (e) => e.targetType === "barrier" && e.targetId === "barrier-1",
    );
    expect(barrierEffect).toBeDefined();

    // AOE assigns the fraction, matching damageBarrier's contract.
    expect(barrierEffect!.barrierAbsorb).toBeCloseTo(ABSORB_PERCENTAGE / 100, 10);
    // The raw 1-100 percentage must never leak through.
    expect(barrierEffect!.barrierAbsorb).toBeLessThanOrEqual(1);
  });
});
