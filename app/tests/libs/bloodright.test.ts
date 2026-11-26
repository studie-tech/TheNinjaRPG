import { describe, expect, it } from "bun:test";
import type { BloodrightOption, Jutsu } from "@/drizzle/schema";
import {
  applyBloodrightChanges,
  bloodrightNumericFields,
  buildBloodrightChanges,
  inheritBloodrightChanges,
  isBloodrightCurrent,
  normalizeBloodrightTag,
  validateBloodrightSelection,
} from "@/libs/bloodrightEffects";
import { userJutsuToAction } from "@/libs/combat/actions";
import type { BattleUserJutsu, CompleteBattle } from "@/libs/combat/types";
import type { BloodrightChange } from "@/validators/bloodright";
import { bloodrightOptionSchema } from "@/validators/bloodright";
import type { ZodAllTags } from "@/validators/combat";
import { DamageTag, HealTag, StunTag } from "@/validators/combat";

const damage = DamageTag.parse({ power: 20 });
const change = (patch: Partial<BloodrightChange> = {}): BloodrightChange => ({
  tagIndex: 0,
  tag: damage,
  field: "power",
  mode: "FLAT",
  value: 5,
  ...patch,
});
const identity = (
  id: string,
  parentJutsuId: string | null = null,
  reskinParentJutsuId: string | null = null,
) => ({ id, parentJutsuId, reskinParentJutsuId });
const source = { ...identity("source"), effects: [damage] };
const option = {
  id: "option",
  jutsuId: "source",
  changes: [change()],
  jutsu: source,
} as BloodrightOption & { jutsu: Jutsu };

