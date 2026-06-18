import { describe, expect, it, vi } from "vitest";
import {
  DMG_REDUCTION_CAP,
  OUT_OF_COMBAT_BASE_DAMAGE_INCREASE,
  OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION,
} from "@/drizzle/constants";
import {
  buildDamageModifierEligibilityById,
  buildDamagePacketModifierLists,
  computeDamagePacket,
  type DamageModifierEligibility,
  consolidatePreBattleDamageModifiers,
  isConsolidatedStage1PercentageModifier,
} from "@/libs/combat/process";
import {
  gearMods,
  makeBattleUser,
  makeDamageEffect,
  makeDamageModifierEffect as makeModifierEffect,
  makeEffect,
} from "./helpers/battleScenario";

const defaultTestGearModifiers = () => ({
  attacker: gearMods({ incDamageGivenFromGear: 18.9 }),
  defender: gearMods({ drTakenFromGear: 5 }),
});

describe("isConsolidatedStage1PercentageModifier", () => {
  it("consolidates equipped gear percentage damage mods only", () => {
    const armorInc = makeModifierEffect({
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "armor",
      power: 10,
    });
    const accessoryInc = makeModifierEffect({
      id: "acc-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "accessory",
      power: 5,
    });
    const keystoneDr = makeModifierEffect({
      id: "ks-dr",
      type: "decreasedamagetaken",
      targetId: "attacker",
      fromType: "keystone",
      power: 3,
    });
    const skillInc = makeModifierEffect({
      id: "skill-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "skill",
      power: 10,
    });
    const bloodlineInc = makeModifierEffect({
      id: "bl-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "bloodline",
      power: 10,
    });

    expect(isConsolidatedStage1PercentageModifier(armorInc)).toBe(true);
    expect(isConsolidatedStage1PercentageModifier(accessoryInc)).toBe(true);
    expect(isConsolidatedStage1PercentageModifier(keystoneDr)).toBe(true);
    expect(isConsolidatedStage1PercentageModifier(skillInc)).toBe(false);
    expect(isConsolidatedStage1PercentageModifier(bloodlineInc)).toBe(false);
  });
});

describe("consolidatePreBattleDamageModifiers", () => {
  it("strips gear mods into preBattleGearModifiers but keeps skill mods in userEffects", () => {
    const armorInc = makeModifierEffect({
      id: "armor-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "armor",
      power: 12,
    });
    const accessoryInc = makeModifierEffect({
      id: "acc-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "accessory",
      power: 4,
    });
    const keystoneDr = makeModifierEffect({
      id: "ks-dr",
      type: "decreasedamagetaken",
      targetId: "attacker",
      fromType: "keystone",
      power: 6,
    });
    const skillInc = makeModifierEffect({
      id: "skill-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "skill",
      power: 8,
    });

    const { preBattleGearModifiers, filteredEffects } =
      consolidatePreBattleDamageModifiers(
        [armorInc, accessoryInc, keystoneDr, skillInc],
        ["attacker"],
      );

    expect(preBattleGearModifiers.attacker?.incDamageGivenFromGear).toBe(16);
    expect(preBattleGearModifiers.attacker?.drTakenFromKeystone).toBe(6);
    expect(filteredEffects).toEqual([skillInc]);
  });
});

describe("buildDamagePacketModifierLists", () => {
  it("does not bucket keystone percentage mods into stage-1 non-gear lists", () => {
    const keystoneInc = makeModifierEffect({
      id: "ks-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "keystone",
      power: 15,
    });
    const skillInc = makeModifierEffect({
      id: "skill-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "skill",
      power: 10,
    });
    const eligibility = new Map<string, DamageModifierEligibility>([
      [
        "ks-inc",
        { targetId: "attacker", increaseSide: "attacker", decreaseSide: null },
      ],
      [
        "skill-inc",
        { targetId: "attacker", increaseSide: "attacker", decreaseSide: null },
      ],
    ]);

    const lists = buildDamagePacketModifierLists(
      [keystoneInc, skillInc],
      "attacker",
      "defender",
      eligibility,
    );

    expect(lists.stage1PreBattleIncreases.map((e) => e.id)).toEqual(["skill-inc"]);
    expect(lists.inBattleIncreases).toHaveLength(0);
  });
});

