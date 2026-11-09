import { describe, expect, it } from "bun:test";
import { applyEffects } from "@/libs/combat/process";
import { alignBattle } from "@/libs/combat/turn";
import type { GroundEffect } from "@/libs/combat/types";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

/** Create a round-boundary fixture with a temporary creature next in initiative order. */
const scenario = (type: "summon" | "clone", expires = true) => {
  const users = [
    makeBattleUser("caster", { round: 3, initiative: 30 }),
    makeBattleUser("creature", {
      round: 3,
      initiative: 20,
      isAi: true,
      isSummon: true,
      isSummonTemplate: false,
      isOriginal: type === "summon",
      controllerId: "caster",
    }),
    makeBattleUser("opponent", {
      round: 3,
      initiative: 10,
      longitude: 3,
      direction: "right",
    }),
  ];
  const effect = makeEffect(
    type,
    { rounds: 2, disappearAnimation: "smoke" },
    {
      creatorId: type === "clone" ? "creature" : "caster",
      summonedUserId: "creature",
      aiId: "template",
      isNew: false,
      castThisRound: false,
      createdRound: 1,
      disappearAnimation: "smoke",
    },
  ) as GroundEffect;
  effect.rounds = expires ? 1 : 2;
  return makeCompleteBattle({
    usersState: users,
    groundEffects: [effect],
    round: 3,
    activeUserId: "caster",
    roundStartAt: new Date(Date.now() - 600_000),
    updatedAt: new Date(),
  });
};

describe("ground expiry at the round boundary", () => {
  for (const type of ["summon", "clone"] as const) {
    it(`removes an expired ${type} before selecting the new round actor`, () => {
      const battle = scenario(type);
      const result = alignBattle(battle, [], "caster");
      expect(result.progressRound).toBe(true);
      expect(battle.round).toBe(4);
      expect(battle.usersState.map((u) => u.userId)).toEqual(["caster", "opponent"]);
      expect(result.actor.userId).toBe("opponent");
      expect(battle.activeUserId).toBe("opponent");
      expect(battle.groundEffects.some((e) => e.type === type)).toBe(false);
      expect(
        battle.groundEffects.some(
          (e) => e.type === "visual" && e.appearAnimation === "smoke",
        ),
      ).toBe(true);
      expect(result.expiredEffects).toHaveLength(1);
      const next = applyEffects(battle, "opponent").newBattle;
      expect(next.usersState.map((u) => u.userId)).toEqual(["caster", "opponent"]);
    });
    it(`keeps a ${type} for its full remaining duration`, () => {
      const battle = scenario(type, false);
      alignBattle(battle, [], "caster");
      expect(battle.usersState.some((u) => u.userId === "creature")).toBe(true);
      expect(battle.groundEffects[0]?.rounds).toBe(1);
    });
    it(`does not decrement a newly cast ${type} on its first transition`, () => {
      const battle = scenario(type);
      battle.groundEffects[0]!.castThisRound = true;
      alignBattle(battle, [], "caster");
      expect(battle.usersState.some((u) => u.userId === "creature")).toBe(true);
      expect(battle.groundEffects[0]?.rounds).toBe(1);
    });
  }
  it("removes an expired object and preserves its disappearance animation", () => {
    const battle = scenario("summon", false);
    battle.groundEffects = [
      makeEffect(
        "barrier",
        { rounds: 1, disappearAnimation: "smoke" },
        {
          isNew: false,
          castThisRound: false,
          createdRound: 1,
          disappearAnimation: "smoke",
        },
      ) as GroundEffect,
    ];
    alignBattle(battle, [], "caster");
    expect(battle.groundEffects.some((e) => e.type === "barrier")).toBe(false);
    expect(battle.groundEffects.some((e) => e.type === "visual")).toBe(true);
  });
});
