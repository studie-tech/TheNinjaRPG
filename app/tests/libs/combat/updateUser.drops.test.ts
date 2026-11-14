import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { and, eq } from "drizzle-orm";
import { battle, item, userData, userItem } from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/settlement";
import type { BattleUserState, CompleteBattle, DroppedItem } from "@/libs/combat/types";
import type { PusherClient } from "@/libs/pusher";
import * as itemQueries from "@/queries/item";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
} from "../../setup/combat";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const pusher = { trigger: async () => {} } as unknown as PusherClient;

const catalog = {
  ore: {
    id: "ore",
    name: "Ore",
    itemType: "MATERIAL" as const,
    canStack: true,
    stackSize: 10,
  },
  pill: {
    id: "pill",
    name: "Pill",
    itemType: "CONSUMABLE" as const,
    canStack: true,
    stackSize: 10,
  },
  blade: {
    id: "blade",
    name: "Blade",
    itemType: "WEAPON" as const,
    canStack: false,
    stackSize: 1,
  },
};

const standing = {
  rank: "JONIN",
  rankedLp: 100,
  rankedStreak: 0,
  rankedWins: 0,
  money: 1000,
  pvpStreak: 0,
} as const;

const scenario = (player: Partial<BattleUserState> = {}) =>
  makeCompleteBattle({
    id: "drops",
    battleType: "COMBAT",
    rewardScaling: 1,
    extraState: { items: catalog } as unknown as CompleteBattle["extraState"],
    usersState: [
      makeBattleUser("player", {
        direction: "left",
        ...standing,
        villageId: "red",
        isAi: false,
        isSummon: false,
        curHealth: 100,
        sector: 1,
        items: [],
        ...player,
      }),
      makeBattleUser("foe", {
        ...standing,
        villageId: "blue",
        direction: "right",
        isAi: true,
        isSummon: false,
        curHealth: 0,
        sector: 1,
        leftBattle: true,
      }),
    ],
  });

const drop = (itemId: keyof typeof catalog, index = 0): DroppedItem => ({
  itemId,
  name: catalog[itemId].name,
  userItemId: `foe-${itemId}-${index}`,
  fromUserId: "foe",
});

/** Settle a won battle for the player with the given drops. */
const settle = async (state: CompleteBattle, drops: DroppedItem[]) => {
  const result = {
    ...calcBattleResult(structuredClone(state), "player")!,
    didWin: 1,
    outcome: "Won" as const,
    droppedItems: drops,
  };
  await updateUser(await getTestDatabase(), pusher, state, result, "player");
};

/** The player's rows of an item as [id or "new", quantity, where], sorted. */
const stacksOf = async (itemId: string) =>
  (
    await (
      await getTestDatabase()
    )
      .select({
        id: userItem.id,
        quantity: userItem.quantity,
        storedAtHome: userItem.storedAtHome,
        isInAuction: userItem.isInAuction,
      })
      .from(userItem)
      .where(and(eq(userItem.userId, "player"), eq(userItem.itemId, itemId)))
  )
    .map((row) => [
      row.id.startsWith("own-") ? row.id : "new",
      row.quantity,
      row.storedAtHome ? "home" : row.isInAuction ? "auction" : "bag",
    ])
    .sort(
      (a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]),
    );

