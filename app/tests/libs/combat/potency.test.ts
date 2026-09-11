import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ElementNames,
  OUT_OF_COMBAT_BASE_DAMAGE_INCREASE,
  OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION,
} from "@/drizzle/constants";
import { insertAction } from "@/libs/combat/actions";
import { getPotencyDescription, resolvePotencyTags } from "@/libs/combat/potency";
import { applyEffects } from "@/libs/combat/process";
import { copy, getPower, mirror } from "@/libs/combat/tags";
import type { CombatAction, CompleteBattle, UserEffect } from "@/libs/combat/types";
import { getBattleGrid, getEffectStackKey } from "@/libs/combat/util";
import {
  AllTags,
  DecreasePotencyTag,
  IncreasePotencyTag,
  isNegativeUserEffect,
  isPositiveUserEffect,
  type PotencyTag,
  PotencyTagTypes,
  type ZodAllTags,
} from "@/validators/combat";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
  makeTag,
} from "./helpers/battleScenario";

const makePotency = (
  fields: Partial<PotencyTag> = {},
  runtime: Partial<UserEffect> = {},
): UserEffect =>
  makeEffect(fields.type ?? "increasepotency", fields, {
    creatorId: "attacker",
    targetId: "attacker",
    targetType: "user",
    fromType: "jutsu",
    ...runtime,
  });

const makeAction = (
  effects: ZodAllTags[],
  overrides: Partial<CombatAction> = {},
): CombatAction => ({
  id: "potency-jutsu",
  name: "Potency test",
  image: "/jutsu.png",
  battleDescription: "",
  type: "jutsu",
  target: "OPPONENT",
  method: "SINGLE",
  range: 3,
  healthCost: 0,
  chakraCost: 0,
  staminaCost: 0,
  actionCostPerc: 10,
  updatedAt: 0,
  cooldown: 0,
  originalCooldown: 0,
  level: 0,
  effects,
  ...overrides,
});

const makeBattle = (usersEffects: UserEffect[] = []) =>
  makeCompleteBattle({
    width: 5,
    height: 5,
    round: 2,
    createdAt: new Date(0),
    usersState: [
      makeBattleUser("attacker", { curHealth: 1000, direction: "left" }),
      makeBattleUser("defender", { curHealth: 1000, direction: "right" }),
    ],
    usersEffects,
  });

const cast = (
  battle: CompleteBattle,
  action: CombatAction,
  actorId = "attacker",
  longitude = 1,
  latitude = 0,
) => {
  expect(
    insertAction({
      battle,
      action,
      actorId,
      longitude,
      latitude,
      grid: getBattleGrid(20, battle),
    }),
  ).toBe(true);
};

const systemDamageMultiplier = (1 + OUT_OF_COMBAT_BASE_DAMAGE_INCREASE / 100) * (1 - OUT_OF_COMBAT_BASE_DAMAGE_REDUCTION / 100);

const powerOf = (tag: ZodAllTags) => getPower({ ...tag, level: 0 } as UserEffect).power;

afterEach(() => vi.restoreAllMocks());

