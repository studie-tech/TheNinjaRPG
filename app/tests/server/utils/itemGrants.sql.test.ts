import { beforeEach, describe, expect, it } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { item, userData, userItem, userItemImbuement } from "@/drizzle/schema";
import { listItemForGrantUserItems } from "@/queries/item";
import { grantUserItems } from "@/server/utils/itemGrants";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const PLAYER = "player";

/** Quantities of the player's rows of `itemId`, smallest first. */
const stacks = async (itemId = "ore") =>
  (
    await (
      await getTestDatabase()
    )
      .select({ quantity: userItem.quantity })
      .from(userItem)
      .where(eq(userItem.itemId, itemId))
      .orderBy(asc(userItem.quantity), asc(userItem.id))
  ).map((row) => row.quantity);

const grant = async (
  rows: { itemId: string; quantity: number }[],
  options?: Parameters<typeof grantUserItems>[3],
) => grantUserItems(await getTestDatabase(), PLAYER, rows, options);

describeWithDatabase("granted items join compatible backpack stacks", () => {
  beforeEach(async () => {
    await resetTables(userItemImbuement, userItem, item, userData);
    await insertUsers([{ userId: PLAYER }]);
    await insertItems([
      { id: "ore", name: "Ore", canStack: true, stackSize: 100 },
      {
        id: "pill",
        name: "Pill",
        itemType: "CONSUMABLE",
        canStack: true,
        stackSize: 20,
      },
      { id: "sword", name: "Sword", itemType: "WEAPON", canStack: false, stackSize: 1 },
    ]);
  });

  it("fills the fullest stacks first and opens stacks only for the rest", async () => {
    await insertUserItems([
      { id: "a", userId: PLAYER, itemId: "ore", quantity: 70 },
      { id: "b", userId: PLAYER, itemId: "ore", quantity: 60 },
      { id: "c", userId: PLAYER, itemId: "ore", quantity: 100 },
    ]);
    const result = await grant([{ itemId: "ore", quantity: 150 }]);
    expect(await stacks()).toEqual([80, 100, 100, 100]);
    expect(result.unstacked).toEqual([{ itemId: "ore", quantity: 80 }]);
  });

  it("combines units of one item into a single new stack", async () => {
    await grant([
      { itemId: "ore", quantity: 1 },
      { itemId: "ore", quantity: 1 },
      { itemId: "ore", quantity: 1 },
    ]);
    expect(await stacks()).toEqual([3]);
  });

  it("splits a grant larger than a stack into full stacks", async () => {
    await grant([{ itemId: "pill", quantity: 45 }]);
    expect(await stacks("pill")).toEqual([5, 20, 20]);
  });

  it("grants several items in one call", async () => {
    await insertUserItems([
      { id: "ores", userId: PLAYER, itemId: "ore", quantity: 10 },
    ]);
    await grant([
      { itemId: "ore", quantity: 5 },
      { itemId: "pill", quantity: 2 },
    ]);
    expect(await stacks()).toEqual([15]);
    expect(await stacks("pill")).toEqual([2]);
  });

  it("never stacks items that cannot stack", async () => {
    await insertUserItems([
      { id: "blade", userId: PLAYER, itemId: "sword", quantity: 1 },
    ]);
    await grant([{ itemId: "sword", quantity: 2 }]);
    expect(await stacks("sword")).toEqual([1, 1, 1]);
  });

  describe("leaves stacks the Merge button would not merge", () => {
    it.each([
      ["equipped", { equipped: "ITEM_1" }, 10],
      ["stored at home", { storedAtHome: true }, 10],
      ["listed at auction", { isInAuction: true }, 10],
      ["showing a variant", { activeVariantId: "variant" }, 10],
      [
        "still being crafted",
        { craftingFinishedAt: new Date(Date.now() + 60_000) },
        10,
      ],
      ["worn", { durability: 40 }, 10],
      ["levelled", { level: 3 }, 10],
      ["claimed by a merge", { quantity: -10 }, -10],
      ["emptied by a merge", { quantity: 0 }, 0],
      ["owned by someone else", { userId: "other" }, 10],
      ["full", { quantity: 100 }, 100],
    ] as const)("%s", async (_, patch, quantity) => {
      await insertUserItems([
        { id: "existing", userId: PLAYER, itemId: "ore", quantity: 10, ...patch },
      ]);
      const result = await grant([{ itemId: "ore", quantity: 5 }]);
      expect(result.unstacked).toEqual([{ itemId: "ore", quantity: 5 }]);
      const existing = await (await getTestDatabase()).query.userItem.findFirst({
        where: eq(userItem.id, "existing"),
      });
      expect(existing?.quantity).toBe(quantity);
    });

    it("imbued", async () => {
      await insertUserItems([
        { id: "existing", userId: PLAYER, itemId: "ore", quantity: 10 },
      ]);
      await (await getTestDatabase()).insert(userItemImbuement).values({
        id: "imbue",
        userItemId: "existing",
        imbuementItemId: "pill",
        craftingFinishedAt: new Date(0),
      });
      await grant([{ itemId: "ore", quantity: 5 }]);
      expect(await stacks()).toEqual([5, 10]);
    });

    it("any stack while the owner is in a battle", async () => {
      await (await getTestDatabase())
        .update(userData)
        .set({ battleId: "battle" })
        .where(eq(userData.userId, PLAYER));
      await insertUserItems([
        { id: "existing", userId: PLAYER, itemId: "ore", quantity: 10 },
      ]);
      await grant([{ itemId: "ore", quantity: 5 }]);
      expect(await stacks()).toEqual([5, 10]);
    });
  });

  it("leaves stacks the caller removes in the same step", async () => {
    await insertUserItems([
      { id: "removing", userId: PLAYER, itemId: "ore", quantity: 40 },
      { id: "keeping", userId: PLAYER, itemId: "ore", quantity: 10 },
    ]);
    await grant([{ itemId: "ore", quantity: 5 }], { excludeUserItemIds: ["removing"] });
    expect(await stacks()).toEqual([15, 40]);
  });

  it("lets consumables join a stack of any level", async () => {
    await insertUserItems([
      { id: "strong", userId: PLAYER, itemId: "pill", quantity: 10, level: 4 },
    ]);
    await grant([{ itemId: "pill", quantity: 5 }]);
    expect(await stacks("pill")).toEqual([15]);
  });

  it("reports what could not join when only topping up", async () => {
    await insertUserItems([
      { id: "pills", userId: PLAYER, itemId: "pill", quantity: 18 },
    ]);
    const result = await grant([{ itemId: "pill", quantity: 5 }], { topUpOnly: true });
    expect(await stacks("pill")).toEqual([20]);
    expect(result.unstacked).toEqual([{ itemId: "pill", quantity: 3 }]);
  });

  it("uses stacks the caller preloaded instead of reading them", async () => {
    await insertUserItems([
      { id: "ores", userId: PLAYER, itemId: "ore", quantity: 10 },
    ]);
    const db = await getTestDatabase();
    const preloaded = await listItemForGrantUserItems(db, PLAYER, ["ore"], new Date());
    await db.update(userItem).set({ quantity: 97 }).where(eq(userItem.id, "ores"));
    // The stack changed after the preload, so the guarded update refuses the snapshot's room.
    await grant([{ itemId: "ore", quantity: 5 }], { preloaded });
    expect(await stacks()).toEqual([5, 97]);
  });

  it("keeps parallel grants within the stack size", async () => {
    await insertUserItems([
      { id: "existing", userId: PLAYER, itemId: "ore", quantity: 90 },
    ]);
    const db = await getTestDatabase();
    await Promise.all([
      grantUserItems(db, PLAYER, [{ itemId: "ore", quantity: 8 }]),
      grantUserItems(db, PLAYER, [{ itemId: "ore", quantity: 8 }]),
    ]);
    const quantities = await stacks();
    expect(quantities.reduce((sum, quantity) => sum + quantity, 0)).toBe(106);
    expect(Math.max(...quantities)).toBeLessThanOrEqual(100);
  });

  it("runs inside a transaction", async () => {
    await insertUserItems([
      { id: "existing", userId: PLAYER, itemId: "ore", quantity: 10 },
    ]);
    const db = await getTestDatabase();
    await db.transaction((tx) =>
      grantUserItems(tx, PLAYER, [{ itemId: "ore", quantity: 3 }]),
    );
    expect(await stacks()).toEqual([13]);
  });
});
