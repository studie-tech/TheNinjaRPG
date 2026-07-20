import { describe, expect, it } from "vitest";
import {
  COPYABLE_EFFECT_TYPES,
  COPY_MAX_TAGS,
  COPY_PRIORITY_RANK,
  MIRROR_MAX_TAGS,
  MIRROR_PRIORITY_RANK,
  TRANSFER_EXCLUDED_SOURCE_TYPES,
} from "@/drizzle/constants";

describe("copy/mirror priority constants", () => {
  it("caps are both 4", () => {
    expect(COPY_MAX_TAGS).toBe(4);
    expect(MIRROR_MAX_TAGS).toBe(4);
  });

  it("copyable set is exactly the 8 expanded positive types", () => {
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
    // absorb and reflect share a tier
    expect(COPY_PRIORITY_RANK.get("absorb")).toBe(COPY_PRIORITY_RANK.get("reflect"));
  });

  it("mirror ranks put IDT/DDG at tier 0 and wound below poison", () => {
    expect(MIRROR_PRIORITY_RANK.get("increasedamagetaken")).toBe(0);
    expect(MIRROR_PRIORITY_RANK.get("decreasedamagegiven")).toBe(0);
    expect(MIRROR_PRIORITY_RANK.get("afterburn")).toBe(1);
    expect(MIRROR_PRIORITY_RANK.get("poison")).toBe(2);
    expect(MIRROR_PRIORITY_RANK.get("increasepoolcost")).toBe(2);
    expect(MIRROR_PRIORITY_RANK.get("wound")).toBe(3);
    // an unranked negative type is absent (helper supplies the tail fallback)
    expect(MIRROR_PRIORITY_RANK.get("weakness")).toBeUndefined();
  });

  it("shared source excludes cover gear/passive origins", () => {
    expect(TRANSFER_EXCLUDED_SOURCE_TYPES).toContain("bloodline");
    expect(TRANSFER_EXCLUDED_SOURCE_TYPES).toContain("item");
    expect(TRANSFER_EXCLUDED_SOURCE_TYPES).toContain("village");
  });
});

import { selectTransferEffects } from "@/libs/combat/util";
import { makeEffect } from "./helpers/battleScenario";
import type { UserEffect } from "@/libs/combat/types";

// Minimal transfer candidate. makeEffect parses through the real tag schema and
// applies defaults; we override power/calculation/rounds + runtime identity.
const cand = (
  type: string,
  power: number,
  overrides: Partial<UserEffect> = {},
): UserEffect =>
  makeEffect(
    type as Parameters<typeof makeEffect>[0],
    {
      power,
      // NOTE: do NOT force `calculation` here. `BaseAttributes.calculation`
      // defaults to z.enum(["static"]); types like `shield` never override it, so
      // passing "percentage" is a Zod parse error. Let each schema default. Tests
      // assert on `power`/`type`/order only, and getPower ordering is unaffected
      // (level:0, all powers <= 100 so no percentage clamp differs).
      rounds: 5,
      statTypes: ["Ninjutsu"],
      generalTypes: [],
      elements: [],
    } as never,
    {
      id: `${type}-${power}`,
      targetId: "opp",
      creatorId: "opp",
      level: 0,
      isNew: true,
      castThisRound: true,
      createdRound: 1,
      ...overrides,
    },
  );

// Simple injected rank: increasedamagegiven=0, lifesteal=1, shield=2, else tail.
const testRank = (type: string): number => {
  const map: Record<string, number> = {
    increasedamagegiven: 0,
    lifesteal: 1,
    shield: 2,
  };
  return map[type] ?? Number.MAX_SAFE_INTEGER;
};

