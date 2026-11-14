import { and, eq, exists, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { gameAsset, userData, userItem } from "@/drizzle/schema";
import { cosmeticSlotRelation } from "@/queries/cosmetic";
import type { DrizzleClient } from "@/server/db";

/** Resolve an explicit design assignment alongside the content editor's other upfront reads. */
export const findLpcDesignForSelection = (
  client: DrizzleClient,
  profile?: string | null,
) =>
  profile && profile !== "AUTO" && profile !== "NONE"
    ? client.query.gameAsset.findFirst({
        columns: { id: true, type: true, hidden: true, lpcConfig: true },
        where: eq(gameAsset.id, profile),
      })
    : Promise.resolve(undefined);

/** Keep explicit item and variant assignments valid if a design is deleted after selection validation. */
export const lpcDesignAssignmentGuard = (profile?: string | null) =>
  profile && profile !== "AUTO" && profile !== "NONE"
    ? exists(
        sql`(SELECT 1 FROM ${gameAsset} WHERE ${eq(gameAsset.id, profile)} AND ${eq(gameAsset.type, "LPC")})`,
      )
    : sql`TRUE`;

/**
 * Build one atomic body-style update guarded against bans and concurrent combat entry.
 * The caller checks rowsAffected; no read/lock/write transaction is required.
 */
export const updateSpriteBodyStyle = (
  client: DrizzleClient,
  userId: string,
  body: "male" | "female",
) =>
  client
    .update(userData)
    .set({ spriteBodyStyle: body })
    .where(
      and(
        eq(userData.userId, userId),
        ne(userData.status, "BATTLE"),
        eq(userData.isBanned, false),
      ),
    );

/** Private resolver inputs join the sector snapshot; callers publish only the resolved recipe. */
export const spriteUserRelations = {
  cosmeticSlots: cosmeticSlotRelation,
  attributes: { columns: { attribute: true } },
  items: {
    // Instance IDs distinguish two worn copies; the base item ID alone cannot identify them.
    columns: { id: true, equipped: true, quantity: true },
    where: and(
      ne(userItem.equipped, "NONE"),
      gt(userItem.quantity, 0),
      eq(userItem.isInAuction, false),
      eq(userItem.storedAtHome, false),
      or(
        isNull(userItem.craftingFinishedAt),
        lte(userItem.craftingFinishedAt, sql`CURRENT_TIMESTAMP(3)`),
      ),
    ),
    with: {
      item: {
        columns: {
          id: true,
          name: true,
          slot: true,
          itemType: true,
          weaponType: true,
          lpcProfile: true,
          lpcColor: true,
        },
      },
      activeVariant: {
        columns: { name: true, lpcProfile: true, lpcColor: true },
      },
    },
  },
} as const;
