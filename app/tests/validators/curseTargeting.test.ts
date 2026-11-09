import { describe, expect, it } from "bun:test";
import {
  CurseTag,
  ItemValidator,
  JutsuValidator,
  JutsuValidatorRawSchema,
} from "@/validators/combat";
import { coordinateTargetingSchema } from "@/validators/coordinateTargeting";

const base = {
  name: "Curse",
  image: "curse.webp",
  description: "Stores healing until expiration",
  battleDescription: "%user curses %target",
  hidden: false,
  target: "CHARACTER",
  method: "SINGLE",
  range: 3,
  chakraCost: 0,
  healthCost: 0,
  staminaCost: 0,
  healthCostReducePerLvl: 0,
  chakraCostReducePerLvl: 0,
  staminaCostReducePerLvl: 0,
  actionCostPerc: 100,
  cooldown: 0,
  bloodlineId: null,
  effects: [CurseTag.parse({ power: 50, rounds: 3 })],
};
const jutsu = {
  ...base,
  extraBaseCost: 0,
  jutsuWeapon: "NONE",
  jutsuType: "NORMAL",
  jutsuRank: "D",
  requiredRank: "STUDENT",
  requiredLevel: 1,
  requiredBloodlineItemId: null,
  villageId: null,
};
const item = {
  ...base,
  itemType: "CONSUMABLE",
  destroyOnUse: true,
  rarity: "COMMON",
  slot: "NONE",
  weaponType: "NONE",
  stackSize: 1,
  maxDurability: 100,
  maxImbueNumber: 1,
  maxEquips: 0,
  cost: 1,
  repsCost: 0,
  seichiSilverCost: 0,
  expireFromStoreAt: null,
  farmYieldItemId: null,
  farmExtractSeedItemId: null,
  crystalTargetTypes: null,
};
const coordinateTargeting = coordinateTargetingSchema.parse({
  origin: "BATTLEFIELD",
  selection: "ALL",
  coordinates: [{ longitude: 1, latitude: 1 }],
});

describe.each([
  ["jutsu", JutsuValidator, jutsu],
  ["item", ItemValidator, item],
] as const)("Curse targeting on %s", (_name, validator, content) => {
  it("accepts direct user targeting", () => {
    expect(validator.safeParse(content).success).toBe(true);
  });

  it.each(["GROUND", "EMPTY_GROUND"] as const)(
    "rejects inherited %s targeting and allows an explicit self override",
    (target) => {
      for (const tagTarget of [undefined, "INHERIT"] as const) {
        const result = validator.safeParse({
          ...content,
          target,
          effects: [CurseTag.parse({ target: tagTarget })],
        });
        expect(result.success).toBe(false);
        if (!result.success)
          expect(
            result.error.issues.some(
              (issue) => issue.path.join(".") === "effects.0.target",
            ),
          ).toBe(true);
      }
      expect(
        validator.safeParse({
          ...content,
          target,
          effects: [CurseTag.parse({ target: "SELF" })],
        }).success,
      ).toBe(true);
    },
  );

  it("rejects a coordinate Curse tag even when its parent targets users", () => {
    const result = validator.safeParse({
      ...content,
      effects: [CurseTag.parse({ target: "COORDINATES", coordinateTargeting })],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.some(
          (issue) => issue.path.join(".") === "effects.0.target",
        ),
      ).toBe(true);
  });

  it("accepts a coordinate method that applies Curse to users", () => {
    expect(
      validator.safeParse({
        ...content,
        method: "COORDINATES",
        coordinateTargeting,
      }).success,
    ).toBe(true);
  });
});

it("rejects coordinate Curse in the shared effects validator", () => {
  const effects = JutsuValidatorRawSchema.shape.effects;
  expect(
    effects.safeParse([CurseTag.parse({ target: "COORDINATES", coordinateTargeting })])
      .success,
  ).toBe(false);
  expect(effects.safeParse([CurseTag.parse({ target: "SELF" })]).success).toBe(true);
});
