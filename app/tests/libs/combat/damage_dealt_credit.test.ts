import { describe, expect, it } from "bun:test";
import { applyEffects } from "@/libs/combat/process";
import type { BattleUserState, CompleteBattle, UserEffect } from "@/libs/combat/types";
import { isOpponentDamageTarget, resolveDamageCreditUser } from "@/libs/combat/util";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
  makeDamageEffect,
  makeEffect,
} from "../../setup/combat";

/**
 * Regression tests for damage_dealt attribution: every source of HP loss must
 * credit the caster's BattleUserState, and a summon's or clone's damage must land
 * on its controller, the only state buildCombatTrackerTasks reads. Attribution
 * then matches creatures_hunted, which already credits kills a summon secures to
 * the summoner.
 */

const TICK_RUNTIME = {
  targetType: "user",
  isNew: false,
  castThisRound: false,
  createdRound: 1,
} as const;

/** Instant single-hit damage effect realized against a user target. */
const makeInstantDamage = (creatorId: string, targetId: string): UserEffect =>
  makeDamageEffect({
    creatorId,
    targetId,
    rounds: 0,
    targetType: "user",
  } as Partial<UserEffect>);

/** A ticking (non-new) poison effect cast by `creatorId` on `targetId` in round 1. */
const makePoison = (creatorId: string, targetId: string): UserEffect =>
  makeEffect(
    "poison",
    { power: 100, rounds: 2 },
    { ...TICK_RUNTIME, id: "poison-1", creatorId, targetId, actionId: "poison-action" },
  );

/** A ticking (non-new) Health drain cast by `creatorId` on `targetId`. */
const makeDrain = (creatorId: string, targetId: string): UserEffect =>
  makeEffect(
    "drain",
    { power: 500, calculation: "static", rounds: 2, poolsAffected: ["Health"] },
    { ...TICK_RUNTIME, id: "drain-1", creatorId, targetId, actionId: "drain-action" },
  );

const makeBattle = (
  usersState: BattleUserState[],
  usersEffects: UserEffect[],
  round: number,
): CompleteBattle => makeCompleteBattle({ round, usersState, usersEffects });

/** Poison only reads the action's pool costs; drain ticks off the target acting. */
const poisonCostAction = makeCombatAction({ chakraCost: 100, staminaCost: 100 });

/**
 * Drain merges all drains on one target into a single consequence keyed by the
 * target, but it must be attributed to the caster: a consequence keyed to the
 * victim fails isOpponentDamageTarget and silently credits nobody. Poison converts
 * the poisoned target's pool expenditure into HP loss. Both must credit like the
 * other DoT consequences (residual, wound, afterburn).
 */
const DOT_TICKS = [
  { tag: "drain", makeTick: makeDrain, action: makeCombatAction() },
  { tag: "poison", makeTick: makePoison, action: poisonCostAction },
];

const makeSummon = () =>
  makeBattleUser("summon-1", {
    isSummon: true,
    controllerId: "attacker",
    direction: "left",
  });

describe("applyEffects — damage over time damage_dealt credit", () => {
  it.each(DOT_TICKS)(
    "credits $tag HP loss on an opponent to the caster",
    ({ makeTick, action }) => {
      const player = makeBattleUser("attacker");
      const enemy = makeBattleUser("defender");
      const battle = makeBattle([player, enemy], [makeTick("attacker", "defender")], 2);

      // The affected target acts, triggering the tick.
      const { newBattle } = applyEffects(battle, "defender", action);

      const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
      const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");
      const healthLost = enemy.curHealth - (newEnemy?.curHealth ?? 0);

      expect(healthLost).toBeGreaterThan(0);
      expect(newPlayer?.damageDealt).toBeCloseTo(healthLost, 5);
      expect(newEnemy?.damageDealt).toBe(0);
    },
  );

  it.each(DOT_TICKS)(
    "credits $tag cast by a summon to its controller",
    ({ makeTick, action }) => {
      const player = makeBattleUser("attacker");
      const summon = makeSummon();
      const enemy = makeBattleUser("defender");
      const battle = makeBattle(
        [player, summon, enemy],
        [makeTick("summon-1", "defender")],
        2,
      );

      const { newBattle } = applyEffects(battle, "defender", action);

      const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
      const newSummon = newBattle.usersState.find((u) => u.userId === "summon-1");
      const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");
      const healthLost = enemy.curHealth - (newEnemy?.curHealth ?? 0);

      expect(healthLost).toBeGreaterThan(0);
      expect(newPlayer?.damageDealt).toBeCloseTo(healthLost, 5);
      expect(newSummon?.damageDealt).toBe(0);
    },
  );

  it("credits the nominal poison amount even when the kill clamps actual HP loss", () => {
    const player = makeBattleUser("attacker");
    const enemy = makeBattleUser("defender", { curHealth: 50 });
    const battle = makeBattle([player, enemy], [makePoison("attacker", "defender")], 2);

    const { newBattle } = applyEffects(battle, "defender", poisonCostAction);

    const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
    const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");

    // 100 chakra + 100 stamina spent at power 100 → 200 nominal poison damage,
    // credited in full like the sibling consequence branches, while actual HP
    // loss clamps at the target's remaining 50 HP.
    expect(newEnemy?.curHealth).toBe(0);
    expect(newPlayer?.damageDealt).toBe(200);
  });
});

describe("applyEffects — damage_dealt credit", () => {
  it("credits damage dealt by a summon to its controller", () => {
    const player = makeBattleUser("attacker");
    const summon = makeSummon();
    const enemy = makeBattleUser("defender");
    const battle = makeBattle(
      [player, summon, enemy],
      [makeInstantDamage("summon-1", "defender")],
      1,
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
      1,
    );

    const { newBattle } = applyEffects(battle, "attacker");

    const newPlayer = newBattle.usersState.find((u) => u.userId === "attacker");
    const newEnemy = newBattle.usersState.find((u) => u.userId === "defender");
    const healthLost = enemy.curHealth - (newEnemy?.curHealth ?? 0);

    expect(healthLost).toBeGreaterThan(0);
    expect(newPlayer?.damageDealt).toBeCloseTo(healthLost, 5);
  });
});

describe("resolveDamageCreditUser", () => {
  it("credits a summon's controller, and a regular attacker themselves", () => {
    const player = makeBattleUser("attacker");
    const summon = makeSummon();

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

describe("isOpponentDamageTarget (damage attribution)", () => {
  it("is true for a real opposing-side opponent", () => {
    const attacker = makeBattleUser("attacker"); // direction left
    const defender = makeBattleUser("defender"); // direction right
    expect(isOpponentDamageTarget(attacker, defender)).toBe(true);
  });

  it("is false for self, summons, and same-side users", () => {
    const attacker = makeBattleUser("attacker");
    expect(isOpponentDamageTarget(attacker, attacker)).toBe(false);

    const enemySummon = makeBattleUser("summon", {
      direction: "right",
      isSummon: true,
    });
    expect(isOpponentDamageTarget(attacker, enemySummon)).toBe(false);

    const ally = makeBattleUser("ally", { direction: "left" });
    expect(isOpponentDamageTarget(attacker, ally)).toBe(false);
  });
});
