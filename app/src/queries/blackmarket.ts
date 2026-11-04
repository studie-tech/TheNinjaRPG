/**
 * Database access for blackmarket; authorization and transaction scopes stay in callers.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { ElementName } from "@/drizzle/constants";
import { ryoTrade } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** A purchasable extra slot; `maxCurrentSlots` caps the count that can still accept one. */
export type ExtraSlotPurchase = {
  column: "extraItemSlots" | "extraJutsuSlots";
  cost: number;
  label: string;
  maxCurrentSlots?: number;
};

/**
 * Fetches a ryo offer from the black market.
 *
 * @param {DrizzleClient} client - The Drizzle client used to make the query.
 * @param {string} offerId - The ID of the offer to fetch.
 */
export const fetchOffer = async (client: DrizzleClient, offerId: string) => {
  return await client.query.ryoTrade.findFirst({
    where: eq(ryoTrade.id, offerId),
  });
};

/**
 * Fetches all offers created by a specific user.
 *
 * @param {DrizzleClient} client - The database client used to perform the query.
 * @param {string} userId - The ID of the user whose offers are to be fetched.
 * @returns {Promise<Array>} A promise that resolves to an array of offers created by the user.
 */
export const fetchActiveUserOffers = async (client: DrizzleClient, userId: string) => {
  return await client.query.ryoTrade.findMany({
    where: and(eq(ryoTrade.creatorUserId, userId), isNull(ryoTrade.purchaserUserId)),
  });
};

import { asc, desc, gte, isNotNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  COST_CHANGE_GENDER,
  COST_REROLL_ELEMENT,
  RYO_CAP,
  RYO_FOR_REP_RESERVE,
} from "@/drizzle/constants";
import { actionLog, userData } from "@/drizzle/schema";

/** Table alias for allowed joins, keeping its columns distinct from other participants. */
const allowed = alias(userData, "allowed");

/** Table alias for buyer joins, keeping its columns distinct from other participants. */
const buyer = alias(userData, "buyer");

/** Table alias for creator joins, keeping its columns distinct from other participants. */
const creator = alias(userData, "creator");

/** Table alias for receiver joins, keeping its columns distinct from other participants. */
const receiver = alias(userData, "receiver");

/** Table alias for sender joins, keeping its columns distinct from other participants. */
const sender = alias(userData, "sender");
/** Build the `ryoTrade` selection for `getRyoOffers`, using predicates on `purchaserUserId` and `username`. */
export const selectRyoTradeForGetRyoOffers = (
  client: Pick<DrizzleClient, "select">,
  input: {
    activeToggle?: undefined | null | false | true;
    creator?: undefined | null | string;
    buyer?: undefined | null | string;
  },
  limit: number,
  skip: number,
) =>
  client
    .select({
      id: ryoTrade.id,
      creatorUserId: ryoTrade.creatorUserId,
      repsForSale: ryoTrade.repsForSale,
      requestedRyo: ryoTrade.requestedRyo,
      createdAt: ryoTrade.createdAt,
      ryoPerRep: ryoTrade.ryoPerRep,
      creatorUsername: creator.username,
      creatorAvatar: creator.avatar,
      purchaserUsername: buyer.username,
      purchaserAvatar: buyer.avatar,
      allowedUsername: allowed.username,
      allowedAvatar: allowed.avatar,
    })
    .from(ryoTrade)
    .innerJoin(creator, eq(ryoTrade.creatorUserId, creator.userId))
    .leftJoin(buyer, eq(ryoTrade.purchaserUserId, buyer.userId))
    .leftJoin(allowed, eq(ryoTrade.allowedPurchaserId, allowed.userId))
    .where(
      and(
        input.activeToggle
          ? isNull(ryoTrade.purchaserUserId)
          : isNotNull(ryoTrade.purchaserUserId),
        ...(input.creator ? [eq(creator.username, input.creator)] : []),
        ...(input.buyer ? [eq(buyer.username, input.buyer)] : []),
      ),
    )
    .orderBy((table) => [
      input.activeToggle ? asc(table.ryoPerRep) : desc(table.createdAt),
    ])
    .limit(limit)
    .offset(skip);

/** Build the `ryoTrade` selection for `getGraph`, using predicates on `purchaserUserId`. */
export const selectRyoTradeForGetGraph = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({
      senderId: sender.userId,
      receiverId: receiver.userId,
      senderUsername: sender.username,
      receiverUsername: receiver.username,
      senderAvatar: sender.avatar,
      receiverAvatar: receiver.avatar,
      totalReps: sql<number>`SUM(${ryoTrade.repsForSale})`,
      totalRyo: sql<number>`SUM(${ryoTrade.requestedRyo})`,
    })
    .from(ryoTrade)
    .innerJoin(sender, eq(ryoTrade.creatorUserId, sender.userId))
    .innerJoin(receiver, eq(ryoTrade.purchaserUserId, receiver.userId))
    .where(isNotNull(ryoTrade.purchaserUserId))
    .groupBy(ryoTrade.creatorUserId, ryoTrade.purchaserUserId);

