import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import {
  COPYABLE_EFFECT_TYPES,
  COPY_MAX_TAGS,
  COPY_PRIORITY_RANK,
  COPY_PRIORITY_TIERS,
  MIRROR_MAX_TAGS,
  MIRROR_PRIORITY_RANK,
  MIRROR_PRIORITY_TIERS,
  TRANSFER_EXCLUDED_SOURCE_TYPES,
} from "@/drizzle/constants";
import { copy, mirror, wound } from "@/libs/combat/tags";
import type { BattleUserState, UserEffect } from "@/libs/combat/types";
import { selectTransferEffects } from "@/libs/combat/util";
import { isNegativeUserEffect, isPositiveUserEffect } from "@/validators/combat";
import type { ZodAllTags } from "@/validators/combat";
import { makeBattleUser, makeEffect } from "../../setup/combat";

const SELF = "self-1";
const OPP = "opp-1";

const asUser = (userId: string, username: string): BattleUserState =>
  makeBattleUser(userId, { username });

// Minimal transfer fixture. makeEffect parses through the real tag schema and
// applies defaults; we override power/rounds + runtime identity.
//
// NOTE: do NOT force `calculation` here. `BaseAttributes.calculation` defaults
// to z.enum(["static"]); types like `shield` never override it, so passing
// "percentage" is a Zod parse error. Let each schema default. Tests assert on
// `power`/`type`/order using the source effect's calculation and units.
const makeTransferEffect = (
  type: string,
  power: number,
  overrides: Partial<UserEffect> = {},
): UserEffect =>
  makeEffect(
    type as Parameters<typeof makeEffect>[0],
    {
      power,
      rounds: 5,
      statTypes: ["Ninjutsu"],
      generalTypes: [],
      elements: [],
    } as never,
    {
      id: `${type}-${power}`,
      targetId: OPP,
      creatorId: OPP,
      level: 0,
      isNew: true,
      castThisRound: true,
      createdRound: 1,
      ...overrides,
    },
  );

// A negative effect ON self (mirror source).
const selfDebuff = (
  type: string,
  power: number,
  overrides: Partial<UserEffect> = {},
): UserEffect =>
  makeTransferEffect(type, power, { targetId: SELF, creatorId: OPP, ...overrides });

// The copy/mirror tag effect itself (cast by SELF onto OPP).
const transferTag = (type: "copy" | "mirror"): UserEffect =>
  makeEffect(
    type,
    { power: 100, rounds: 3, calculation: "percentage" } as never,
    {
      id: `${type}-tag`,
      targetId: OPP,
      creatorId: SELF,
      level: 0,
      isNew: true,
      castThisRound: true,
      createdRound: 1,
    },
  );
const copyTag = (): UserEffect => transferTag("copy");
const mirrorTag = (): UserEffect => transferTag("mirror");

// Simple injected rank: increasedamagegiven=0, lifesteal=1, shield=2, else tail.
const testRank: ReadonlyMap<string, number> = new Map([
  ["increasedamagegiven", 0],
  ["lifesteal", 1],
  ["shield", 2],
]);

