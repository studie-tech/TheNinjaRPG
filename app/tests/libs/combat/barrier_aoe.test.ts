import { describe, expect, it, vi } from "vitest";

/**
 * Regression test for the AOE-vs-barrier damage scaling bug.
 *
 * `damageBarrier` consumes `barrierAbsorb` as a 0-1 fraction. The single-target
 * path supplies that fraction (getBarriersBetween normalizes absorbPercentage to
 * `value / 100`), but the AOE path used to assign the raw 1-100 `absorbPercentage`
 * integer directly. That made AOE hits deal ~100x the intended damage to barriers,
 * instantly destroying them. This test pins the AOE path to the fractional contract.
 */

/** Avoid executing real db/env when transitive imports touch `@/server/db`. */
vi.mock("@/server/db", () => ({ drizzleDB: {} }));

/**
 * insertAction only needs `checkFriendlyFire` (force pass) from process; it never calls
 * applyEffects. Override ONLY checkFriendlyFire — do NOT stub applyEffects. Under `bun test`
 * vi.mock merges the factory over the real module and the override is process-global, so stubbing
 * applyEffects here leaks into sibling suites that drive the real applyEffects (summon/poison/
 * used_tag_types damage-credit tests) and crashes them (newBattle.usersState undefined). Leaving
 * applyEffects real is inert here since this suite never calls it.
 */
vi.mock("@/libs/combat/process", () => ({
  checkFriendlyFire: vi.fn(() => true),
}));

import { insertAction } from "@/libs/combat/actions";
import { getBattleGrid } from "@/libs/combat/util";
import { DamageTag } from "@/validators/combat";
import type {
  CombatAction,
  CompleteBattle,
  GroundEffect,
  ReturnedBattle,
} from "@/libs/combat/types";

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
  highestOffence: "offence",
  highestDefence: "defence",
  highestMasteryType: "Ninjutsu",
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
    usersState: [makeActor()],
    usersEffects: [],
    groundEffects: [makeBarrier()],
  }) as unknown as CompleteBattle;

/** AOE damage action centered on the barrier tile. */
const makeAoeDamageAction = (): CombatAction =>
  ({
    id: "aoe-jutsu",
    name: "AOE Blast",
    image: "/jutsu.png",
    battleDescription: "",
    type: "jutsu",
    target: "OPPONENT",
    method: "AOE_CIRCLE_SPAWN",
    range: 3,
    healthCost: 0,
    chakraCost: 0,
    staminaCost: 0,
    actionCostPerc: 10,
    updatedAt: new Date("2020-01-01T00:00:00Z"),
    cooldown: 0,
    originalCooldown: 0,
    level: 1,
    effects: [DamageTag.parse({})],
  }) as unknown as CombatAction;

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

    // The fix: AOE assigns the fraction, matching damageBarrier's contract.
    expect(barrierEffect!.barrierAbsorb).toBeCloseTo(ABSORB_PERCENTAGE / 100, 10);
    // Guard against the original 100x bug: the raw 1-100 percentage must never leak through.
    expect(barrierEffect!.barrierAbsorb).toBeLessThanOrEqual(1);
  });
});
