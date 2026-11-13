import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { getInventoryQuantities } from "@/deltas/item";
import { HOSPITAL_BASE_HEAL_SECONDS } from "@/drizzle/constants";
import { item, userData, userItem } from "@/drizzle/schema";
import { AUTO_CHECKOUT_MESSAGE, AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { itemRouter } from "@/server/api/routers/item";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("consumable merges across ownership levels", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, userData);
    await insertUsers([{ userId: "merge-user", status: "AWAKE" }]);
    await insertItems([
      { id: "consumable", itemType: "CONSUMABLE", canStack: true, stackSize: 10 },
      { id: "weapon", itemType: "WEAPON", canStack: true, stackSize: 10 },
    ]);
  });

  it.each([false, true])(
    "retains the highest-level keeper and stack cap (home: %s)",
    async (storedAtHome) => {
      await insertUserItems([
        {
          id: "a-low",
          userId: "merge-user",
          itemId: "consumable",
          quantity: 8,
          level: 1,
          storedAtHome,
        },
        {
          id: "z-high",
          userId: "merge-user",
          itemId: "consumable",
          quantity: 7,
          level: 15,
          experience: 91,
          storedAtHome,
        },
        {
          id: "b-middle",
          userId: "merge-user",
          itemId: "consumable",
          quantity: 3,
          level: 9,
          storedAtHome,
        },
      ]);
      const api = await callerFor(itemRouter, "merge-user");
      const before = await (await getTestDatabase())
        .select()
        .from(userItem)
        .where(eq(userItem.userId, "merge-user"));
      const result = storedAtHome
        ? await api.mergeAllStacks({ storedAtHome: true })
        : await api.mergeStacks({ itemId: "consumable" });
      expect(result.success).toBe(true);
      const database = await getTestDatabase();
      const rows = await database
        .select()
        .from(userItem)
        .where(eq(userItem.userId, "merge-user"));
      expect(
        getInventoryQuantities(before, result.inventoryChanges)?.sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      ).toEqual(rows.sort((a, b) => a.id.localeCompare(b.id)));
      expect(rows).toHaveLength(2);
      expect(rows.reduce((total, row) => total + row.quantity, 0)).toBe(18);
      expect(rows.find((row) => row.id === "z-high")).toMatchObject({
        quantity: 10,
        level: 15,
        experience: 91,
      });
      expect(rows.find((row) => row.id === "b-middle")).toMatchObject({
        quantity: 8,
        level: 9,
      });
    },
  );

  it("withholds no-op merge metadata after recovering a stale claim", async () => {
    await insertUserItems([
      {
        id: "stale",
        userId: "merge-user",
        itemId: "consumable",
        quantity: -3,
        updatedAt: new Date(Date.now() - 60000),
      },
    ]);
    const api = await callerFor(itemRouter, "merge-user"),
      result = await api.mergeStacks({ itemId: "consumable" });
    expect(result.success).toBe(true);
    expect(result.inventoryChanges).toBeUndefined();
    expect((await api.getUserItems()).find((row) => row.id === "stale")?.quantity).toBe(
      3,
    );
  });

  it("keeps different-level gear separate", async () => {
    await insertUserItems([
      { id: "low", userId: "merge-user", itemId: "weapon", quantity: 3, level: 1 },
      { id: "high", userId: "merge-user", itemId: "weapon", quantity: 3, level: 15 },
    ]);
    const api = await callerFor(itemRouter, "merge-user");
    expect(await api.mergeAllStacks({ storedAtHome: false })).toMatchObject({
      success: true,
      message: "Nothing to merge",
    });
    const database = await getTestDatabase();
    const rows = await database
      .select()
      .from(userItem)
      .where(eq(userItem.userId, "merge-user"));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.quantity)).toEqual([3, 3]);
  });

  it("reports nothing to merge for an empty, unstackable or orphaned inventory", async () => {
    const api = await callerFor(itemRouter, "merge-user");
    const empty = await api.mergeAllStacks({ storedAtHome: false });
    expect(empty).toEqual({
      success: true,
      message: "Nothing to merge",
      inventoryChanges: [],
      userPatch: {},
      userDelta: {},
    } as never);
    await resetTables(item);
    await insertItems([{ id: "single", itemType: "WEAPON", stackSize: 1 }]);
    await insertUserItems([
      { id: "single-a", userId: "merge-user", itemId: "single", quantity: 1 },
      { id: "single-b", userId: "merge-user", itemId: "single", quantity: 1 },
      { id: "orphan-a", userId: "merge-user", itemId: "deleted-item", quantity: 2 },
      { id: "orphan-b", userId: "merge-user", itemId: "deleted-item", quantity: 2 },
    ]);
    expect(await api.mergeAllStacks({ storedAtHome: false })).toEqual(empty);
    expect(await (await getTestDatabase()).select().from(userItem)).toHaveLength(4);
  });

  it("merges every stackable item type in one request and leaves others alone", async () => {
    await insertItems([
      {
        id: "potion",
        name: "Potion",
        itemType: "CONSUMABLE",
        canStack: true,
        stackSize: 10,
      },
    ]);
    await insertUserItems([
      { id: "c1", userId: "merge-user", itemId: "consumable", quantity: 2 },
      { id: "c2", userId: "merge-user", itemId: "consumable", quantity: 2 },
      { id: "p1", userId: "merge-user", itemId: "potion", quantity: 5 },
      { id: "p2", userId: "merge-user", itemId: "potion", quantity: 5 },
      {
        id: "listed",
        userId: "merge-user",
        itemId: "potion",
        quantity: 4,
        isInAuction: true,
      },
    ]);
    const result = await (await callerFor(itemRouter, "merge-user")).mergeAllStacks({
      storedAtHome: false,
    });
    expect(result).toMatchObject({
      success: true,
      message: "Merged stacks for 2 item types",
    });
    const rows = await (await getTestDatabase()).select().from(userItem);
    expect(rows.map((row) => [row.itemId, row.quantity]).sort()).toEqual([
      ["consumable", 4],
      ["potion", 10],
      ["potion", 4],
    ]);
  });

  it.each(["ASLEEP", "HOSPITALIZED"] as const)(
    "reports confirmed %s recovery when only one item type merges",
    async (status) => {
      const database = await getTestDatabase();
      await database
        .update(userData)
        .set({
          status,
          curHealth: 1,
          maxHealth: 1000,
          regeneration: 0,
          regenAt: new Date(Date.now() - (HOSPITAL_BASE_HEAL_SECONDS + 5) * 1000),
        })
        .where(eq(userData.userId, "merge-user"));
      await insertUserItems([
        { id: "a1", userId: "merge-user", itemId: "consumable", quantity: 3 },
        { id: "a2", userId: "merge-user", itemId: "consumable", quantity: 3 },
        { id: "b1", userId: "merge-user", itemId: "weapon", quantity: 3 },
        { id: "b2", userId: "merge-user", itemId: "weapon", quantity: 3 },
      ]);
      // Change one group after preload so its atomic claim fails while the other group merges.
      const raced = beforeStatements(database, userItem, [
        async () => {},
        async () => {},
        async () => {
          await database
            .update(userItem)
            .set({ quantity: 4 })
            .where(eq(userItem.id, "a1"));
        },
      ]);
      const result = await callerForDatabase(
        itemRouter,
        "merge-user",
        raced,
      ).mergeAllStacks({ storedAtHome: false });

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining("Merged 1 item type"),
        actionNotice: status === "ASLEEP" ? AUTO_WAKE_MESSAGE : AUTO_CHECKOUT_MESSAGE,
      });
      expect(result.inventoryChanges).toBeUndefined();
      expect(
        await database.query.userData.findFirst({
          where: eq(userData.userId, "merge-user"),
        }),
      ).toMatchObject({ status: "AWAKE" });
      const rows = await database
        .select()
        .from(userItem)
        .where(eq(userItem.userId, "merge-user"));
      expect(
        rows
          .filter((row) => row.itemId === "consumable")
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toMatchObject([
        { id: "a1", quantity: 4 },
        { id: "a2", quantity: 3 },
      ]);
      expect(rows.filter((row) => row.itemId === "weapon")).toMatchObject([
        { quantity: 6 },
      ]);
    },
  );

  it.each([
    ["one stack above the stack size", [25]],
    ["more units than its rows can hold at the stack size", [25, 3]],
  ])("keeps every unit of %s", async (_, quantities) => {
    await insertUserItems(
      quantities.map((quantity, index) => ({
        id: `oversized-${index}`,
        userId: "merge-user",
        itemId: "consumable",
        quantity,
      })),
    );
    const api = await callerFor(itemRouter, "merge-user");
    expect((await api.mergeStacks({ itemId: "consumable" })).success).toBe(true);
    expect(
      (
        await (
          await getTestDatabase()
        )
          .select({ quantity: userItem.quantity })
          .from(userItem)
          .where(eq(userItem.userId, "merge-user"))
      )
        .map((row) => row.quantity)
        .sort((a, b) => b - a),
    ).toEqual(quantities);
  });

  it("merges a stack above the stack size when the total exactly fills the rows", async () => {
    await insertUserItems(
      [25, 3, 1].map((quantity, index) => ({
        id: `fitting-${index}`,
        userId: "merge-user",
        itemId: "consumable",
        quantity,
      })),
    );
    const api = await callerFor(itemRouter, "merge-user");
    expect(await api.mergeStacks({ itemId: "consumable" })).toMatchObject({
      success: true,
    });
    expect(
      (
        await (
          await getTestDatabase()
        )
          .select({ quantity: userItem.quantity })
          .from(userItem)
          .where(eq(userItem.userId, "merge-user"))
      )
        .map((row) => row.quantity)
        .filter((quantity) => quantity > 0)
        .sort((a, b) => b - a),
    ).toEqual([10, 10, 9]);
  });
});
