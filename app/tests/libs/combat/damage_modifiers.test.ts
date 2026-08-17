import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DMG_REDUCTION_CAP,
  OUT_OF_COMBAT_BASE_DAMAGE_INCREASE,
  OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION,
} from "@/drizzle/constants";
import {
  applyDamageModifierPipelineToConsequences,
  buildDamageModifierEligibilityById,
  buildDamagePacketModifierLists,
  computeDamagePacket,
  type DamageModifierEligibility,
  consolidatePreBattleDamageModifiers,
  isConsolidatedStage1PercentageModifier,
} from "@/libs/combat/process";
import type { Consequence } from "@/libs/combat/types";
import {
  defaultTestGearModifiers,
  gearMods,
  makeBattleUser,
  makeDamageEffect,
  makeDamageModifierEffect as makeModifierEffect,
  makeEffect,
} from "./helpers/battleScenario";

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
  // Restore in afterEach so a failing assertion mid-test cannot leak the
  // Math.random spy into later test files.
  afterEach(() => vi.restoreAllMocks());

  it("excludes expired damage modifiers before packet lists can apply them", () => {
    const expiredDr = makeModifierEffect({
      id: "expired-dr",
      type: "decreasedamagetaken",
      targetId: "defender",
      fromType: "jutsu",
      power: 80,
      rounds: 0,
    });
    expiredDr.createdRound = 1;

    const usersStateById = new Map([["defender", makeBattleUser("defender")]]);
    const eligibility = buildDamageModifierEligibilityById(
      [expiredDr],
      3,
      usersStateById,
    );
    const emptyGear = { attacker: gearMods(), defender: gearMods() };

    const baseline = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 3,
      preBattleGearModifiers: emptyGear,
    }).damage;
    const withExpired = computeDamagePacket({
      rawDamage: 100,
      damageEffect: makeDamageEffect(),
      usersEffects: [expiredDr],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 3,
      preBattleGearModifiers: emptyGear,
      modifierLists: buildDamagePacketModifierLists(
        [expiredDr],
        "attacker",
        "defender",
        eligibility,
      ),
    }).damage;

    expect(eligibility.has("expired-dr")).toBe(false);
    expect(withExpired).toBeCloseTo(baseline, 2);
  });

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
    activeInc.createdRound = 0;

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
    const floor =
      boosted *
      (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100) *
      (1 - DMG_REDUCTION_CAP);
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
      power: 100,
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
    const afterExtremeDr = 0;
    const floor = afterOocDr * (1 - DMG_REDUCTION_CAP);
    expect(damage).toBeCloseTo(Math.max(afterExtremeDr, floor), 2);
  });

  it("keeps the reported Element Divine DR stack active after crossing the old floor", () => {
    // Regression test for: https://discord.com/channels/1080832341234159667/1375094434437271572/1518235151878983771
    const rawDamage = 742.44;

    const damageEffect = makeDamageEffect({
      statTypes: ["Highest"],
      generalTypes: ["Highest"],
      elements: ["Fire"],
      highestOffence: "bukijutsuOffence",
      highestGenerals: ["strength", "speed"],
    });

    const namedModifier = (
      id: string,
      params: Parameters<typeof makeModifierEffect>[0],
    ) =>
      makeModifierEffect({
        id,
        ...params,
        runtime: {
          level: params.runtime?.level ?? 0,
          isNew: false,
          castThisRound: false,
          createdRound: 1,
          highestOffence: "bukijutsuOffence",
          highestGenerals: ["strength", "speed"],
          ...params.runtime,
        },
      });

    const incEffects = [
      namedModifier("gust-armor-inc-given", {
        type: "increasedamagegiven",
        targetId: "attacker",
        fromType: "jutsu",
        power: 20,
        tag: {
          powerPerLevel: 0.4,
          statTypes: ["Bukijutsu"],
          elements: ["Wind"],
        },
        runtime: { level: 25 },
      }),
      namedModifier("gust-armor-inc-taken", {
        type: "increasedamagetaken",
        targetId: "defender",
        fromType: "jutsu",
        power: 20,
        tag: { powerPerLevel: 0.4, statTypes: ["Bukijutsu"] },
        runtime: { level: 25 },
      }),
      namedModifier("fire-release-inc-taken", {
        type: "increasedamagetaken",
        targetId: "defender",
        fromType: "jutsu",
        power: 25,
        tag: {
          powerPerLevel: 0.4,
          elements: ["Earth", "Fire", "Lightning", "Water", "Wind"],
        },
        runtime: { level: 25 },
      }),
      namedModifier("element-divine-inc-taken", {
        type: "increasedamagetaken",
        targetId: "defender",
        fromType: "jutsu",
        power: 20,
        tag: {
          powerPerLevel: 0.4,
          elements: ["Earth", "Fire", "Lightning", "Water", "Wind"],
        },
        runtime: { level: 37.5 },
      }),
      namedModifier("stamina-pill-ii-inc-taken", {
        type: "increasedamagetaken",
        targetId: "defender",
        fromType: "item",
        power: 15,
        tag: { statTypes: ["Highest"] },
      }),
    ];

    const drEffectsBeforeBreakpoint = [
      namedModifier("terra-shift-dr-taken", {
        type: "decreasedamagetaken",
        targetId: "defender",
        fromType: "jutsu",
        power: 15,
        tag: {
          powerPerLevel: 0.4,
          statTypes: ["Bukijutsu", "Genjutsu", "Ninjutsu", "Taijutsu"],
        },
        runtime: { level: 25 },
      }),
      namedModifier("stamina-pill-ii-dr-taken", {
        type: "decreasedamagetaken",
        targetId: "defender",
        fromType: "item",
        power: 15,
        tag: { statTypes: ["Bukijutsu", "Genjutsu", "Ninjutsu", "Taijutsu"] },
      }),
      namedModifier("elite-smoke-bomb-dr-taken", {
        type: "decreasedamagetaken",
        targetId: "defender",
        fromType: "item",
        power: 25,
        tag: { statTypes: ["Bukijutsu", "Genjutsu", "Ninjutsu", "Taijutsu"] },
      }),
    ];

    const smokeDamageGivenDr = namedModifier("elite-smoke-bomb-dr-given", {
      type: "decreasedamagegiven",
      targetId: "attacker",
      fromType: "item",
      power: 70,
      tag: { statTypes: ["Bukijutsu", "Genjutsu", "Ninjutsu", "Taijutsu"] },
    });

    const beforeBreakpointDamage = computeDamagePacket({
      rawDamage,
      damageEffect,
      usersEffects: [...incEffects, ...drEffectsBeforeBreakpoint],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 2,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    }).damage;

    const { damage: afterBreakpointDamage } = computeDamagePacket({
      rawDamage,
      damageEffect,
      usersEffects: [
        ...incEffects,
        ...drEffectsBeforeBreakpoint,
        smokeDamageGivenDr,
      ],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 2,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    });

    const boostedDamage = [30, 30, 35, 35, 15].reduce(
      (total, power) => total * (1 + power / 100),
      rawDamage * (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100),
    );
    const expectedBeforeBreakpointDamage = [25, 15, 25].reduce(
      (total, power) => total * (1 - power / 100),
      boostedDamage * (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100),
    );
    const expectedAfterBreakpointDamage = expectedBeforeBreakpointDamage * 0.3;
    const oldFloor = boostedDamage * (1 - DMG_REDUCTION_CAP);

    expect(beforeBreakpointDamage).toBeCloseTo(
      expectedBeforeBreakpointDamage,
      2,
    );
    expect(beforeBreakpointDamage).toBeGreaterThan(oldFloor);
    expect(expectedAfterBreakpointDamage).toBeLessThan(oldFloor);
    expect(afterBreakpointDamage).toBeCloseTo(
      expectedAfterBreakpointDamage,
      2,
    );
    expect(afterBreakpointDamage).toBeCloseTo(beforeBreakpointDamage * 0.3, 2);
  });

  it("does not let base DR consume the player-applied reduction cap", () => {
    const rawDamage = 742.44;
    const incPowers = [30, 30, 35, 35, 15];
    const drPowers = [25, 15, 25, 70];
    const incEffects = incPowers.map((power, index) =>
      makeModifierEffect({
        id: `reported-inc-${index}`,
        type: "increasedamagegiven",
        targetId: "attacker",
        fromType: "jutsu",
        power,
      }),
    );
    const drEffects = drPowers.map((power, index) =>
      makeModifierEffect({
        id: `reported-dr-${index}`,
        type: "decreasedamagetaken",
        targetId: "defender",
        fromType: "jutsu",
        power,
      }),
    );

    const { damage } = computeDamagePacket({
      rawDamage,
      damageEffect: makeDamageEffect(),
      usersEffects: [...incEffects, ...drEffects],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 2,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    });

    const boostedDamage = incPowers.reduce(
      (total, power) => total * (1 + power / 100),
      rawDamage * (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100),
    );
    const expectedDamage = drPowers.reduce(
      (total, power) => total * (1 - power / 100),
      boostedDamage * (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100),
    );
    const oldFloor = boostedDamage * (1 - DMG_REDUCTION_CAP);

    expect(expectedDamage).toBeGreaterThan(
      boostedDamage *
        (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100) *
        (1 - DMG_REDUCTION_CAP),
    );
    expect(expectedDamage).toBeLessThan(oldFloor);
    expect(damage).toBeCloseTo(expectedDamage, 2);
  });

  it("keeps the Colored Jewel DR stack active past the old cap breakpoint", () => {
    // Regression test for: https://discord.com/channels/1080832341234159667/1375094434437271572/1518261616372744263
    const reportedNoTagDamage = 743.74;
    const rawDamage =
      reportedNoTagDamage /
      ((1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100) *
        (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100));
    const incPowers = [30, 35, 35, 35, 30];
    const drPowers = [10, 35, 30, 30, 40, 25];
    const incEffects = incPowers.map((power, index) =>
      makeModifierEffect({
        id: `colored-jewel-report-inc-${index}`,
        type: "increasedamagegiven",
        targetId: "attacker",
        fromType: "jutsu",
        power,
      }),
    );
    const drEffects = drPowers.map((power, index) =>
      makeModifierEffect({
        id: `colored-jewel-report-dr-${index}`,
        type: "decreasedamagetaken",
        targetId: "defender",
        fromType: index === 0 ? "item" : "jutsu",
        power,
      }),
    );

    const { damage } = computeDamagePacket({
      rawDamage,
      damageEffect: makeDamageEffect({ power: 50 }),
      usersEffects: [...incEffects, ...drEffects],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 3,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    });

    const boostedDamage = incPowers.reduce(
      (total, power) => total * (1 + power / 100),
      reportedNoTagDamage,
    );
    const expectedDamage = drPowers.reduce(
      (total, power) => total * (1 - power / 100),
      boostedDamage,
    );
    const oldFloor =
      rawDamage *
      (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100) *
      incPowers.reduce((total, power) => total * (1 + power / 100), 1) *
      (1 - DMG_REDUCTION_CAP);

    expect(expectedDamage).toBeCloseTo(398.91, 2);
    expect(expectedDamage).toBeLessThan(oldFloor);
    expect(damage).toBeCloseTo(expectedDamage, 2);
    expect(damage).not.toBeCloseTo(883.57, 2);
  });

  it("keeps the smoke bomb DR stack active past the old cap breakpoint", () => {
    // Regression test for: https://discord.com/channels/1080832341234159667/1375094434437271572/1518261967616475248
    const reportedNoTagDamage = 743.74;
    const rawDamage =
      reportedNoTagDamage /
      ((1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100) *
        (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100));
    const incPowers = [35, 30, 35, 35];
    const defenderDrPowers = [25, 15, 25, 15];
    const smokeDamageGivenDrPower = 70;
    const incEffects = incPowers.map((power, index) =>
      makeModifierEffect({
        id: `smoke-bomb-report-inc-${index}`,
        type: "increasedamagegiven",
        targetId: "attacker",
        fromType: "jutsu",
        power,
      }),
    );
    const defenderDrEffects = defenderDrPowers.map((power, index) =>
      makeModifierEffect({
        id: `smoke-bomb-report-dr-taken-${index}`,
        type: "decreasedamagetaken",
        targetId: "defender",
        fromType: index === 2 || index === 3 ? "item" : "jutsu",
        power,
      }),
    );
    const smokeDamageGivenDr = makeModifierEffect({
      id: "smoke-bomb-report-dr-given",
      type: "decreasedamagegiven",
      targetId: "attacker",
      fromType: "item",
      power: smokeDamageGivenDrPower,
    });

    const { damage } = computeDamagePacket({
      rawDamage,
      damageEffect: makeDamageEffect({ power: 50 }),
      usersEffects: [...incEffects, ...defenderDrEffects, smokeDamageGivenDr],
      attackerId: "attacker",
      defenderId: "defender",
      battleRound: 4,
      preBattleGearModifiers: {
        attacker: gearMods(),
        defender: gearMods(),
      },
    });

    const boostedDamage = incPowers.reduce(
      (total, power) => total * (1 + power / 100),
      reportedNoTagDamage,
    );
    const expectedDamage = [
      25,
      15,
      smokeDamageGivenDrPower,
      25,
      15,
    ].reduce((total, power) => total * (1 - power / 100), boostedDamage);
    const oldFloor =
      rawDamage *
      (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100) *
      incPowers.reduce((total, power) => total * (1 + power / 100), 1) *
      (1 - DMG_REDUCTION_CAP);

    expect(expectedDamage).toBeCloseTo(290.03, 2);
    expect(expectedDamage).toBeLessThan(oldFloor);
    expect(damage).toBeCloseTo(expectedDamage, 2);
    expect(damage).not.toBeCloseTo(883.57, 2);
  });

  it("applies round-4 active modifiers to both same-round damage packets", () => {
    const firstDamage = makeDamageEffect({
      id: "first-60ap-damage",
      actionId: "lightning-release",
      power: 60,
    });
    const secondDamage = makeDamageEffect({
      id: "second-60ap-damage",
      actionId: "second-60ap-jutsu",
      power: 60,
    });
    const round2Increase = makeModifierEffect({
      id: "round-2-timeshift",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "jutsu",
      power: 30,
      runtime: { createdRound: 2 },
    });
    const round3Increase = makeModifierEffect({
      id: "round-3-cleave",
      type: "increasedamagegiven",
      targetId: "attacker",
      fromType: "jutsu",
      power: 35,
      runtime: { createdRound: 3 },
    });
    const round3Reduction = makeModifierEffect({
      id: "round-3-dr",
      type: "decreasedamagetaken",
      targetId: "defender",
      fromType: "jutsu",
      power: 15,
      runtime: { createdRound: 3 },
    });
    const consequences = new Map<string, Consequence>([
      [
        firstDamage.id,
        {
          userId: "attacker",
          targetId: "defender",
          damage: 100,
        } as Consequence,
      ],
      [
        secondDamage.id,
        {
          userId: "attacker",
          targetId: "defender",
          damage: 100,
        } as Consequence,
      ],
    ]);

    applyDamageModifierPipelineToConsequences({
      consequences,
      usersEffects: [
        firstDamage,
        secondDamage,
        round2Increase,
        round3Increase,
        round3Reduction,
      ],
      // The pipeline only reads extraState.preBattleGearModifiers, so the test
      // supplies just that slice; route through unknown since the partial does
      // not satisfy the full ExtraState shape.
      extraState: {
        preBattleGearModifiers: {
          attacker: gearMods(),
          defender: gearMods(),
        },
      } as unknown as Parameters<
        typeof applyDamageModifierPipelineToConsequences
      >[0]["extraState"],
      battleRound: 4,
    });

    const expectedDamage =
      100 *
      1.3 *
      1.35 *
      (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100) *
      (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100) *
      0.85;

    expect(consequences.get(firstDamage.id)?.damage).toBeCloseTo(expectedDamage, 2);
    expect(consequences.get(secondDamage.id)?.damage).toBeCloseTo(expectedDamage, 2);
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
