import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq, getTableName } from "drizzle-orm";
import { actionLog, item, itemVariant, userData, userItem, userItemImbuement, userItemVariant } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import { UnlockItemVariantTag } from "@/validators/combat";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { beforeStatements, failStatements } from "../../../setup/statements";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

/** Staff authoring must preserve requirements that players can satisfy. */
describeWithDatabase("item variant unlock requirements", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(actionLog, userItemVariant, itemVariant, userItemImbuement, userItem, item, userData);
    await insertUsers([{ userId: "staff", username: "Staff", role: "OWNER" }]);
    await insertItems([
      { id: "weapon", name: "Sword", itemType: "WEAPON" },
      { id: "token", name: "Token", itemType: "CONSUMABLE", effects: [UnlockItemVariantTag.parse({})] },
      { id: "ore", name: "Ore" },
    ]);
    await (await getTestDatabase()).insert(itemVariant).values({ id: "variant", itemId: "weapon", name: "Red", image: "/red.png", costType: "VARIANT_TOKEN", requiredItemId: "token" });
  });

  afterEach(() => vi.restoreAllMocks());

  it("lists only token-gated variants for unlock-effect authoring", async () => {
    const db = await getTestDatabase();
    await db.insert(itemVariant).values({ id: "currency-variant", itemId: "weapon", name: "Blue", image: "/blue.png", costType: "MONEY", cost: 100, order: 2 });
    const api = await callerFor(itemRouter, "staff");
    expect(await api.getVariantNames()).toEqual([{ id: "variant", name: "Sword: Red" }]);
  });

  it("rejects unusable required items and accepts generic or specifically matching tokens", async () => {
    const db = await getTestDatabase();
    const api = await callerFor(itemRouter, "staff");
    const variant = { id: "variant", name: "Red", image: "/red.png", costType: "VARIANT_TOKEN" as const, cost: 0, order: 1, requiredItemId: "ore" };
    expect(await api.upsertItemVariant({ itemId: "weapon", variant })).toMatchObject({ success: false, message: "Required unlock item cannot unlock this variant" });
    expect((await api.getItemVariants({ itemId: "weapon" }))[0]?.requiredItemId).toBe("token");
    for (const variantId of ["other-variant", "variant", null]) {
      await db.update(item).set({ effects: [UnlockItemVariantTag.parse({ variantId })] }).where(eq(item.id, "token"));
      const result = await api.upsertItemVariant({ itemId: "weapon", variant: { ...variant, requiredItemId: "token" } });
      expect(result.success).toBe(variantId !== "other-variant");
      const names = await api.getAllNames();
      expect(names.find((entry) => entry.id === "token")?.unlockVariantIds).toEqual([variantId]);
      expect(names.find((entry) => entry.id === "ore")?.unlockVariantIds).toEqual([]);
    }
  });

  it("blocks deleting a required token before deleting its inventory, then permits deletion after reassignment", async () => {
    const db = await getTestDatabase();
    await insertUserItems([{ id: "staff-token", userId: "staff", itemId: "token" }]);
    const api = await callerFor(itemRouter, "staff");
    expect(await api.delete({ id: "token" })).toMatchObject({ success: false, message: expect.stringContaining("Change their required unlock item first") });
    expect(await db.select().from(userItem).where(eq(userItem.id, "staff-token"))).toHaveLength(1);
    await db.update(itemVariant).set({ requiredItemId: null }).where(eq(itemVariant.id, "variant"));
    expect(await api.delete({ id: "token" })).toMatchObject({ success: true });
    expect(await db.select().from(item).where(eq(item.id, "token"))).toHaveLength(0);
  });

  it("retains the item and every dependent row when a variant starts requiring it before deletion", async () => {
    const db = await getTestDatabase();
    await db.update(itemVariant).set({ requiredItemId: null }).where(eq(itemVariant.id, "variant"));
    await db.insert(itemVariant).values({ id: "token-skin", itemId: "token", name: "Token skin", image: "/token.png", costType: "MONEY" });
    await db.insert(userItemVariant).values({ id: "staff-skin", userId: "staff", variantId: "token-skin" });
    await insertUserItems([{ id: "staff-token", userId: "staff", itemId: "token", quantity: 5 }]);
    await db.insert(userItemImbuement).values({ id: "imbuement", userItemId: "staff-token", imbuementItemId: "token", craftingFinishedAt: new Date() });
    const api = callerForDatabase(itemRouter, "staff", beforeStatements(db, item, [async () => {
      await db.update(itemVariant).set({ requiredItemId: "token" }).where(eq(itemVariant.id, "variant"));
    }]));
    expect(await api.delete({ id: "token" })).toMatchObject({ success: false, message: expect.stringContaining("Delete incomplete") });
    expect(await db.select().from(item).where(eq(item.id, "token"))).toHaveLength(1);
    expect(await db.select().from(itemVariant).where(eq(itemVariant.id, "token-skin"))).toHaveLength(1);
    expect(await db.select().from(userItemVariant)).toHaveLength(1);
    expect((await db.select().from(userItem))[0]?.quantity).toBe(5);
    expect(await db.select().from(userItemImbuement)).toHaveLength(1);
  });

  it("allows deletion when only the item's own variants require it", async () => {
    const db = await getTestDatabase();
    await db.update(itemVariant).set({ itemId: "token" }).where(eq(itemVariant.id, "variant"));
    expect(await (await callerFor(itemRouter, "staff")).delete({ id: "token" })).toMatchObject({ success: true });
    expect(await db.select().from(itemVariant)).toHaveLength(0);
  });

  for (const isUpdate of [false, true]) {
    for (const deletedId of ["token", "weapon"]) {
      it(`rejects variant ${isUpdate ? "updates" : "inserts"} when ${deletedId} is deleted after validation`, async () => {
        const db = await getTestDatabase();
        await db.update(itemVariant).set({ requiredItemId: null }).where(eq(itemVariant.id, "variant"));
        const api = await callerFor(itemRouter, "staff");
        const interleaved = callerForDatabase(itemRouter, "staff", beforeStatements(db, itemVariant, [async () => {
          expect(await api.delete({ id: deletedId })).toMatchObject({ success: true });
        }]));
        expect(await interleaved.upsertItemVariant({ itemId: "weapon", variant: { id: isUpdate ? "variant" : undefined, name: "Red", image: "/red.png", costType: "VARIANT_TOKEN", cost: 0, order: isUpdate ? 1 : 2, requiredItemId: "token" } })).toMatchObject({ success: false, message: expect.stringContaining("changed") });
        const variants = await db.select().from(itemVariant);
        expect(variants).toHaveLength(deletedId === "weapon" ? 0 : 1);
        expect(variants.every((variant) => variant.requiredItemId === null)).toBe(true);
        expect(await db.select().from(item).where(eq(item.id, deletedId))).toHaveLength(0);
      });
    }
  }

  it("cleans variants added between the initial reads and parent deletion", async () => {
    const db = await getTestDatabase();
    await db.update(itemVariant).set({ requiredItemId: null }).where(eq(itemVariant.id, "variant"));
    const api = await callerFor(itemRouter, "staff");
    const interleaved = callerForDatabase(itemRouter, "staff", beforeStatements(db, item, [async () => {
      expect(await api.upsertItemVariant({ itemId: "token", variant: { name: "Token skin", image: "/token.png", costType: "MONEY", cost: 0, order: 1, requiredItemId: null } })).toMatchObject({ success: true });
      const [variant] = await api.getItemVariants({ itemId: "token" });
      await db.insert(userItemVariant).values({ id: "staff-skin", userId: "staff", variantId: variant!.id });
    }]));
    expect(await interleaved.delete({ id: "token" })).toMatchObject({ success: true });
    expect(await db.select().from(itemVariant).where(eq(itemVariant.itemId, "token"))).toHaveLength(0);
    expect(await db.select().from(userItemVariant)).toHaveLength(0);
  });

  for (const table of [userItemVariant, itemVariant, userItem, userItemImbuement]) {
    it(`retries dependent cleanup after ${getTableName(table)} deletion fails`, async () => {
      const db = await getTestDatabase();
      await db.update(itemVariant).set({ itemId: "token" }).where(eq(itemVariant.id, "variant"));
      await db.insert(userItemVariant).values({ id: "staff-skin", userId: "staff", variantId: "variant" });
      await insertUserItems([{ id: "staff-token", userId: "staff", itemId: "token" }]);
      await db.insert(userItemImbuement).values({ id: "imbuement", userItemId: "staff-token", imbuementItemId: "token", craftingFinishedAt: new Date() });
      const failed = callerForDatabase(itemRouter, "staff", failStatements(db, table));
      await expect(failed.delete({ id: "token" })).rejects.toThrow("Statement failed on purpose");
      expect(await db.select().from(item).where(eq(item.id, "token"))).toHaveLength(0);
      const logs = await db.select().from(actionLog);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ userId: "staff", tableName: "item", relatedId: "token", changes: ["Deleted: Token"] });
      expect(await (await callerFor(itemRouter, "staff")).delete({ id: "token" })).toMatchObject({ success: true });
      expect(await db.select().from(actionLog)).toEqual(logs);
      expect(await db.select().from(itemVariant)).toHaveLength(0);
      expect(await db.select().from(userItemVariant)).toHaveLength(0);
      expect(await db.select().from(userItem)).toHaveLength(0);
      expect(await db.select().from(userItemImbuement)).toHaveLength(0);
    });
  }
});