describe("jutsu-specific Bloodright", () => {
  it("normalizes schema defaults in historical source and evolved tags", () => {
    const raw = { type: "damage", power: 20 } as unknown as ZodAllTags;
    const parsed = bloodrightOptionSchema.parse({
      bloodlineId: "line",
      jutsuId: "source",
      name: "Option",
      description: "",
      seichiSilverCost: 1,
      hidden: false,
      changes: [change({ tag: raw })],
    });
    expect(isBloodrightCurrent(parsed.changes, [raw])).toBe(true);
    expect(bloodrightNumericFields(normalizeBloodrightTag(raw))).toContain(
      "animationScale",
    );
    const evolved = { ...identity("evolved", "source"), effects: [raw] };
    const result = buildBloodrightChanges(
      [evolved],
      [{ ...option, ...parsed, jutsu: { effects: [raw] } }],
      [source, evolved],
    );
    expect(
      applyBloodrightChanges(evolved.effects, result.evolved ?? [])?.[0],
    ).toMatchObject({ power: 25 });
  });
  it("stacks flat increases before summed percentages without mutating shared tags", () => {
    const effects = applyBloodrightChanges(
      [damage],
      [
        change(),
        change({ mode: "PERCENT", value: 20 }),
        change({ mode: "PERCENT", value: 40 }),
      ],
    );
    expect(effects?.[0]).toMatchObject({ power: 40 });
    expect(damage.power).toBe(20);
  });
  it("exposes every numeric field and rejects nonnumeric/prototype paths", () => {
    expect(
      bloodrightNumericFields({
        power: 20,
        nested: { values: [1, 2] },
        type: "damage",
      }),
    ).toEqual(["power", "nested.values.0", "nested.values.1"]);
    for (const field of [
      "type",
      "__proto__.power",
      "constructor.prototype.power",
      "missing",
    ])
      expect(applyBloodrightChanges([damage], [change({ field })])).toBeNull();
  });
  it("rejects increases outside tag limits and nonfinite results", () => {
    const stun = StunTag.parse({ rounds: 1 });
    expect(
      applyBloodrightChanges(
        [stun],
        [change({ tag: stun, field: "rounds", value: 0.5 })],
      ),
    ).toBeNull();
    expect(
      applyBloodrightChanges(
        [damage],
        [change({ value: Number.MAX_VALUE }), change({ value: Number.MAX_VALUE })],
      ),
    ).toBeNull();
  });
  it("detects edited and reordered source tags, including repeated tag types", () => {
    expect(isBloodrightCurrent([change()], [damage])).toBe(true);
    expect(isBloodrightCurrent([change()], [DamageTag.parse({ power: 30 })])).toBe(
      false,
    );
    expect(isBloodrightCurrent([change()], [HealTag.parse({}), damage])).toBe(false);
    expect(
      isBloodrightCurrent([change()], [DamageTag.parse({ power: 10 }), damage]),
    ).toBe(false);
  });
  it("follows evolutions and mechanics variants and leaves unrelated jutsu alone", () => {
    const evolved = {
      ...identity("evolved", "source"),
      effects: [HealTag.parse({}), DamageTag.parse({ power: 30 })],
    };
    const variant = {
      ...identity("variant", null, "evolved"),
      effects: evolved.effects,
    };
    const other = { ...identity("other"), effects: [damage] };
    const result = buildBloodrightChanges(
      [source, evolved, variant, other],
      [option],
      [source, evolved, variant, other],
    );
    expect(
      applyBloodrightChanges(source.effects, result.source ?? [])?.[0],
    ).toMatchObject({ power: 25 });
    expect(
      applyBloodrightChanges(evolved.effects, result.evolved ?? [])?.[1],
    ).toMatchObject({ power: 35 });
    expect(
      applyBloodrightChanges(variant.effects, result.variant ?? [])?.[1],
    ).toMatchObject({ power: 35 });
    expect(result.other).toBeUndefined();
  });
  it("does not guess which duplicate descendant tag is the intended target", () => {
    expect(
      inheritBloodrightChanges(
        "source",
        { id: "evolved", effects: [damage, DamageTag.parse({ power: 40 })] },
        [change()],
      ),
    ).toBeNull();
  });
  it("rejects a same-ID catalog snapshot changed between initiation reads", () => {
    const changed = { ...source, effects: [DamageTag.parse({ power: 30 })] };
    expect(inheritBloodrightChanges("source", changed, [change()])).toBeNull();
    expect(buildBloodrightChanges([source, changed], [option], [source])).toEqual({});
    expect(
      buildBloodrightChanges([changed, source], [option], [source]),
    ).toHaveProperty("source");
  });
  it("validates combined ancestor and descendant choices", () => {
    const tag = StunTag.parse({ rounds: 80 });
    const root = { ...identity("root"), effects: [tag] };
    const evolved = { ...identity("evolved", "root"), effects: [tag] };
    const makeOption = (jutsu: typeof root) => ({
      ...option,
      jutsuId: jutsu.id,
      jutsu,
      changes: [change({ tag, field: "rounds", value: 15 })],
    });
    expect(
      validateBloodrightSelection([root, evolved], [makeOption(root)], [root, evolved]),
    ).toBe(true);
    expect(
      validateBloodrightSelection(
        [root, evolved],
        [makeOption(root), makeOption(evolved)],
        [root, evolved],
      ),
    ).toBe(false);
  });
  it("resolves purchases per actor and retains cosmetic reskins", () => {
    const base = {
      ...source,
      bloodlineId: "line",
      name: "Jutsu",
      image: "base",
      battleDescription: "cast",
    } as Jutsu;
    const linked = {
      ...base,
      id: "cosmetic",
      reskinParentJutsuId: base.id,
      name: "Cosmetic",
      effects: [DamageTag.parse({ power: 999, staticAnimation: "cosmetic" })],
    };
    const battle = {
      extraState: {
        jutsus: { source: base, cosmetic: linked },
        bloodrightChanges: {
          owner: buildBloodrightChanges([base], [option], [source]),
        },
      },
    } as unknown as CompleteBattle;
    const owned = {
      jutsuId: "source",
      linkedReskinId: "cosmetic",
      level: 1,
    } as BattleUserJutsu;
    expect(userJutsuToAction(owned, battle, "owner").effects[0]).toMatchObject({
      power: 25,
      staticAnimation: "cosmetic",
    });
    expect(userJutsuToAction(owned, battle, "enemy").effects[0]).toMatchObject({
      power: 20,
    });
    expect(base.effects[0]).toMatchObject({ power: 20 });
    battle.extraState.bloodrightChanges!.owner = buildBloodrightChanges(
      [base],
      [{ ...option, changes: [change({ field: "animationScale", value: 1 })] }],
      [source],
    );
    expect(userJutsuToAction(owned, battle, "owner").effects[0]).toMatchObject({
      animationScale: 2,
      staticAnimation: "cosmetic",
    });
    delete battle.extraState.bloodrightChanges;
    expect(userJutsuToAction(owned, battle, "owner").effects[0]).toMatchObject({
      power: 20,
    });
  });
});
