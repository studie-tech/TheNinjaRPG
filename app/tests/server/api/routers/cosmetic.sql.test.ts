import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  item,
  itemVariant,
  userCosmetic,
  userCosmeticSlot,
  userData,
  userItem,
  userItemVariant,
} from "@/drizzle/schema";
import { cosmeticRouter } from "@/server/api/routers/cosmetic";
import { insertItems, insertUserItems, insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("cosmetic ownership and selection", () => {
  beforeEach(async () => {
    await resetTables(
      userCosmeticSlot,
      userCosmetic,
      userItemVariant,
      itemVariant,
      userItem,
      item,
      userData,
    );
    await insertUsers([{ userId: "cosmetic-owner", status: "AWAKE" }]);
    await insertItems([{ id: "cosmetic-hat", slot: "HEAD", itemType: "ARMOR" }]);
    await insertUserItems([
      {
        id: "hat-stack",
        userId: "cosmetic-owner",
        itemId: "cosmetic-hat",
        quantity: 2,
        equipped: "NONE",
      },
    ]);
  });

  it("consumes one copy exactly once across concurrent requests", async () => {
    const caller = await callerFor(cosmeticRouter, "cosmetic-owner");
    const results = await Promise.all([
      caller.make({ userItemId: "hat-stack", expectedQuantity: 2 }),
      caller.make({ userItemId: "hat-stack", expectedQuantity: 2 }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const db = await getTestDatabase();
    expect(
      (await db.query.userItem.findFirst({ where: eq(userItem.id, "hat-stack") }))
        ?.quantity,
    ).toBe(1);
    expect(await db.query.userCosmetic.findMany()).toHaveLength(1);
  });

  it("rolls back ownership when the source quantity changed", async () => {
    const caller = await callerFor(cosmeticRouter, "cosmetic-owner");
    expect(
      (await caller.make({ userItemId: "hat-stack", expectedQuantity: 1 })).success,
    ).toBe(false);
    const db = await getTestDatabase();
    expect(await db.query.userCosmetic.findMany()).toHaveLength(0);
    expect((await db.query.userItem.findFirst())?.quantity).toBe(2);
  });

  it("removes the last real copy and retains ownership after clearing a slot", async () => {
    const db = await getTestDatabase();
    await db.update(userItem).set({ quantity: 1 }).where(eq(userItem.id, "hat-stack"));
    const caller = await callerFor(cosmeticRouter, "cosmetic-owner");
    expect(
      (await caller.make({ userItemId: "hat-stack", expectedQuantity: 1 })).success,
    ).toBe(true);
    expect(await db.query.userItem.findMany()).toHaveLength(0);
    expect(
      (await caller.select({ slot: "HEAD", itemId: "cosmetic-hat" })).success,
    ).toBe(true);
    expect(
      (await caller.select({ slot: "FEET", itemId: "cosmetic-hat" })).success,
    ).toBe(false);
    expect(
      (
        await caller.select({
          slot: "HEAD",
          itemId: "cosmetic-hat",
          variantId: "locked",
        })
      ).success,
    ).toBe(false);
    expect((await caller.select({ slot: "HEAD", itemId: null })).success).toBe(true);
    expect((await caller.get()).slots).toHaveLength(0);
    expect((await caller.get()).owned).toHaveLength(1);
    expect(
      (await caller.select({ slot: "HEAD", itemId: "cosmetic-hat" })).success,
    ).toBe(true);
  });
  it("uses later variant unlocks and rejects variants belonging to another item", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(cosmeticRouter, "cosmetic-owner");
    await caller.make({ userItemId: "hat-stack", expectedQuantity: 2 });
    await insertItems([{ id: "other-hat", slot: "HEAD", itemType: "ARMOR" }]);
    await db.insert(itemVariant).values([
      {
        id: "hat-red",
        itemId: "cosmetic-hat",
        name: "Red hat",
        image: "https://example.com/red.png",
        costType: "MONEY",
      },
      {
        id: "other-red",
        itemId: "other-hat",
        name: "Other hat",
        image: "https://example.com/other.png",
        costType: "MONEY",
      },
    ]);
    expect(
      (
        await caller.select({
          slot: "HEAD",
          itemId: "cosmetic-hat",
          variantId: "hat-red",
        })
      ).success,
    ).toBe(false);
    await db.insert(userItemVariant).values([
      { id: "unlock-red", userId: "cosmetic-owner", variantId: "hat-red" },
      { id: "unlock-other", userId: "cosmetic-owner", variantId: "other-red" },
    ]);
    expect(
      (
        await caller.select({
          slot: "HEAD",
          itemId: "cosmetic-hat",
          variantId: "hat-red",
        })
      ).success,
    ).toBe(true);
    expect(
      (
        await caller.select({
          slot: "HEAD",
          itemId: "cosmetic-hat",
          variantId: "other-red",
        })
      ).success,
    ).toBe(false);
    expect((await caller.get()).slots[0]?.variant?.id).toBe("hat-red");
  });
});
