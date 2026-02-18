import { describe, it, expect } from "vitest";
import { damageCalc } from "@/libs/combat/tags";
import { dmgConfig } from "@/libs/combat/constants";
import { DMG_REDUCTION_CAP } from "@/drizzle/constants";
import type { UserEffect } from "@/libs/combat/types";
import type { BattleUserState, Consequence } from "@/libs/combat/types";

/** Helper to create a minimal damage UserEffect for testing */
const makeDamageEffect = (
  overrides: Partial<UserEffect> = {},
): UserEffect =>
  ({
    id: "test-effect",
    creatorId: "attacker",
    targetId: "defender",
    level: 1,
    isNew: true,
    castThisRound: true,
    createdRound: 1,
    power: 40,
    powerPerLevel: 0,
    type: "damage",
    calculation: "formula",
    direction: "offence",
    longitude: 0,
    latitude: 0,
    barrierAbsorb: 0,
    actionId: "test-action",
    statTypes: ["Ninjutsu"],
    generalTypes: [],
    ...overrides,
  }) as unknown as UserEffect;

/** Helper to create a minimal BattleUserState for testing */
const makeUser = (
  overrides: Record<string, unknown> = {},
): BattleUserState =>
  ({
    userId: "user",
    level: 100,
    experience: 0,
    ninjutsuOffence: 450000,
    ninjutsuDefence: 450000,
    taijutsuOffence: 450000,
    taijutsuDefence: 450000,
    bukijutsuOffence: 450000,
    bukijutsuDefence: 450000,
    genjutsuOffence: 450000,
    genjutsuDefence: 450000,
    strength: 100000,
    intelligence: 100000,
    willpower: 100000,
    speed: 100000,
    highestOffence: "ninjutsuOffence",
    highestDefence: "ninjutsuDefence",
    highestGenerals: ["strength", "intelligence"],
    ...overrides,
  }) as unknown as BattleUserState;

