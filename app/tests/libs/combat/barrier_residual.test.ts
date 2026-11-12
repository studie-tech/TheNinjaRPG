import { describe, expect, it } from "bun:test";
import { applyEffects } from "@/libs/combat/process";
import type { CompleteBattle, GroundEffect } from "@/libs/combat/types";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

const barrier = (id = "barrier", longitude = 2) =>
  makeEffect(
    "barrier",
    { rounds: 10, curHealth: 10000, maxHealth: 10000 },
    { id, longitude, creatorId: "defender" },
  ) as GroundEffect;

const damage = (type: "damage" | "pierce", rounds = 3, id = "hit") =>
  makeEffect(
    type,
    { power: 100, calculation: "static", rounds },
    {
      id,
      targetType: "barrier",
      targetId: "barrier",
      barrierAbsorb: 0.5,
      createdRound: 0,
    },
  );

const scenario = () =>
  makeCompleteBattle({
    round: 1,
    usersState: [makeBattleUser("attacker"), makeBattleUser("defender")],
    groundEffects: [barrier()],
  });

const health = (battle: CompleteBattle, id = "barrier") => {
  const effect = battle.groundEffects.find((e) => e.id === id);
  if (!effect || !("curHealth" in effect)) throw new Error("Missing barrier");
  return effect.curHealth;
};

describe("barrier damage timing", () => {
  for (const type of ["damage", "pierce"] as const) {
    it(`ticks residual ${type} once per round across different actors`, () => {
      let battle = scenario();
      battle.usersEffects = [damage(type)];
      battle = applyEffects(battle, "attacker").newBattle;
      expect(health(battle)).toBe(9950);
      // Persist through serialization, as a later action reloads the battle state.
      battle = structuredClone(battle);
      battle = applyEffects(battle, "defender").newBattle;
      battle = applyEffects(battle, "attacker").newBattle;
      expect(health(battle)).toBe(9950);
      battle.round++;
      battle = applyEffects(battle, "defender").newBattle;
      expect(health(battle)).toBe(9900);
    });

    it(`allows separate instant ${type} attacks in the same round`, () => {
      let battle = scenario();
      for (const id of ["first", "second"]) {
        const effect = damage(type, 0, id);
        effect.createdRound = battle.round;
        effect.isNew = true;
        battle.usersEffects.push(effect);
        battle = applyEffects(battle, "attacker").newBattle;
      }
      expect(health(battle)).toBe(9900);
    });
  }

  it("does not consume the first residual tick during the casting round", () => {
    let battle = scenario();
    const effect = damage("damage");
    effect.createdRound = battle.round;
    effect.isNew = true;
    battle.usersEffects = [effect];
    battle = applyEffects(battle, "attacker").newBattle;
    expect(health(battle)).toBe(10000);
    battle.round++;
    battle = applyEffects(battle, "defender").newBattle;
    expect(health(battle)).toBe(9950);
  });

  it("tracks round zero and stops expired residuals", () => {
    let battle = scenario();
    battle.round = 0;
    const effect = damage("damage");
    effect.createdRound = -1;
    battle.usersEffects = [effect];
    battle = applyEffects(battle, "attacker").newBattle;
    battle = applyEffects(battle, "defender").newBattle;
    expect(health(battle)).toBe(9950);
    battle.round++;
    battle.usersEffects[0]!.rounds = 0;
    battle = applyEffects(battle, "attacker").newBattle;
    expect(health(battle)).toBe(9950);
    expect(battle.usersEffects).toHaveLength(0);
  });

  it("tracks different effects and barriers independently", () => {
    let battle = scenario();
    battle.groundEffects.push(barrier("other-barrier", 3));
    const first = damage("damage");
    const second = damage("damage", 3, "other-hit");
    const otherBarrier = { ...first, targetId: "other-barrier" };
    battle.usersEffects = [first, second, otherBarrier];
    battle = applyEffects(battle, "attacker").newBattle;
    expect(health(battle)).toBe(9900);
    expect(health(battle, "other-barrier")).toBe(9950);
    battle = applyEffects(battle, "defender").newBattle;
    expect(health(battle)).toBe(9900);
    expect(health(battle, "other-barrier")).toBe(9950);
  });

  it("retains ground damage history when temporary barrier effects are recreated", () => {
    let battle = scenario();
    const ground = damage("damage") as GroundEffect;
    ground.longitude = 2;
    ground.latitude = 0;
    ground.timeTracker = undefined;
    battle.groundEffects.push(ground);
    battle = applyEffects(battle, "attacker").newBattle;
    expect(health(battle)).toBe(9950);
    expect(battle.usersEffects).toHaveLength(0);
    battle = structuredClone(battle);
    battle = applyEffects(battle, "defender").newBattle;
    expect(health(battle)).toBe(9950);
    battle.round++;
    battle = applyEffects(battle, "attacker").newBattle;
    expect(health(battle)).toBe(9900);
  });
});
