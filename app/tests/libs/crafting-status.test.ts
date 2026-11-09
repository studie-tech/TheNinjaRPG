import { describe, expect, it } from "bun:test";
import { CRAFTING_REQUIRED_EXP, CRAFTING_RANKS } from "@/drizzle/constants";
import type { Item, UserData, UserItem } from "@/drizzle/schema";
import {
  calculateItemConsumption,
  getCraftingRank,
  getCraftingRankProgress,
  getCurrentCraftingStatus,
  getTotalItemQuantity,
} from "@/libs/crafting";

type Stack = UserItem & { item: Item };

const past = new Date(Date.now() - 60_000);
const future = new Date(Date.now() + 60_000);
const stack = (id: string, overrides: Partial<Stack> = {}) =>
  ({
    id,
    itemId: "ore",
    quantity: 1,
    isInAuction: false,
    craftingFinishedAt: null,
    item: { name: id },
    ...overrides,
  }) as Stack;
const crafter = (overrides: Partial<UserData> = {}) =>
  ({ occupation: "CRAFTING", craftingExperience: 0, ...overrides }) as UserData;

const stacks = [
  stack("big", { quantity: 5 }),
  stack("small", { quantity: 2 }),
  stack("finished", { quantity: 3, craftingFinishedAt: past }),
  stack("empty", { quantity: 0 }),
  stack("auction", { quantity: 7, isInAuction: true }),
  stack("crafting", { quantity: 9, craftingFinishedAt: future }),
  stack("other", { itemId: "wood", quantity: 11 }),
];

describe("usable crafting stacks", () => {
  it("counts only finished stacks of the item that are out of auction", () => {
    expect(getTotalItemQuantity(stacks, "ore")).toBe(10);
    expect(getTotalItemQuantity(stacks, "wood")).toBe(11);
    expect(getTotalItemQuantity(stacks, "missing")).toBe(0);
  });

  it("consumes those stacks smallest first", () => {
    expect(calculateItemConsumption(stacks, "ore", 6)).toEqual({
      consumptions: [
        { userItemId: "small", consumeQuantity: 2, newQuantity: 0 },
        { userItemId: "finished", consumeQuantity: 3, newQuantity: 0 },
        { userItemId: "big", consumeQuantity: 1, newQuantity: 4 },
      ],
    });
    expect(
      calculateItemConsumption(stacks, "ore", 11).consumptions.map(
        (row) => row.newQuantity,
      ),
    ).toEqual([0, 0, 0]);
  });
});

describe("getCurrentCraftingStatus", () => {
  it("reports the item in progress", () => {
    const status = getCurrentCraftingStatus(crafter({ craftingExperience: 0 }), stacks);
    expect(status).toEqual({
      isCurrentlyCrafting: true,
      craftingRank: getCraftingRank(0),
      craftingExperience: 0,
      currentCraftingItem: stacks[5]!.item,
      currentCraftingUserItemId: "crafting",
      craftingFinishedAt: future,
    });
  });

  it("reports an idle crafter", () => {
    expect(getCurrentCraftingStatus(crafter(), [stack("done")])).toMatchObject({
      isCurrentlyCrafting: false,
      currentCraftingItem: null,
      currentCraftingUserItemId: null,
      craftingFinishedAt: null,
    });
  });

  it("leaves the next rank's experience to the rank progress", () => {
    CRAFTING_RANKS.forEach((rank, index) => {
      const next = CRAFTING_RANKS[index + 1];
      expect(
        getCraftingRankProgress(CRAFTING_REQUIRED_EXP[rank]).nextRankExperience,
      ).toBe(next ? CRAFTING_REQUIRED_EXP[next] : null);
    });
  });
});
