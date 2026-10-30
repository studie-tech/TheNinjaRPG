/**
 * Database access for occupation; authorization and transaction scopes stay in callers.
 */

import { and, asc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { MAP_WAKE_ISLAND_SECTOR } from "@/drizzle/constants";
import {
  item,
  userCookingJob,
  userData,
  userItem,
  userItemImbuement,
  userQueue,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the `item` listing for `getCraftableItems`, using predicates on `canBeCrafted`, `hidden`, `itemType`. */
export const listItemForGetCraftableItems = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({
    where: and(
      eq(item.canBeCrafted, true),
      eq(item.hidden, false),
      ne(item.itemType, "MEAL"),
    ),
    with: {
      craftingRequirements: {
        with: {
          requirementItem: true,
        },
      },
    },
  });

/** Build the `item` listing for `getCookingRecipes`, using predicates on `canBeCrafted`, `hidden`, `itemType`. */
export const listItemForGetCookingRecipes = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({
    where: and(
      eq(item.canBeCrafted, true),
      eq(item.hidden, false),
      eq(item.itemType, "MEAL"),
    ),
    with: { craftingRequirements: { with: { requirementItem: true } } },
  });

/**
 * Build the `userData` update for `selectOccupation`, setting `occupation` and
 * `occupationSignupAt`, using predicates on `userId`, `occupation`,
 * `occupationSignupAt`.
 */
export const updateUserDataForSelectOccupation = (
  client: Pick<DrizzleClient, "update">,
  input: { occupation: "GATHERING" | "HUNTER" | "CRAFTING" },
  occupationSignupAt: Date,
  ctx: { userId: string },
  user: {
    occupation: null | "GATHERING" | "HUNTER" | "CRAFTING";
    occupationSignupAt: null | Date;
  },
) =>
  client
    .update(userData)
    .set({ occupation: input.occupation, occupationSignupAt })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        user.occupation === null
          ? isNull(userData.occupation)
          : eq(userData.occupation, user.occupation),
        user.occupationSignupAt === null
          ? isNull(userData.occupationSignupAt)
          : eq(userData.occupationSignupAt, user.occupationSignupAt),
      ),
    );

/** Build the `userData` update for `craftItem`, including predicates on `userId`, `updatedAt`, `status`. */
export const updateUserDataForCraftItem = (
  client: Pick<DrizzleClient, "update">,
  user: { updatedAt: Date },
  expGain: number,
  questDataForDb: import("@/validators/objectives").QuestTrackerType[],
  ctx: { userId: string },
  updatedAt: Date,
) =>
  client
    .update(userData)
    .set({
      updatedAt,
      craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
      questData: questDataForDb,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.updatedAt, user.updatedAt),
        eq(userData.status, "AWAKE"),
        or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
      ),
    );

/** Build the `userCookingJob` insert for `craftItem`. */
export const insertUserCookingJobForCraftItem = (
  client: Pick<DrizzleClient, "insert">,
  job: typeof userCookingJob.$inferInsert,
) => client.insert(userCookingJob).values(job);

/** Build the `userItem` update for `imbueItem`, setting `updatedAt`, including predicates on `id`, `userId`, `quantity`. */
export const updateUserItemForImbueItem = (
  client: Pick<DrizzleClient, "update">,
  input: { userItemId: string },
  ctx: { userId: string },
) =>
  client
    .update(userItem)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(userItem.id, input.userItemId),
        eq(userItem.userId, ctx.userId),
        gt(userItem.quantity, 0),
        eq(userItem.isInAuction, false),
      ),
    );

/** Build the `userItemImbuement` insert for `imbueItem`. */
export const insertUserItemImbuementForImbueItem = (
  client: Pick<DrizzleClient, "insert">,
  input: { userItemId: string },
  crystalItem: { id: string },
  finishTime: Date,
) =>
  client.insert(userItemImbuement).values({
    id: nanoid(),
    userItemId: input.userItemId,
    imbuementItemId: crystalItem.id,
    craftingFinishedAt: finishTime,
  });

