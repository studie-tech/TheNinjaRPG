import { describe, expect, it } from "vitest";
import { ItemValidator } from "@/validators/combat";

const validItem = {
  name: "Farm item",
  image: "item.webp",
  description: "Farm item",
  battleDescription: "Farm item",
  stackSize: 1,
  chakraCost: 0,
  healthCost: 0,
  staminaCost: 0,
  healthCostReducePerLvl: 0,
  chakraCostReducePerLvl: 0,
  staminaCostReducePerLvl: 0,
  actionCostPerc: 100,
  maxImbueNumber: 1,
  maxDurability: 100,
  hidden: false,
  cooldown: 0,
  cost: 1,
  repsCost: 0,
  seichiSilverCost: 0,
  range: 0,
  maxEquips: 0,
  method: "SINGLE" as const,
  target: "SELF" as const,
  itemType: "MATERIAL" as const,
  weaponType: "NONE" as const,
  rarity: "COMMON" as const,
  slot: "NONE" as const,
  requiredNinjutsuOffence: null,
  requiredNinjutsuDefence: null,
  requiredGenjutsuOffence: null,
  requiredGenjutsuDefence: null,
  requiredTaijutsuOffence: null,
  requiredTaijutsuDefence: null,
  requiredBukijutsuOffence: null,
  requiredBukijutsuDefence: null,
  requiredStrength: null,
  requiredSpeed: null,
  requiredIntelligence: null,
  requiredWillpower: null,
  expireFromStoreAt: null,
  effects: [],
  farmYieldItemId: null,
  farmExtractSeedItemId: null,
  crystalTargetTypes: null,
  bloodlineId: null,
};

describe("farm item validation", () => {
  it("rejects a farm seed with the default zero grow time", () => {
    const result = ItemValidator.safeParse({ ...validItem, isFarmSeed: true });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["farmGrowTimeSeconds"] }),
      );
    }
  });

  it("accepts a farm seed with a positive grow time", () => {
    const result = ItemValidator.safeParse({
      ...validItem,
      isFarmSeed: true,
      farmGrowTimeSeconds: 1,
    });

    expect(result.success).toBe(true);
  });

  it("keeps the zero grow-time default valid for non-seed items", () => {
    const result = ItemValidator.safeParse(validItem);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.farmGrowTimeSeconds).toBe(0);
  });
});