describe("buildDamageModifierEligibilityById", () => {
  it("excludes modifiers when buffprevent RNG blocks", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const inc = makeModifierEffect({
      id: "inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      power: 20,
      fromType: "jutsu",
    });
    inc.createdRound = 5;

    const prevent = makeEffect(
      "buffprevent",
      { power: 100, calculation: "static" },
      {
        id: "buff-prevent",
        creatorId: "defender",
        targetId: "attacker",
        level: 0,
        isNew: false,
        castThisRound: false,
        createdRound: 0,
        longitude: 0,
        latitude: 0,
        barrierAbsorb: 0,
        actionId: "prevent-action",
      },
    );

    const attacker = makeBattleUser("attacker", { username: "Attacker" });
    const usersStateById = new Map([["attacker", attacker]]);
    const eligibility = buildDamageModifierEligibilityById(
      [inc, prevent],
      1,
      usersStateById,
    );

    expect(eligibility.get("inc")?.increaseSide).toBeNull();
    expect(eligibility.get("inc")?.preventInfo?.txt).toContain("cannot be buffed");

    const lists = buildDamagePacketModifierLists(
      [inc, prevent],
      "attacker",
      "defender",
      eligibility,
    );
    expect(lists.inBattleIncreases).toHaveLength(0);

    const emptyGear = { attacker: gearMods(), defender: gearMods() };
    const activeInc = makeModifierEffect({
      id: "active-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      power: 20,
      fromType: "jutsu",
    });
    activeInc.createdRound = 5;

    const withInc = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [activeInc],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: emptyGear,
      modifierLists: buildDamagePacketModifierLists(
        [activeInc],
        "attacker",
        "defender",
        buildDamageModifierEligibilityById([activeInc], 1, usersStateById),
      ),
    }).damage;

    const prevented = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [inc, prevent],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: emptyGear,
      modifierLists: lists,
    }).damage;

    const afterOoc =
      100 *
      (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100) *
      (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100);
    expect(withInc).toBeCloseTo(afterOoc * 1.2, 2);
    expect(prevented).toBeCloseTo(afterOoc, 2);

    vi.restoreAllMocks();
  });
});

