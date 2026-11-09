import { describe, expect, it } from "bun:test";
import {
  getCookingExperience,
  getCookingLevel,
  getCookingRank,
  getCookingSeconds,
} from "@/libs/cooking";
import {
  getInventoryBucket,
  getHomeStorageBucket,
  nonCombatConsume,
  isEquippableUserItem,
  getEquipBlockReason,
  canEquipAdditional,
} from "@/libs/item";
import type { Item, UserData } from "@/drizzle/schema";

describe("Cooking progression", () => {
  it.each([
    [0, 1, "Apprentice Cook"],
    [150000, 25, "Chef"],
    [612500, 50, "1 Star Master Chef"],
    [1387500, 75, "2 Star Master Chef"],
    [3244500, 100, "3 Star Master Chef"],
  ])("maps %s XP to the Farming level and Cooking rank", (experience, level, title) => {
    expect(getCookingLevel(Number(experience))).toBe(Number(level));
    expect(getCookingRank(Number(experience)).title as string).toBe(String(title));
    if (Number(experience) > 0)
      expect(getCookingLevel(Number(experience) - 1)).toBe(Number(level) - 1);
  });
  it("times each output meal, with shrine bonuses increasing the duration", () => {
    expect(
      getCookingSeconds({ cookingTimeSeconds: 60, cookingOutputQuantity: 3 }, 2, 0.1),
    ).toBe(396);
  });
  it("floors the XP of a whole job, with the Territory War boost as a fraction", () => {
    expect(getCookingExperience(7, 3)).toBe(21);
    expect(getCookingExperience(7, 3, 0.25)).toBe(26);
  });
  it("stores Meals in cooking and makes them edible outside battle", () => {
    const item = { itemType: "MEAL", isEventItem: true } as Item;
    expect(getInventoryBucket(item)).toBe("cooking");
    expect(getHomeStorageBucket(item)).toBe("cooking");
    expect(nonCombatConsume(item, {} as UserData)).toBe(true);
    const owned = {
      item,
      storedAtHome: false,
      isInAuction: false,
      craftingFinishedAt: null,
    };
    expect(isEquippableUserItem(owned)).toBe(true);
    expect(getEquipBlockReason(owned)).toBeNull();
    expect(
      canEquipAdditional({ itemType: "MEAL", slot: "ITEM", bloodlineId: null }, []),
    ).toBe("Meals cannot be equipped");
  });
});
