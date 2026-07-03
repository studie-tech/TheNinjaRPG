import { describe, expect, it } from "vitest";
import { applyEffects } from "@/libs/combat/process";
import { resolveDamageCreditUser } from "@/libs/combat/util";
import type { CompleteBattle, UserEffect } from "@/libs/combat/types";
import { makeBattleUser, makeDamageEffect } from "./helpers/battleScenario";

/**
 * Regression tests for damage_dealt attribution when the attacker is a summon or
 * clone: the accumulated damage must land on the controller's BattleUserState —
 * the only state buildCombatTrackerTasks reads — instead of being lost on the
 * summon's. Attribution then matches creatures_hunted, which already credits
 * kills a summon secures to the summoner.
 */

/** Instant single-hit damage effect realized against a user target. */
const makeInstantDamage = (creatorId: string, targetId: string): UserEffect =>
  makeDamageEffect({
    creatorId,
    targetId,
    rounds: 0,
    targetType: "user",
  } as Partial<UserEffect>);

const makeBattle = (
  usersState: ReturnType<typeof makeBattleUser>[],
  usersEffects: UserEffect[],
): CompleteBattle =>
  ({
    battleType: "COMBAT",
    round: 1,
    usersState,
    usersEffects,
    groundEffects: [],
    extraState: {},
  }) as unknown as CompleteBattle;

describe("resolveDamageCreditUser", () => {
  it("credits a summon's controller, and a regular attacker themselves", () => {
    const player = makeBattleUser("attacker");
    const summon = makeBattleUser("summon-1", {
      isSummon: true,
      controllerId: "attacker",
      direction: "left",
    });

    expect(resolveDamageCreditUser([player, summon], summon)).toBe(player);
    expect(resolveDamageCreditUser([player, summon], player)).toBe(player);
  });

  it("falls back to the summon itself when the controller is absent", () => {
    const summon = makeBattleUser("summon-1", {
      isSummon: true,
      controllerId: "gone",
    });
    expect(resolveDamageCreditUser([summon], summon)).toBe(summon);
  });
});

describe("applyEffects — damage_dealt credit (#13)", () => {
  it("credits damage dealt by a summon to its controller", () => {
    const player = makeBattleUser("attacker");
    const summon = makeBattleUser("summon-1", {
      isSummon: true,
      controllerId: "attacker",
      direction: "left",
    });
    const enemy = makeBattleUser("defender");
    const battle = makeBattle(
      [player, summon, enemy],
      [makeInstantDamage("summon-1", "defender")],
    );

    const { newBattle } = applyEffects(battle, "summon-1");

    const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
    const newSummon = newBattle.usersState.find((u) => u.userId === "summon-1");
    const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");
    const healthLost = enemy.curHealth - (newEnemy?.curHealth ?? 0);

    expect(healthLost).toBeGreaterThan(0);
    expect(newPlayer?.damageDealt).toBeCloseTo(healthLost, 5);
    expect(newSummon?.damageDealt).toBe(0);
  });

  it("still credits a regular attacker's own damage to themselves", () => {
    const player = makeBattleUser("attacker");
    const enemy = makeBattleUser("defender");
    const battle = makeBattle(
      [player, enemy],
      [makeInstantDamage("attacker", "defender")],
    );

    const { newBattle } = applyEffects(battle, "attacker");

    const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
    const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");
    const healthLost = enemy.curHealth - (newEnemy?.curHealth ?? 0);

    expect(healthLost).toBeGreaterThan(0);
    expect(newPlayer?.damageDealt).toBeCloseTo(healthLost, 5);
  });
});