describe("copy/mirror priority constants", () => {
  it("caps are both 4", () => {
    expect(COPY_MAX_TAGS).toBe(4);
    expect(MIRROR_MAX_TAGS).toBe(4);
  });

  it("copyable set is exactly these 8 positive types", () => {
    expect([...COPYABLE_EFFECT_TYPES].sort()).toEqual(
      [
        "absorb",
        "decreasedamagetaken",
        "increasedamagegiven",
        "increaseheal",
        "increasestat",
        "lifesteal",
        "reflect",
        "shield",
      ].sort(),
    );
  });

  it("copy ranks put DI/DR at tier 0 and increasestat at the tail", () => {
    expect(COPY_PRIORITY_RANK.get("increasedamagegiven")).toBe(0);
    expect(COPY_PRIORITY_RANK.get("decreasedamagetaken")).toBe(0);
    expect(COPY_PRIORITY_RANK.get("lifesteal")).toBe(1);
    expect(COPY_PRIORITY_RANK.get("increasestat")).toBe(5);
    expect(COPY_PRIORITY_RANK.get("shield")).toBe(3);
    expect(COPY_PRIORITY_RANK.get("increaseheal")).toBe(4);
    // Absorb and reflect share a tier above static-HP shields.
    expect(COPY_PRIORITY_RANK.get("absorb")).toBe(COPY_PRIORITY_RANK.get("reflect"));
  });

  it("mirror ranks put IDT/DDG at tier 0 and wound below poison", () => {
    expect(MIRROR_PRIORITY_RANK.get("increasedamagetaken")).toBe(0);
    expect(MIRROR_PRIORITY_RANK.get("decreasedamagegiven")).toBe(0);
    expect(MIRROR_PRIORITY_RANK.get("afterburn")).toBe(1);
    expect(MIRROR_PRIORITY_RANK.get("poison")).toBe(2);
    expect(MIRROR_PRIORITY_RANK.get("increasepoolcost")).toBe(2);
    expect(MIRROR_PRIORITY_RANK.get("wound")).toBe(3);
    // an unranked negative type is absent (the selector supplies the tail fallback)
    expect(MIRROR_PRIORITY_RANK.get("weakness")).toBeUndefined();
  });

  it("shared source excludes cover gear/passive origins", () => {
    expect(TRANSFER_EXCLUDED_SOURCE_TYPES.has("bloodline")).toBe(true);
    expect(TRANSFER_EXCLUDED_SOURCE_TYPES.has("item")).toBe(true);
    expect(TRANSFER_EXCLUDED_SOURCE_TYPES.has("village")).toBe(true);
    expect(TRANSFER_EXCLUDED_SOURCE_TYPES.has("ranked")).toBe(true);
  });

  it("keeps every priority tier entry aligned with the polarity classifiers", () => {
    // A typo'd type name in a tier would otherwise silently never match anything.
    for (const type of COPY_PRIORITY_TIERS.flat()) {
      expect(isPositiveUserEffect({ type } as ZodAllTags)).toBe(true);
    }
    for (const type of MIRROR_PRIORITY_TIERS.flat()) {
      expect(isNegativeUserEffect({ type } as ZodAllTags)).toBe(true);
    }
  });
});

describe("selectTransferEffects", () => {
  it("returns [] when cap <= 0", () => {
    expect(selectTransferEffects([makeTransferEffect("shield", 10)], testRank, 0)).toEqual([]);
  });

  it("keeps repeated types ordered by strength", () => {
    const result = selectTransferEffects(
      [makeTransferEffect("shield", 10), makeTransferEffect("shield", 40), makeTransferEffect("shield", 25)], testRank, 4,
    );
    expect(result.map((e) => e.power)).toEqual([40, 25, 10]);
  });

  it("orders equal-power instances deterministically regardless of input order", () => {
    const low = makeTransferEffect("shield", 30, { id: "aaa" });
    const high = makeTransferEffect("shield", 30, { id: "bbb" });
    for (const candidates of [[low, high], [high, low]]) {
      expect(selectTransferEffects(candidates, testRank, 4).map((e) => e.id)).toEqual(["aaa", "bbb"]);
    }
  });

  it("orders by rank then power and applies the cap", () => {
    const result = selectTransferEffects(
      [
        makeTransferEffect("shield", 90), // rank 2
        makeTransferEffect("lifesteal", 10), // rank 1
        makeTransferEffect("increasedamagegiven", 20), // rank 0
        makeTransferEffect("increaseheal", 99), // tail
      ],
      testRank,
      3,
    );
    expect(result.map((e) => e.type)).toEqual([
      "increasedamagegiven",
      "lifesteal",
      "shield",
    ]);
  });

  it("tie-breaks equal rank+power deterministically by id", () => {
    const a = makeTransferEffect("increaseheal", 30, { id: "aaa" });
    const b = makeTransferEffect("increasestat", 30, { id: "bbb" });
    // both tail rank, equal power -> id ascending
    const result = selectTransferEffects([b, a], testRank, 2);
    expect(result.map((e) => e.id)).toEqual(["aaa", "bbb"]);
  });

  it("allows the strongest same-type instances to consume multiple slots", () => {
    const result = selectTransferEffects(
      [
        makeTransferEffect("increasedamagegiven", 50), // rank 0, strongest of its type
        makeTransferEffect("increasedamagegiven", 45), // rank 0, second strongest instance
        makeTransferEffect("lifesteal", 10), // rank 1
      ],
      testRank,
      2,
    );
    expect(result.map((e) => e.type)).toEqual(["increasedamagegiven", "increasedamagegiven"]);
    expect(result[0]?.power).toBe(50);
  });

  it("ranks negated decrease-type effects by magnitude, not signed value", () => {
    // The damage-modifier pass mutates decrease* powers to -|power| in place, and
    // those objects persist in the battle state. |−40| must beat +5 within tier 0.
    const boost = makeTransferEffect("increasedamagegiven", 5, { id: "boost" });
    const reduction = makeTransferEffect("decreasedamagetaken", 40, { id: "reduction" });
    reduction.power = -40;
    const result = selectTransferEffects([boost, reduction], COPY_PRIORITY_RANK, 1);
    expect(result.map((e) => e.id)).toEqual(["reduction"]);
  });

  it("orders negated same-type effects by magnitude", () => {
    const weak = makeTransferEffect("decreasedamagetaken", 5, { id: "weak" });
    weak.power = -5;
    const strong = makeTransferEffect("decreasedamagetaken", 40, { id: "strong" });
    strong.power = -40;
    const result = selectTransferEffects([weak, strong], COPY_PRIORITY_RANK, 4);
    expect(result.map((e) => e.id)).toEqual(["strong", "weak"]);
  });
});

