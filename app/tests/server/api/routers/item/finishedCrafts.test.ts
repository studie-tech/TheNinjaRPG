import { beforeEach, expect, it } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { item, userData, userItem } from "@/drizzle/schema";
import { itemRouter, splitItemStack } from "@/server/api/routers/item";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "crafter";
const minute = 60_000;

/** Each of the crafter's stacks as [id, quantity, whether its craft time is still set]. */
const stacks = async () =>
  (
    await (
      await getTestDatabase()
    ).query.userItem.findMany({
      where: eq(userItem.userId, userId),
      orderBy: asc(userItem.id),
    })
  )
    .filter((row) => row.quantity > 0)
    .map((row) => [row.id, row.quantity, row.craftingFinishedAt !== null]);

/** A repair kit crafted into its own row, finishing at the given offset from now. */
const craftedKits = (quantity: number, finishesInMs: number, id = "kit-crafted") => ({
  id,
  userId,
  itemId: "kit",
  quantity,
  craftingFinishedAt: new Date(Date.now() + finishesInMs),
});

describeWithDatabase("finished crafts in the backpack", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, userData);
    await insertUsers([{ userId, username: userId, status: "AWAKE" }]);
    await insertItems([
      {
        id: "kit",
        name: "Repair Kit",
        itemType: "CONSUMABLE",
        canStack: true,
        stackSize: 10,
      },
    ]);
  });

  it.each(["getUserItems", "getUserItemsWithVariants"] as const)(
    "joins a finished craft to the stack already carried (%s)",
    async (procedure) => {
      await insertUserItems([
        { id: "kit-carried", userId, itemId: "kit", quantity: 3 },
        craftedKits(4, -minute),
      ]);
      const inventory = await (await callerFor(itemRouter, userId))[procedure]();
      expect(inventory.map((row) => [row.itemId, row.quantity])).toEqual([["kit", 7]]);
      expect(await stacks()).toEqual([["kit-carried", 7, false]]);
    },
  );

  it("clears the craft time of a crafted stack the carried one joins", async () => {
    // The merge keeps the lowest ID, so the crafted row holds the joined stack.
    await insertUserItems([
      { id: "kit-z-carried", userId, itemId: "kit", quantity: 3 },
      craftedKits(4, -minute, "kit-a-crafted"),
    ]);
    await (await callerFor(itemRouter, userId)).getUserItems();
    expect(await stacks()).toEqual([["kit-a-crafted", 7, false]]);
  });

  it("clears the craft time of a finished craft stored at home without joining it", async () => {
    await insertUserItems([
      { id: "kit-carried", userId, itemId: "kit", quantity: 3 },
      { ...craftedKits(4, -minute), storedAtHome: true },
    ]);
    await (await callerFor(itemRouter, userId)).getUserItems();
    expect(await stacks()).toEqual([
      ["kit-carried", 3, false],
      ["kit-crafted", 4, false],
    ]);
  });

  it("keeps a craft that is still running apart", async () => {
    await insertUserItems([
      { id: "kit-carried", userId, itemId: "kit", quantity: 3 },
      craftedKits(4, minute),
    ]);
    await (await callerFor(itemRouter, userId)).getUserItems();
    expect(await stacks()).toEqual([
      ["kit-carried", 3, false],
      ["kit-crafted", 4, true],
    ]);
  });

  it("leaves a stack split after its craft finished as the player split it", async () => {
    await insertUserItems([craftedKits(6, -minute)]);
    const api = await callerFor(itemRouter, userId);
    await api.getUserItems();
    expect(await stacks()).toEqual([["kit-crafted", 6, false]]);
    const split = await splitItemStack(
      await getTestDatabase(),
      "kit-crafted",
      userId,
      4,
    );
    expect(split.success).toBe(true);
    await api.getUserItems();
    expect((await stacks()).map(([, quantity]) => quantity).sort()).toEqual([2, 4]);
  });

  it("joins a craft that finished during a battle once the battle is over", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ battleId: "fight" })
      .where(eq(userData.userId, userId));
    await insertUserItems([
      { id: "kit-carried", userId, itemId: "kit", quantity: 3 },
      craftedKits(4, -minute),
    ]);
    const api = await callerFor(itemRouter, userId);
    const inBattle = await api.getUserItems();
    expect(inBattle.map((row) => `${row.id}:${row.quantity}`).sort()).toEqual([
      "kit-carried:3",
      "kit-crafted:4",
    ]);
    expect(await stacks()).toEqual([
      ["kit-carried", 3, false],
      ["kit-crafted", 4, true],
    ]);
    await db
      .update(userData)
      .set({ battleId: null })
      .where(eq(userData.userId, userId));
    await api.getUserItems();
    expect(await stacks()).toEqual([["kit-carried", 7, false]]);
  });
});