describe("potency configuration", () => {
  it("round-trips both modes and every supported selection through AllTags", () => {
    for (const schema of [IncreasePotencyTag, DecreasePotencyTag]) {
      for (const calculation of ["static", "percentage"] as const) {
        for (const affectedTag of ["all", ...PotencyTagTypes] as const) {
          const tag = schema.parse({
            calculation,
            affectedTag,
            affectedElements: [...ElementNames],
            power: 20,
            powerPerLevel: 0.5,
            rounds: 3,
          });
          expect(AllTags.parse(JSON.parse(JSON.stringify(tag)))).toEqual(tag);
        }
      }
    }
    expect(IncreasePotencyTag.parse({}).target).toBe("SELF");
    expect(DecreasePotencyTag.parse({}).target).toBe("INHERIT");
    expect(IncreasePotencyTag.parse({}).affectedElements).toEqual([]);
    expect(DecreasePotencyTag.parse({}).affectedElements).toEqual([]);
    expect(isPositiveUserEffect(IncreasePotencyTag.parse({}))).toBe(true);
    expect(isNegativeUserEffect(DecreasePotencyTag.parse({}))).toBe(true);
  });

  it("rejects unsupported selections, modes, negative amounts, and empty durations", () => {
    for (const schema of [IncreasePotencyTag, DecreasePotencyTag]) {
      for (const fields of [
        { affectedTag: "pierce" },
        { affectedTag: "increasepotency" },
        { affectedElements: ["Unknown"] },
        { calculation: "formula" },
        { power: -1 },
        { rounds: 0 },
      ]) {
        expect(schema.safeParse(fields).success).toBe(false);
      }
    }
  });

  it("describes selected tags, all tags, units, ownership, and duration", () => {
    expect(
      getPotencyDescription(
        IncreasePotencyTag.parse({ affectedTag: "reflect", power: 20 }),
      ),
    ).toBe(
      "The power of Reflect tags on your subsequent jutsu is increased by 20 power points for 3 rounds.",
    );
    expect(
      getPotencyDescription(
        DecreasePotencyTag.parse({ calculation: "percentage", power: 15 }),
      ),
    ).toBe(
      "The power of all supported tags on the target's subsequent jutsu is decreased by 15% for 3 rounds.",
    );
  });

  it("describes element selections and non-elemental tags", () => {
    expect(
      getPotencyDescription(
        IncreasePotencyTag.parse({
          affectedTag: "damage",
          affectedElements: ["Fire", "Water"],
          power: 20,
        }),
      ),
    ).toBe(
      "The power of Damage tags on your subsequent jutsu is increased by 20 power points for 3 rounds. Affected elements (match any): Fire, Water.",
    );
    expect(
      getPotencyDescription(
        DecreasePotencyTag.parse({ affectedElements: ["None"] }),
      ),
    ).toContain("Affected elements (match any): None (non-elemental).");
  });
});