describe("copy tag: ceiling + priority", () => {
  beforeEach(() => {
    // Force the success roll (Math.random() < power/100) to pass.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([90, 100_000])(
    "copies at most 4, keeping absorb ahead of a %i HP shield",
    (shieldPower) => {
      const effects: UserEffect[] = [
        makeTransferEffect("increasedamagegiven", 40),
        makeTransferEffect("decreasedamagetaken", 30),
        makeTransferEffect("lifesteal", 20),
        makeTransferEffect("absorb", 50),
        makeTransferEffect("shield", shieldPower),
        makeTransferEffect("increaseheal", 80),
      ];
      const before = effects.length;
      copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
      const copied = effects.filter(
        (e) => e.targetId === SELF && e.creatorId === SELF && e.fromEffectId,
      );
      expect(copied).toHaveLength(4);
      expect(copied.map((e) => e.type).sort()).toEqual<string[]>(
        ["absorb", "decreasedamagetaken", "increasedamagegiven", "lifesteal"].sort(),
      );
      expect(copied.map((e) => e.type)).not.toContain("shield");
      expect(effects.length).toBe(before + 4);
    },
  );

  it("keeps multiple high-HP shields from displacing absorb and reflect", () => {
    const effects: UserEffect[] = [
      makeTransferEffect("shield", 100_000),
      makeTransferEffect("shield", 90_000),
      makeTransferEffect("shield", 80_000),
      makeTransferEffect("increasedamagegiven", 40),
      makeTransferEffect("lifesteal", 20),
      makeTransferEffect("absorb", 50),
      makeTransferEffect("reflect", 40),
    ];
    copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const copied = effects.filter((e) => e.fromEffectId);
    expect(copied.map((e) => e.type)).toEqual([
      "increasedamagegiven",
      "lifesteal",
      "absorb",
      "reflect",
    ]);
  });

  it("respects the persistent ceiling across casts (already at 4 -> copies nothing)", () => {
    const effects: UserEffect[] = [
      // 4 effects already copied onto SELF
      makeTransferEffect("increasedamagegiven", 40, { id: "c1", targetId: SELF, creatorId: SELF, fromEffectId: "src1" }),
      makeTransferEffect("decreasedamagetaken", 30, { id: "c2", targetId: SELF, creatorId: SELF, fromEffectId: "src2" }),
      makeTransferEffect("lifesteal", 20, { id: "c3", targetId: SELF, creatorId: SELF, fromEffectId: "src3" }),
      makeTransferEffect("absorb", 50, { id: "c4", targetId: SELF, creatorId: SELF, fromEffectId: "src4" }),
      // a fresh copyable buff on the opponent
      makeTransferEffect("shield", 90),
    ];
    const before = effects.length;
    copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before); // nothing added
  });

  it("does not count opponent-created transfers on self against the copy ceiling", () => {
    // 4 copyable-typed, fromEffectId-bearing effects on SELF created by OPP.
    // Without the creatorId scope in the budget filter these would exhaust the
    // ceiling and block the cast; with it, the copy must still succeed.
    const effects: UserEffect[] = [
      makeTransferEffect("increasedamagegiven", 40, { id: "o1", targetId: SELF, creatorId: OPP, fromEffectId: "s1" }),
      makeTransferEffect("decreasedamagetaken", 30, { id: "o2", targetId: SELF, creatorId: OPP, fromEffectId: "s2" }),
      makeTransferEffect("lifesteal", 20, { id: "o3", targetId: SELF, creatorId: OPP, fromEffectId: "s3" }),
      makeTransferEffect("absorb", 50, { id: "o4", targetId: SELF, creatorId: OPP, fromEffectId: "s4" }),
      makeTransferEffect("shield", 90), // fresh copyable buff on the opponent
    ];
    copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const copied = effects.filter(
      (e) => e.targetId === SELF && e.creatorId === SELF && e.fromEffectId,
    );
    expect(copied.map((e) => e.type)).toContain("shield");
  });

  it("does not count non-copyable-typed clones (e.g. mirrors) against the copy ceiling", () => {
    // 4 negative-typed, fromEffectId-bearing effects on SELF that pass the
    // identity checks (targetId/creatorId = SELF). Only the isCopyableEffect
    // scope in the budget filter keeps them from exhausting the ceiling.
    const effects: UserEffect[] = [
      makeTransferEffect("increasedamagetaken", 40, { id: "n1", targetId: SELF, creatorId: SELF, fromEffectId: "s1" }),
      makeTransferEffect("poison", 30, { id: "n2", targetId: SELF, creatorId: SELF, fromEffectId: "s2" }),
      makeTransferEffect("wound", 20, { id: "n3", targetId: SELF, creatorId: SELF, fromEffectId: "s3" }),
      makeTransferEffect("afterburn", 50, { id: "n4", targetId: SELF, creatorId: SELF, fromEffectId: "s4" }),
      makeTransferEffect("shield", 90), // fresh copyable buff on the opponent
    ];
    copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const copied = effects.filter(
      (e) =>
        e.targetId === SELF && e.creatorId === SELF && e.fromEffectId && e.type === "shield",
    );
    expect(copied).toHaveLength(1);
  });

  it("skips buffs from excluded passive sources (bloodline, ranked)", () => {
    const effects: UserEffect[] = [
      makeTransferEffect("increasedamagegiven", 40, { fromType: "bloodline" }),
      makeTransferEffect("decreasedamagetaken", 30, { fromType: "ranked" }),
    ];
    const before = effects.length;
    const res = copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before);
    expect(res?.txt).toContain("no copyable effects");
  });

  it("skips ground-derived buffs (their clones cannot outlive the tile pass)", () => {
    const effects: UserEffect[] = [
      makeTransferEffect("increasedamagegiven", 40, { fromGround: true }),
    ];
    const before = effects.length;
    const res = copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before);
    expect(res?.txt).toContain("no copyable effects");
  });

  it("skips depleted effects (a fully absorbed shield must not burn a slot)", () => {
    const depleted = makeTransferEffect("shield", 10);
    depleted.power = 0; // shield absorbed to zero; rounds still > 0
    const effects: UserEffect[] = [depleted];
    const before = effects.length;
    const res = copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before);
    expect(res?.txt).toContain("no copyable effects");
  });

  it("skips the exact source already actively copied", () => {
    const effects: UserEffect[] = [
      makeTransferEffect("lifesteal", 20, { id: "held", targetId: SELF, creatorId: SELF, fromEffectId: "srcL" }),
      makeTransferEffect("lifesteal", 99, { id: "srcL" }),
    ];
    const before = effects.length;
    copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before); // no new lifesteal copied
  });

  it("reports a no-op when the caster targets itself (self-copy)", () => {
    const effects: UserEffect[] = [
      // A copyable buff sitting on SELF; a self-cast must not clone it.
      makeTransferEffect("increasedamagegiven", 40, { targetId: SELF, creatorId: SELF }),
    ];
    const before = effects.length;
    const res = copy(copyTag(), effects, asUser(SELF, "Self"), asUser(SELF, "Self"));
    expect(res?.txt).toContain("cannot copy effects from themselves");
    expect(effects.filter((e) => e.fromEffectId)).toHaveLength(0);
    expect(effects.length).toBe(before);
  });
});

