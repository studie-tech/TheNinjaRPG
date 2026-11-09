import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { item, itemVariant, userData } from "@/drizzle/schema";
import { itemRouter } from "@/server/api/routers/item";
import {
  DEFAULT_FURNITURE_DATA,
  FURNITURE_ITEM_DEFAULTS,
} from "@/validators/itemFurniture";
import { insertItems, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const author = "furniture-author";
const variant = {
  name: "Red Cabinet",
  image: "/red-cabinet.webp",
  costType: "MONEY" as const,
  cost: 0,
  order: 1,
  furnitureData: { views: { "90": { image: "/red-cabinet-90.webp", width: 18 } } },
};

/** The ordinary variant endpoint stores directional art and rejects it for combat items. */
describeWithDatabase("furniture variant content", () => {
  beforeEach(async () => {
    await resetTables(itemVariant, item, userData);
    await insertUsers([{ userId: author, username: author, role: "OWNER" }]);
    await insertItems([
      {
        ...FURNITURE_ITEM_DEFAULTS,
        id: "furniture-cabinet",
        name: "Cabinet",
        itemType: "FURNITURE",
        furnitureData: DEFAULT_FURNITURE_DATA,
      },
      { id: "ordinary-sword", name: "Sword", itemType: "WEAPON" },
    ]);
  });

  it("persists and exposes replacement directions through the existing variant endpoints", async () => {
    const api = await callerFor(itemRouter, author);
    expect(
      (await api.upsertItemVariant({ itemId: "furniture-cabinet", variant })).success,
    ).toBe(true);
    const [created] = await api.getItemVariants({ itemId: "furniture-cabinet" });
    expect(created?.furnitureData).toEqual(variant.furnitureData);
    const replacement = {
      views: { "180": { image: "/red-cabinet-180.webp", groundAnchor: 85 } },
    };
    expect(
      (
        await api.upsertItemVariant({
          itemId: "furniture-cabinet",
          variant: { ...variant, id: created!.id, furnitureData: replacement },
        })
      ).success,
    ).toBe(true);
    expect(
      (await api.getItemVariants({ itemId: "furniture-cabinet" }))[0]?.furnitureData,
    ).toEqual(replacement);
    expect(
      (
        await api.upsertItemVariant({
          itemId: "furniture-cabinet",
          variant: { ...variant, id: created!.id, furnitureData: null },
        })
      ).success,
    ).toBe(true);
    expect(
      (await api.getItemVariants({ itemId: "furniture-cabinet" }))[0]?.furnitureData,
    ).toBeNull();
  });

  it("rejects ordinary item orientations before writing and preserves ordinary variants", async () => {
    const api = await callerFor(itemRouter, author);
    const rejected = await api.upsertItemVariant({ itemId: "ordinary-sword", variant });
    expect(rejected.success).toBe(false);
    expect(rejected.message).toContain("Only furniture");
    expect(await api.getItemVariants({ itemId: "ordinary-sword" })).toEqual([]);
    expect(
      (
        await api.upsertItemVariant({
          itemId: "ordinary-sword",
          variant: { ...variant, furnitureData: null },
        })
      ).success,
    ).toBe(true);
    expect(
      (await api.getItemVariants({ itemId: "ordinary-sword" }))[0]?.furnitureData,
    ).toBeNull();
  });

  it("clears a furniture skin's directions when the variant is deleted", async () => {
    const api = await callerFor(itemRouter, author);
    expect(
      (await api.upsertItemVariant({ itemId: "furniture-cabinet", variant })).success,
    ).toBe(true);
    const [created] = await api.getItemVariants({ itemId: "furniture-cabinet" });
    expect((await api.deleteItemVariant({ variantId: created!.id })).success).toBe(
      true,
    );
    const database = await getTestDatabase();
    expect(
      await database.select().from(itemVariant).where(eq(itemVariant.id, created!.id)),
    ).toEqual([]);
  });
});