describe("potency arithmetic", () => {
  it.each(PotencyTagTypes)("adjusts %s in both directions and modes", (type) => {
    const action = makeAction([makeTag(type, { power: 40 })]);
    for (const [kind, calculation, expected] of [
      ["increasepotency", "static", 60],
      ["increasepotency", "percentage", 48],
      ["decreasepotency", "static", 20],
      ["decreasepotency", "percentage", 32],
    ] as const) {
      const tags = resolvePotencyTags(
        action,
        [makePotency({ type: kind, calculation, affectedTag: type, power: 20 })],
        "attacker",
      );
      expect(powerOf(tags[0]!)).toBeCloseTo(expected);
      expect(action.effects[0]?.power).toBe(40);
    }
  });

  it("matches every occurrence but leaves unsupported and unselected tags intact", () => {
    const action = makeAction([
      makeTag("damage", { power: 40 }),
      makeTag("damage", { power: 10 }),
      makeTag("heal", { power: 40 }),
      makeTag("pierce", { power: 40 }),
      makeTag("decreaseheal", { power: 40 }),
      IncreasePotencyTag.parse({ power: 40 }),
    ]);
    const selected = resolvePotencyTags(
      action,
      [makePotency({ affectedTag: "damage", power: 20 })],
      "attacker",
    );
    expect(selected.map((e) => e.power)).toEqual([60, 30, 40, 40, 40, 40]);
    const all = resolvePotencyTags(
      action,
      [makePotency({ affectedTag: "all", power: 20 })],
      "attacker",
    );
    expect(all.map((e) => e.power)).toEqual([60, 30, 60, 40, 40, 40]);
  });

  it("adds static modifiers before additive percentages, independent of order", () => {
    const action = makeAction([makeTag("damage", { power: 40, powerPerLevel: 1 })], {
      level: 10,
    });
    const effects = [
      makePotency({ power: 20, powerPerLevel: 1 }, { level: 5 }),
      makePotency({ type: "decreasepotency", power: 5 }),
      makePotency({ power: 30, calculation: "percentage", affectedTag: "damage" }),
      makePotency({ type: "decreasepotency", power: 10, calculation: "percentage" }),
    ];
    // (40 + 10 + 25 - 5) * (1 + .30 - .10) = 84
    expect(resolvePotencyTags(action, effects, "attacker")[0]?.power).toBeCloseTo(84);
    expect(
      resolvePotencyTags(action, [...effects].reverse(), "attacker")[0]?.power,
    ).toBeCloseTo(84);
  });

  it("floors reductions at zero and retains percentage tag caps", () => {
    const action = makeAction([
      makeTag("reflect", { power: 90 }),
      makeTag("damage", { power: 90, calculation: "static" }),
    ]);
    expect(
      resolvePotencyTags(action, [makePotency({ power: 50 })], "attacker").map(
        (e) => e.power,
      ),
    ).toEqual([100, 140]);
    for (const calculation of ["static", "percentage"] as const) {
      const effects = [
        makePotency({ type: "decreasepotency", calculation, power: 100 }),
        makePotency({ type: "decreasepotency", calculation, power: 100 }),
      ];
      expect(
        resolvePotencyTags(action, effects, "attacker").map((e) => e.power),
      ).toEqual([0, 0]);
    }
    const bothNegative = [
      makePotency({ type: "decreasepotency", power: 200 }),
      makePotency({ type: "decreasepotency", calculation: "percentage", power: 100 }),
    ];
    expect(
      resolvePotencyTags(action, bothNegative, "attacker").map((e) => e.power),
    ).toEqual([0, 0]);
  });

  it("uses only active, resolved potency on the caster and excludes non-jutsu actions", () => {
    const action = makeAction([makeTag("damage", { power: 40 })]);
    const expired = makePotency({ power: 20 });
    expired.rounds = 0;
    const pending = makePotency({ power: 20 }, { isNew: true });
    const onRecipient = makePotency({ power: 20 }, { targetId: "defender" });
    expect(
      resolvePotencyTags(action, [expired, pending, onRecipient], "attacker")[0]?.power,
    ).toBe(40);
    for (const type of ["basic", "item"] as const) {
      expect(
        resolvePotencyTags(
          { ...action, type },
          [makePotency({ power: 20 })],
          "attacker",
        )[0]?.power,
      ).toBe(40);
    }
  });

  it("distinguishes selectors and modes in stacking identities", () => {
    const effects = [
      makePotency({ affectedTag: "damage" }),
      makePotency({ affectedTag: "heal" }),
      makePotency({ affectedTag: "damage", calculation: "percentage" }),
    ];
    expect(new Set(effects.map(getEffectStackKey)).size).toBe(3);
  });
});

