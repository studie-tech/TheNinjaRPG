import { describe, it, expect } from "vitest";
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-call */
import { selectItemLoadout } from "@/server/api/routers/item";

const makeUserItem = (overrides: Partial<any> = {}) => ({
  id: Math.random().toString(36).slice(2),
  createdAt: new Date(),
  updatedAt: new Date(),
  userId: "user-1",
  itemId: "item-1",
  quantity: 1,
  equipped: "NONE",
  storedAtHome: false,
  craftingFinishedAt: null,
  isInAuction: false,
  imbuements: [],
  dropChancePerc: 0,
  durability: 100,
  item: {
    id: "item-1",
    name: "Test Item",
    cooldown: 1,
    maxDurability: 100,
    preventBattleUsage: false,
    itemType: "WEAPON",
    requiredLevel: 1,
  },
  ...overrides,
});

describe("selectItemLoadout", () => {
  it("returns equipped items after selecting loadout", async () => {
    const user = { userId: "user-1", level: 100, federalStatus: "GOLD", staffAccount: false } as any;

    const loadout = {
      id: "loadout-1",
      userId: "user-1",
      itemData: [
        { itemId: "item-1", slot: "ITEM_1" },
        { itemId: "item-2", slot: "ITEM_2" },
      ],
      createdAt: new Date(),
    } as any;

    const loadouts = [loadout];

    const useritems = [
      makeUserItem({
        itemId: "item-1",
        item: {
          id: "item-1",
          name: "Sword",
          cooldown: 2,
          maxDurability: 100,
          preventBattleUsage: false,
          itemType: "WEAPON",
          requiredLevel: 1,
        },
      }),
      makeUserItem({
        itemId: "item-2",
        item: {
          id: "item-2",
          name: "Potion",
          cooldown: 1,
          maxDurability: 100,
          preventBattleUsage: false,
          itemType: "CONSUMABLE",
          requiredLevel: 1,
        },
      }),
    ] as any;

    // Simulate DB reflecting equipped change after updates
    const updatedUserItems = [
      { ...useritems[0], equipped: "ITEM_1" },
      { ...useritems[1], equipped: "ITEM_2" },
    ];

    // Drizzle client stub used by selectItemLoadout internally
    const client: any = {
      update() {
        return {
          set() {
            return {
              where() {
                return Promise.resolve({ rowsAffected: 1 });
              },
            };
          },
        };
      },
      query: {
        userItem: {
          findMany: async () => updatedUserItems,
        },
      },
    };

    const result = await selectItemLoadout(
      client as any,
      loadout.id,
      loadouts as any,
      useritems as any,
      user as any,
    );

    expect(result.success).toBe(true);
    // Only items from the loadout that are equipped should be returned
    expect(result.items.length).toBe(2);
    const slots = new Set(result.items.map((ui: any) => ui.equipped));
    expect(slots).toEqual(new Set(["ITEM_1", "ITEM_2"]));
  });
});
