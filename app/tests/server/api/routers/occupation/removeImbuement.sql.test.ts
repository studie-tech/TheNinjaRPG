import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, userData, userItem, userItemImbuement } from "@/drizzle/schema";
import { occupationRouter } from "@/server/api/routers/occupation";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const USER_ID = "imbuer";
const remove = async (userItemImbuementId = "imbuement") =>
  (await callerFor(occupationRouter, USER_ID)).removeImbuement({ userItemImbuementId });

const imbue = async (craftingFinishedAt = new Date(0)) =>
  (await getTestDatabase()).insert(userItemImbuement).values({
    id: "imbuement",
    userItemId: "sword-stack",
    imbuementItemId: "crystal",
    craftingFinishedAt,
  });

describeWithDatabase("imbuement removal", () => {
  beforeEach(async () => {
    await resetTables(userItemImbuement, userItem, item, userData);
    await insertUsers([
      { userId: USER_ID, username: "Imbuer", status: "AWAKE" },
      { userId: "other", username: "Other" },
    ]);
    await insertItems([
      { id: "sword", name: "Sword", itemType: "WEAPON", canBeImbued: true },
      { id: "retired", name: "Retired Sword", itemType: "WEAPON", canBeImbued: false },
      { id: "crystal", name: "Crystal" },
    ]);
  });

  it("removes the imbuement from an owned item", async () => {
    await insertUserItems([{ id: "sword-stack", userId: USER_ID, itemId: "sword" }]);
    await imbue();
    expect(await remove()).toEqual({
      success: true,
      message: "Removed Crystal from Sword",
    });
    const db = await getTestDatabase();
    expect(await db.select().from(userItemImbuement)).toEqual([]);
    expect(
      await db.select().from(userItem).where(eq(userItem.itemId, "crystal")),
    ).toEqual([]);
  });

  it("returns the crystal when the item can no longer be imbued", async () => {
    await insertUserItems([{ id: "sword-stack", userId: USER_ID, itemId: "retired" }]);
    await imbue();
    expect(await remove()).toEqual({
      success: true,
      message:
        "Removed Crystal from Retired Sword and returned the crystal to your inventory",
    });
    const db = await getTestDatabase();
    expect(
      await db.select().from(userItem).where(eq(userItem.itemId, "crystal")),
    ).toHaveLength(1);
  });

  it("tells a missing imbuement apart from another player's", async () => {
    expect(await remove("missing")).toEqual({
      success: false,
      message: "Imbuement not found",
    });
    await insertUserItems([{ id: "sword-stack", userId: "other", itemId: "sword" }]);
    await imbue();
    expect(await remove()).toEqual({
      success: false,
      message: "You don't own this item",
    });
    expect(
      await (await getTestDatabase()).select().from(userItemImbuement),
    ).toHaveLength(1);
  });

  it("refuses an imbuement still being crafted", async () => {
    await insertUserItems([{ id: "sword-stack", userId: USER_ID, itemId: "sword" }]);
    await imbue(new Date(Date.now() + 60_000));
    expect(await remove()).toEqual({
      success: false,
      message: "Cannot remove imbuement that is still being crafted",
    });
  });
});
