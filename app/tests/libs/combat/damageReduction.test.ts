import { describe, expect, it } from "bun:test";
import { DMG_REDUCTION_CAP } from "@/drizzle/constants";
import {
  applyDamageModifierPipelineToConsequences,
  buildDamageModifierEligibilityById,
  computeDamagePacket,
} from "@/libs/combat/damagePipeline";
import type { Consequence } from "@/libs/combat/types";
import {
  makeCompleteBattle,
  makeDamageEffect,
  makeDamageModifierEffect,
} from "../../setup/combat";

const packet = (power: number, rawDamage = 100) =>
  computeDamagePacket({
    rawDamage,
    damageEffect: makeDamageEffect(),
    usersEffects: [
      makeDamageModifierEffect({
        type: "decreasedamagetaken",
        targetId: "defender",
        fromType: "jutsu",
        power,
      }),
    ],
    attackerId: "attacker",
    defenderId: "defender",
    preBattleGearModifiers: {},
    battleRound: 1,
  }).damage;

describe("damage reduction floor", () => {
  it.each([
    { reduction: 0, remaining: 1 },
    { reduction: 40, remaining: 0.6 },
    { reduction: 100 * DMG_REDUCTION_CAP, remaining: 1 - DMG_REDUCTION_CAP },
    { reduction: 95, remaining: 1 - DMG_REDUCTION_CAP },
    { reduction: 100, remaining: 1 - DMG_REDUCTION_CAP },
    { reduction: 150, remaining: 1 - DMG_REDUCTION_CAP },
  ])(
    "retains $remaining of baseline damage at $reduction percent reduction",
    ({ reduction, remaining }) => {
      const baseline = packet(0);
      expect(baseline).toBeGreaterThan(0);
      expect(packet(reduction)).toBeCloseTo(baseline * remaining, 5);
    },
  );

  it("caps each target independently and leaves non-damage consequences unchanged", () => {
    const reduced = makeDamageEffect({ id: "reduced", targetId: "defender" });
    const ordinary = makeDamageEffect({ id: "ordinary", targetId: "other" });
    const reduction = makeDamageModifierEffect({
      type: "decreasedamagetaken",
      targetId: "defender",
      fromType: "jutsu",
      power: 100,
    });
    const healing = { userId: "attacker", targetId: "defender", heal_hp: 25 };
    const unmapped = { userId: "attacker", targetId: "defender", damage: 50 };
    const consequences = new Map<string, Consequence>([
      [reduced.id, { userId: "attacker", targetId: "defender", damage: 200 }],
      [ordinary.id, { userId: "attacker", targetId: "other", damage: 200 }],
      ["healing", { ...healing }],
      ["missing-effect", { ...unmapped }],
    ]);
    const usersEffects = [reduced, ordinary, reduction];
    applyDamageModifierPipelineToConsequences({
      consequences,
      usersEffects,
      extraState: makeCompleteBattle().extraState,
      battleRound: 1,
      sealEffects: [],
      eligibilityById: buildDamageModifierEligibilityById(usersEffects, 1),
    });
    expect(consequences.get(reduced.id)?.damage).toBeCloseTo(
      packet(0, 200) * (1 - DMG_REDUCTION_CAP),
      5,
    );
    expect(consequences.get(ordinary.id)?.damage).toBeCloseTo(packet(0, 200), 5);
    expect(consequences.get(reduced.id)?.baseDamageForModifiers).toBe(200);
    expect(consequences.get(ordinary.id)?.baseDamageForModifiers).toBe(200);
    expect(consequences.get("healing")).toEqual(healing);
    expect(consequences.get("missing-effect")).toEqual(unmapped);
  });
});
