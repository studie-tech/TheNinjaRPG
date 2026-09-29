import { describe, expect, it } from "vitest";
import { ElementNames, RANKED_BLOODLINE_EFFECT_MULT } from "@/drizzle/constants";
import { RANKED_BLOODLINE_DAMAGE_TAG } from "@/libs/combat/constants";
import { computeDamagePacket } from "@/libs/combat/process";
import { getEfficiencyRatio, realizeTag } from "@/libs/combat/tags";
import type { UserEffect } from "@/libs/combat/types";
import {
  defaultTestGearModifiers,
  makeBattleUser,
  makeDamageEffect,
  makeEffect,
} from "./helpers/battleScenario";

describe("ranked bloodline damage boost", () => {
  it.each(ElementNames)("boosts off-stat %s damage and remains sealable", (element) => {
    const attacker = makeBattleUser("attacker", {
      highestOffence: "ninjutsuOffence",
    });
    const boost = realizeTag({
      tag: { ...RANKED_BLOODLINE_DAMAGE_TAG } as UserEffect,
      user: attacker,
      target: attacker,
      actionId: "ranked-bloodline",
      level: attacker.level,
    });
    boost.isNew = false;
    boost.castThisRound = false;
    boost.targetId = attacker.userId;
    boost.fromType = "bloodline";
    const damageEffect = makeDamageEffect({
      statTypes: ["Genjutsu"],
      elements: [element],
    });
    expect(getEfficiencyRatio(damageEffect, boost)).toBe(1);

    const damageWith = (usersEffects: UserEffect[]) =>
      computeDamagePacket({
        rawDamage: 505,
        damageEffect,
        usersEffects,
        attackerId: "attacker",
        defenderId: "defender",
        battleRound: 1,
        preBattleGearModifiers: defaultTestGearModifiers(),
      }).damage;
    const baseline = damageWith([]);
    expect(damageWith([boost])).toBeCloseTo(baseline * RANKED_BLOODLINE_EFFECT_MULT, 2);
    const seal = makeEffect(
      "seal",
      { power: 100, calculation: "static" },
      {
        creatorId: "defender",
        targetId: "attacker",
        isNew: false,
        castThisRound: false,
      },
    );
    expect(damageWith([boost, seal])).toBeCloseTo(baseline, 2);
  });
});
