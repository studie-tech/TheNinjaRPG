import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, userData, userItem, village } from "@/drizzle/schema";
import { homeRouter } from "@/server/api/routers/home";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import { aroundStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "storage-player";
const villageId = "storage-village";

const storedIds = async () => {
  const db = await getTestDatabase();
  const rows = await db.query.userItem.findMany({ where: eq(userItem.userId, userId) });
  return rows
    .filter((row) => row.storedAtHome && !row.id.startsWith("kept-"))
    .map((row) => row.id)
    .sort();
};

describeWithDatabase("home.moveUserItems", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, userData, village);
    const db = await getTestDatabase();
    await db
      .insert(village)
      .values({ id: villageId, name: "Storage Village", sector: 30, kageId: "kage" });
    // A tent: 15 item slots and 5 material slots, 4 of them already taken.
    await insertUsers([
      {
        userId,
        username: userId,
        villageId,
        sector: 30,
        status: "AWAKE",
        homeType: "NONE",
        federalStatus: "NONE",
      },
    ]);
    await insertItems([
      {
        id: "sword",
        name: "Sword",
        itemType: "WEAPON",
        slot: "HAND",
        cost: 10,
        inShop: true,
      },
      {
        id: "ore",
        name: "Ore",
        itemType: "MATERIAL",
        slot: "NONE",
        cost: 10,
        inShop: true,
      },
    ]);
    await insertUserItems([
      { id: "sword-a", userId, itemId: "sword" },
      { id: "sword-b", userId, itemId: "sword" },
      { id: "ore-a", userId, itemId: "ore" },
      { id: "ore-b", userId, itemId: "ore" },
      { id: "ore-c", userId, itemId: "ore" },
      { id: "worn", userId, itemId: "sword", equipped: "HAND_1" },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `kept-${index}`,
        userId,
        itemId: "ore",
        storedAtHome: true,
      })),
    ]);
  });

  it("stores several stacks at once and takes them out again", async () => {
    const home = await callerFor(homeRouter, userId);
    const stored = await home.moveUserItems({
      userItemIds: ["sword-a", "ore-a"],
      toHome: true,
    });
    expect(stored).toMatchObject({
      success: true,
      movedUserItemIds: ["sword-a", "ore-a"],
      refused: [],
      message: "Stored 2 items in your home.",
    });
    expect(await storedIds()).toEqual(["ore-a", "sword-a"]);
    const taken = await home.moveUserItems({ userItemIds: ["ore-a"], toHome: false });
    expect(taken).toMatchObject({
      success: true,
      movedUserItemIds: ["ore-a"],
      message: "Took 1 item out of your home.",
    });
    expect(await storedIds()).toEqual(["sword-a"]);
  });

  it("stores only what fits and names the stacks that stayed", async () => {
    const home = await callerFor(homeRouter, userId);
    const result = await home.moveUserItems({
      userItemIds: ["ore-a", "ore-b", "ore-c", "worn"],
      toHome: true,
    });
    // One material slot is left.
    expect(result.success).toBe(true);
    expect(result.movedUserItemIds).toEqual(["ore-a"]);
    expect(result.refused.map((entry) => [entry.userItemId, entry.reason])).toEqual([
      ["ore-b", "does not fit: Your home materials storage is full"],
      ["ore-c", "does not fit: Your home materials storage is full"],
      ["worn", "is equipped"],
    ]);
    expect(await storedIds()).toEqual(["ore-a"]);
  });

  it("refuses outside the player's own village without moving anything", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ sector: 31 }).where(eq(userData.userId, userId));
    const home = await callerFor(homeRouter, userId);
    expect(
      await home.moveUserItems({ userItemIds: ["sword-a"], toHome: true }),
    ).toMatchObject({
      success: false,
      message: "Return to your own village to use your home storage",
    });
    expect(await home.toggleStoreItem({ userItemId: "sword-a" })).toMatchObject({
      success: false,
      message: "Return to your own village to use your home storage",
    });
    expect(await storedIds()).toEqual([]);
  });

  it("refuses while travelling", async () => {
    const db = await getTestDatabase();
    await db
      .update(userData)
      .set({ status: "TRAVEL" })
      .where(eq(userData.userId, userId));
    const home = await callerFor(homeRouter, userId);
    expect(await home.toggleStoreItem({ userItemId: "sword-a" })).toMatchObject({
      success: false,
      message: "You cannot use your home storage right now",
    });
  });
});