describe("computeDamagePacket", () => {
  it("applies base 60% inc and 50% DR only", () => {
    const { damage } = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    });

    const expected =
      505 *
      (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100) *
      (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100);
    expect(damage).toBeCloseTo(expected, 2);
    expect(damage).toBeCloseTo(404, 2);
  });

  it("applies stage-1 skill DR after pre-battle pool without negative intermediate damage", () => {
    const skillDr = makeModifierEffect({
      id: "skill-dr",
      type: "decreasedamagetaken",
      targetId: "defender",
      fromType: "skill",
      power: 10,
    });

    const gearOnly = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods({ drTakenFromGear: 30 }),
      },
    }).damage;

    const withSkillDr = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [skillDr],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods({ drTakenFromGear: 30 }),
      },
    }).damage;

    expect(gearOnly).toBeCloseTo(32, 2);
    expect(withSkillDr).toBeCloseTo(gearOnly * 0.9, 2);
  });

  it("applies stage-1 skill percentage inc before consolidated gear inc", () => {
    const skillInc = makeModifierEffect({
      id: "skill-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "skill",
      power: 10,
    });

    const { damage } = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [skillInc],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods({ incDamageGivenFromGear: 10 }),
        defender: gearMods(),
      },
    });

    const expected =
      100 *
      1.1 *
      (1 + (OUT_OF_COMBAT_BASE_DAMAGE_INCREASE + 10) / 100) *
      (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100);
    expect(damage).toBeCloseTo(expected, 2);
  });

  it("clamps to min damage floor when keystone DR exceeds 100%", () => {
    const blBoost = makeModifierEffect({
      id: "bl-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "bloodline",
      power: 50,
    });

    const { damage } = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [blBoost],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods({ drTakenFromKeystone: 150 }),
      },
    });

    const boosted = 100 * (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100);
    const floor = boosted * (1 - DMG_REDUCTION_CAP);
    expect(damage).toBeCloseTo(floor * 1.5, 2);
  });

  it("applies keystone inc after % mitigation and before bloodline", () => {
    const { damage } = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods({ incDamageGivenFromKeystone: 10 }),
        defender: gearMods(),
      },
    });

    const afterEarlyPools =
      100 *
      (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100) *
      (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100);
    const expected = afterEarlyPools * 1.1;
    expect(damage).toBeCloseTo(expected, 2);
    expect(damage).not.toBeCloseTo(
      100 *
        (1 + (OUT_OF_COMBAT_BASE_DAMAGE_INCREASE + 10) / 100) *
        (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100),
      2,
    );
  });

  it("applies gear inc and DR points additively into base pools", () => {
    const { damage } = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: defaultTestGearModifiers(),
    });

    expect(damage).toBeCloseTo(406.55, 2);
  });

  it("applies defender stage-1 increasedamagetaken in pre-battle inc pool", () => {
    const { damage } = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods({ incDamageTakenFromGear: 10 }),
      },
    });

    const expected =
      505 *
      (1 + (OUT_OF_COMBAT_BASE_DAMAGE_INCREASE + 10) / 100) *
      (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100);
    expect(damage).toBeCloseTo(expected, 2);
    expect(damage).toBeCloseTo(429.25, 2);
  });

  it("does not apply attacker increasedamagetaken to outgoing damage", () => {
    const baseline = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    }).damage;

    const { damage } = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods({ incDamageTakenFromGear: 20 }),
        defender: gearMods(),
      },
    });

    expect(damage).toBeCloseTo(baseline, 2);
  });

  it("applies bloodline percentage DR after the reduction cap", () => {
    const jutsuDr = makeModifierEffect({
      id: "jutsu-dr",
      type: "decreasedamagetaken",
      targetId: "defender",
      fromType: "jutsu",
      power: 50,
    });
    const blDr = makeModifierEffect({
      id: "bl-dr",
      type: "decreasedamagetaken",
      targetId: "defender",
      fromType: "bloodline",
      power: 20,
    });

    const withoutBlDr = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [jutsuDr],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    }).damage;

    const { damage } = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [jutsuDr, blDr],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    });

    expect(damage).toBeCloseTo(withoutBlDr * 0.8, 2);
  });

  it("does not apply sealed bloodline damage modifiers in the pipeline", () => {
    const blBoost = makeModifierEffect({
      id: "bl-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "bloodline",
      power: 40,
    });
    const seal = makeEffect(
      "seal",
      { power: 100, calculation: "static" },
      {
        id: "seal-1",
        creatorId: "defender",
        targetId: "attacker",
        level: 0,
        isNew: false,
        castThisRound: false,
        createdRound: 0,
        longitude: 0,
        latitude: 0,
        barrierAbsorb: 0,
        actionId: "seal-action",
      },
    );

    const baseline = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: defaultTestGearModifiers(),
    }).damage;

    const { damage } = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [blBoost, seal],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: defaultTestGearModifiers(),
    });

    expect(damage).toBeCloseTo(baseline, 2);
  });

  it("applies 40% bloodline boost after DR", () => {
    const blBoost = makeModifierEffect({
      id: "bl-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "bloodline",
      power: 40,
    });

    const { damage } = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [blBoost],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: defaultTestGearModifiers(),
    });

    expect(damage).toBeCloseTo(569.17, 2);
  });

  it("uses DMG_REDUCTION_CAP of 90%", () => {
    expect(DMG_REDUCTION_CAP).toBe(0.9);
  });

  it("enforces 10% damage floor after extreme DR", () => {
    const extremeDr = makeModifierEffect({
      id: "extreme-dr",
      type: "decreasedamagetaken",
      targetId: "defender",
      fromType: "jutsu",
      power: 80,
    });

    const { damage } = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [extremeDr],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    });

    const boosted = 100 * (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100);
    const afterOocDr = boosted * (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100);
    const afterExtremeDr = afterOocDr * (1 - 0.8);
    const floor = boosted * (1 - DMG_REDUCTION_CAP);
    expect(damage).toBeCloseTo(Math.max(afterExtremeDr, floor), 2);
  });

  it("applies static increase as flat addition immediately before static DR", () => {
    const staticInc = makeModifierEffect({
      id: "static-inc",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "jutsu",
      calculation: "static",
      power: 25,
    });
    const staticDr = makeModifierEffect({
      id: "static-dr",
      type: "decreasedamagetaken",
      targetId: "defender",
      fromType: "ranked",
      calculation: "static",
      power: 50,
    });

    const baseline = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    }).damage;

    const { damage } = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [staticInc, staticDr],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    });

    expect(damage).toBeCloseTo(baseline + 25 - 50, 2);
  });

  it("applies static DR as flat subtraction after % mitigation", () => {
    const staticDr = makeModifierEffect({
      id: "static-dr",
      type: "decreasedamagetaken",
      targetId: "defender",
      fromType: "ranked",
      calculation: "static",
      power: 50,
    });

    const baseline = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    }).damage;

    const { damage } = computeDamagePacket({
      rawDamage: 505,
      damageEffect: makeDamageEffect(),
      usersEffects: [staticDr],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 1,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    });

    expect(damage).toBeCloseTo(baseline - 50, 2);
  });
});
