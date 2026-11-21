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
import { actionReadinessSqlSet } from "@/queries/actionReadiness";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";
import { hasNoHuntingBattle } from "@/server/utils/concurrency";
import { periodStart } from "@/utils/time";
import type { QueryCondition } from "@/utils/typeutils";
import type { QuestTrackerType } from "@/validators/objectives";

/** Load carried supply snapshots, optionally restricted to the reviewed stack. */
export const listSupplyRequestStacks = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  userItemId?: string,
) =>
  client.query.userItem.findMany({
    where: and(
      eq(userItem.userId, userId),
      userItemId === undefined ? undefined : eq(userItem.id, userItemId),
      gt(userItem.quantity, 0),
      eq(userItem.equipped, "NONE"),
      eq(userItem.storedAtHome, false),
    ),
    columns: {
      id: true,
      itemId: true,
      quantity: true,
      updatedAt: true,
      equipped: true,
      storedAtHome: true,
      isInAuction: true,
      craftingFinishedAt: true,
      activeVariantId: true,
      level: true,
      experience: true,
      durability: true,
    },
    with: {
      item: {
        columns: {
          name: true,
          image: true,
          auctionMaxPrice: true,
          canBeCrafted: true,
          canBeGathered: true,
          canBeHunted: true,
        },
      },
      imbuements: { columns: { id: true } },
    },
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
  readiness?: ActionReadinessWrite,
  questState?: { set: Record<string, unknown>; where?: QueryCondition[] },
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
    SET ${actionReadinessSqlSet(
      {
        set: { ...readiness?.set, questData: request.questData, ...questState?.set },
        where: readiness?.where,
      },
      ["updatedAt", "money", supplyExperienceField(user.occupation)],
    )} ${userItem.quantity} = ${userItem.quantity} - ${request.quantity},
        ${userItem.updatedAt} = ${sql.param(request.updatedAt, userItem.updatedAt)},
        ${userData.money} = ${userData.money} + ${request.ryo},
        ${experience} = ${experience} + ${request.experience},
        ${userData.supplyRequestAt} = ${sql.param(request.claimedAt, userData.supplyRequestAt)},
        ${userData.updatedAt} = ${sql.param(request.updatedAt, userData.updatedAt)}
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
      ...(questState?.where ?? []),
      eq(userData.occupation, user.occupation),
      readiness?.where ?? eq(userData.status, "AWAKE"),
      eq(userData.isBanned, false),
      eq(userData.sector, MAP_WAKE_ISLAND_SECTOR),
      or(
        isNull(userData.supplyRequestAt),
        lt(userData.supplyRequestAt, periodStart("daily", request.claimedAt)),
      ),
      hasNoHuntingBattle(user.userId),
    )}`);
};
