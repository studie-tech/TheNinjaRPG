import { describe, expect, it } from "bun:test";
import {
  DamageTag,
  DecreaseCookingTime,
  IncreaseRegenerationTag,
  IncreaseStatTag,
  ItemValidator,
} from "@/validators/combat";
import { MEAL_ITEM_DEFAULTS } from "@/validators/cooking";
import { validItemInput } from "../setup/items";

const validItem = validItemInput();

const meal = {
  ...validItem,
  ...MEAL_ITEM_DEFAULTS,
  itemType: "MEAL",
  canBeCrafted: true,
  effects: [IncreaseStatTag.parse({ statTypes: ["Ninjutsu"], power: 10 })],
  craftingRequirements: [{ ids: ["rice"], number: 2 }],
};
describe("meal configuration", () => {
  it("rejects activity bonuses on temporary meals and consumable grants", () => {
    expect(
      ItemValidator.safeParse({
        ...meal,
        effects: [DecreaseCookingTime.parse({ power: 10 })],
      }).success,
    ).toBe(false);
    expect(
      ItemValidator.safeParse({
        ...validItem,
        itemType: "CONSUMABLE",
        destroyOnUse: true,
        effects: [DecreaseCookingTime.parse({ power: 10 })],
      }).success,
    ).toBe(false);
  });
  it("accepts other tags and their configurable fields", () => {
    expect(
      ItemValidator.safeParse({
        ...meal,
        effects: [
          DamageTag.parse({
            power: 10,
            rounds: 3,
            powerPerLevel: 0.1,
            elements: ["Fire"],
          }),
        ],
      }).success,
    ).toBe(true);
  });
  it("requires exactly one effect", () => {
    expect(ItemValidator.safeParse({ ...meal, effects: [] }).success).toBe(false);
    expect(
      ItemValidator.safeParse({ ...meal, effects: [...meal.effects, ...meal.effects] })
        .success,
    ).toBe(false);
  });
  it("accepts a consumable combat-stat recipe and regeneration recipe", () => {
    expect(ItemValidator.safeParse(meal).success).toBe(true);
    expect(
      ItemValidator.safeParse({
        ...meal,
        effects: [IncreaseRegenerationTag.parse({ power: 10 })],
      }).success,
    ).toBe(true);
  });
  it.each([0, -1, 1.5])("rejects ingredient quantity %s", (number) => {
    expect(
      ItemValidator.safeParse({
        ...meal,
        craftingRequirements: [{ ids: ["rice"], number }],
      }).success,
    ).toBe(false);
  });
  it.each([0, -1, 1.5])("rejects effect duration %s", (mealDurationSeconds) => {
    expect(ItemValidator.safeParse({ ...meal, mealDurationSeconds }).success).toBe(
      false,
    );
  });
  it("rejects empty and duplicate recipes, combat actions, equipment", () => {
    for (const patch of [
      { craftingRequirements: [] },
      { craftingRequirements: [{ ids: [], number: 1 }] },
      { craftingRequirements: [{ ids: ["rice", "rice"], number: 1 }] },
      { destroyOnUse: false },
      { preventBattleUsage: false },
      { slot: "HEAD" },
    ])
      expect(ItemValidator.safeParse({ ...meal, ...patch }).success).toBe(false);
  });
});
