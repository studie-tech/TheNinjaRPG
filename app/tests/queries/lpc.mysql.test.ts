import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, itemVariant, userAttribute, userData, userItem } from "@/drizzle/schema";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { updateSpriteBodyStyle } from "@/queries/lpc";
import { fetchItemWithCraftingRequirements } from "@/queries/item";
import { itemRouter } from "@/routers/item";
import { ItemValidator } from "@/validators/combat";
import { ItemVariantValidator } from "@/validators/item";
import { listUserItemForFetchUserItems, listUserItemForFetchUserItemsWithVariants } from "@/queries/item";
import { findUserDataForQueryUpdatedUser } from "@/queries/profile";
import { fetchSectorWindowData } from "@/queries/travel";
import type { DrizzleClient } from "@/server/db";
import { insertItems, insertUserItems, insertUsers } from "../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../setup/testDatabase";

// Exercise production query/mutation contracts against real rows, including selected variants and guards.
describeWithDatabase("sprite appearance database snapshots", () => {
  beforeEach(async () => {
    await resetTables(userItem, itemVariant, item, userAttribute, userData);
    await insertUsers([{ userId: "sprite-owner", gender: "Other", spriteBodyStyle: "female", sector: 724, status: "AWAKE" }]);
    await insertItems([{ id: "sprite-coat", name: "Test coat", slot: "CHEST", itemType: "ARMOR", lpcProfile: "plate", lpcColor: "blue" }]);
    const database = await getTestDatabase();
    await database.insert(itemVariant).values({ id: "sprite-red-coat", itemId: "sprite-coat", name: "Red leather", image: "/coat.png", costType: "MONEY", lpcProfile: "leather", lpcColor: "red" });
    await database.insert(userAttribute).values([{ id: "sprite-hair", userId: "sprite-owner", attribute: "Long Hair" }, { id: "sprite-color", userId: "sprite-owner", attribute: "Blue hair" }]);
    await insertUserItems([{ id: "sprite-worn", userId: "sprite-owner", itemId: "sprite-coat", equipped: "CHEST", activeVariantId: "sprite-red-coat" }]);
  });
  it("loads creation traits and the selected worn variant in the existing sector snapshot", async () => {
    const client = await getTestDatabase() as unknown as DrizzleClient;
    const [users] = await fetchSectorWindowData(client, "viewer", 724);
    const user = users.find((entry) => entry.userId === "sprite-owner");
    expect(user).toBeDefined();
    if (!user) return;
    const appearance = resolveSpriteAppearance(user);
    expect(appearance.body).toBe("female");
    expect(appearance.layers.find((layer) => layer.slot === "hair")).toMatchObject({ profile: "hair-long", color: "blue" });
    expect(appearance.layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "leather", color: "red" });
  });
  it("uses the same appearance inputs for the authenticated profile", async () => {
    const client = await getTestDatabase() as unknown as DrizzleClient;
    const user = await findUserDataForQueryUpdatedUser(client, "sprite-owner");
    expect(user?.attributes).toHaveLength(2);
    expect(user?.items[0]?.activeVariant?.lpcColor).toBe("red");
  });
  it("persists staff item and variant appearance overrides through their existing mutations", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ role: "CODER" }).where(eq(userData.userId, "sprite-owner"));
    const api = callerForDatabase(itemRouter, "sprite-owner", database);
    const row = await fetchItemWithCraftingRequirements(database as unknown as DrizzleClient, "sprite-coat");
    if (!row) throw new Error("Missing coat fixture");
    const response = await api.update({ id: row.id, data: ItemValidator.parse({ ...row, target: "SELF", method: "SINGLE", lpcProfile: "robe", lpcColor: "green" }) });
    expect(response.success, response.message).toBe(true);
    expect(await database.query.item.findFirst({ where: eq(item.id, row.id) })).toMatchObject({ lpcProfile: "robe", lpcColor: "green" });
    const variant = ItemVariantValidator.parse({ name: "Emerald cloak", image: "https://example.com/sprite.png", costType: "MONEY", cost: 0, order: 2, lpcProfile: "cloak", lpcColor: "green" });
    const created = await api.upsertItemVariant({ itemId: row.id, variant });
    expect(created.success, created.message).toBe(true);
    const saved = await database.query.itemVariant.findFirst({ where: eq(itemVariant.name, variant.name) });
    expect(saved).toMatchObject({ lpcProfile: "cloak", lpcColor: "green" });
    if (!saved) throw new Error("Missing saved variant");
    const updated = await api.upsertItemVariant({ itemId: row.id, variant: { ...variant, id: saved.id, lpcProfile: "leather", lpcColor: "purple" } });
    expect(updated.success, updated.message).toBe(true);
    expect(await database.query.itemVariant.findFirst({ where: eq(itemVariant.id, saved.id) })).toMatchObject({ lpcProfile: "leather", lpcColor: "purple" });
  });
  it("retains both worn copies of the same weapon in a sector appearance", async () => {
    const client = await getTestDatabase() as unknown as DrizzleClient;
    await insertItems([{ id: "sprite-blades", name: "Twin knives", slot: "HAND", itemType: "WEAPON", weaponType: "DAGGER", lpcProfile: "dagger" }]);
    await insertUserItems([
      { id: "sprite-left", userId: "sprite-owner", itemId: "sprite-blades", equipped: "HAND_1" },
      { id: "sprite-right", userId: "sprite-owner", itemId: "sprite-blades", equipped: "HAND_2" },
    ]);
    const [users] = await fetchSectorWindowData(client, "viewer", 724);
    const user = users.find((entry) => entry.userId === "sprite-owner")!;
    const appearance = resolveSpriteAppearance(user);
    expect(appearance.layers.filter((layer) => layer.profile === "dagger")).toEqual([
      { slot: "HAND_1", profile: "dagger", color: "gray" },
      { slot: "HAND_2", profile: "dagger", color: "gray", mirror: true },
    ]);
  });
  it("preserves the selected appearance in inventory responses used by equipment cache patches", async () => {
    const client = await getTestDatabase() as unknown as DrizzleClient;
    const inventories = await Promise.all([
      listUserItemForFetchUserItems(client, "sprite-owner"),
      listUserItemForFetchUserItemsWithVariants(client, "sprite-owner"),
    ]);
    for (const items of inventories) {
      const appearance = resolveSpriteAppearance({ items });
      expect(appearance.layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "leather", color: "red" });
    }
  });
  it("prevents body edits after a concurrent transition into combat", async () => {
    const database = await getTestDatabase();
    await database.update(userData).set({ status: "BATTLE" }).where(eq(userData.userId, "sprite-owner"));
    const result = await updateSpriteBodyStyle(database as unknown as DrizzleClient, "sprite-owner", "male");
    expect(result.rowsAffected).toBe(0);
    const user = await database.query.userData.findFirst({ where: eq(userData.userId, "sprite-owner") });
    expect(user?.spriteBodyStyle).toBe("female");
  });
});
