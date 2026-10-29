import { and, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { userData, userItem } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

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