describe("potency element matching", () => {
  it.each(
    PotencyTagTypes.filter((type) => type !== "heal" && type !== "increaseheal"),
  )(
    "matches elements on %s in both directions and modes",
    (type) => {
      const action = makeAction([
        makeTag(type, { power: 40, elements: ["Fire"] }),
        makeTag(type, { power: 40, elements: ["Water"] }),
        makeTag(type, { power: 40, elements: ["Wind", "Fire"] }),
        makeTag(type, { power: 40 }),
      ]);
      for (const [kind, calculation, expected] of [
        ["increasepotency", "static", 60],
        ["increasepotency", "percentage", 48],
        ["decreasepotency", "static", 20],
        ["decreasepotency", "percentage", 32],
      ] as const) {
        const tags = resolvePotencyTags(
          action,
          [
            makePotency({
              type: kind,
              calculation,
              affectedTag: type,
              affectedElements: ["Fire"],
              power: 20,
            }),
          ],
          "attacker",
        );
        expect(tags.map((tag) => tag.power)).toEqual([expected, 40, expected, 40]);
        expect(action.effects.map((tag) => tag.power)).toEqual([40, 40, 40, 40]);
      }
    },
  );

  it("requires the selected tag type and matches any selected element only once", () => {
    const action = makeAction([
      makeTag("damage", { power: 40, elements: ["Fire", "Water"] }),
      makeTag("damage", { power: 40, elements: ["Water"] }),
      makeTag("afterburn", { power: 40, elements: ["Fire"] }),
      makeTag("pierce", { power: 40, elements: ["Fire"] }),
      makeTag("heal", { power: 40 }),
    ]);
    for (const [affectedTag, expected] of [
      ["damage", [60, 60, 40, 40, 40]],
      ["all", [60, 60, 60, 40, 40]],
    ] as const) {
      const tags = resolvePotencyTags(
        action,
        [makePotency({ affectedTag, affectedElements: ["Fire", "Water"], power: 20 })],
        "attacker",
      );
      expect(tags.map((tag) => tag.power)).toEqual(expected);
    }
  });

  it("matches None to explicit, empty, and missing tag elements", () => {
    const action = makeAction([
      makeTag("damage", { power: 40, elements: ["None"] }),
      makeTag("damage", { power: 40, elements: [] }),
      makeTag("damage", { power: 40 }),
      makeTag("heal", { power: 40 }),
      makeTag("increaseheal", { power: 40 }),
      makeTag("damage", { power: 40, elements: ["Fire"] }),
    ]);
    const tags = resolvePotencyTags(
      action,
      [makePotency({ affectedElements: ["None"], power: 20 })],
      "attacker",
    );
    expect(tags.map((tag) => tag.power)).toEqual([60, 60, 60, 60, 60, 40]);
  });

  it("keeps existing potency effects without an element selection unrestricted", () => {
    const action = makeAction([
      makeTag("damage", { power: 40, elements: ["Fire"] }),
      makeTag("damage", { power: 40, elements: ["Ice"] }),
      makeTag("heal", { power: 40 }),
    ]);
    const effect = makePotency({ power: 20 });
    const legacyEffect = { ...effect };
    Reflect.deleteProperty(legacyEffect, "affectedElements");
    expect(getEffectStackKey(legacyEffect)).toBe(getEffectStackKey(effect));
    for (const potency of [effect, legacyEffect]) {
      expect(
        resolvePotencyTags(action, [potency], "attacker").map((tag) => tag.power),
      ).toEqual([60, 60, 60]);
    }
  });

  it("stacks distinct element selections and normalizes element order and duplicates", () => {
    const action = makeAction([
      makeTag("damage", { power: 40, elements: ["Fire"] }),
      makeTag("damage", { power: 40, elements: ["Water"] }),
      makeTag("damage", { power: 40, elements: ["Fire", "Water"] }),
    ]);
    const effects = [
      makePotency({ affectedElements: ["Fire"], power: 10 }),
      makePotency({ affectedElements: ["Water"], power: 20 }),
      makePotency({
        affectedElements: ["Fire"],
        power: 20,
        calculation: "percentage",
      }),
    ];
    expect(new Set(effects.map(getEffectStackKey)).size).toBe(3);
    for (const orderedEffects of [effects, [...effects].reverse()]) {
      expect(
        resolvePotencyTags(action, orderedEffects, "attacker").map((tag) => tag.power),
      ).toEqual([60, 60, 84]);
    }
    const ordered = makePotency({ affectedElements: ["Fire", "Water"] });
    const reversed = makePotency({ affectedElements: ["Water", "Fire", "Fire"] });
    expect(getEffectStackKey(ordered)).toBe(getEffectStackKey(reversed));
    expect("affectedElements" in reversed && reversed.affectedElements).toEqual([
      "Water",
      "Fire",
      "Fire",
    ]);
  });
});

