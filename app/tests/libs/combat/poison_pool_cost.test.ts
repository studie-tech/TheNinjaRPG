import { describe, expect, it } from "bun:test";
import { applyEffects } from "@/libs/combat/process";
import type { CompleteBattle, UserEffect } from "@/libs/combat/types";
import { calcPoolCost } from "@/libs/combat/util";
import { makeBattleUser, makeCombatAction, makeEffect } from "../../setup/combat";

const runtime = (id: string, creatorId: string) => ({
  id,
  creatorId,
  targetId: "defender",
  targetType: "user" as const,
  isNew: false,
  castThisRound: false,
  createdRound: 1,
  actionId: id,
});

const poison = () =>
  makeEffect("poison", { power: 100, rounds: 3 }, runtime("poison", "attacker"));

const action = makeCombatAction({ chakraCost: 200, staminaCost: 300 });

const poolCost = (
  type: "increasepoolcost" | "decreasepoolcost",
  tag: { power: number; powerPerLevel?: number; calculation: "static" | "percentage" },
  level = 0,
): UserEffect => ({
  ...makeEffect(
    type,
    { rounds: 4, poolsAffected: ["Chakra", "Stamina"], ...tag },
    runtime("cost", "defender"),
  ),
  level,
});

const poisonDamage = (modifier: UserEffect) => {
  const defender = makeBattleUser("defender");
  const battle = {
    battleType: "COMBAT",
    round: 2,
    usersState: [makeBattleUser("attacker"), defender],
    usersEffects: [poison(), modifier],
    groundEffects: [],
    extraState: {},
  } as unknown as CompleteBattle;
  const spent = calcPoolCost(action, structuredClone(battle.usersEffects), defender);
  const { newBattle } = applyEffects(battle, "defender", action);
  const after = newBattle.usersState.find((u) => u.userId === "defender");
  return {
    spent: spent.cpCost + spent.spCost,
    damage: defender.curHealth - (after?.curHealth ?? 0),
  };
};

describe("poison over modified pool costs", () => {
  it.each([
    [
      "a flat increase",
      poolCost("increasepoolcost", { power: 10, calculation: "static" }),
      520,
    ],
    [
      "a flat decrease",
      poolCost("decreasepoolcost", { power: 10, calculation: "static" }),
      480,
    ],
    [
      "a percentage increase",
      poolCost("increasepoolcost", { power: 20, calculation: "percentage" }),
      600,
    ],
    [
      "a percentage decrease",
      poolCost("decreasepoolcost", { power: 20, calculation: "percentage" }),
      400,
    ],
    [
      "level-scaled power",
      poolCost(
        "increasepoolcost",
        { power: 10, powerPerLevel: 1, calculation: "percentage" },
        20,
      ),
      650,
    ],
  ])("turns what the action spends under %s into damage", (_label, modifier, total) => {
    const { spent, damage } = poisonDamage(modifier);
    expect(spent).toBeCloseTo(total, 5);
    expect(damage).toBe(Math.floor(total));
  });
});

describe("pool cost floor", () => {
  const user = makeBattleUser("defender");
  const costs = (modifiers: UserEffect[]) => calcPoolCost(action, modifiers, user);

  it("makes an action free, never a refund, under a static reduction past its cost", () => {
    const modifier = poolCost("decreasepoolcost", {
      power: 250,
      calculation: "static",
    });
    expect(costs([modifier])).toEqual({ hpCost: 0, cpCost: 0, spCost: 50 });
  });

  it("makes an action free under a level-scaled percentage reduction past 100%", () => {
    const modifier = poolCost(
      "decreasepoolcost",
      { power: 120, powerPerLevel: 1, calculation: "percentage" },
      30,
    );
    expect(costs([modifier])).toEqual({ hpCost: 0, cpCost: 0, spCost: 0 });
  });

  it("floors stacked reductions at zero", () => {
    const flat = poolCost("decreasepoolcost", { power: 350, calculation: "static" });
    const percentage = poolCost("decreasepoolcost", {
      power: 50,
      calculation: "percentage",
    });
    expect(costs([flat, percentage])).toEqual({ hpCost: 0, cpCost: 0, spCost: 0 });
  });

  it("deals no poison damage for an action made free", () => {
    const modifier = poolCost("decreasepoolcost", {
      power: 500,
      calculation: "static",
    });
    expect(poisonDamage(modifier)).toEqual({ spent: 0, damage: 0 });
  });
});
