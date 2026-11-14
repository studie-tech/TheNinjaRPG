import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as ContentImage from "@/layout/ContentImage";
import * as DurabilityBar from "@/layout/DurabilityBar";
import type { ItemWithEffectsProps } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import * as UserContext from "@/utils/UserContext";
import { NonCombatConsumeRewardTag } from "@/validators/combat";

const names = { useQuery: () => ({ data: [] }) };
const evolutions = { useQuery: vi.fn(() => ({ data: [] })) };
const durability = vi.fn(() => <span>Durability bar</span>);
const furniture = {
  id: "custom-rug",
  name: "Painted Rug",
  description: "A warm woven decoration.",
  image: "/custom-rug.webp",
  createdAt: new Date(),
  updatedAt: new Date(),
  itemType: "FURNITURE",
  rarity: "COMMON",
  furnitureData: { action: null, width: 24, groundAnchor: 100, isFloor: true },
  requiredLevel: 1,
  canBeCrafted: true,
  canBeTraded: true,
  hidden: false,
  cost: 500,
  repsCost: 0,
  seichiSilverCost: 0,
  purchaseLimitPeriod: "NONE",
  // Display stays cosmetic even if a stale catalog row still carries gameplay fields.
  maxDurability: 100,
  curDurability: 10,
  maxImbueNumber: 3,
  canBeImbued: true,
  slot: "HAND",
  target: "OPPONENT",
  method: "AOE",
  range: 5,
  actionCostPerc: 60,
  chakraCost: 50,
  battleUsageType: "BOTH",
  level: 30,
  xpToLevel: 1_000,
  effects: [{ type: "damage", description: "Strikes with damage", power: 10 }],
} as unknown as ItemWithEffectsProps["item"];

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: { getAllNames: names },
    sageMode: { getAllNames: names },
    skillTree: { getAllNames: names },
    item: { getAllNames: names, getEvolutions: evolutions },
    jutsu: { getEvolutions: evolutions },
  });
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(
    (select) => ({ data: select({ role: "USER" } as never) }) as never,
  );
  vi.spyOn(ContentImage, "default").mockImplementation(() => null);
  vi.spyOn(DurabilityBar, "default").mockImplementation(durability);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("furniture item details", () => {
  it("shows furniture content and economy while hiding stale battle and durability data", () => {
    const view = render(<ItemWithEffects item={furniture} showEvolutions />);
    expect(view.getByText("Painted Rug")).toBeTruthy();
    expect(view.getByText("A warm woven decoration.")).toBeTruthy();
    expect(view.getByText(/500 ryo/)).toBeTruthy();
    expect(view.getByText("Floor decoration")).toBeTruthy();
    expect(view.getByText("Can be Crafted")).toBeTruthy();
    expect(view.getByText("Can be Traded")).toBeTruthy();
    for (const label of [
      "Battle Type",
      "Durability",
      "Durability bar",
      "Equip",
      "Range",
      "Target",
      "Method",
      "Level",
      "XP Per Level",
      "Action Usage",
      "Chakra Usage",
      "Max Imbue Number",
    ]) {
      expect(view.queryByText(label)).toBeNull();
    }
    expect(view.queryByText(/Strikes with damage/)).toBeNull();
    expect(durability).not.toHaveBeenCalled();
    expect(evolutions.useQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
  });
});

it("shows the active cache display and distribution instead of inactive standard rewards", () => {
  const view = render(
    <ItemWithEffects
      item={
        {
          ...furniture,
          itemType: "CONSUMABLE",
          effects: [
            NonCombatConsumeRewardTag.parse({
              reward_money: 17,
              rewardMode: "weightedCache",
              weightedCache: {
                version: 1,
                displayName: "Chakra Pill Cache",
                rolls: [
                  { count: 1, probability: 5000 },
                  { count: 2, probability: 5000 },
                ],
                tiers: [
                  {
                    name: "Common",
                    probability: 10_000,
                    entries: [{ items: [{ itemId: "pill", quantity: 2 }] }],
                  },
                ],
              },
            }),
          ],
        } as ItemWithEffectsProps["item"]
      }
    />,
  );
  expect(view.getByText("Chakra Pill Cache")).toBeTruthy();
  expect(view.getByText("1 roll: 50%; 2 rolls: 50%")).toBeTruthy();
  expect(view.queryByText("Reward Money")).toBeNull();
});