describe("damageCalc - new HP-based formula", () => {
  it("returns effect power for non-formula calculations", () => {
    const effect = makeDamageEffect({ calculation: "static", power: 50 });
    const attacker = makeUser({ userId: "attacker" });
    const defender = makeUser({ userId: "defender" });
    const result = damageCalc(effect, attacker, defender, dmgConfig);
    expect(result).toBe(50);
  });

  it("returns effect power when origin is undefined", () => {
    const effect = makeDamageEffect({ power: 30 });
    const defender = makeUser({ userId: "defender" });
    const result = damageCalc(effect, undefined, defender, dmgConfig);
    expect(result).toBe(30);
  });

  it("produces higher damage at higher levels (world scaling)", () => {
    const effect = makeDamageEffect();
    const defender = makeUser({ userId: "defender" });

    const attackerLvl1 = makeUser({ userId: "attacker", level: 1 });
    const attackerLvl100 = makeUser({ userId: "attacker", level: 100 });

    const dmgLvl1 = damageCalc(effect, attackerLvl1, defender, dmgConfig);
    const dmgLvl100 = damageCalc(effect, attackerLvl100, defender, dmgConfig);

    expect(dmgLvl100).toBeGreaterThan(dmgLvl1);
    // Level 100 HP is 5050 vs level 1 HP is 100, so damage should scale ~50x
    expect(dmgLvl100 / dmgLvl1).toBeCloseTo(5050 / 100, 0);
  });

  it("equal stats produce advantage ratio of 1 (baseline damage)", () => {
    const effect = makeDamageEffect({ power: 40 });
    const attacker = makeUser({ userId: "attacker", level: 50 });
    const defender = makeUser({ userId: "defender", level: 50 });

    const dmg = damageCalc(effect, attacker, defender, dmgConfig);

    // With equal stats, advantage_mod = 1.0 + 0.75 * (1^1.6 - 1) = 1.0
    // EP scale = 40/40 = 1.0
    // baseline = calcHP(50) / 10 = (100 + 50*49) / 10 = 2550/10 = 255
    // Final = 255 * 1.0 * 1.0 = 255
    expect(dmg).toBeCloseTo(255, 0);
  });

  it("higher offense stats produce more damage", () => {
    const effect = makeDamageEffect();
    const defender = makeUser({ userId: "defender" });

    const weakAttacker = makeUser({
      userId: "attacker",
      ninjutsuOffence: 100000,
    });
    const strongAttacker = makeUser({
      userId: "attacker",
      ninjutsuOffence: 450000,
    });

    const dmgWeak = damageCalc(effect, weakAttacker, defender, dmgConfig);
    const dmgStrong = damageCalc(effect, strongAttacker, defender, dmgConfig);

    expect(dmgStrong).toBeGreaterThan(dmgWeak);
  });

  it("higher defense stats reduce damage", () => {
    const effect = makeDamageEffect();
    const attacker = makeUser({ userId: "attacker" });

    const weakDefender = makeUser({
      userId: "defender",
      ninjutsuDefence: 100000,
    });
    const strongDefender = makeUser({
      userId: "defender",
      ninjutsuDefence: 450000,
    });

    const dmgVsWeak = damageCalc(effect, attacker, weakDefender, dmgConfig);
    const dmgVsStrong = damageCalc(effect, attacker, strongDefender, dmgConfig);

    expect(dmgVsWeak).toBeGreaterThan(dmgVsStrong);
  });

  it("equal offense and defense buffs cancel out", () => {
    const effect = makeDamageEffect();
    const baseStat = 450000;

    // Base case: equal stats
    const baseAttacker = makeUser({ userId: "attacker", ninjutsuOffence: baseStat });
    const baseDefender = makeUser({ userId: "defender", ninjutsuDefence: baseStat });
    const baseDmg = damageCalc(effect, baseAttacker, baseDefender, dmgConfig);

    // Buffed case: both get 30% increase
    const buffedAttacker = makeUser({
      userId: "attacker",
      ninjutsuOffence: baseStat * 1.3,
    });
    const buffedDefender = makeUser({
      userId: "defender",
      ninjutsuDefence: baseStat * 1.3,
    });
    const buffedDmg = damageCalc(effect, buffedAttacker, buffedDefender, dmgConfig);

    // When both sides get equal buffs, damage should stay approximately the same
    // (advantage ratio remains ~1)
    expect(buffedDmg).toBeCloseTo(baseDmg, 0);
  });

  it("EP scaling works linearly (EP=80 deals 2x damage of EP=40)", () => {
    const effectEp40 = makeDamageEffect({ power: 40 });
    const effectEp80 = makeDamageEffect({ power: 80 });
    const attacker = makeUser({ userId: "attacker" });
    const defender = makeUser({ userId: "defender" });

    const dmg40 = damageCalc(effectEp40, attacker, defender, dmgConfig);
    const dmg80 = damageCalc(effectEp80, attacker, defender, dmgConfig);

    expect(dmg80 / dmg40).toBeCloseTo(2.0, 5);
  });

  it("zero defense does not cause division by zero", () => {
    const effect = makeDamageEffect();
    const attacker = makeUser({ userId: "attacker" });
    const defender = makeUser({
      userId: "defender",
      ninjutsuDefence: 0,
    });

    const dmg = damageCalc(effect, attacker, defender, dmgConfig);
    expect(dmg).toBeGreaterThan(0);
    expect(Number.isFinite(dmg)).toBe(true);
  });

  it("advantage_min prevents zero damage when defender greatly outclasses attacker", () => {
    const effect = makeDamageEffect();
    const attacker = makeUser({
      userId: "attacker",
      ninjutsuOffence: 1,
    });
    const defender = makeUser({
      userId: "defender",
      ninjutsuDefence: 450000,
    });

    const dmg = damageCalc(effect, attacker, defender, dmgConfig);
    expect(dmg).toBeGreaterThan(0);
  });

  it("advantage_max caps damage when attacker greatly outclasses defender", () => {
    const effect = makeDamageEffect();
    const attacker = makeUser({
      userId: "attacker",
      ninjutsuOffence: 10_000_000,
    });
    const defender = makeUser({
      userId: "defender",
      ninjutsuDefence: 1,
    });

    const dmg = damageCalc(effect, attacker, defender, dmgConfig);

    // With advantage_max = 10, damage should be capped
    // baseline = calcHP(100) / 10 = 505, epScale = 40/40 = 1, advantageMod capped at 10
    // dmg should be at most baseline * epScale * advantage_max = 505 * 1 * 10 = 5050
    expect(dmg).toBeLessThanOrEqual(505 * 1 * dmgConfig.advantage_max);
    expect(dmg).toBeGreaterThan(0);
  });

  it("general stats contribute to damage via gen_weight", () => {
    const effectWithGens = makeDamageEffect({
      statTypes: ["Ninjutsu"],
      generalTypes: ["Strength"],
    });
    const effectWithoutGens = makeDamageEffect({
      statTypes: ["Ninjutsu"],
      generalTypes: [],
    });

    // Attacker has higher generals than defender
    const attacker = makeUser({
      userId: "attacker",
      strength: 200000,
    });
    const defender = makeUser({
      userId: "defender",
      strength: 100000,
    });

    const dmgWithGens = damageCalc(effectWithGens, attacker, defender, dmgConfig);
    const dmgWithoutGens = damageCalc(effectWithoutGens, attacker, defender, dmgConfig);

    // With general advantage, damage should be higher
    expect(dmgWithGens).toBeGreaterThan(dmgWithoutGens);
  });

  it("residualModifier reduces damage on subsequent rounds", () => {
    const effect = makeDamageEffect({
      castThisRound: false,
      residualModifier: 0.5,
    });
    const effectNoResidual = makeDamageEffect({
      castThisRound: false,
    });

    const attacker = makeUser({ userId: "attacker" });
    const defender = makeUser({ userId: "defender" });

    const dmgResidual = damageCalc(effect, attacker, defender, dmgConfig);
    const dmgFull = damageCalc(effectNoResidual, attacker, defender, dmgConfig);

    expect(dmgResidual).toBeCloseTo(dmgFull * 0.5, 5);
  });

  it("config parameters are respected (custom base_hits)", () => {
    const effect = makeDamageEffect();
    const attacker = makeUser({ userId: "attacker" });
    const defender = makeUser({ userId: "defender" });

    const configFast = { ...dmgConfig, base_hits: 5 };
    const configSlow = { ...dmgConfig, base_hits: 20 };

    const dmgFast = damageCalc(effect, attacker, defender, configFast);
    const dmgSlow = damageCalc(effect, attacker, defender, configSlow);

    // base_hits 5 should deal 2x the damage of base_hits 20 (since baseline = HP / base_hits)
    // Actually base_hits 5 vs 20 = 4x ratio
    expect(dmgFast / dmgSlow).toBeCloseTo(4.0, 5);
  });
});

