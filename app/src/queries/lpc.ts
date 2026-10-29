import { and, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { userData, userItem } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

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

/** Public appearance inputs travel with the existing sector read, without a query per actor. */
export const spriteUserRelations = {
  attributes: { columns: { attribute: true } },
  items: {
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
