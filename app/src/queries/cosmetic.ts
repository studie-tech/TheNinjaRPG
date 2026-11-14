import { and, eq, exists, sql } from "drizzle-orm";
import type { ItemSlot } from "@/drizzle/constants";
import {
  item,
  itemVariant,
  userCosmetic,
  userCosmeticSlot,
  userData,
  userItem,
  userItemImbuement,
  userItemVariant,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Load the owned appearances and all variants for wardrobe selection. */
export const listCosmetics = (client: DrizzleClient, userId: string) =>
  client.query.userCosmetic.findMany({
    where: eq(userCosmetic.userId, userId),
    with: { item: { with: { variants: true } } },
  });
export const cosmeticSlotRelation = {
  with: {
    item: {
      columns: {
        id: true,
        name: true,
        image: true,
        slot: true,
        lpcProfile: true,
        lpcColor: true,
      },
    },
    variant: {
      columns: { id: true, name: true, image: true, lpcProfile: true, lpcColor: true },
    },
  },
} as const;
/** Load saved visuals alongside the character's equipment. */
export const listCosmeticSlots = (client: DrizzleClient, userId: string) =>
  client.query.userCosmeticSlot.findMany({
    where: eq(userCosmeticSlot.userId, userId),
    ...cosmeticSlotRelation,
  });
/** Resolve current character unlocks so later unlocks become available automatically. */
export const listCosmeticUnlocks = (client: DrizzleClient, userId: string) =>
  client.query.userItemVariant.findMany({ where: eq(userItemVariant.userId, userId) });
/** Load a conversion source with its definition and imbuements. */
export const findCosmeticSource = (client: DrizzleClient, userId: string, id: string) =>
  client.query.userItem.findFirst({
    where: and(eq(userItem.userId, userId), eq(userItem.id, id)),
    with: { item: true, imbuements: true },
  });

/** Claim ownership before debiting the source in the caller's transaction. */
export const claimCosmetic = (
  client: DrizzleClient,
  userId: string,
  itemId: string,
  id: string,
) =>
  client
    .insert(userCosmetic)
    .ignore()
    .select(
      sql`SELECT ${id}, ${userId}, ${itemId} FROM ${item} WHERE ${item.id} = ${itemId} AND ${item.slot} <> 'NONE' AND ${item.itemType} NOT IN ('MEAL', 'FURNITURE')`,
    );

/** Prevent source changes and combat admission from racing irreversible conversion. */
export const cosmeticSourceGuard = (userId: string, itemId: string) =>
  and(
    eq(userItem.itemId, itemId),
    eq(userItem.equipped, "NONE"),
    eq(userItem.isInAuction, false),
    eq(userItem.storedAtHome, false),
    sql`(${userItem.craftingFinishedAt} IS NULL OR ${userItem.craftingFinishedAt} <= CURRENT_TIMESTAMP(3))`,
    sql`NOT EXISTS (SELECT 1 FROM ${userItemImbuement} WHERE ${userItemImbuement.userItemId} = ${userItem.id})`,
    exists(
      sql`(SELECT 1 FROM ${userData} WHERE ${userData.userId} = ${userId} AND ${userData.status} <> 'BATTLE' AND ${userData.isBanned} = false)`,
    ),
  );

/** Persist a slot only while ownership, compatibility and any variant unlock remain valid. */
export const saveCosmeticSlot = (
  client: DrizzleClient,
  userId: string,
  slot: ItemSlot,
  itemId: string,
  variantId: string | null,
) =>
  client.execute(sql`
INSERT INTO ${userCosmeticSlot} (userId, slot, itemId, variantId)
SELECT ${userId}, ${slot}, ${itemId}, ${variantId} FROM ${userCosmetic}
INNER JOIN ${item} ON ${item.id} = ${userCosmetic.itemId}
INNER JOIN ${userData} ON ${userData.userId} = ${userCosmetic.userId}
WHERE ${userCosmetic.userId} = ${userId} AND ${userCosmetic.itemId} = ${itemId}
AND ${item.slot} <> 'NONE' AND ${item.itemType} NOT IN ('MEAL', 'FURNITURE') AND (${slot} = ${item.slot} OR (${item.slot} = 'HAND' AND ${slot} IN ('HAND_1', 'HAND_2')) OR (${item.slot} = 'ITEM' AND ${slot} IN ('ITEM_1','ITEM_2','ITEM_3','ITEM_4','ITEM_5','ITEM_6')))
AND ${userData.status} <> 'BATTLE' AND ${userData.isBanned} = false
AND (${variantId} IS NULL OR EXISTS (SELECT 1 FROM ${userItemVariant} INNER JOIN ${itemVariant} ON ${itemVariant.id} = ${userItemVariant.variantId} WHERE ${userItemVariant.userId} = ${userId} AND ${itemVariant.id} = ${variantId} AND ${itemVariant.itemId} = ${itemId}))
ON DUPLICATE KEY UPDATE itemId = VALUES(itemId), variantId = VALUES(variantId)`);

/** Clearing a slot is idempotent and preserves its wardrobe unlock. */
export const clearCosmeticSlot = (
  client: DrizzleClient,
  userId: string,
  slot: ItemSlot,
) =>
  client
    .delete(userCosmeticSlot)
    .where(and(eq(userCosmeticSlot.userId, userId), eq(userCosmeticSlot.slot, slot)));
/** Remove wardrobe references after staff deletes their source definition. */
export const deleteItemCosmetics = (client: DrizzleClient, itemId: string) =>
  Promise.all([
    client.delete(userCosmetic).where(eq(userCosmetic.itemId, itemId)),
    client.delete(userCosmeticSlot).where(eq(userCosmeticSlot.itemId, itemId)),
  ]);
/** Restore base cosmetic artwork when its variant is deleted. */
export const clearCosmeticVariant = (client: DrizzleClient, variantId: string) =>
  client
    .update(userCosmeticSlot)
    .set({ variantId: null })
    .where(eq(userCosmeticSlot.variantId, variantId));
/** Move wardrobe ownership and selections with a staff account rename. */
export const renameCosmetics = (
  client: DrizzleClient,
  userId: string,
  newUserId: string,
) =>
  Promise.all([
    client
      .update(userCosmetic)
      .set({ userId: newUserId })
      .where(eq(userCosmetic.userId, userId)),
    client
      .update(userCosmeticSlot)
      .set({ userId: newUserId })
      .where(eq(userCosmeticSlot.userId, userId)),
  ]);