describeWithDatabase("home.moveUserItems stacking", () => {
  const rows = async () =>
    (
      await (
        await getTestDatabase()
      ).query.userItem.findMany({
        where: eq(userItem.itemId, "herb"),
      })
    )
      .filter((row) => row.quantity > 0)
      .map((row) => [row.storedAtHome ? "home" : "carried", row.quantity])
      .sort();
  beforeEach(async () => {
    await resetTables(userItem, item, userData, village);
    await (await getTestDatabase())
      .insert(village)
      .values({ id: villageId, name: "Storage Village", sector: 30, kageId: "kage" });
    await insertUsers([
      {
        userId,
        username: userId,
        villageId,
        sector: 30,
        status: "AWAKE",
        homeType: "NONE",
      },
    ]);
    await insertItems([
      { id: "herb", name: "Herb", itemType: "MATERIAL", canStack: true, stackSize: 10 },
    ]);
  });

  it.each(["AWAKE", "ASLEEP"] as const)(
    "joins the stack already stored when depositing (%s)",
    async (status) => {
      await (await getTestDatabase())
        .update(userData)
        .set({ status })
        .where(eq(userData.userId, userId));
      await insertUserItems([
        { id: "herb-carried", userId, itemId: "herb", quantity: 4 },
        { id: "herb-stored", userId, itemId: "herb", quantity: 5, storedAtHome: true },
      ]);
      const home = await callerFor(homeRouter, userId);
      const result = await home.moveUserItems({
        userItemIds: ["herb-carried"],
        toHome: true,
      });
      expect(result.success).toBe(true);
      expect(await rows()).toEqual([["home", 9]]);
      expect(result.inventoryChanges).toBeDefined();
    },
  );

  it("joins the stack already carried when taking items out", async () => {
    await insertUserItems([
      { id: "herb-carried", userId, itemId: "herb", quantity: 2 },
      { id: "herb-stored", userId, itemId: "herb", quantity: 3, storedAtHome: true },
    ]);
    const home = await callerFor(homeRouter, userId);
    const result = await home.moveUserItems({
      userItemIds: ["herb-stored"],
      toHome: false,
    });
    expect(result.success).toBe(true);
    expect(await rows()).toEqual([["carried", 5]]);
  });

  it("joins the stored stack when one stack is stored from the home page", async () => {
    await insertUserItems([
      { id: "herb-carried", userId, itemId: "herb", quantity: 4 },
      { id: "herb-stored", userId, itemId: "herb", quantity: 5, storedAtHome: true },
    ]);
    const home = await callerFor(homeRouter, userId);
    expect((await home.toggleStoreItem({ userItemId: "herb-carried" })).success).toBe(
      true,
    );
    expect(await rows()).toEqual([["home", 9]]);
  });

  it("keeps stacks apart when together they exceed the stack size", async () => {
    await insertUserItems([
      { id: "herb-carried", userId, itemId: "herb", quantity: 7 },
      { id: "herb-stored", userId, itemId: "herb", quantity: 6, storedAtHome: true },
    ]);
    const home = await callerFor(homeRouter, userId);
    await home.moveUserItems({ userItemIds: ["herb-carried"], toHome: true });
    expect(await rows()).toEqual([
      ["home", 10],
      ["home", 3],
    ]);
  });

  it("keeps every unit when the stacks already hold more than the stack size", async () => {
    await insertUserItems([
      { id: "herb-carried", userId, itemId: "herb", quantity: 3 },
      { id: "herb-stored", userId, itemId: "herb", quantity: 25, storedAtHome: true },
    ]);
    const home = await callerFor(homeRouter, userId);
    expect(
      (await home.moveUserItems({ userItemIds: ["herb-carried"], toHome: true }))
        .success,
    ).toBe(true);
    expect(await rows()).toEqual([
      ["home", 25],
      ["home", 3],
    ]);
  });

  it("reports a committed move when the merge after it fails", async () => {
    await insertUserItems([
      { id: "herb-carried", userId, itemId: "herb", quantity: 4 },
      { id: "herb-stored", userId, itemId: "herb", quantity: 5, storedAtHome: true },
      { id: "herb-other", userId, itemId: "herb", quantity: 2 },
    ]);
    const failing = aroundStatements(
      await getTestDatabase(),
      userItem,
      async () => {
        throw new TypeError("fetch failed");
      },
      { when: (values) => "quantity" in values },
    );
    const home = callerForDatabase(homeRouter, userId, failing);
    const moved = await home.moveUserItems({
      userItemIds: ["herb-carried"],
      toHome: true,
    });
    expect(moved.success).toBe(true);
    // Without confirmed stacks the client reads the inventory again.
    expect(moved.movedUserItemIds).toBeUndefined();
    expect((await home.toggleStoreItem({ userItemId: "herb-other" })).success).toBe(
      true,
    );
    expect(await rows()).toEqual([
      ["home", 2],
      ["home", 4],
      ["home", 5],
    ]);
  });
});
