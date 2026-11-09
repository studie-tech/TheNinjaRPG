import { afterEach, describe, expect, it, vi } from "bun:test";
import { BattleTypes } from "@/drizzle/constants";
import type {
  CombatAction,
  Consequence,
  ReturnedBattle,
  UserEffect,
} from "@/libs/combat/types";
import {
  applyPoolAdjustmentsToBase,
  calcPoolCost,
  collapseConsequences,
  getDefaultBattleSizes,
  rollInitiative,
} from "@/libs/combat/util";
import { calcApReduction, hasNoAvailableActions } from "@/libs/combat/turn";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Merge consequences for one target and damage source through the reducer. */
const collapse = (...consequences: Partial<Consequence>[]) =>
  consequences
    .map((c) => ({ userId: "user", targetId: "target", ...c }) as Consequence)
    .reduce(collapseConsequences, []);

const poolEffect = (
  type: string,
  poolsAffected: string[],
  calculation: string,
  power: number,
) =>
  ({
    id: type,
    type,
    targetId: "user",
    creatorId: "other",
    calculation,
    power,
    powerPerLevel: 0,
    level: 0,
    poolsAffected,
    isNew: false,
    castThisRound: false,
  }) as unknown as UserEffect;

describe("collapseConsequences", () => {
  it("keeps consequences for other targets and damage sources apart", () => {
    const merged = collapse(
      { damage: 1 },
      { damage: 2, targetId: "other" },
      { damage: 3, damageSource: "recoil" },
    );
    expect(merged.map((c) => c.damage)).toEqual([1, 2, 3]);
  });

  it("sums additive fields and takes the highest heal", () => {
    const fields = [
      "damage",
      "residual",
      "reflect",
      "recoil",
      "lifesteal_hp",
      "preShieldDamage",
      "absorb_hp",
      "absorb_sp",
      "absorb_cp",
      "drain_hp",
      "drain_cp",
      "drain_sp",
      "poison",
      "wound",
      "afterburn",
    ] as const;
    const [merged] = collapse(
      Object.fromEntries(fields.map((field) => [field, 2])),
      { heal_hp: 5, heal_sp: 9, heal_cp: 1 },
      Object.fromEntries(fields.map((field) => [field, 3])),
      { heal_hp: 7, heal_sp: 2, heal_cp: 1 },
    );
    for (const field of fields) expect(merged?.[field]).toBe(5);
    expect([merged?.heal_hp, merged?.heal_sp, merged?.heal_cp]).toEqual([7, 9, 1]);
  });

  it("ignores falsy increments and adopts values into empty slots", () => {
    const [merged] = collapse(
      { damage: 0, heal_hp: 0 },
      { damage: 4, heal_hp: 3, afterburn: 0 },
      { damage: 0, reflect: 0 },
    );
    expect(merged?.damage).toBe(4);
    expect(merged?.heal_hp).toBe(3);
    expect(merged?.afterburn).toBeUndefined();
    expect(merged?.reflect).toBeUndefined();
  });

  it("replaces a NaN sum slot but lets afterburn stay NaN", () => {
    const [merged] = collapse(
      { damage: Number.NaN, afterburn: Number.NaN },
      { damage: 4, afterburn: 4 },
    );
    expect(merged?.damage).toBe(4);
    expect(merged?.afterburn).toBeNaN();
  });

  it("converts vamp from the pre-shield hit, dropping a merged vampHeal but keeping a pushed one", () => {
    const [pushed] = collapse({
      vampRatio: 0.5,
      preShieldDamage: 10,
      damage: 2,
      vampHeal: 1,
    });
    expect(pushed?.vampHeal).toBe(6);
    const [merged] = collapse(
      { vampRatio: 0.5, damage: 2 },
      { vampRatio: 0.5, damage: 4, vampHeal: 100 },
    );
    expect(merged?.vampHeal).toBe(3);
  });

  it("derives pre-diffuse damage before adding the incoming pre-shield hit", () => {
    const [merged] = collapse(
      { preShieldDamage: 10 },
      { preShieldDamage: 5, preDiffuseDamage: 7 },
      { preShieldDamage: 1 },
    );
    expect(merged?.preDiffuseDamage).toBe(18);
    expect(merged?.preShieldDamage).toBe(16);
  });

  it("adds defined immediate diffuse damage and concatenates lists", () => {
    const [merged] = collapse(
      { types: ["fire"], enmitySources: [{ userId: "a" }] } as never,
      {
        diffuseImmediateDamage: 0,
        types: ["water"],
        enmitySources: [{ userId: "b" }],
      } as never,
      { diffuseImmediateDamage: 2 },
    );
    expect(merged?.diffuseImmediateDamage).toBe(2);
    expect(merged?.types as unknown).toEqual(["fire", "water"]);
    expect(merged?.enmitySources as unknown).toEqual([
      { userId: "a" },
      { userId: "b" },
    ]);
  });
});