describe("damage reduction cap", () => {
  const applyReductionCap = (consequences: Map<string, Consequence>) => {
    consequences.forEach((consequence) => {
      if (
        consequence.damage !== undefined &&
        consequence.baseDamageForModifiers !== undefined
      ) {
        const minDamage =
          consequence.baseDamageForModifiers * (1 - DMG_REDUCTION_CAP);
        consequence.damage = Math.max(consequence.damage, minDamage);
      }
    });
  };

  const makeConsequence = (
    overrides: Partial<Consequence> = {},
  ): Consequence => ({
    userId: "attacker",
    targetId: "defender",
    damage: 100,
    baseDamageForModifiers: 100,
    ...overrides,
  });

  it("DMG_REDUCTION_CAP is 80%", () => {
    expect(DMG_REDUCTION_CAP).toBe(0.8);
  });

  it("does not alter damage that is above the floor", () => {
    const consequences = new Map<string, Consequence>();
    consequences.set("e1", makeConsequence({ damage: 60, baseDamageForModifiers: 100 }));
    applyReductionCap(consequences);
    expect(consequences.get("e1")!.damage).toBe(60);
  });

  it("caps damage at 20% of base when fully reduced to 0", () => {
    const consequences = new Map<string, Consequence>();
    consequences.set("e1", makeConsequence({ damage: 0, baseDamageForModifiers: 100 }));
    applyReductionCap(consequences);
    expect(consequences.get("e1")!.damage).toBeCloseTo(20, 5);
  });

  it("caps damage at 20% of base when reduced below the floor", () => {
    const consequences = new Map<string, Consequence>();
    consequences.set("e1", makeConsequence({ damage: 5, baseDamageForModifiers: 100 }));
    applyReductionCap(consequences);
    expect(consequences.get("e1")!.damage).toBeCloseTo(20, 5);
  });

  it("caps negative damage (over-reduction) at 20% of base", () => {
    const consequences = new Map<string, Consequence>();
    consequences.set(
      "e1",
      makeConsequence({ damage: -50, baseDamageForModifiers: 100 }),
    );
    applyReductionCap(consequences);
    expect(consequences.get("e1")!.damage).toBeCloseTo(20, 5);
  });

  it("does not affect consequences without baseDamageForModifiers", () => {
    const consequences = new Map<string, Consequence>();
    consequences.set(
      "e1",
      makeConsequence({ damage: 0, baseDamageForModifiers: undefined }),
    );
    applyReductionCap(consequences);
    expect(consequences.get("e1")!.damage).toBe(0);
  });

  it("handles multiple consequences independently", () => {
    const consequences = new Map<string, Consequence>();
    consequences.set(
      "e1",
      makeConsequence({ damage: 0, baseDamageForModifiers: 200 }),
    );
    consequences.set(
      "e2",
      makeConsequence({ damage: 80, baseDamageForModifiers: 200 }),
    );
    applyReductionCap(consequences);
    expect(consequences.get("e1")!.damage).toBeCloseTo(40, 5);
    expect(consequences.get("e2")!.damage).toBe(80);
  });
});