describeWithDatabase("items dropped in battle", () => {
  beforeEach(async () => {
    await resetTables(battle, userItem, item, userData);
    await insertUsers([
      { userId: "player", username: "player", status: "BATTLE", battleId: "drops" },
    ]);
    await insertItems(Object.values(catalog));
  });

  afterEach(() => vi.restoreAllMocks());

  it("joins a drop to the stack of that item the player carries", async () => {
    await insertUserItems([
      { id: "own-ore", userId: "player", itemId: "ore", quantity: 4 },
    ]);
    await settle(scenario(), [drop("ore")]);
    expect(await stacksOf("ore")).toEqual([["own-ore", 5, "bag"]]);
  });

  it("delivers several drops of one item as one stack", async () => {
    await settle(scenario(), [drop("ore", 0), drop("ore", 1), drop("ore", 2)]);
    expect(await stacksOf("ore")).toEqual([["new", 3, "bag"]]);
  });

  it("fills the fullest carried stack that has room", async () => {
    await insertUserItems([
      { id: "own-ore-a", userId: "player", itemId: "ore", quantity: 3 },
      { id: "own-ore-b", userId: "player", itemId: "ore", quantity: 8 },
      { id: "own-ore-c", userId: "player", itemId: "ore", quantity: 10 },
    ]);
    await settle(scenario(), [drop("ore", 0), drop("ore", 1)]);
    expect(await stacksOf("ore")).toEqual([
      ["own-ore-a", 3, "bag"],
      ["own-ore-b", 10, "bag"],
      ["own-ore-c", 10, "bag"],
    ]);
  });

  it("fills the room left in a carried stack before opening a new one", async () => {
    await insertUserItems([
      { id: "own-ore", userId: "player", itemId: "ore", quantity: 8 },
    ]);
    await settle(scenario(), [drop("ore", 0), drop("ore", 1), drop("ore", 2)]);
    expect(await stacksOf("ore")).toEqual([
      ["new", 1, "bag"],
      ["own-ore", 10, "bag"],
    ]);
  });

  it("still delivers drops when saving the battle's own items fails", async () => {
    await insertUserItems([
      { id: "own-pill", userId: "player", itemId: "pill", quantity: 1 },
    ]);
    vi.spyOn(itemQueries, "deleteUserItemsWithPositiveQuantity").mockRejectedValue(
      new TypeError("fetch failed"),
    );
    const usedUp = scenario({
      items: [
        makeBattleUserItem({
          id: "own-pill",
          itemId: "pill",
          quantity: 0,
          equipped: "ITEM_1",
        }),
      ],
    });
    await expect(settle(usedUp, [drop("ore")])).rejects.toThrow("fetch failed");
    expect(await stacksOf("ore")).toEqual([["new", 1, "bag"]]);
  });

  it("opens a new stack when no carried stack has room", async () => {
    await insertUserItems([
      { id: "own-ore", userId: "player", itemId: "ore", quantity: 10 },
    ]);
    await settle(scenario(), [drop("ore")]);
    expect(await stacksOf("ore")).toEqual([
      ["new", 1, "bag"],
      ["own-ore", 10, "bag"],
    ]);
  });

  it("leaves stacks at home, on auction and damaged apart", async () => {
    await insertUserItems([
      {
        id: "own-ore-home",
        userId: "player",
        itemId: "ore",
        quantity: 2,
        storedAtHome: true,
      },
      {
        id: "own-ore-listed",
        userId: "player",
        itemId: "ore",
        quantity: 2,
        isInAuction: true,
      },
      {
        id: "own-ore-worn",
        userId: "player",
        itemId: "ore",
        quantity: 2,
        durability: 1,
      },
    ]);
    await settle(scenario(), [drop("ore")]);
    expect(await stacksOf("ore")).toEqual([
      ["new", 1, "bag"],
      ["own-ore-home", 2, "home"],
      ["own-ore-listed", 2, "auction"],
      ["own-ore-worn", 2, "bag"],
    ]);
  });

  it("keeps the battle's own quantity for a stack used in the fight", async () => {
    await insertUserItems([
      { id: "own-pill", userId: "player", itemId: "pill", quantity: 5 },
    ]);
    // The player used two pills: settlement writes the remaining 3 to that row.
    await settle(
      scenario({
        items: [
          makeBattleUserItem({
            id: "own-pill",
            itemId: "pill",
            quantity: 3,
            equipped: "ITEM_1",
          }),
        ],
      }),
      [drop("pill")],
    );
    expect(await stacksOf("pill")).toEqual([
      ["new", 1, "bag"],
      ["own-pill", 3, "bag"],
    ]);
  });

  it("delivers each drop of an item that does not stack on its own", async () => {
    await insertUserItems([
      { id: "own-blade", userId: "player", itemId: "blade", quantity: 1 },
    ]);
    await settle(scenario(), [drop("blade", 0), drop("blade", 1)]);
    expect(await stacksOf("blade")).toEqual([
      ["new", 1, "bag"],
      ["new", 1, "bag"],
      ["own-blade", 1, "bag"],
    ]);
  });
});
