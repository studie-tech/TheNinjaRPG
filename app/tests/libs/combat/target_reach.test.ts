import { describe, expect, it } from "bun:test";
import {
  actionAimsAtFighter,
  tapAimsAction,
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
  const distant = makeBattleUser("distant", {
    longitude: 4,
    latitude: 1,
    direction: "left",
  });
  const battle = makeCompleteBattle({
    width: 5,
    height: 3,
    usersState: [actor, ally, enemy, distant],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    roundStartAt: new Date(),
    activeUserId,
    round: 3,
  }) as ReturnedBattle;
  const grid = getBattleGrid(20, battle);
  const tile = (col: number) => {
    const hex = grid.getHex({ col, row: 1 });
    if (!hex) throw new Error("Missing fixture tile");
    return hex;
  };
  /** Validate a tap on the fighter's own tile, and whether the action aims at them. */
  const check = (action: CombatAction, fighterId: string) => {
    const fighter = battle.usersState.find((user) => user.userId === fighterId)!;
    const info = {
      user: battle.usersState.find((user) => user.userId === "actor")!,
      battle,
      action,
      grid,
      target: tile(fighter.longitude),
      timeDiff: 0,
    };
    return {
      valid: validateActionTarget(info).isValid,
      aims: actionAimsAtFighter(info, fighterId),
    };
  };
  /** Whether the action aims at the fighter when the tapped tile is another one. */
  const aimsFromTile = (action: CombatAction, fighterId: string, col: number) =>
    actionAimsAtFighter(
      {
        user: battle.usersState.find((user) => user.userId === "actor")!,
        battle,
        action,
        grid,
        target: tile(col),
        timeDiff: 0,
      },
      fighterId,
    );
  /** Whether a tap whose pointer is on one tile and whose sprite hit is a fighter aims. */
  const tapAims = (action: CombatAction, fighterId: string, col: number) =>
    tapAimsAction(
      {
        user: battle.usersState.find((user) => user.userId === "actor")!,
        battle,
        action,
        grid,
        target: tile(col),
        timeDiff: 0,
      },
      fighterId,
    );
  return { check, aimsFromTile, tapAims };
};

const heal = makeCombatAction({
  id: "heal",
  name: "Heal",
  target: "CHARACTER",
  method: "SINGLE",
  range: 1,
  actionCostPerc: 50,
  effects: [HealTag.parse({ power: 10, calculation: "static", rounds: 0 })],
});
const selfBuff = makeCombatAction({
  id: "self-buff",
  name: "Self buff",
  target: "SELF",
  method: "SINGLE",
  range: 0,
  actionCostPerc: 50,
  effects: [HealTag.parse({ power: 10, calculation: "static", rounds: 0 })],
});
const strike = makeCombatAction({
  id: "strike",
  name: "Strike",
  target: "OPPONENT",
  method: "SINGLE",
  range: 3,
  actionCostPerc: 50,
  effects: [DamageTag.parse({ power: 10, calculation: "static", rounds: 0 })],
});

describe("actionAimsAtFighter", () => {
  it("matches validation while the actor can act", () => {
    const { check } = scenario(100);
    expect(check(heal, "actor")).toEqual({ valid: true, aims: true });
    expect(check(heal, "ally")).toEqual({ valid: true, aims: true });
    expect(check(strike, "enemy")).toEqual({ valid: true, aims: true });
  });

  it("aims on the actor's turn without the action points for it", () => {
    const { check } = scenario(30);
    expect(check(heal, "actor")).toEqual({ valid: false, aims: true });
    expect(check(heal, "ally")).toEqual({ valid: false, aims: true });
    expect(check(selfBuff, "actor")).toEqual({ valid: false, aims: true });
  });

  it("aims on the actor's turn while the action cools down", () => {
    const { check } = scenario(100);
    const cooling = { ...heal, cooldown: 3, lastUsedRound: 2 };
    expect(check(cooling, "ally")).toEqual({ valid: false, aims: true });
  });

  it("aims at nothing outside the actor's turn", () => {
    const { check } = scenario(100, "enemy");
    expect(check(heal, "actor")).toEqual({ valid: false, aims: false });
    expect(check(heal, "ally")).toEqual({ valid: false, aims: false });
  });

  it("does not aim at a fighter the action cannot target", () => {
    const { check } = scenario(100);
    expect(check(strike, "ally")).toEqual({ valid: false, aims: false });
    expect(check(selfBuff, "ally")).toEqual({ valid: false, aims: false });
    expect(check(heal, "distant")).toEqual({ valid: false, aims: false });
  });

  it("judges the fighter's own tile, not the tile under the tap", () => {
    const { aimsFromTile } = scenario(30);
    expect(aimsFromTile(selfBuff, "actor", 2)).toBe(true);
    expect(aimsFromTile(heal, "distant", 2)).toBe(false);
  });

  it("counts a tap that casts on the tile under the pointer, whichever sprite it hit", () => {
    const { tapAims } = scenario(100);
    // The heal lands on the ally's tile; the sprite hit is a teammate out of its reach.
    expect(tapAims(heal, "distant", 2)).toBe(true);
    expect(tapAims(heal, "distant", 4)).toBe(false);
  });

  it("counts a tap aimed at the fighter's own tile when it cannot cast yet", () => {
    const { tapAims } = scenario(30);
    expect(tapAims(selfBuff, "actor", 2)).toBe(true);
  });
});