/**
 * Build the `userData` update for `createOffer`, setting `reputationPoints`, using
 * predicates on `userId` and `reputationPoints`.
 */
export const updateUserDataForCreateOffer = (
  client: Pick<DrizzleClient, "update">,
  input: { reps: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ reputationPoints: sql`${userData.reputationPoints} - ${input.reps}` })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        gte(userData.reputationPoints, input.reps + RYO_FOR_REP_RESERVE),
      ),
    );

/** Build the `ryoTrade` insert for `createOffer`. */
export const insertRyoTradeForCreateOffer = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { reps: number; ryo: number; allowedUser?: undefined | null | string },
) =>
  client.insert(ryoTrade).values({
    id: nanoid(),
    creatorUserId: ctx.userId,
    repsForSale: input.reps,
    requestedRyo: input.ryo,
    ryoPerRep: input.ryo / input.reps,
    allowedPurchaserId: input.allowedUser,
  });

/** Build the `ryoTrade` deletion for `delistOffer`, using predicates on `id`. */
export const deleteRyoTradeForDelistOffer = (
  client: Pick<DrizzleClient, "delete">,
  input: { offerId: string },
) => client.delete(ryoTrade).where(eq(ryoTrade.id, input.offerId));

/** Build the `userData` lookup for `takeOffer`, selecting only `userId` and `bank`, using predicates on `userId`. */
export const findUserDataForTakeOffer = (
  client: Pick<DrizzleClient, "query">,
  offer: { creatorUserId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, offer.creatorUserId),
    columns: { userId: true, bank: true },
  });

/**
 * Build the `ryoTrade` update for `takeOffer`, setting `purchaserUserId`, using
 * predicates on `id` and `purchaserUserId`.
 */
export const updateRyoTradeForTakeOffer = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  input: { offerId: string },
) =>
  client
    .update(ryoTrade)
    .set({ purchaserUserId: ctx.userId })
    .where(and(eq(ryoTrade.id, input.offerId), isNull(ryoTrade.purchaserUserId)));

/**
 * Build the `userData` update for `takeOffer`, setting `money` and `reputationPoints`,
 * using predicates on `userId` and `money`.
 */
export const updateUserDataForTakeOffer = (
  client: Pick<DrizzleClient, "update">,
  offer: { requestedRyo: number; repsForSale: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} - ${offer.requestedRyo}`,
      reputationPoints: sql`${userData.reputationPoints} + ${offer.repsForSale}`,
    })
    .where(
      and(eq(userData.userId, ctx.userId), gte(userData.money, offer.requestedRyo)),
    );

/** Build the `userData` update for `takeOffer`, setting `bank`, using predicates on `userId` and `bank`. */
export const updateUserDataForTakeOffer2 = (
  client: Pick<DrizzleClient, "update">,
  offer: { requestedRyo: number; creatorUserId: string },
) =>
  client
    .update(userData)
    .set({ bank: sql`${userData.bank} + ${offer.requestedRyo}` })
    .where(
      and(
        eq(userData.userId, offer.creatorUserId),
        sql`${userData.bank} + ${offer.requestedRyo} <= ${RYO_CAP}`,
      ),
    );

/** Build the `ryoTrade` update for `takeOffer`, setting `purchaserUserId`, using predicates on `id`. */
export const updateRyoTradeForTakeOffer2 = (
  client: Pick<DrizzleClient, "update">,
  input: { offerId: string },
) =>
  client
    .update(ryoTrade)
    .set({ purchaserUserId: null })
    .where(eq(ryoTrade.id, input.offerId));

/** Build the `userData` update for `takeOffer`, setting `bank`, using predicates on `userId`. */
export const updateUserDataForTakeOffer3 = (
  client: Pick<DrizzleClient, "update">,
  offer: { requestedRyo: number; creatorUserId: string },
) =>
  client
    .update(userData)
    .set({ bank: sql`${userData.bank} - ${offer.requestedRyo}` })
    .where(eq(userData.userId, offer.creatorUserId));

/** Build the `userData` update for `takeOffer`, setting `money` and `reputationPoints`, using predicates on `userId`. */
export const updateUserDataForTakeOffer4 = (
  client: Pick<DrizzleClient, "update">,
  offer: { requestedRyo: number; repsForSale: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} + ${offer.requestedRyo}`,
      reputationPoints: sql`${userData.reputationPoints} - ${offer.repsForSale}`,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `actionLog` insert for `takeOffer`. */
export const insertActionLogForTakeOffer = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { offerId: string },
  buyerFailed: false | true,
  sellerFailed: false | true,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "ryoTrade",
    changes: [
      `Rollback of offer ${input.offerId}`,
      `Buyer update: ${buyerFailed ? "failed" : "success"}`,
      `Seller update: ${sellerFailed ? "failed" : "success"}`,
    ],
    relatedId: input.offerId,
    relatedMsg: `Rollback: buyer=${buyerFailed ? "fail" : "ok"}, seller=${sellerFailed ? "fail" : "ok"}`,
  });