describe("applyPoolAdjustmentsToBase", () => {
  const target = () =>
    makeBattleUser("user", {
      curHealth: 50,
      maxHealth: 100,
      curChakra: 50,
      maxChakra: 100,
      curStamina: 50,
      maxStamina: 100,
    });

  it("moves each current pool by its own delta and tracks every pool", () => {
    const user = target();
    applyPoolAdjustmentsToBase(user, [
      poolEffect("increasemaxpools", ["Health"], "static", 20),
      poolEffect("decreasemaxpools", ["Stamina"], "static", 30),
    ]);
    expect([user.curHealth, user.curChakra, user.curStamina]).toEqual([70, 50, 20]);
    expect([user._prevHealthAdj, user._prevChakraAdj, user._prevStaminaAdj]).toEqual([
      20, 0, -30,
    ]);
    applyPoolAdjustmentsToBase(user, [
      poolEffect("increasemaxpools", ["Health"], "static", 5),
    ]);
    expect([user.curHealth, user.curChakra, user.curStamina]).toEqual([55, 50, 50]);
  });

  it("clears tracking once every adjustment is gone", () => {
    const user = target();
    user._prevChakraAdj = 10;
    applyPoolAdjustmentsToBase(user, []);
    expect(user.curChakra).toBe(40);
    expect([user._prevHealthAdj, user._prevChakraAdj, user._prevStaminaAdj]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("keeps empty pools empty, living pools at one and clamps to the effective max", () => {
    const user = target();
    user.curHealth = 0;
    user.curChakra = 5;
    user.curStamina = 100;
    applyPoolAdjustmentsToBase(user, [
      poolEffect("decreasemaxpools", ["Health", "Chakra", "Stamina"], "static", 40),
    ]);
    expect([user.curHealth, user.curChakra, user.curStamina]).toEqual([0, 1, 60]);
  });

  it("never clamps below an effective max of one", () => {
    const user = target();
    applyPoolAdjustmentsToBase(user, [
      poolEffect("decreasemaxpools", ["Health"], "static", 500),
    ]);
    expect(user.curHealth).toBe(1);
  });
});

describe("calcPoolCost", () => {
  const action = { healthCost: 10, chakraCost: 20, staminaCost: 40 } as CombatAction;
  const user = makeBattleUser("user");

  it("applies each effect to its pools in order", () => {
    const cost = calcPoolCost(
      action,
      [
        poolEffect("increasepoolcost", ["Health", "Stamina"], "percentage", 50),
        poolEffect("decreasepoolcost", ["Health"], "static", 5),
        poolEffect("increasepoolcost", ["Chakra"], "static", -1),
      ],
      user,
    );
    expect(cost).toEqual({ hpCost: 10, cpCost: 21, spCost: 60 });
  });

  it("makes an over-reduced action free without refunding pools", () => {
    expect(
      calcPoolCost(
        action,
        [poolEffect("decreasepoolcost", ["Stamina"], "percentage", 200)],
        user,
      ).spCost,
    ).toBe(0);
  });

  it("ignores effect pools outside the three costs", () => {
    const cost = calcPoolCost(
      action,
      [poolEffect("increasepoolcost", ["Energy"], "static", 50)],
      user,
    );
    expect(cost).toEqual({ hpCost: 10, cpCost: 20, spCost: 40 });
  });
});

describe("getDefaultBattleSizes", () => {
  const scaled = ["HUNTING", "RANDOM_ENCOUNTER", "ARENA", "TRAINING", "QUEST"];

  it("scales early level-gated battles and fixes the rest", () => {
    for (const battleType of BattleTypes) {
      const isScaled = scaled.includes(battleType);
      expect(getDefaultBattleSizes(battleType, 19)).toEqual(
        isScaled ? { width: 9, height: 8 } : { width: 12, height: 10 },
      );
      expect(getDefaultBattleSizes(battleType, 20)).toEqual(
        isScaled ? { width: 10, height: 9 } : { width: 12, height: 10 },
      );
      expect(getDefaultBattleSizes(battleType, 30)).toEqual(
        isScaled ? { width: 11, height: 10 } : { width: 12, height: 10 },
      );
      for (const level of [40, 50, 100])
        expect(getDefaultBattleSizes(battleType, level)).toEqual({
          width: 12,
          height: 10,
        });
    }
  });
});

describe("rollInitiative", () => {
  const roll = (pvpStreak?: number | null) => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    return rollInitiative({ sector: 1, pvpStreak }, undefined, 1);
  };
  const base = 11 * 1.1;

  it("adds a shrinking bonus per streak step, flat beyond the fourth", () => {
    expect(roll(0)).toBe(base);
    expect(roll(null)).toBe(base);
    expect(roll(1)).toBeCloseTo(base * 1.02, 10);
    expect(roll(2)).toBeCloseTo(base * 1.035, 10);
    expect(roll(4)).toBeCloseTo(base * 1.05, 10);
    expect(roll(5)).toBeCloseTo(base * 1.0525, 10);
    expect(roll(7)).toBeCloseTo(base * 1.0575, 10);
  });

  it("applies level and territory bonuses before the streak", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = rollInitiative(
      { level: 110, sector: 2, pvpStreak: 1 },
      [{ level: 100 }, {}],
      1,
    );
    expect(result).toBeCloseTo(11 * (1 + 0.03 * (110 - 50.5)) * 0.9 * 1.02, 10);
  });
});

describe("calcApReduction", () => {
  const stun = (apReduction: number) => ({
    id: `stun-${apReduction}`,
    type: "stun",
    targetId: "user",
    creatorId: "user",
    rounds: 1,
    apReduction,
    isNew: false,
    castThisRound: false,
    fromType: "jutsu",
  });

  it("takes the strongest active stun, or zero without one", () => {
    const battle = makeCompleteBattle({
      usersState: [makeBattleUser("user")],
      usersEffects: [stun(10), stun(30), stun(20)] as never,
      groundEffects: [],
    });
    expect(calcApReduction(battle as unknown as ReturnedBattle, "user")).toBe(30);
    expect(calcApReduction(battle as unknown as ReturnedBattle, "nobody")).toBe(0);
    expect(calcApReduction(null, null)).toBe(0);
    expect(calcApReduction(undefined, "user")).toBe(0);
  });
});

describe("hasNoAvailableActions", () => {
  const act = (id: string, actionCostPerc: number) =>
    ({ id, actionCostPerc, effects: [] }) as unknown as CombatAction;
  const battleWith = (overrides: Record<string, unknown> = {}) =>
    makeCompleteBattle({
      usersState: [makeBattleUser("user", { actionPoints: 50, ...overrides })],
      usersEffects: [],
      groundEffects: [],
    }) as unknown as ReturnedBattle;

  it("is done for missing, dead, fled and departed actors", () => {
    expect(hasNoAvailableActions(battleWith(), "nobody")).toBe(true);
    for (const state of [
      { curHealth: 0 },
      { fledBattle: true },
      { leftBattle: true },
    ]) {
      expect(hasNoAvailableActions(battleWith(state), "user", [act("jutsu", 10)])).toBe(
        true,
      );
    }
  });

  it("treats a public actor's unknown loadout as still able to act", () => {
    const battle = battleWith();
    Reflect.deleteProperty(battle.usersState[0]!, "jutsus");
    expect(hasNoAvailableActions(battle, "user", [act("jutsu", 200)])).toBe(false);
  });

  it("needs an affordable action other than waiting", () => {
    expect(
      hasNoAvailableActions(battleWith(), "user", [act("wait", 10), act("jutsu", 100)]),
    ).toBe(true);
    expect(
      hasNoAvailableActions(battleWith(), "user", [act("wait", 10), act("jutsu", 40)]),
    ).toBe(false);
  });
});
