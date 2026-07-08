import { describe, expect, it } from "vitest";
import { applyEffects } from "@/libs/combat/process";
import type { CombatAction, CompleteBattle, UserEffect } from "@/libs/combat/types";
import { makeBattleUser, makeEffect } from "./helpers/battleScenario";

/**
 * Regression tests for damage_dealt attribution of drain ticks. Drain merges all
 * drains on one target into a single consequence keyed by the target, but the
 * consequence must be attributed to the caster so the drain_hp loss credits the
 * drainer's damageDealt like the other DoT consequences (residual, wound,
 * afterburn, poison). A consequence keyed to the victim would fail
 * isOpponentDamageTarget (self is never an opponent) and silently credit nobody.
 */

/** A ticking (non-new) Health drain cast by `creatorId` on `targetId`. */
const makeDrain = (creatorId: string, targetId: string): UserEffect =>
  makeEffect(
    "drain",
    { power: 500, calculation: "static", rounds: 2, poolsAffected: ["Health"] },
    {
      id: "drain-1",
      creatorId,
      targetId,
      targetType: "user",
      isNew: false,
      castThisRound: false,
      createdRound: 1,
      actionId: "drain-action",
    },
  );

/** Minimal action fixture; drain ticks off the target acting, not the action. */
const makeTickAction = (): CombatAction =>
  ({ chakraCost: 0, staminaCost: 0 }) as CombatAction;

const makeBattle = (
  usersState: ReturnType<typeof makeBattleUser>[],
  usersEffects: UserEffect[],
): CompleteBattle =>
  ({
    battleType: "COMBAT",
    round: 2,
    usersState,
    usersEffects,
    groundEffects: [],
    extraState: {},
  }) as unknown as CompleteBattle;

describe("applyEffects — drain damage_dealt credit", () => {
  it("credits drain HP loss on an opponent to the drainer", () => {
    const player = makeBattleUser("attacker");
    const enemy = makeBattleUser("defender");
    const battle = makeBattle([player, enemy], [makeDrain("attacker", "defender")]);

    // The drained target acts, triggering the drain tick.
    const { newBattle } = applyEffects(battle, "defender", makeTickAction());

    const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
    const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");
    const healthLost = enemy.curHealth - (newEnemy?.curHealth ?? 0);

    expect(healthLost).toBeGreaterThan(0);
    expect(newPlayer?.damageDealt).toBeCloseTo(healthLost, 5);
    expect(newEnemy?.damageDealt).toBe(0);
  });

  it("credits drain cast by a summon to its controller", () => {
    const player = makeBattleUser("attacker");
    const summon = makeBattleUser("summon-1", {
      isSummon: true,
      controllerId: "attacker",
      direction: "left",
    });
    const enemy = makeBattleUser("defender");
    const battle = makeBattle(
      [player, summon, enemy],
      [makeDrain("summon-1", "defender")],
    );

    const { newBattle } = applyEffects(battle, "defender", makeTickAction());

    const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
    const newSummon = newBattle.usersState.find((u) => u.userId === "summon-1");
    const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");
    const healthLost = enemy.curHealth - (newEnemy?.curHealth ?? 0);

    expect(healthLost).toBeGreaterThan(0);
    expect(newPlayer?.damageDealt).toBeCloseTo(healthLost, 5);
    expect(newSummon?.damageDealt).toBe(0);
  });
});
