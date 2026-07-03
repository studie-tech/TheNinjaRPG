import { describe, expect, it } from "vitest";
import { applyEffects } from "@/libs/combat/process";
import type { CombatAction, CompleteBattle, UserEffect } from "@/libs/combat/types";
import { makeBattleUser, makeEffect } from "./helpers/battleScenario";

/**
 * Regression tests for damage_dealt attribution of poison ticks: poison converts
 * the poisoned target's pool expenditure into HP loss, and that loss must credit
 * the poisoner's damageDealt like the other DoT/drain consequences (residual,
 * wound, afterburn, drain_hp) do.
 */

/** A ticking (non-new) poison effect cast by `creatorId` on `targetId` in round 1. */
const makePoison = (creatorId: string, targetId: string): UserEffect =>
  makeEffect(
    "poison",
    { power: 100, rounds: 2 },
    {
      id: "poison-1",
      creatorId,
      targetId,
      targetType: "user",
      isNew: false,
      castThisRound: false,
      createdRound: 1,
      actionId: "poison-action",
    },
  );

/** Minimal action fixture; poison only reads the pool costs. */
const makeCostAction = (): CombatAction =>
  ({ chakraCost: 100, staminaCost: 100 }) as CombatAction;

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

describe("applyEffects — poison damage_dealt credit", () => {
  it("credits poison HP loss on an opponent to the poisoner", () => {
    const player = makeBattleUser("attacker");
    const enemy = makeBattleUser("defender");
    const battle = makeBattle(
      [player, enemy],
      [makePoison("attacker", "defender")],
    );

    // The poisoned target acts and spends pools, triggering the poison tick.
    const { newBattle } = applyEffects(battle, "defender", makeCostAction());

    const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
    const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");
    const healthLost = enemy.curHealth - (newEnemy?.curHealth ?? 0);

    expect(healthLost).toBeGreaterThan(0);
    expect(newPlayer?.damageDealt).toBeCloseTo(healthLost, 5);
    expect(newEnemy?.damageDealt).toBe(0);
  });

  it("credits the nominal poison amount even when the kill clamps actual HP loss", () => {
    const player = makeBattleUser("attacker");
    const enemy = makeBattleUser("defender", { curHealth: 50 });
    const battle = makeBattle(
      [player, enemy],
      [makePoison("attacker", "defender")],
    );

    const { newBattle } = applyEffects(battle, "defender", makeCostAction());

    const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
    const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");

    // 100 chakra + 100 stamina spent at power 100 → 200 nominal poison damage,
    // credited in full like the sibling consequence branches, while actual HP
    // loss clamps at the target's remaining 50 HP.
    expect(newEnemy?.curHealth).toBe(0);
    expect(newPlayer?.damageDealt).toBe(200);
  });

  it("credits poison cast by a summon to its controller", () => {
    const player = makeBattleUser("attacker");
    const summon = makeBattleUser("summon-1", {
      isSummon: true,
      controllerId: "attacker",
      direction: "left",
    });
    const enemy = makeBattleUser("defender");
    const battle = makeBattle(
      [player, summon, enemy],
      [makePoison("summon-1", "defender")],
    );

    const { newBattle } = applyEffects(battle, "defender", makeCostAction());

    const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
    const newSummon = newBattle.usersState.find((u) => u.userId === "summon-1");
    const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");
    const healthLost = enemy.curHealth - (newEnemy?.curHealth ?? 0);

    expect(healthLost).toBeGreaterThan(0);
    expect(newPlayer?.damageDealt).toBeCloseTo(healthLost, 5);
    expect(newSummon?.damageDealt).toBe(0);
  });
});