describe("potency combat lifecycle", () => {
  it.each(["increasepotency", "decreasepotency"] as const)(
    "preserves %s element selections through casting and effect processing",
    (type) => {
      let battle = makeBattle();
      cast(
        battle,
        makeAction([makeTag(type, { affectedElements: ["Fire"], power: 20 })]),
      );
      battle = applyEffects(battle, "attacker").newBattle;
      battle.round++;
      const casterId = type === "increasepotency" ? "attacker" : "defender";
      expect(battle.usersEffects.find((effect) => effect.type === type)).toMatchObject({
        affectedElements: ["Fire"],
        targetId: casterId,
        isNew: false,
      });
      cast(
        battle,
        makeAction([
          makeTag("damage", { power: 40, calculation: "static", elements: ["Fire"] }),
          makeTag("afterburn", { power: 40, rounds: 3, elements: ["Water"] }),
        ]),
        casterId,
        casterId === "attacker" ? 1 : 0,
      );
      expect(
        battle.usersEffects.find((effect) => effect.type === "damage")?.power,
      ).toBe(type === "increasepotency" ? 60 : 20);
      expect(
        battle.usersEffects.find((effect) => effect.type === "afterburn")?.power,
      ).toBe(40);
    },
  );

  it("starts on subsequent casts and never modifies saved tags or compounds ticks", () => {
    let battle = makeBattle();
    const original = [
      IncreasePotencyTag.parse({ power: 20 }),
      makeTag("damage", {
        power: 40,
        powerPerLevel: 1,
        rounds: 2,
        calculation: "static",
      }),
    ];
    const saved = structuredClone(original);
    cast(battle, makeAction(original, { level: 10 }));
    expect(getPower(battle.usersEffects.find((e) => e.type === "damage")!).power).toBe(
      50,
    );
    battle = applyEffects(battle, "attacker").newBattle;
    const action = makeAction([saved[1]!], { id: "next-jutsu", level: 10 });
    cast(battle, action);
    const boosted = battle.usersEffects.find((e) => e.actionId === "next-jutsu")!;
    expect(getPower(boosted).power).toBe(70);
    expect(boosted.powerPerLevel).toBe(0);
    battle = applyEffects(battle, "attacker").newBattle;
    const potency = battle.usersEffects.find((e) => e.type === "increasepotency")!;
    potency.rounds = 0;
    battle.round++;
    battle = applyEffects(battle, "defender").newBattle;
    expect(getPower(battle.usersEffects.find((e) => e.id === boosted.id)!).power).toBe(
      70,
    );
    expect(battle.usersEffects.some((e) => e.type === "increasepotency")).toBe(false);
    cast(battle, makeAction([saved[1]!], { id: "expired-jutsu", level: 10 }));
    expect(
      getPower(battle.usersEffects.find((e) => e.actionId === "expired-jutsu")!).power,
    ).toBe(50);
    expect(original).toEqual(saved);
  });

  it("reduces the debuffed caster's outgoing tags, not incoming jutsu", () => {
    let battle = makeBattle();
    cast(
      battle,
      makeAction([DecreasePotencyTag.parse({ power: 20, affectedTag: "heal" })]),
    );
    battle = applyEffects(battle, "attacker").newBattle;
    cast(
      battle,
      makeAction([makeTag("heal", { power: 40, calculation: "static" })], {
        id: "debuffed-heal",
        target: "OTHER_USER",
      }),
      "defender",
      0,
    );
    expect(battle.usersEffects.find((e) => e.actionId === "debuffed-heal")?.power).toBe(
      20,
    );
    cast(
      battle,
      makeAction([makeTag("heal", { power: 40, calculation: "static" })], {
        id: "incoming-heal",
        target: "OTHER_USER",
      }),
    );
    expect(battle.usersEffects.find((e) => e.actionId === "incoming-heal")?.power).toBe(
      40,
    );
  });

  it.each([
    ["increasepotency", "buffprevent", "clear"],
    ["decreasepotency", "debuffprevent", "cleanse"],
  ] as const)("integrates %s with %s and %s", (type, preventType, removeType) => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const prevent = makeEffect(
      preventType,
      { power: 100, rounds: 3 },
      {
        creatorId: "defender",
        targetId: "defender",
        targetType: "user",
        createdRound: 0,
      },
    );
    let battle = makeBattle([prevent]);
    cast(battle, makeAction([makeTag(type, { target: "INHERIT", power: 20 })]));
    const blocked = applyEffects(battle, "attacker");
    expect(blocked.newBattle.usersEffects.some((e) => e.type === type)).toBe(false);
    expect(
      blocked.actionEffects.some((e) =>
        e.txt.includes(
          type === "increasepotency" ? "cannot be buffed" : "cannot be debuffed",
        ),
      ),
    ).toBe(true);

    battle = makeBattle();
    cast(battle, makeAction([makeTag(type, { target: "INHERIT", power: 20 })]));
    battle = applyEffects(battle, "attacker").newBattle;
    expect(battle.usersEffects.some((e) => e.type === type)).toBe(true);
    cast(battle, makeAction([makeTag(removeType, { power: 100 })]));
    battle = applyEffects(battle, "attacker").newBattle;
    expect(
      battle.usersEffects.some((e) => e.type === type && (e.rounds ?? 0) > 0),
    ).toBe(false);
  });

  it("strengthens damage reduction without inverting its sign", () => {
    let battle = makeBattle([
      makePotency({ affectedTag: "decreasedamagetaken", power: 20 }),
    ]);
    cast(
      battle,
      makeAction([
        makeTag("decreasedamagetaken", {
          target: "SELF",
          power: 20,
          calculation: "percentage",
          rounds: 3,
        }),
      ]),
    );
    battle = applyEffects(battle, "attacker").newBattle;
    expect(
      getPower(battle.usersEffects.find((e) => e.type === "decreasedamagetaken")!)
        .power,
    ).toBe(-40);
    battle.round++;
    cast(
      battle,
      makeAction([makeTag("damage", { power: 100, rounds: 0, calculation: "static" })]),
      "defender",
      0,
    );
    const result = applyEffects(battle, "defender");
    expect(
      result.newBattle.usersState.find((u) => u.userId === "attacker")?.curHealth,
    ).toBeCloseTo(1000 - 100 * systemDamageMultiplier * 0.6);
  });

  it.each([
    "OPPONENT",
    "GROUND",
  ] as const)("keeps separate SELF potency selections on %s area casts", (target) => {
    const battle = makeBattle();
    cast(
      battle,
      makeAction(
        [
          IncreasePotencyTag.parse({ affectedTag: "damage", power: 20 }),
          IncreasePotencyTag.parse({ affectedTag: "heal", power: 10 }),
          IncreasePotencyTag.parse({
            affectedTag: "damage",
            calculation: "percentage",
            power: 10,
          }),
          IncreasePotencyTag.parse({
            affectedTag: "damage",
            affectedElements: ["Fire"],
            power: 20,
          }),
          IncreasePotencyTag.parse({
            affectedTag: "damage",
            affectedElements: ["Water"],
            power: 20,
          }),
        ],
        { target, method: "AOE_CIRCLE_SPAWN" },
      ),
    );
    expect(battle.usersEffects).toHaveLength(5);
    expect(
      battle.usersEffects.every(
        (e) => e.targetId === "attacker" && e.fromType === "jutsu",
      ),
    ).toBe(true);
  });

  it("snapshots ground effects and preserves their jutsu source when they land", () => {
    let battle = makeBattle([makePotency({ power: 20 })]);
    cast(
      battle,
      makeAction([makeTag("damage", { power: 40, rounds: 3, calculation: "static" })], {
        target: "GROUND",
      }),
    );
    expect(battle.groundEffects[0]?.power).toBe(60);
    expect(battle.groundEffects[0]?.fromType).toBe("jutsu");
    battle.usersEffects[0]!.rounds = 0;
    battle = applyEffects(battle, "attacker").newBattle;
    expect(
      battle.usersState.find((u) => u.userId === "defender")?.curHealth,
    ).toBeCloseTo(1000 - 60 * systemDamageMultiplier);
    expect(battle.groundEffects[0]?.power).toBe(60);
  });

  it("uses adjusted damage for barrier copies on area casts", () => {
    const battle = makeBattle([makePotency({ power: 20 })]);
    const barrier = makeEffect(
      "barrier",
      { power: 10, rounds: 3 },
      { id: "barrier", creatorId: "defender", longitude: 2, latitude: 0 },
    );
    battle.groundEffects.push(barrier);
    cast(
      battle,
      makeAction([makeTag("damage", { power: 40 })], { method: "AOE_CIRCLE_SPAWN" }),
      "attacker",
      2,
    );
    expect(battle.usersEffects.find((e) => e.targetId === "barrier")?.power).toBe(60);
  });

  it.each([
    "afterburn",
    "lifesteal",
    "reflect",
  ] as const)("adjusts %s in the post-damage phase and preserves its cap", (type) => {
    for (const initialPower of [20, 90]) {
      let battle = makeBattle([makePotency({ affectedTag: type, power: 20 })]);
      battle.usersState.forEach((u) => {
        u.curHealth = 3000;
      });
      cast(
        battle,
        makeAction([
          makeTag(type, { power: initialPower, rounds: 3, calculation: "percentage" }),
        ], {
          // Lifesteal reads outgoing damage credited to its target. Targeting SELF
          // keeps that target aligned with the attacker's damage userId; the
          // afterburn and reflect cases retain their existing opponent targeting.
          target: type === "lifesteal" ? "SELF" : "OPPONENT",
        }),
        "attacker",
        type === "lifesteal" ? 0 : 1,
      );
      battle = applyEffects(battle, "attacker").newBattle;
      battle.round++;
      const reflecting = type === "reflect";
      cast(
        battle,
        makeAction([
          makeTag("damage", { power: 1000, rounds: 0, calculation: "static" }),
        ]),
        reflecting ? "defender" : "attacker",
        reflecting ? 0 : 1,
      );
      battle = applyEffects(battle, reflecting ? "defender" : "attacker").newBattle;
      const damage = 1000 * systemDamageMultiplier;
      const converted = Math.floor(damage * Math.min(0.6, (initialPower + 20) / 100));
      const attacker = battle.usersState.find((u) => u.userId === "attacker")!;
      const defender = battle.usersState.find((u) => u.userId === "defender")!;
      expect(attacker.curHealth).toBeCloseTo(
        type === "lifesteal" ? 3000 + converted : reflecting ? 3000 - damage : 3000,
      );
      expect(defender.curHealth).toBeCloseTo(
        reflecting
          ? 3000 - converted
          : type === "afterburn"
            ? 3000 - damage - converted
            : 3000 - damage,
      );
    }
  });

  it("adjusts Heal and Increase Heal in their respective processing stages", () => {
    let battle = makeBattle([makePotency({ power: 20 })]);
    cast(
      battle,
      makeAction([
        makeTag("increaseheal", {
          target: "SELF",
          power: 20,
          calculation: "percentage",
          rounds: 3,
        }),
      ]),
    );
    battle = applyEffects(battle, "attacker").newBattle;
    battle.round++;
    cast(
      battle,
      makeAction([makeTag("heal", { power: 40, calculation: "static", rounds: 0 })], {
        target: "OTHER_USER",
      }),
    );
    battle = applyEffects(battle, "attacker").newBattle;
    // Heal power 40 -> 60, then Increase Heal 20% -> 40%.
    expect(
      battle.usersState.find((u) => u.userId === "defender")?.curHealth,
    ).toBeCloseTo(1000 + 60 * 10 * 1.4);
  });

  it("follows existing transfer eligibility: Copy's whitelist and Mirror's fallback tier", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const attacker = makeBattleUser("attacker");
    const defender = makeBattleUser("defender");
    const buff = makePotency({ power: 20 }, { targetId: "defender" });
    const copyEffects = [buff];
    copy(
      makeEffect(
        "copy",
        { power: 100, rounds: 3 },
        { isNew: true, castThisRound: true },
      ),
      copyEffects,
      attacker,
      defender,
    );
    expect(copyEffects).toHaveLength(1);
    const debuff = makePotency({
      type: "decreasepotency",
      power: 20,
      affectedTag: "heal",
    });
    const mirrorEffects = [debuff];
    mirror(
      makeEffect(
        "mirror",
        { power: 100, rounds: 3 },
        { isNew: true, castThisRound: true, createdRound: 2 },
      ),
      mirrorEffects,
      attacker,
      defender,
    );
    expect(mirrorEffects).toHaveLength(2);
    const transferred = mirrorEffects[1]!;
    expect(transferred).toMatchObject({
      type: "decreasepotency",
      affectedTag: "heal",
      targetId: "defender",
      power: 20,
    });
    expect(transferred.isNew).toBe(true);
  });
});
