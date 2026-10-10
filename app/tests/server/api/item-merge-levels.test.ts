import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import { item, userData, userItem } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("consumable merges across ownership levels", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, userData);
    await insertUsers([{ userId: "merge-user", status: "AWAKE" }]);
    await insertItems([
      { id: "consumable", itemType: "CONSUMABLE", canStack: true, stackSize: 10 },
      { id: "weapon", itemType: "WEAPON", canStack: true, stackSize: 10 },
    ]);
  });

  it.each([false, true])("retains the highest-level keeper and stack cap (home: %s)", async (storedAtHome) => {
    await insertUserItems([
      { id: "a-low", userId: "merge-user", itemId: "consumable", quantity: 8, level: 1, storedAtHome },
      { id: "z-high", userId: "merge-user", itemId: "consumable", quantity: 7, level: 15, experience: 91, storedAtHome },
      { id: "b-middle", userId: "merge-user", itemId: "consumable", quantity: 3, level: 9, storedAtHome },
    ]);
    const api = await callerFor(itemRouter, "merge-user");
    const result = storedAtHome
      ? await api.mergeAllStacks({ storedAtHome: true })
      : await api.mergeStacks({ itemId: "consumable" });
    expect(result.success).toBe(true);
    const database = await getTestDatabase();
    const rows = await database.select().from(userItem).where(eq(userItem.userId, "merge-user"));
    expect(rows).toHaveLength(2);
    expect(rows.reduce((total, row) => total + row.quantity, 0)).toBe(18);
    expect(rows.find((row) => row.id === "z-high")).toMatchObject({ quantity: 10, level: 15, experience: 91 });
    expect(rows.find((row) => row.id === "b-middle")).toMatchObject({ quantity: 8, level: 9 });
  });

  it("keeps different-level gear separate", async () => {
    await insertUserItems([
      { id: "low", userId: "merge-user", itemId: "weapon", quantity: 3, level: 1 },
      { id: "high", userId: "merge-user", itemId: "weapon", quantity: 3, level: 15 },
    ]);
    const api = await callerFor(itemRouter, "merge-user");
    expect(await api.mergeAllStacks({ storedAtHome: false })).toMatchObject({ success: true, message: "Nothing to merge" });
    const database = await getTestDatabase();
    const rows = await database.select().from(userItem).where(eq(userItem.userId, "merge-user"));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.quantity)).toEqual([3, 3]);
  });
});
