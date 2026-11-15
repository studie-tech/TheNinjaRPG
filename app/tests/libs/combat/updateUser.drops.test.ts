import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  aiProfile,
  battle,
  battleHistory,
  item,
  userData,
  userItem,
} from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/settlement";
import type { BattleUserState, CompleteBattle, DroppedItem } from "@/libs/combat/types";
import type { PusherClient } from "@/libs/pusher";
import * as itemQueries from "@/queries/item";
import { initiateBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
} from "../../setup/combat";
import { deferred } from "../../setup/deferred";
import {
  insertDefaultAiProfile,
  insertItems,
  insertUserItems,
  insertUsers,
} from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
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
const settle = async (
  state: CompleteBattle,
  drops: DroppedItem[],
  client?: DrizzleClient,
) => {
  const result = {
    ...calcBattleResult(structuredClone(state), "player")!,
    didWin: 1,
    outcome: "Won" as const,
    droppedItems: drops,
  };
  await updateUser(
    client ?? (await getTestDatabase()),
    pusher,
    state,
    result,
    "player",
  );
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
    await resetTables(aiProfile, battle, battleHistory, userItem, item, userData);
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

  it.each(["top-up", "new-stack"] as const)(
    "releases the finished battle when drop delivery fails at %s",
    async (delivery) => {
      if (delivery === "top-up")
        vi.spyOn(itemQueries, "updateUserItemForBattleDrop").mockRejectedValue(
          new TypeError("drop delivery failed"),
        );
      else
        vi.spyOn(itemQueries, "insertUserItems").mockRejectedValue(
          new TypeError("drop delivery failed"),
        );
      await expect(
        settle(scenario(), [drop(delivery === "top-up" ? "pill" : "blade")]),
      ).rejects.toThrow("drop delivery failed");
      const owner = await (await getTestDatabase()).query.userData.findFirst({
        where: eq(userData.userId, "player"),
      });
      expect(owner).toMatchObject({ status: "AWAKE", battleId: null });
    },
  );

  it("holds battle admission until drops finish so the next fight preloads every unit", async () => {
    const database = await getTestDatabase();
    await insertDefaultAiProfile();
    await insertUsers([{ userId: "foe", username: "foe", isAi: true, inArena: true }]);
    await insertUserItems([
      { id: "own-pill", userId: "player", itemId: "pill", quantity: 5 },
    ]);
    const deliveryReady = deferred();
    const resumeDelivery = deferred();
    const held = beforeStatements(
      database,
      userItem,
      [
        async () => {
          deliveryReady.resolve();
          await resumeDelivery.promise;
        },
      ],
      { operations: ["update"] },
    );
    const settlement = settle(scenario(), [drop("pill")], held);
    const startNextBattle = () =>
      initiateBattle(
        { client: database, userIds: ["player"], targetIds: ["foe"] },
        "ARENA",
      );
    try {
      await deliveryReady.promise;
      await database
        .update(userItem)
        .set({ equipped: "ITEM_1" })
        .where(eq(userItem.id, "own-pill"));
      const attempted = await startNextBattle();
      expect(attempted.success).toBe(false);
      const owner = await database.query.userData.findFirst({
        where: eq(userData.userId, "player"),
      });
      expect(owner).toMatchObject({ status: "BATTLE", battleId: "drops" });
    } finally {
      await database
        .update(userItem)
        .set({ equipped: "NONE" })
        .where(eq(userItem.id, "own-pill"));
      resumeDelivery.resolve();
      await settlement;
    }
    await database
      .update(userItem)
      .set({ equipped: "ITEM_1" })
      .where(eq(userItem.id, "own-pill"));
    const started = await startNextBattle();
    expect(started.success, started.message).toBe(true);
    const next = (await database.query.battle.findFirst({
      where: eq(battle.id, started.battleId!),
    }))! as CompleteBattle;
    const player = next.usersState.find((user) => user.userId === "player")!;
    expect(player.items.find((entry) => entry.id === "own-pill")?.quantity).toBe(6);
    // Unequipping during ordinary combat makes the row eligible for drop top-ups.
    await database
      .update(userItem)
      .set({ equipped: "NONE" })
      .where(eq(userItem.id, "own-pill"));
    const foe = next.usersState.find((user) => user.isAi && !user.isSummon)!;
    foe.curHealth = 0;
    foe.leftBattle = true;
    await settle(next, []);
    expect(await stacksOf("pill")).toEqual([["own-pill", 6, "bag"]]);
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
