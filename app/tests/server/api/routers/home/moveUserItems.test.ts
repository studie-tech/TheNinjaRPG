import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, userData, userItem, village } from "@/drizzle/schema";
import { homeRouter } from "@/server/api/routers/home";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
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
