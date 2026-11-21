import { and, eq, gt, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";
import { DURABILITY_MAX_DEFAULT, MAP_WAKE_ISLAND_SECTOR } from "@/drizzle/constants";
import {
  item,
  type UserData,
  type UserItem,
  userData,
  userItem,
  userItemImbuement,
} from "@/drizzle/schema";
import { supplyExperienceField } from "@/libs/supplyRequest";
import type { DrizzleClient } from "@/server/db";
import { hasNoHuntingBattle } from "@/server/utils/concurrency";
import { periodStart } from "@/utils/time";
import type { QuestTrackerType } from "@/validators/objectives";

/** Load carried stacks and the relations needed to exclude modified or reserved copies. */
export const listSupplyRequestStacks = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userItem.findMany({
    where: and(
      eq(userItem.userId, userId),
      gt(userItem.quantity, 0),
      eq(userItem.equipped, "NONE"),
      eq(userItem.storedAtHome, false),
    ),
    with: { item: true, imbuements: true },
  });

/**
 * Consume exactly one reviewed stack and award its daily payment in the same statement.
 * Drizzle cannot express a joined UPDATE; every mutable eligibility and snapshot guard
 * is repeated here so losing any race leaves both inventory and rewards untouched.
 */
export const submitSupplyRequestAtomically = (
  client: Pick<DrizzleClient, "execute" | "select">,
  user: Pick<UserData, "userId" | "updatedAt"> & {
    occupation: NonNullable<UserData["occupation"]>;
  },
  stack: Pick<UserItem, "id" | "itemId" | "quantity" | "updatedAt">,
  request: {
    quantity: number;
    auctionMaxPrice: number;
    ryo: number;
    experience: number;
    claimedAt: Date;
    updatedAt: Date;
    questData: QuestTrackerType[];
  },
) => {
  const experience = userData[supplyExperienceField(user.occupation)];
  const flag =
    user.occupation === "CRAFTING"
      ? item.canBeCrafted
      : user.occupation === "GATHERING"
        ? item.canBeGathered
        : item.canBeHunted;
  return client.execute(sql`UPDATE ${userItem}
    INNER JOIN ${userData} ON ${eq(userData.userId, userItem.userId)}
    INNER JOIN ${item} ON ${eq(item.id, userItem.itemId)}
    SET ${userItem.quantity} = ${userItem.quantity} - ${request.quantity},
        ${userItem.updatedAt} = ${sql.param(request.updatedAt, userItem.updatedAt)},
        ${userData.money} = ${userData.money} + ${request.ryo},
        ${experience} = ${experience} + ${request.experience},
        ${userData.supplyRequestAt} = ${sql.param(request.claimedAt, userData.supplyRequestAt)},
        ${userData.updatedAt} = ${sql.param(request.updatedAt, userData.updatedAt)},
        ${userData.questData} = ${sql.param(request.questData, userData.questData)}
    WHERE ${and(
      eq(userItem.id, stack.id),
      eq(userItem.itemId, stack.itemId),
      eq(userItem.userId, user.userId),
      eq(userItem.quantity, stack.quantity),
      eq(userItem.updatedAt, stack.updatedAt),
      eq(userItem.equipped, "NONE"),
      eq(userItem.storedAtHome, false),
      eq(userItem.isInAuction, false),
      or(
        isNull(userItem.craftingFinishedAt),
        lte(userItem.craftingFinishedAt, request.claimedAt),
      ),
      isNull(userItem.activeVariantId),
      eq(userItem.level, 1),
      eq(userItem.experience, 0),
      eq(userItem.durability, DURABILITY_MAX_DEFAULT),
      notExists(
        client
          .select({ id: userItemImbuement.id })
          .from(userItemImbuement)
          .where(eq(userItemImbuement.userItemId, userItem.id)),
      ),
      eq(item.auctionMaxPrice, request.auctionMaxPrice),
      eq(flag, true),
      eq(userData.updatedAt, user.updatedAt),
      eq(userData.occupation, user.occupation),
      eq(userData.status, "AWAKE"),
      eq(userData.isBanned, false),
      eq(userData.sector, MAP_WAKE_ISLAND_SECTOR),
      or(
        isNull(userData.supplyRequestAt),
        lt(userData.supplyRequestAt, periodStart("daily", request.claimedAt)),
      ),
      hasNoHuntingBattle(user.userId),
    )}`);
};
