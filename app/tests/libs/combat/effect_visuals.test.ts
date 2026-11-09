import { describe, expect, it } from "bun:test";
import { ID_ANIMATION_SMOKE } from "@/drizzle/constants";
import { applyEffects, applySingleEffect } from "@/libs/combat/process";
import type { GroundEffect, UserEffect } from "@/libs/combat/types";
import {
  makeBattleUser,
  makeCombatAction,
  makeCompleteBattle,
  makeDamageEffect,
  makeEffect,
} from "../../setup/combat";

describe("applySingleEffect lifecycle visuals", () => {
  it.each([
    [0, 0],
    [0, 2],
    [2, 0],
  ])(
    "plays the disappear animation for an expired effect at [%i, %i]",
    (longitude, latitude) => {
      const caster = makeBattleUser("caster", { longitude, latitude });
      const battle = makeCompleteBattle({ usersState: [caster], round: 3 });
      const effect = makeEffect(
        "increasestat",
        {
          rounds: 0,
          generalTypes: ["Strength"],
          power: 10,
          animationScale: 2.5,
          disappearAnimation: "smoke",
        },
        {
          creatorId: "caster",
          targetId: "caster",
          isNew: false,
          castThisRound: false,
          createdRound: 1,
          targetType: "user",
        },
      );
      const newGroundEffects: GroundEffect[] = [];
      applySingleEffect(
        {
          consequences: new Map(),
          newUsersState: structuredClone(battle.usersState),
          newUsersEffects: [],
          newGroundEffects,
          actionEffects: [],
          appliedEffects: new Set(),
          battle,
          actorId: "caster",
        },
        effect,
      );
      expect(newGroundEffects).toHaveLength(1);
      expect(newGroundEffects[0]).toMatchObject({
        type: "visual",
        appearAnimation: "smoke",
        animationScale: 2.5,
        longitude,
        latitude,
      });
    },
  );
});

describe("defeated stand-in smoke", () => {
  const ROUND = 3;
  const fight = (
    attacker: Record<string, unknown>,
    defender: Record<string, unknown>,
  ) => {
    const hit = makeDamageEffect({
      creatorId: "attacker",
      targetId: "defender",
      isNew: true,
      castThisRound: true,
      createdRound: ROUND,
      rounds: 0,
      targetType: "user",
    } as Partial<UserEffect>);
    const reflect = makeEffect(
      "reflect",
      { power: 50, calculation: "percentage", rounds: 3 },
      {
        creatorId: "defender",
        targetId: "defender",
        targetType: "user",
        createdRound: ROUND - 1,
        isNew: false,
      },
    );
    const battle = makeCompleteBattle({
      round: ROUND,
      usersState: [
        makeBattleUser("attacker", { longitude: 1, latitude: 1, ...attacker }),
        makeBattleUser("defender", { longitude: 3, latitude: 2, ...defender }),
      ],
      usersEffects: [hit, reflect],
    });
    return applyEffects(battle, "attacker", makeCombatAction())
      .newBattle.groundEffects.filter(
        (effect) => effect.appearAnimation === ID_ANIMATION_SMOKE,
      )
      .map((effect) => [effect.longitude, effect.latitude]);
  };

  it("marks a defeated target stand-in", () => {
    expect(fight({}, { isOriginal: false, curHealth: 1 })).toEqual([[3, 2]]);
  });

  it("marks an attacking stand-in defeated by returned damage", () => {
    expect(fight({ isOriginal: false, curHealth: 1 }, {})).toEqual([[1, 1]]);
  });

  it("marks both stand-ins when they fall together", () => {
    expect(
      fight({ isOriginal: false, curHealth: 1 }, { isOriginal: false, curHealth: 1 }),
    ).toEqual([
      [3, 2],
      [1, 1],
    ]);
  });

  it("leaves no smoke for originals", () => {
    expect(
      fight({ isOriginal: true, curHealth: 1 }, { isOriginal: true, curHealth: 1 }),
    ).toEqual([]);
  });
});
