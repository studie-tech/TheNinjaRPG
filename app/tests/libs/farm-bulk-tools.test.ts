import { describe, expect, it } from "vitest";
import { getFarmBulkToolAvailability } from "@/libs/farming";

describe("farm bulk tool availability", () => {
  const availableInput = {
    selectedSeedId: "seed-1",
    selectedFertilizerId: "fertilizer-stack-1",
    emptyCount: 3,
    waterableCount: 2,
    fertilizableCount: 2,
    readyCount: 1,
  };

  it("enables consumable actions from selections and targets, not stack size", () => {
    expect(
      getFarmBulkToolAvailability({ ...availableInput, pending: false }),
    ).toEqual({
      canPlantAll: true,
      canWaterAll: true,
      canFertilizeAll: true,
      canHarvestAll: true,
    });
  });

  it("disables every bulk tool while another bulk action is pending", () => {
    expect(
      getFarmBulkToolAvailability({ ...availableInput, pending: true }),
    ).toEqual({
      canPlantAll: false,
      canWaterAll: false,
      canFertilizeAll: false,
      canHarvestAll: false,
    });
  });
});