describe("selectTransferEffects", () => {
  it("returns [] when cap <= 0", () => {
    expect(selectTransferEffects([cand("shield", 10)], testRank, 0)).toEqual([]);
  });

  it("dedupes by type, keeping the highest-power effect per type", () => {
    const result = selectTransferEffects(
      [cand("shield", 10), cand("shield", 40), cand("shield", 25)],
      testRank,
      4,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("shield");
    expect(result[0]?.power).toBe(40);
  });

  it("dedupes equal-power same-type effects by lower id, independent of input order", () => {
    // Same type + equal power but distinct identity. The dedup survivor must be the
    // lower id in BOTH orders, so which source's clone is transferred is deterministic.
    // (The final sort's id tie-break only orders survivors — it cannot pick which of
    // two equal-power same-type effects the dedup keeps.)
    const lowId = cand("shield", 30, { id: "shield-aaa" });
    const highId = cand("shield", 30, { id: "shield-bbb" });
    const forward = selectTransferEffects([lowId, highId], testRank, 4);
    const reversed = selectTransferEffects([highId, lowId], testRank, 4);
    expect(forward).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(forward[0]?.id).toBe("shield-aaa");
    expect(reversed[0]?.id).toBe("shield-aaa");
  });

  it("orders by rank then power and applies the cap", () => {
    const result = selectTransferEffects(
      [
        cand("shield", 90), // rank 2
        cand("lifesteal", 10), // rank 1
        cand("increasedamagegiven", 20), // rank 0
        cand("increaseheal", 99), // tail
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
    const a = cand("increaseheal", 30, { id: "aaa" });
    const b = cand("increasestat", 30, { id: "bbb" });
    // both tail rank, equal power -> id ascending
    const result = selectTransferEffects([b, a], testRank, 2);
    expect(result.map((e) => e.id)).toEqual(["aaa", "bbb"]);
  });

  it("dedupes before capping so one type cannot consume two slots", () => {
    const result = selectTransferEffects(
      [
        cand("increasedamagegiven", 50), // rank 0, strongest of its type
        cand("increasedamagegiven", 45), // rank 0 duplicate — must not take a slot
        cand("lifesteal", 10), // rank 1
      ],
      testRank,
      2,
    );
    expect(result.map((e) => e.type)).toEqual(["increasedamagegiven", "lifesteal"]);
    expect(result[0]?.power).toBe(50);
  });
});

import { afterEach, beforeEach, vi } from "vitest";
import { copy, mirror } from "@/libs/combat/tags";
import type { BattleUserState } from "@/libs/combat/types";

const SELF = "self-1";
const OPP = "opp-1";
const asUser = (userId: string, username: string) =>
  ({ userId, username }) as BattleUserState;

// A positive effect ON the opponent (copy source).
const oppBuff = (
  type: string,
  power: number,
  overrides: Partial<UserEffect> = {},
): UserEffect =>
  makeEffect(
    type as Parameters<typeof makeEffect>[0],
    {
      power,
      // NOTE: do NOT force `calculation` here. `BaseAttributes.calculation`
      // defaults to z.enum(["static"]); types like `shield` never override it, so
      // passing "percentage" is a Zod parse error. Let each schema default. Tests
      // assert on `power`/`type`/order only, and getPower ordering is unaffected
      // (level:0, all powers <= 100 so no percentage clamp differs).
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

// The copy tag effect itself (cast by SELF onto OPP).
const copyTag = (): UserEffect =>
  makeEffect(
    "copy",
    { power: 100, rounds: 3, calculation: "percentage" } as never,
    {
      id: "copy-tag",
      targetId: OPP,
      creatorId: SELF,
      level: 0,
      isNew: true,
      castThisRound: true,
      createdRound: 1,
    },
  );

describe("copy tag: ceiling + priority", () => {
  beforeEach(() => {
    // Force the success roll (Math.random() < power/100) to pass.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => vi.restoreAllMocks());

  it("copies at most 4, one per type, highest-priority first", () => {
    const effects: UserEffect[] = [
      oppBuff("increasedamagegiven", 40),
      oppBuff("decreasedamagetaken", 30),
      oppBuff("lifesteal", 20),
      oppBuff("absorb", 50),
      oppBuff("shield", 90),
      oppBuff("increaseheal", 80),
    ];
    const before = effects.length;
    copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const copied = effects.filter((e) => e.targetId === SELF && e.creatorId === SELF && e.fromEffectId);
    expect(copied).toHaveLength(4);
    expect(copied.map((e) => e.type).sort()).toEqual(
      ["absorb", "decreasedamagetaken", "increasedamagegiven", "lifesteal"].sort(),
    );
    // shield + increaseheal (lower tiers) were NOT copied
    expect(copied.map((e) => e.type)).not.toContain("shield");
    expect(effects.length).toBe(before + 4);
  });

  it("respects the persistent ceiling across casts (already at 4 -> copies nothing)", () => {
    const effects: UserEffect[] = [
      // 4 effects already copied onto SELF
      oppBuff("increasedamagegiven", 40, { id: "c1", targetId: SELF, creatorId: SELF, fromEffectId: "src1" }),
      oppBuff("decreasedamagetaken", 30, { id: "c2", targetId: SELF, creatorId: SELF, fromEffectId: "src2" }),
      oppBuff("lifesteal", 20, { id: "c3", targetId: SELF, creatorId: SELF, fromEffectId: "src3" }),
      oppBuff("absorb", 50, { id: "c4", targetId: SELF, creatorId: SELF, fromEffectId: "src4" }),
      // a fresh copyable buff on the opponent
      oppBuff("shield", 90),
    ];
    const before = effects.length;
    copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before); // nothing added
  });

  it("does not count an opponent's mirror on self against the copy ceiling", () => {
    const effects: UserEffect[] = [
      // opponent mirrored a debuff onto SELF (creatorId = OPP) -> must NOT count
      oppBuff("increasedamagetaken", 50, { id: "m1", targetId: SELF, creatorId: OPP, fromEffectId: "srcM" }),
      oppBuff("increasedamagegiven", 40), // copyable buff on opponent
    ];
    copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const copied = effects.filter((e) => e.targetId === SELF && e.creatorId === SELF && e.fromEffectId);
    expect(copied.map((e) => e.type)).toContain("increasedamagegiven");
  });

  it("skips a type already actively copied (unique per type across casts)", () => {
    const effects: UserEffect[] = [
      oppBuff("lifesteal", 20, { id: "held", targetId: SELF, creatorId: SELF, fromEffectId: "srcL" }),
      oppBuff("lifesteal", 99), // stronger, but type already held -> skipped
    ];
    const before = effects.length;
    copy(copyTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    expect(effects.length).toBe(before); // no new lifesteal copied
  });

  it("is a no-op when the caster targets itself (self-copy)", () => {
    const effects: UserEffect[] = [
      // A copyable buff sitting on SELF; a self-cast must not clone it.
      oppBuff("increasedamagegiven", 40, { targetId: SELF, creatorId: SELF }),
    ];
    const before = effects.length;
    const res = copy(copyTag(), effects, asUser(SELF, "Self"), asUser(SELF, "Self"));
    expect(res).toBeUndefined();
    expect(effects.filter((e) => e.fromEffectId)).toHaveLength(0);
    expect(effects.length).toBe(before);
  });
});

// A negative effect ON self (mirror source). username-less users reused from copy tests.
const selfDebuff = (
  type: string,
  power: number,
  overrides: Partial<UserEffect> = {},
): UserEffect =>
  makeEffect(
    type as Parameters<typeof makeEffect>[0],
    {
      power,
      // NOTE: do NOT force `calculation` here. `BaseAttributes.calculation`
      // defaults to z.enum(["static"]); types like `shield` never override it, so
      // passing "percentage" is a Zod parse error. Let each schema default. Tests
      // assert on `power`/`type`/order only, and getPower ordering is unaffected
      // (level:0, all powers <= 100 so no percentage clamp differs).
      rounds: 5,
      statTypes: ["Ninjutsu"],
      generalTypes: [],
      elements: [],
    } as never,
    {
      id: `${type}-${power}`,
      targetId: SELF,
      creatorId: OPP,
      level: 0,
      isNew: true,
      castThisRound: true,
      createdRound: 1,
      ...overrides,
    },
  );

const mirrorTag = (): UserEffect =>
  makeEffect(
    "mirror",
    { power: 100, rounds: 3, calculation: "percentage" } as never,
    {
      id: "mirror-tag",
      targetId: OPP,
      creatorId: SELF,
      level: 0,
      isNew: true,
      castThisRound: true,
      createdRound: 1,
    },
  );

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
    const mirrored = effects.filter((e) => e.targetId === OPP && e.creatorId === SELF && e.fromEffectId);
    expect(mirrored).toHaveLength(4);
    expect(mirrored.map((e) => e.type).sort()).toEqual(
      ["afterburn", "decreasedamagegiven", "increasedamagetaken", "poison"].sort(),
    );
    // increasepoolcost (loses tier-2 tie to poison) and wound (tier 3) dropped
    expect(mirrored.map((e) => e.type)).not.toContain("wound");
  });

  it("now mirrors wound (previously excluded) when slots are available", () => {
    const effects: UserEffect[] = [selfDebuff("wound", 15)];
    mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const mirrored = effects.filter((e) => e.targetId === OPP && e.creatorId === SELF && e.fromEffectId);
    expect(mirrored.map((e) => e.type)).toContain("wound");
  });

  it("scales mirrored drain power down by the mirror tag's duration", () => {
    // The divisor is the MIRROR TAG's rounds (mirrorTag() => rounds 3), NOT the
    // source drain's rounds. So the source's own rounds value is irrelevant here.
    const effects: UserEffect[] = [selfDebuff("drain", 40)];
    mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(OPP, "Opp"));
    const mirrored = effects.find((e) => e.targetId === OPP && e.creatorId === SELF && e.type === "drain");
    expect(mirrored?.power).toBe(Math.floor(40 / 3)); // floor(40 / mirror-tag-rounds=3) = 13
  });

  it("is a no-op when the caster targets itself (self-mirror)", () => {
    const effects: UserEffect[] = [selfDebuff("increasedamagetaken", 50)];
    const before = effects.length;
    const res = mirror(mirrorTag(), effects, asUser(SELF, "Self"), asUser(SELF, "Self"));
    expect(res).toBeUndefined();
    expect(effects.filter((e) => e.fromEffectId)).toHaveLength(0);
    expect(effects.length).toBe(before);
  });
});