/**
 * Build the `userData` update for `imbueItem`, setting `craftingExperience` and
 * `questData`, using predicates on `userId`, `status`, `sector`.
 */
export const updateUserDataForImbueItem = (
  client: Pick<DrizzleClient, "update">,
  expGain: number,
  questDataForDb: import("@/validators/objectives").QuestTrackerType[],
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      craftingExperience: sql`${userData.craftingExperience} + ${expGain}`,
      questData: questDataForDb,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.status, "AWAKE"),
        or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
      ),
    );

/** Build the `userItem` update for `finishCraftingImmediately`, setting `craftingFinishedAt`, using predicates on `id`. */
export const updateUserItemForFinishCraftingImmediately = (
  client: Pick<DrizzleClient, "update">,
  input: { userItemId: string },
) =>
  client
    .update(userItem)
    .set({ craftingFinishedAt: new Date() })
    .where(eq(userItem.id, input.userItemId));

/**
 * Build the `userCookingJob` update for `finishCraftingImmediately`, setting
 * `finishesAt`, using predicates on `userId` and `finishesAt`.
 */
export const updateUserCookingJobForFinishCraftingImmediately = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  craftingItem: { craftingFinishedAt: Date },
) =>
  client
    .update(userCookingJob)
    .set({ finishesAt: new Date() })
    .where(
      and(
        eq(userCookingJob.userId, ctx.userId),
        eq(userCookingJob.finishesAt, craftingItem.craftingFinishedAt),
      ),
    );

/**
 * Build the `userItemImbuement` update for `finishImbuingImmediately`, setting
 * `craftingFinishedAt`, using predicates on `id`.
 */
export const updateUserItemImbuementForFinishImbuingImmediately = (
  client: Pick<DrizzleClient, "update">,
  input: { userItemImbuementId: string },
) =>
  client
    .update(userItemImbuement)
    .set({ craftingFinishedAt: new Date() })
    .where(eq(userItemImbuement.id, input.userItemImbuementId));

/** Build the `userItemImbuement` lookup for `removeImbuement`, using predicates on `id`. */
export const findUserItemImbuementForRemoveImbuement = (
  client: Pick<DrizzleClient, "query">,
  input: { userItemImbuementId: string },
) =>
  client.query.userItemImbuement.findFirst({
    where: eq(userItemImbuement.id, input.userItemImbuementId),
    with: {
      userItem: {
        with: { item: true },
      },
      item: true,
    },
  });

/** Build the `userItemImbuement` deletion for `removeImbuement`, using predicates on `id` and `userItemId`. */
export const deleteUserItemImbuementForRemoveImbuement = (
  client: Pick<DrizzleClient, "delete">,
  input: { userItemImbuementId: string },
  ownedUserItem: { id: string },
  ctx: { userId: string },
) =>
  client
    .delete(userItemImbuement)
    .where(
      and(
        eq(userItemImbuement.id, input.userItemImbuementId),
        eq(userItemImbuement.userItemId, ownedUserItem.id),
        sql`EXISTS (SELECT 1 FROM UserItem WHERE UserItem.id = ${ownedUserItem.id} AND UserItem.userId = ${ctx.userId} AND UserItem.isInAuction = 0 AND UserItem.equipped = 'NONE')`,
      ),
    );

/** Build the `userItem` insert for `removeImbuement`. */
export const insertUserItemForRemoveImbuement = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  imbuement: { imbuementItemId: string },
) =>
  client.insert(userItem).values({
    id: nanoid(),
    userId: ctx.userId,
    itemId: imbuement.imbuementItemId,
    quantity: 1,
    equipped: "NONE",
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
  });

/** Load the cancellation receipt and complete queue in the same opening statement. */
export const findCraftingQueueState = (client: DrizzleClient, userId: string) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { userId: true },
    with: {
      queue: { orderBy: asc(userQueue.position), with: { item: true } },
      items: {
        columns: { id: true },
        where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
      },
    },
  });
