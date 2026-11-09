import { describe, expect, it } from "bun:test";
import { computeDamagePacket } from "@/libs/combat/damagePipeline";
import { cleanse, clear } from "@/libs/combat/tags";
import type { UserEffect } from "@/libs/combat/types";
import {
  gearMods,
  makeBattleUser,
  makeDamageEffect,
  makeEffect,
} from "../../setup/combat";

describe("Clear/Cleanse damage modifier regressions", () => {
  it("clear removes temporary DR but preserves village DR and base DR", () => {
    const villageDr = {
      type: "decreasedamagetaken",
      id: "village-dr",
      power: 15,
      fromType: "village",
    } as const;
    const effects = [
      damageTaken(villageDr),
      damageTaken({
        type: "decreasedamagetaken",
        id: "jutsu-dr",
        power: 25,
        fromType: "jutsu",
      }),
    ];

    applyBasicEffect("clear", effects);

    expect(effects.find((effect) => effect.id === "village-dr")?.rounds).toBe(10);
    expect(effects.find((effect) => effect.id === "jutsu-dr")?.rounds).toBe(0);

    const noStatusDamage = damageUnder([]);
    const villageOnlyDamage = damageUnder([damageTaken(villageDr)]);

    expect(damageUnder(effects)).toBeCloseTo(villageOnlyDamage, 10);
    expect(damageUnder(effects)).toBeLessThan(noStatusDamage);
  });

  it("cleanse removes temporary damage-taken debuffs but preserves village debuffs", () => {
    const villageDebuff = {
      type: "increasedamagetaken",
      id: "village-inc-taken",
      power: 15,
      fromType: "village",
    } as const;
    const effects = [
      damageTaken(villageDebuff),
      damageTaken({
        type: "increasedamagetaken",
        id: "jutsu-inc-taken",
        power: 25,
        fromType: "jutsu",
      }),
    ];

    applyBasicEffect("cleanse", effects);

    expect(effects.find((effect) => effect.id === "village-inc-taken")?.rounds).toBe(
      10,
    );
    expect(effects.find((effect) => effect.id === "jutsu-inc-taken")?.rounds).toBe(0);

    const noStatusDamage = damageUnder([]);
    const villageOnlyDamage = damageUnder([damageTaken(villageDebuff)]);

    expect(damageUnder(effects)).toBeCloseTo(villageOnlyDamage, 10);
    expect(damageUnder(effects)).toBeGreaterThan(noStatusDamage);
  });
});

/** A 10-round percentage damage-taken modifier on the defender. */
const damageTaken = ({
  type,
  id,
  power,
  fromType,
}: {
  type: "decreasedamagetaken" | "increasedamagetaken";
  id: string;
  power: number;
  fromType: "village" | "jutsu";
}) =>
  makeEffect(
    type,
    { power, rounds: 10, calculation: "percentage" },
    { id, targetId: "defender", fromType },
  );

/** Casts the round-1 basic clear or cleanse action on the defender against `effects`. */
const applyBasicEffect = (type: "clear" | "cleanse", effects: UserEffect[]) => {
  const target = makeBattleUser("defender");
  const effect = makeEffect(
    type,
    { power: 100 },
    {
      id: `${type}-defender`,
      targetId: "defender",
      isNew: true,
      castThisRound: true,
      createdRound: 1,
      longitude: target.longitude,
      latitude: target.latitude,
      actionId: type,
      fromType: "basic",
    },
  );
  return (type === "clear" ? clear : cleanse)(effect, effects, target);
};

/** Damage of the default formula hit from attacker to defender on round 1, without gear. */
const damageUnder = (effects: UserEffect[]) => {
  const damageEffect = makeDamageEffect();
  return computeDamagePacket({
    rawDamage: 1000,
    damageEffect,
    usersEffects: effects,
    attackerId: damageEffect.creatorId,
    defenderId: damageEffect.targetId,
    preBattleGearModifiers: { attacker: gearMods(), defender: gearMods() },
    battleRound: 1,
  }).damage;
};
