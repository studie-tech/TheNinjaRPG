import { describe, expect, it } from "vitest";
import { getCaughtFishStackRequirement } from "@/server/utils/caughtFishDelivery";

const fish = { id: "fishing-river-carp", canStack: true, stackSize: 20 };

describe("caught fish stack planning", () => {
  it("uses free space in an eligible carried cooking stack", () => {
    const result = getCaughtFishStackRequirement({
      itemInfo: fish as never,
      quantity: 3,
      userItems: [
        {
          itemId: fish.id,
          quantity: 18,
          equipped: "NONE",
          storedAtHome: false,
          isInAuction: false,
          craftingFinishedAt: null,
          item: {},
        },
      ] as never,
    });
    expect(result.newStacks).toBe(1);
  });

  it("does not reuse equipped or home stacks", () => {
    const result = getCaughtFishStackRequirement({
      itemInfo: fish as never,
      quantity: 1,
      userItems: [
        {
          itemId: fish.id,
          quantity: 1,
          equipped: "ITEM",
          storedAtHome: false,
          isInAuction: false,
          craftingFinishedAt: null,
          item: {},
        },
      ] as never,
    });
    expect(result.newStacks).toBe(1);
  });
});
