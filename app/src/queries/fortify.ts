import { and, eq, exists, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import type { UserData, UserItemWithRelations } from "@/drizzle/schema";
import { item, userData, userItem, userItemImbuement } from "@/drizzle/schema";
import type { rollFortify } from "@/libs/fortify";
import { actionReadinessSqlSet } from "@/queries/actionReadiness";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";

/** Include hidden evolution children when deciding whether a definition is terminal. */
export const findFortifyEvolutions = (db: DrizzleClient) =>
  db
    .select({ parentItemId: item.parentItemId })
    .from(item)
    .where(sql`${item.parentItemId} IS NOT NULL`);

/** Charge and enhance one owned copy in one guarded write, including content and battle guards. */
export const attemptFortify = (
  db: DrizzleClient,
  user: Pick<UserData, "userId" | "updatedAt" | "occupation">,
  owned: UserItemWithRelations,
  result: ReturnType<typeof rollFortify>,
  updatedAt: Date,
  readiness?: ActionReadinessWrite,
) => {
  const child = alias(item, "fortifyChild");
  return db.execute(sql`
    UPDATE ${userItem}
    INNER JOIN ${userData} ON ${userData.userId} = ${userItem.userId}
    INNER JOIN ${item} ON ${item.id} = ${userItem.itemId}
    SET ${actionReadinessSqlSet(readiness, [])}
        ${userData.money} = ${userData.money} - ${result.cost},
        ${userData.updatedAt} = ${nextSnapshotSql(userData.updatedAt)},
        ${userItem.fortification} = ${JSON.stringify(result.state)},
        ${userItem.updatedAt} = ${sql.param(updatedAt, userItem.updatedAt)}
    WHERE ${and(
      eq(userData.userId, user.userId),
      eq(userData.updatedAt, user.updatedAt),
      readiness?.where ?? eq(userData.status, "AWAKE"),
      eq(userData.isBanned, false),
      isNull(userData.battleId),
      user.occupation
        ? eq(userData.occupation, user.occupation)
        : isNull(userData.occupation),
      sql`${userData.money} >= ${result.cost}`,
      eq(userItem.id, owned.id),
      eq(userItem.itemId, owned.itemId),
      eq(userItem.updatedAt, owned.updatedAt),
      owned.fortification
        ? sql`${userItem.fortification} = CAST(${JSON.stringify(owned.fortification)} AS JSON)`
        : isNull(userItem.fortification),
      eq(userItem.quantity, 1),
      eq(userItem.isInAuction, false),
      or(
        isNull(userItem.craftingFinishedAt),
        lte(userItem.craftingFinishedAt, new Date()),
      ),
      eq(item.updatedAt, owned.item.updatedAt),
      eq(item.canBeEnhanced, true),
      eq(item.itemType, owned.item.itemType),
      sql`${item.effects} = CAST(${JSON.stringify(owned.item.effects)} AS JSON)`,
      notExists(
        db
          .select({ id: child.id })
          .from(child)
          .where(eq(child.parentItemId, owned.itemId)),
      ),
      notExists(
        db
          .select({ id: userItemImbuement.id })
          .from(userItemImbuement)
          .where(
            and(
              eq(userItemImbuement.userItemId, owned.id),
              sql`${userItemImbuement.craftingFinishedAt} > NOW(3)`,
            ),
          ),
      ),
    )}
  `);
};

/** Recheck authored tags and all evolution children when publishing a service receipt. */
export const fortifyDefinitionGuard = (
  db: DrizzleClient,
  owned: UserItemWithRelations,
) => {
  const child = alias(item, "fortifyServiceChild");
  return exists(
    db
      .select({ id: item.id })
      .from(item)
      .where(
        and(
          eq(item.id, owned.itemId),
          eq(item.updatedAt, owned.item.updatedAt),
          eq(item.canBeEnhanced, true),
          sql`${item.effects} = CAST(${JSON.stringify(owned.item.effects)} AS JSON)`,
          notExists(
            db
              .select({ id: child.id })
              .from(child)
              .where(eq(child.parentItemId, owned.itemId)),
          ),
        ),
      ),
  );
};
