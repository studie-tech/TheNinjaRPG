import { beforeEach, expect, it } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { item, userData, userItem } from "@/drizzle/schema";
import { itemRouter, splitItemStack } from "@/server/api/routers/item";
import { joinFinishedCrafts } from "@/server/utils/itemStacks";
import { deferred } from "../../../../setup/deferred";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import { aroundStatements, overrideQuery } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
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

  it.each([-2 * minute, -minute / 2])(
    "acknowledges a concurrently settled craft kept by the merge (finish offset %s)",
    async (finishesInMs) => {
      await insertUserItems([
        { id: "kit-carried", userId, itemId: "kit", quantity: 3 },
        craftedKits(2, -3 * minute, "kit-z-crafted"),
      ]);
      const db = await getTestDatabase();
      const seen = await db.query.userItem.findMany({
        where: eq(userItem.userId, userId),
      });
      const snapshotAt = new Date(Date.now() - minute);
      // Another request settles the queued craft before this read's merge reload.
      await insertUserItems([craftedKits(2, finishesInMs, "kit-a-crafted")]);
      expect(await joinFinishedCrafts(db, userId, seen, snapshotAt)).toBe(true);
      expect(await stacks()).toEqual([["kit-a-crafted", 7, false]]);
      expect((await splitItemStack(db, "kit-a-crafted", userId, 4)).success).toBe(true);
      await (await callerFor(itemRouter, userId)).getUserItems();
      expect((await stacks()).map(([, quantity]) => quantity).sort()).toEqual([3, 4]);
    },
  );

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
  it("keeps the craft time of a finished craft another read has claimed for its merge", async () => {
    // Another read's merge has claimed the craft (negative quantity) after this read saw it.
    await insertUserItems([
      { id: "kit-carried", userId, itemId: "kit", quantity: 3 },
      craftedKits(-4, -minute),
    ]);
    const db = await getTestDatabase();
    const seen = [
      {
        id: "kit-crafted",
        itemId: "kit",
        storedAtHome: false,
        craftingFinishedAt: new Date(Date.now() - minute),
      },
    ];
    // Nothing joined here, so the rows already read stay this read's answer.
    expect(await joinFinishedCrafts(db, userId, seen)).toBe(false);
    // The claiming merge fails and restores the quantity: a later read still joins the craft.
    await db
      .update(userItem)
      .set({ quantity: 4 })
      .where(eq(userItem.id, "kit-crafted"));
    await (await callerFor(itemRouter, userId)).getUserItems();
    expect(await stacks()).toEqual([["kit-carried", 7, false]]);
  });
  it.each(["getUserItems", "getUserItemsWithVariants"] as const)(
    "recovers an abandoned craft merge before returning the inventory (%s)",
    async (procedure) => {
      await insertUserItems([
        {
          id: "kit-carried",
          userId,
          itemId: "kit",
          quantity: -3,
          updatedAt: new Date(Date.now() - minute),
        },
        { ...craftedKits(-4, -minute), updatedAt: new Date(Date.now() - minute) },
      ]);
      const inventory = await (await callerFor(itemRouter, userId))[procedure]();
      expect(inventory.reduce((sum, row) => sum + row.quantity, 0)).toBe(7);
      expect(await stacks()).toEqual([["kit-carried", 7, false]]);
    },
  );
  it.each(["getUserItems", "getUserItemsWithVariants"] as const)(
    "returns the complete inventory when a read starts during a craft merge (%s)",
    async (procedure) => {
      await insertUserItems([
        { id: "kit-carried", userId, itemId: "kit", quantity: 3 },
        craftedKits(4, -minute),
      ]);
      const db = await getTestDatabase();
      const claimed = deferred();
      const publish = deferred();
      const observed = deferred();
      const merging = callerForDatabase(
        itemRouter,
        userId,
        aroundStatements(
          db,
          userItem,
          async (run) => {
            const result = await run();
            claimed.resolve();
            await publish.promise;
            return result;
          },
          { when: (values) => values.updatedAt instanceof Date && !!values.quantity },
        ),
      ).getUserItems();
      await claimed.promise;
      const reader = callerForDatabase(
        itemRouter,
        userId,
        overrideQuery(db, "userItem", {
          findMany: async (read, ...args) => {
            const rows = await read(...args);
            observed.resolve();
            return rows;
          },
        }),
      )[procedure]();
      // The second read has fetched the claimed rows before the first may publish them.
      await observed.promise;
      publish.resolve();
      const answers = await Promise.all([merging, reader]);
      for (const inventory of answers) {
        expect(inventory.reduce((sum, row) => sum + row.quantity, 0)).toBe(7);
      }
      expect(await stacks()).toEqual([["kit-carried", 7, false]]);
    },
  );
  it("answers both inventory reads in full while they join the same craft", async () => {
    const api = await callerFor(itemRouter, userId);
    const db = await getTestDatabase();
    for (let round = 0; round < 15; round++) {
      await db.delete(userItem).where(eq(userItem.userId, userId));
      await insertUserItems([
        { id: "kit-carried", userId, itemId: "kit", quantity: 3 },
        craftedKits(4, -minute),
      ]);
      const answers = await Promise.all([
        api.getUserItems(),
        api.getUserItemsWithVariants(),
      ]);
      for (const inventory of answers) {
        expect(inventory.reduce((sum, row) => sum + row.quantity, 0)).toBe(7);
      }
      // Concurrent claims may both conflict; the retained craft time retries on a later read.
      await api.getUserItems();
      expect(await stacks()).toEqual([["kit-carried", 7, false]]);
    }
  });
});
