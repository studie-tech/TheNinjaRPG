import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  actionLog,
  craftingRequirement,
  gameAsset,
  item,
  itemVariant,
  userData,
  userItem,
} from "@/drizzle/schema";
import { fetchItemWithCraftingRequirements } from "@/queries/item";
import { gameAssetRouter } from "@/routers/asset";
import { itemRouter } from "@/routers/item";
import type { DrizzleClient } from "@/server/db";
import { ItemValidator } from "@/validators/combat";
import { ItemVariantValidator } from "@/validators/item";
import { seedLpcAssets } from "../../../../drizzle/seeds/lpc";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { beforeStatements } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const assignmentKinds = ["item", "variant-insert", "variant-update"] as const;
type AssignmentKind = (typeof assignmentKinds)[number];

describeWithDatabase("staff LPC item assignments", () => {
  beforeEach(async () => {
    stubRateLimitTransport({
      unexpectedRequestMessage: "Unexpected LPC test transport",
    });
    await resetTables(
      userItem,
      itemVariant,
      craftingRequirement,
      item,
      gameAsset,
      userData,
      actionLog,
    );
    const database = await getTestDatabase();
    await seedLpcAssets(database);
    await insertUsers([{ userId: "lpc-staff", role: "CODER" }]);
    await insertItems([
      {
        id: "lpc-coat",
        name: "Original coat",
        slot: "CHEST",
        itemType: "ARMOR",
        hidden: false,
      },
      { id: "lpc-thread", name: "Thread" },
    ]);
    await insertUserItems([
      { id: "lpc-worn", itemId: "lpc-coat", userId: "lpc-staff", equipped: "CHEST" },
    ]);
    await database.insert(craftingRequirement).values({
      id: "lpc-recipe",
      craftItemId: "lpc-coat",
      requirementItemId: "lpc-thread",
      quantity: 2,
    });
    await database.insert(itemVariant).values({
      id: "lpc-variant",
      itemId: "lpc-coat",
      name: "Original variant",
      image: "https://example.com/original.png",
      costType: "MONEY",
      cost: 5,
      order: 1,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(assignmentKinds)(
    "rejects %s when its selected design is deleted before the write",
    async (kind) => {
      const database = await getTestDatabase();
      const originalItem = await database
        .select()
        .from(item)
        .where(eq(item.id, "lpc-coat"));
      const originalVariants = await database.select().from(itemVariant);
      const originalRecipe = await database.select().from(craftingRequirement);
      const originalInventory = await database.select().from(userItem);
      const assets = callerForDatabase(gameAssetRouter, "lpc-staff", database);
      const interleaved = beforeStatements(
        database,
        kind === "item" ? item : itemVariant,
        [
          async () => {
            expect(await assets.delete({ id: "katana" })).toMatchObject({
              success: true,
            });
          },
        ],
      );

      const response = await saveAppearance(interleaved, kind, "katana");
      expect(response.success).toBe(false);
      expect(response.message).toContain("LPC design");
      expect(response.message.toLowerCase()).toContain("refresh and try again");
      expect(
        await database.query.gameAsset.findFirst({ where: eq(gameAsset.id, "katana") }),
      ).toBeUndefined();
      expect(await database.select().from(item).where(eq(item.id, "lpc-coat"))).toEqual(
        originalItem,
      );
      expect(await database.select().from(itemVariant)).toEqual(originalVariants);
      expect(await database.select().from(craftingRequirement)).toEqual(originalRecipe);
      expect(await database.select().from(userItem)).toEqual(originalInventory);
      // The successful asset deletion is logged; the rejected assignment has no success log.
      expect(
        await database.select({ relatedId: actionLog.relatedId }).from(actionLog),
      ).toEqual([{ relatedId: "katana" }]);
    },
  );

  it.each(assignmentKinds)(
    "saves %s with an existing design and prevents its deletion",
    async (kind) => {
      const database = await getTestDatabase();
      const response = await saveAppearance(database, kind, "katana");
      expect(response.success, response.message).toBe(true);
      expect(await savedAppearance(database, kind)).toMatchObject({
        lpcProfile: "katana",
        lpcColor: "red",
        name: "Edited appearance",
      });
      expect(
        await callerForDatabase(gameAssetRouter, "lpc-staff", database).delete({
          id: "katana",
        }),
      ).toMatchObject({ success: false });
      if (kind !== "variant-insert") {
        const repeated = await saveAppearance(database, kind, "katana");
        expect(repeated.success, repeated.message).toBe(true);
      }
    },
  );

  for (const profile of [null, "AUTO", "NONE"]) {
    it.each(assignmentKinds)(
      `saves %s with ${String(profile)} without a design reference`,
      async (kind) => {
        const database = await getTestDatabase();
        await database.delete(gameAsset);
        const response = await saveAppearance(database, kind, profile);
        expect(response.success, response.message).toBe(true);
        expect(await savedAppearance(database, kind)).toMatchObject({
          lpcProfile: profile,
          lpcColor: "red",
        });
      },
    );
  }

  it.each(assignmentKinds)(
    "rejects a new hidden-design assignment for %s",
    async (kind) => {
      const database = await getTestDatabase();
      await database
        .update(gameAsset)
        .set({ hidden: true })
        .where(eq(gameAsset.id, "katana"));
      expect(await saveAppearance(database, kind, "katana")).toMatchObject({
        success: false,
        message: "Choose a visible LPC design.",
      });
    },
  );

  it.each(["item", "variant-update"] as const)(
    "retains the existing hidden design for %s",
    async (kind) => {
      const database = await getTestDatabase();
      await database
        .update(gameAsset)
        .set({ hidden: true })
        .where(eq(gameAsset.id, "katana"));
      if (kind === "item") {
        await database
          .update(item)
          .set({ lpcProfile: "katana" })
          .where(eq(item.id, "lpc-coat"));
      } else {
        await database
          .update(itemVariant)
          .set({ lpcProfile: "katana" })
          .where(eq(itemVariant.id, "lpc-variant"));
      }
      const response = await saveAppearance(database, kind, "katana");
      expect(response.success, response.message).toBe(true);
      expect(await savedAppearance(database, kind)).toMatchObject({
        lpcProfile: "katana",
        lpcColor: "red",
      });
    },
  );
});

const saveAppearance = async (
  database: DrizzleClient,
  kind: AssignmentKind,
  profile: string | null,
) => {
  const api = callerForDatabase(itemRouter, "lpc-staff", database);
  if (kind === "item") {
    const row = await fetchItemWithCraftingRequirements(database, "lpc-coat");
    if (!row) throw new Error("Missing LPC coat fixture");
    return api.update({
      id: row.id,
      data: ItemValidator.parse({
        ...row,
        name: "Edited appearance",
        hidden: true,
        target: "SELF",
        method: "SINGLE",
        craftingRequirements: [],
        lpcProfile: profile,
        lpcColor: "red",
      }),
    });
  }
  return api.upsertItemVariant({
    itemId: "lpc-coat",
    variant: ItemVariantValidator.parse({
      id: kind === "variant-update" ? "lpc-variant" : undefined,
      name: "Edited appearance",
      image: "https://example.com/edited.png",
      costType: "MONEY",
      cost: 10,
      order: kind === "variant-update" ? 1 : 2,
      lpcProfile: profile,
      lpcColor: "red",
    }),
  });
};

const savedAppearance = (database: DrizzleClient, kind: AssignmentKind) =>
  kind === "item"
    ? database.query.item.findFirst({ where: eq(item.id, "lpc-coat") })
    : database.query.itemVariant.findFirst({
        where: eq(itemVariant.order, kind === "variant-update" ? 1 : 2),
      });