describe("mirror tag: ceiling + priority + wound", () => {
  beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0));
  afterEach(() => vi.restoreAllMocks());

  it("mirrors at most 4 highest-priority debuffs onto the target", () => {
    const effects: UserEffect[] = [
      selfDebuff("increasedamagetaken", 50),
      selfDebuff("decreasedamagegiven", 40),
      selfDebuff("afterburn", 30),
      selfDebuff("poison", 80),
      selfDebuff("increasepoolcost", 25),
      selfDebuff("wound", 10),
    ];
    mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const mirrored = effects.filter(
      (e) => e.targetId === OPP && e.creatorId === SELF && e.fromEffectId,
    );
    expect(mirrored).toHaveLength(4);
    expect(mirrored.map((e) => e.type).sort()).toEqual<string[]>(
      ["afterburn", "decreasedamagegiven", "increasedamagetaken", "poison"].sort(),
    );
    // increasepoolcost (loses tier-2 tie to poison) and wound (tier 3) dropped
    expect(mirrored.map((e) => e.type)).not.toContain("wound");
  });

  it("mirrors wound when slots are available", () => {
    const effects: UserEffect[] = [selfDebuff("wound", 15)];
    mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const mirrored = effects.filter(
      (e) => e.targetId === OPP && e.creatorId === SELF && e.fromEffectId,
    );
    expect(mirrored.map((e) => e.type)).toContain("wound");
  });

  it("a mirrored wound keeps the source's recorded damage through processing", () => {
    // The wound clone lands with isNew + castThisRound set, and the wound tag
    // recomputes originalDamage from the current action's consequences on first
    // processing. A pure utility mirror deals no damage, so without the carried
    // timeTracker the clone would be permanently inert (0 wound damage).
    const source = selfDebuff("wound", 15, {
      timeTracker: { originalDamage: 120 },
    });
    const effects: UserEffect[] = [source];
    mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const clone = effects.find(
      (e) => e.targetId === OPP && e.creatorId === SELF && e.type === "wound",
    );
    expect(clone?.timeTracker?.originalDamage).toBe(120);
    // First processing pass (no damage consequences) must not zero it out.
    wound(clone!, effects, new Map(), asUser(OPP, "Opp"));
    expect(clone?.timeTracker?.originalDamage).toBe(120);
  });

  it("scales mirrored drain power down by the mirror tag's duration", () => {
    // The divisor is the MIRROR TAG's rounds (mirrorTag() => rounds 3), NOT the
    // source drain's rounds. So the source's own rounds value is irrelevant here.
    const effects: UserEffect[] = [selfDebuff("drain", 40)];
    mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const mirrored = effects.find(
      (e) => e.targetId === OPP && e.creatorId === SELF && e.type === "drain",
    );
    expect(mirrored?.power).toBe(Math.floor(40 / 3)); // floor(40 / mirror-tag-rounds=3) = 13
  });

  it("respects the persistent ceiling across casts (already at 4 -> mirrors nothing)", () => {
    const effects: UserEffect[] = [
      // 4 active mirrors by SELF on OPP
      selfDebuff("increasedamagetaken", 50, { id: "m1", targetId: OPP, creatorId: SELF, fromEffectId: "s1" }),
      selfDebuff("decreasedamagegiven", 40, { id: "m2", targetId: OPP, creatorId: SELF, fromEffectId: "s2" }),
      selfDebuff("poison", 30, { id: "m3", targetId: OPP, creatorId: SELF, fromEffectId: "s3" }),
      selfDebuff("wound", 20, { id: "m4", targetId: OPP, creatorId: SELF, fromEffectId: "s4" }),
      // a fresh mirrorable debuff on SELF
      selfDebuff("afterburn", 60),
    ];
    const before = effects.length;
    const res = mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before); // nothing added
    expect(res?.txt).toContain("maximum mirrored");
  });

  it("does not count opponent-created transfers on the target against the mirror ceiling", () => {
    // 4 mirrorable-typed, fromEffectId-bearing effects on OPP created by OPP.
    // Without the creatorId scope these would exhaust this caster's budget;
    // with it, the mirror must still succeed.
    const effects: UserEffect[] = [
      selfDebuff("increasedamagetaken", 50, { id: "o1", targetId: OPP, creatorId: OPP, fromEffectId: "s1" }),
      selfDebuff("decreasedamagegiven", 40, { id: "o2", targetId: OPP, creatorId: OPP, fromEffectId: "s2" }),
      selfDebuff("poison", 30, { id: "o3", targetId: OPP, creatorId: OPP, fromEffectId: "s3" }),
      selfDebuff("wound", 20, { id: "o4", targetId: OPP, creatorId: OPP, fromEffectId: "s4" }),
      selfDebuff("afterburn", 60), // fresh mirrorable debuff on SELF
    ];
    mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const mirrored = effects.filter(
      (e) => e.targetId === OPP && e.creatorId === SELF && e.fromEffectId,
    );
    expect(mirrored.map((e) => e.type)).toContain("afterburn");
  });

  it("skips the exact source already actively mirrored", () => {
    const effects: UserEffect[] = [
      selfDebuff("poison", 20, { id: "held", targetId: OPP, creatorId: SELF, fromEffectId: "srcP" }),
      selfDebuff("poison", 99, { id: "srcP" }),
    ];
    const before = effects.length;
    mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before); // no new poison mirrored
  });

  it("skips excluded effect types (damage) even when negative and active", () => {
    const effects: UserEffect[] = [selfDebuff("damage", 40)];
    const before = effects.length;
    const res = mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before);
    expect(res?.txt).toContain("no negative effects to reflect");
  });

  it("ranks drain by delivered (duration-scaled) power when competing for a slot", () => {
    const effects: UserEffect[] = [
      // 3 active mirrors leave exactly one open slot
      selfDebuff("increasedamagetaken", 50, { id: "m1", targetId: OPP, creatorId: SELF, fromEffectId: "s1" }),
      selfDebuff("decreasedamagegiven", 40, { id: "m2", targetId: OPP, creatorId: SELF, fromEffectId: "s2" }),
      selfDebuff("afterburn", 30, { id: "m3", targetId: OPP, creatorId: SELF, fromEffectId: "s3" }),
      // both tail-tier: drain delivers floor(60 / mirror-rounds=3) = 20 < 50
      selfDebuff("drain", 60),
      selfDebuff("decreasestat", 50),
    ];
    const seeded = new Set(["s1", "s2", "s3"]);
    mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const newMirrors = effects.filter(
      (e) =>
        e.targetId === OPP &&
        e.creatorId === SELF &&
        e.fromEffectId &&
        !seeded.has(e.fromEffectId),
    );
    expect(newMirrors.map((e) => e.type)).toEqual(["decreasestat"]);
  });

  it("reports a no-op when the caster targets itself (self-mirror)", () => {
    const effects: UserEffect[] = [selfDebuff("increasedamagetaken", 50)];
    const before = effects.length;
    const res = mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(SELF, "Self"));
    expect(res?.txt).toContain("cannot mirror effects onto themselves");
    expect(effects.filter((e) => e.fromEffectId)).toHaveLength(0);
    expect(effects.length).toBe(before);
  });
});

