import { describe, expect, it } from "bun:test";
import {
  actionReachesTarget,
  validateActionTarget,
} from "@/libs/combat/targetValidation";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { DamageTag, HealTag } from "@/validators/combat";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
} from "../../setup/combat";

const scenario = (actorActionPoints: number, activeUserId = "actor") => {
  const actor = makeBattleUser("actor", {
    longitude: 1,
    latitude: 1,
    direction: "left",
    actionPoints: actorActionPoints,
  });
  const ally = makeBattleUser("ally", { longitude: 2, latitude: 1, direction: "left" });
  const enemy = makeBattleUser("enemy", {
    longitude: 3,
    latitude: 1,
    direction: "right",
  });
  const battle = makeCompleteBattle({
    width: 5,
    height: 3,
    usersState: [actor, ally, enemy],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    roundStartAt: new Date(),
    activeUserId,
  }) as ReturnedBattle;
  const grid = getBattleGrid(20, battle);
  const tile = (col: number) => {
    const hex = grid.getHex({ col, row: 1 });
    if (!hex) throw new Error("Missing fixture tile");
    return hex;
  };
  const check = (action: CombatAction, col: number) => {
    const info = {
      user: battle.usersState.find((user) => user.userId === "actor")!,
      battle,
      action,
      grid,
      target: tile(col),
      timeDiff: 0,
    };
    return {
      valid: validateActionTarget(info).isValid,
      reaches: actionReachesTarget(info),
    };
  };
  return { check };
};

const heal = makeCombatAction({
  id: "heal",
  name: "Heal",
  target: "CHARACTER",
  method: "SINGLE",
  range: 3,
  actionCostPerc: 50,
  effects: [HealTag.parse({ power: 10, calculation: "static", rounds: 0 })],
});
const strike = makeCombatAction({
  id: "strike",
  name: "Strike",
  target: "OTHER_USER",
  method: "SINGLE",
  range: 3,
  actionCostPerc: 50,
  effects: [DamageTag.parse({ power: 10, calculation: "static", rounds: 0 })],
});

describe("actionReachesTarget", () => {
  it("matches validation while the actor can act", () => {
    const { check } = scenario(100);
    expect(check(heal, 1)).toEqual({ valid: true, reaches: true });
    expect(check(heal, 2)).toEqual({ valid: true, reaches: true });
    expect(check(strike, 3)).toEqual({ valid: true, reaches: true });
  });

  it("still reaches a target the actor lacks the action points for", () => {
    const { check } = scenario(0);
    expect(check(heal, 1)).toEqual({ valid: false, reaches: true });
    expect(check(heal, 2)).toEqual({ valid: false, reaches: true });
  });

  it("still reaches a target outside the actor's turn", () => {
    const { check } = scenario(100, "enemy");
    expect(check(heal, 1)).toEqual({ valid: false, reaches: true });
  });

  it("does not reach a tile the action cannot target", () => {
    const { check } = scenario(100);
    expect(check(strike, 1)).toEqual({ valid: false, reaches: false });
    expect(check(heal, 0)).toEqual({ valid: false, reaches: false });
  });
});
