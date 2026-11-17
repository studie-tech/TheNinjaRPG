import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, itemLoadout, userData, userItem } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import { insertItems, insertUserItems, insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "bulk-equip-player";
const loadoutId = "bulk-equip-loadout";

const slots = async () =>
  Object.fromEntries(
    (
      await (
        await getTestDatabase()
      ).query.userItem.findMany({ where: eq(userItem.userId, userId) })
    ).map((row) => [row.id, row.equipped]),
  );

const byId = <T extends { id: string }>(rows: T[] | undefined) =>
  [...(rows ?? [])].sort((a, b) => a.id.localeCompare(b.id));

const itemUpdates = (statements: string[]) =>
  statements.filter((statement) => /^\s*update\s+`UserItem`/i.test(statement));

describeWithDatabase("bulk item equipment", () => {
  beforeEach(async () => {
    await resetTables(itemLoadout, userItem, item, userData);
    await insertUsers([
      {
        userId,
        username: "BulkEquip",
        level: 10,
        status: "AWAKE",
        itemLoadout: loadoutId,
      },
    ]);
    await insertItems([
      { id: "helmet", itemType: "ARMOR", slot: "HEAD", cost: 300 },
      { id: "boots", itemType: "ARMOR", slot: "FEET", cost: 200 },
      { id: "cheap-boots", itemType: "ARMOR", slot: "FEET", cost: 10 },
      { id: "belt", itemType: "ARMOR", slot: "WAIST", cost: 100 },
      { id: "cape", itemType: "ARMOR", slot: "CHEST", cost: 50, hidden: true },
    ]);
    await insertUserItems([
      { id: "worn-helmet", userId, itemId: "helmet", equipped: "HEAD" },
      { id: "worn-cape", userId, itemId: "cape", equipped: "CHEST" },
      { id: "spare-boots", userId, itemId: "boots" },
      { id: "spare-cheap-boots", userId, itemId: "cheap-boots" },
      { id: "spare-belt", userId, itemId: "belt" },
    ]);
    await (await getTestDatabase()).insert(itemLoadout).values({
      id: loadoutId,
      userId,
      itemData: [{ userItemId: "worn-helmet", itemId: "helmet", slot: "HEAD" }],
      hotkeys: {},
    });
  });

  it("unequips every worn row in one statement and reports the cleared loadout", async () => {
    const api = await callerFor(itemRouter, userId);
    const measured = await recordQueries(() => api.unequipAllItems());
    expect(measured.result).toMatchObject({
      success: true,
      clearedLoadoutId: loadoutId,
    });
    expect(byId(measured.result.equipmentChanges)).toEqual([
      { id: "worn-cape", equipped: "NONE", beforeEquipped: "CHEST" },
      { id: "worn-helmet", equipped: "NONE", beforeEquipped: "HEAD" },
    ]);
    expect(itemUpdates(measured.statements)).toHaveLength(1);
    expect(await slots()).toMatchObject({ "worn-helmet": "NONE", "worn-cape": "NONE" });
    const loadout = await (await getTestDatabase()).query.itemLoadout.findFirst({
      where: eq(itemLoadout.id, loadoutId),
    });
    expect(loadout?.itemData).toEqual([]);
  });

  it("confirms that no loadout changed when the active loadout is already empty", async () => {
    await (await getTestDatabase())
      .update(itemLoadout)
      .set({ itemData: [] })
      .where(eq(itemLoadout.id, loadoutId));
    const api = await callerFor(itemRouter, userId);
    expect(await api.unequipAllItems()).toMatchObject({
      success: true,
      clearedLoadoutId: null,
    });
  });

  it("withholds the projection when a worn row enters an auction before the write", async () => {
    const db = await getTestDatabase();
    const auctionFirst = beforeStatements(db, userItem, [
      () =>
        db
          .update(userItem)
          .set({ isInAuction: true })
          .where(eq(userItem.id, "worn-cape")),
    ]);
    const api = callerForDatabase(itemRouter, userId, auctionFirst);
    const result = await api.unequipAllItems();
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("equipmentChanges");
  });

  it("auto-equips every assignment in one statement and reports the filled slots", async () => {
    const api = await callerFor(itemRouter, userId);
    const measured = await recordQueries(() => api.autoEquipOptimal());
    expect(measured.result).toMatchObject({
      success: true,
      message: "Equipped 2 items",
    });
    expect(byId(measured.result.equipmentChanges)).toEqual([
      { id: "spare-belt", equipped: "WAIST", beforeEquipped: "NONE" },
      { id: "spare-boots", equipped: "FEET", beforeEquipped: "NONE" },
    ]);
    expect(itemUpdates(measured.statements)).toHaveLength(1);
    expect(await slots()).toMatchObject({
      "spare-boots": "FEET",
      "spare-belt": "WAIST",
      "spare-cheap-boots": "NONE",
    });
  });

  it("equips the rows still available and withholds the projection when one moved home", async () => {
    const db = await getTestDatabase();
    const storeFirst = beforeStatements(db, userItem, [
      () =>
        db
          .update(userItem)
          .set({ storedAtHome: true })
          .where(eq(userItem.id, "spare-belt")),
    ]);
    const api = callerForDatabase(itemRouter, userId, storeFirst);
    const result = await api.autoEquipOptimal();
    expect(result).toMatchObject({ success: true, message: "Equipped 1 item" });
    expect(result.equipmentChanges).toBeUndefined();
    expect(await slots()).toMatchObject({
      "spare-boots": "FEET",
      "spare-belt": "NONE",
    });
  });

  it("equips from the target and worn rows, swapping out the slot's current item", async () => {
    const api = await callerFor(itemRouter, userId);
    await api.toggleEquip({ userItemId: "spare-boots" });
    const swapped = await api.toggleEquip({ userItemId: "spare-cheap-boots" });
    expect(swapped.success).toBe(true);
    expect(byId(swapped.equipmentChanges)).toEqual([
      { id: "spare-boots", equipped: "NONE", beforeEquipped: "FEET" },
      { id: "spare-cheap-boots", equipped: "FEET", beforeEquipped: "NONE" },
    ]);
    expect(await slots()).toMatchObject({
      "spare-boots": "NONE",
      "spare-cheap-boots": "FEET",
    });
  });

  it("does not equip a hidden item", async () => {
    await insertUserItems([{ id: "spare-cape", userId, itemId: "cape" }]);
    const api = await callerFor(itemRouter, userId);
    expect(await api.toggleEquip({ userItemId: "spare-cape" })).toMatchObject({
      success: false,
      message: "User item not found",
    });
  });
});