describe("transfer instances across casts", () => {
  beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0));
  afterEach(() => vi.restoreAllMocks());

  it.each(["copy", "mirror"] as ("copy" | "mirror")[])("%s transfers four strongest instances and refills expired slots", (type) => {
    const transfer = type === "copy" ? copy : mirror;
    const source = type === "copy" ? makeTransferEffect : selfDebuff;
    const tagType = type === "copy" ? "increasedamagegiven" : "increasedamagetaken";
    const landingId = type === "copy" ? SELF : OPP;
    const sources = [10, 50, 20, 40, 30].map((power) => source(tagType, power));
    const effects = [...sources];
    const clones = () => effects.filter((e) => e.targetId === landingId && e.creatorId === SELF && e.fromEffectId);
    const cast = () => transfer(transferTag(type), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    cast();
    expect(clones().map((e) => e.power)).toEqual([50, 40, 30, 20]);
    expect(clones().map((e) => e.fromEffectId)).toEqual([sources[1]!.id, sources[3]!.id, sources[4]!.id, sources[2]!.id]);
    cast();
    expect(clones()).toHaveLength(4);
    clones()[0]!.rounds = 0;
    cast();
    const active = clones().filter((e) => e.rounds! > 0);
    expect(active).toHaveLength(4);
    expect(active.map((e) => e.power)).toEqual([40, 30, 20, 50]);
    expect(sources.map((e) => e.power)).toEqual([10, 50, 20, 40, 30]);
  });

  it.each(["copy", "mirror"] as ("copy" | "mirror")[])("%s fills remaining slots with new sources of a held type", (type) => {
    const source = type === "copy" ? makeTransferEffect : selfDebuff;
    const tagType = type === "copy" ? "increasedamagegiven" : "increasedamagetaken";
    const effects = [source(tagType, 10), source(tagType, 20)];
    const transfer = type === "copy" ? copy : mirror;
    transfer(transferTag(type), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    effects.push(source(tagType, 30), source(tagType, 40), source(tagType, 50));
    transfer(transferTag(type), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.filter((e) => e.fromEffectId).map((e) => e.power)).toEqual([20, 10, 50, 40]);
  });
});