/** Build the `actionLog` insert for `takeOffer`. */
export const insertActionLogForTakeOffer2 = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  offer: { repsForSale: number; requestedRyo: number; creatorUserId: string },
  input: { offerId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "ryoTrade",
    changes: [
      `Purchased ${offer.repsForSale} reputation for ${offer.requestedRyo} ryo`,
      `Seller: ${offer.creatorUserId}`,
    ],
    relatedId: input.offerId,
    relatedMsg: `Trade completed: ${offer.requestedRyo} ryo`,
  });

/**
 * Build the `userData` update for `changeUserGender`, setting `gender` and
 * `reputationPoints`, using predicates on `userId`, `gender`, `reputationPoints`.
 */
export const updateUserDataForChangeUserGender = (
  client: Pick<DrizzleClient, "update">,
  input: { gender: import("@/validators/register").Gender },
  ctx: { userId: string },
  user: { gender: string; reputationPoints: number },
) =>
  client
    .update(userData)
    .set({
      gender: input.gender,
      reputationPoints: sql`reputationPoints - ${COST_CHANGE_GENDER}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.gender, user.gender),
        eq(userData.reputationPoints, user.reputationPoints),
        gte(userData.reputationPoints, COST_CHANGE_GENDER),
      ),
    );

/**
 * Build the `userData` update for a slot purchase, raising `column` and debiting
 * `reputationPoints`, using predicates on `userId`, `reputationPoints` and, for capped
 * slots, `column`.
 */
export const updateUserDataForBuySlot = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  slot: ExtraSlotPurchase,
) =>
  client
    .update(userData)
    .set({
      [slot.column]: sql`${userData[slot.column]} + 1`,
      reputationPoints: sql`reputationPoints - ${slot.cost}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        gte(userData.reputationPoints, slot.cost),
        slot.maxCurrentSlots === undefined
          ? undefined
          : lte(userData[slot.column], slot.maxCurrentSlots),
      ),
    );

/** Build the `actionLog` insert for a slot purchase. */
export const insertActionLogForBuySlot = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  user: { avatarLight: null | string },
  slot: Pick<ExtraSlotPurchase, "label">,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`${slot.label} slot purchased`],
    relatedId: ctx.userId,
    relatedMsg: `Update: ${slot.label} slot purchased`,
    relatedImage: user.avatarLight,
  });

/** Build the `actionLog` insert for `rerollElement`. */
export const insertActionLogForRerollElement = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { elementType: "primary" | "secondary" },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "elementRoll",
    changes: [`${input.elementType} element tracking reset`],
    relatedMsg: `RESET: ${input.elementType}`,
  });

/** Build the `userData` update for `rerollElement`, including predicates on `userId`, `reputationPoints`, `bloodlineId`. */
export const updateUserDataForRerollElement = (
  client: Pick<DrizzleClient, "update">,
  updateData: Record<string, unknown>,
  ctx: { userId: string },
  user: {
    bloodlineId: null | string;
    primaryElement: ElementName | null;
    secondaryElement: ElementName | null;
  },
) =>
  client
    .update(userData)
    .set(updateData)
    .where(
      and(
        eq(userData.userId, ctx.userId),
        gte(userData.reputationPoints, COST_REROLL_ELEMENT),
        user.bloodlineId === null
          ? isNull(userData.bloodlineId)
          : eq(userData.bloodlineId, user.bloodlineId),
        user.primaryElement === null
          ? isNull(userData.primaryElement)
          : eq(userData.primaryElement, user.primaryElement),
        user.secondaryElement === null
          ? isNull(userData.secondaryElement)
          : eq(userData.secondaryElement, user.secondaryElement),
      ),
    );

/** Build the `actionLog` insert for `updateStats`. */
export const insertActionLogForUpdateStats = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  user: { username: string; avatarLight: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "user",
    changes: [`User stats distribution changed`],
    relatedId: ctx.userId,
    relatedMsg: `Update: ${user.username} stats redistribution`,
    relatedImage: user.avatarLight,
  });

/** Build the `actionLog` selection for `getRolledElements`, using predicates on `userId` and `tableName`. */
export const selectActionLogForGetRolledElements = (
  client: Pick<DrizzleClient, "select">,
  userId: string,
) =>
  client
    .select({
      relatedMsg: actionLog.relatedMsg,
      createdAt: actionLog.createdAt,
    })
    .from(actionLog)
    .where(and(eq(actionLog.userId, userId), eq(actionLog.tableName, "elementRoll")))
    .orderBy(asc(actionLog.createdAt));

/**
 * Adds a new element roll to actionLog.
 *
 * @param {DrizzleClient} client - The Drizzle client used to make the query.
 * @param {string} userId - The ID of the user who rolled the element.
 * @param {string} elementType - The type of element rolled (primary or secondary).
 * @param {string} element - The name of the element rolled.
 */
export const addElementRoll = (
  client: DrizzleClient,
  userId: string,
  elementType: "primary" | "secondary",
  element: ElementName,
) => {
  return client.insert(actionLog).values({
    id: nanoid(),
    userId: userId,
    tableName: "elementRoll",
    changes: [`${elementType} element rolled`],
    relatedMsg: `${elementType === "primary" ? "Primary" : "Secondary"}: ${element}`,
  });
};
