import { AUCTION_HOUSE_MIN_LEVEL } from "@/drizzle/constants";
/**
 * Database access for auction offers; authorization and transaction scopes stay in callers.
 */

import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { userItem } from "@/drizzle/schema";
import type { DrizzleClient, DrizzleTransaction } from "@/server/db";
import type { getAuctionOffersSchema } from "@/validators/auction";

/** Build the offered-item lookup with its item and imbuement relations for offer validation. */
export const fetchOfferItem = (database: DrizzleClient, id: string, userId: string) =>
  database.query.userItem.findFirst({
    where: and(eq(userItem.id, id), eq(userItem.userId, userId)),
    with: { item: true, imbuements: { with: { item: true } } },
  });

import { desc, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  actionLog,
  auctionOffer,
  item,
  type UserItem,
  userData,
} from "@/drizzle/schema";

/** Build the `item` listing for `getAuctionOfferItems`, using predicates on `canBeTraded` and `hidden`. */
export const listItemForGetAuctionOfferItems = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({
    where: and(eq(item.canBeTraded, true), eq(item.hidden, false)),
    columns: {
      id: true,
      name: true,
      image: true,
      itemType: true,
      canStack: true,
      auctionMinPrice: true,
      auctionMaxPrice: true,
    },
    orderBy: (table, { asc }) => [asc(table.name)],
  });

/** Build the `auctionOffer` listing for `getAuctionOffers`, including predicates on `offerType`, `status`, `ownerId`. */
export const listAuctionOfferForGetAuctionOffers = (
  client: Pick<DrizzleClient, "query">,
  input: z.infer<typeof getAuctionOffersSchema>,
  ctx: { userId: string },
) =>
  client.query.auctionOffer.findMany({
    where: and(
      eq(auctionOffer.offerType, input.offerType),
      eq(auctionOffer.status, input.status),
      input.onlyMine ? eq(auctionOffer.ownerId, ctx.userId) : undefined,
      input.search.trim()
        ? sql`EXISTS (SELECT 1 FROM Item WHERE Item.id = ${auctionOffer.requestedItemId} AND Item.name LIKE ${`%${input.search.trim()}%`})`
        : undefined,
    ),
    with: {
      owner: { columns: { userId: true, username: true } },
      requestedItem: true,
      offeredUserItem: {
        with: { item: true, imbuements: { with: { item: true } } },
      },
    },
    orderBy: [desc(auctionOffer.createdAt), desc(auctionOffer.id)],
    offset: (input.cursor ?? 0) * input.limit,
    limit: input.limit + 1,
  });

/** Build the `userData` update for `createAuctionOffer`, setting `bank` and `updatedAt`, using predicates on `bank`. */
export const updateUserDataForCreateAuctionOffer = (
  client: Pick<DrizzleClient, "update">,
  input: { ryo: number },

  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ bank: sql`${userData.bank} - ${input.ryo}`, updatedAt: new Date() })
    .where(and(eligibleOfferUser(ctx.userId), gte(userData.bank, input.ryo)));

/** Build the `auctionOffer` insert for `createAuctionOffer`. */
export const insertAuctionOfferForCreateAuctionOffer = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  ctx: { userId: string },
  input:
    | {
        offerType: "REQUEST";
        requestedItemId: string;
        requestedQuantity: number;
        ryo: number;
      }
    | {
        offerType: "TRADE";
        requestedItemId: string;
        requestedQuantity: number;
        offeredUserItemId: string;
        offeredQuantity: number;
      },
  offeredUserItemId: null | string,
) =>
  client.insert(auctionOffer).values({
    id,
    ownerId: ctx.userId,
    offerType: input.offerType,
    requestedItemId: input.requestedItemId,
    requestedQuantity: input.requestedQuantity,
    offeredUserItemId,
    offeredQuantity: input.offerType === "TRADE" ? input.offeredQuantity : null,
    ryo: input.offerType === "REQUEST" ? input.ryo : 0,
  });

/** Build the `auctionOffer` lookup for `acceptAuctionOffer`, using predicates on `id`. */
export const findAuctionOfferForAcceptAuctionOffer = (
  client: Pick<DrizzleClient, "query">,
  input: { offerId: string },
) =>
  client.query.auctionOffer.findFirst({
    where: eq(auctionOffer.id, input.offerId),
    with: {
      owner: true,
      requestedItem: true,
      offeredUserItem: {
        with: { item: true, imbuements: { with: { item: true } } },
      },
    },
  });

/** Build the `auctionOffer` update for `acceptAuctionOffer`, using predicates on `id` and `status`. */
export const updateAuctionOfferForAcceptAuctionOffer = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  offer: { id: string },
) =>
  client
    .update(auctionOffer)
    .set({ status: "SOLD", accepterId: ctx.userId, updatedAt: new Date() })
    .where(and(eq(auctionOffer.id, offer.id), eq(auctionOffer.status, "ACTIVE")));

/** Build the `userData` update for `acceptAuctionOffer`, setting `bank` and `updatedAt`, using predicates on `userId`. */
export const updateUserDataForAcceptAuctionOffer = (
  client: Pick<DrizzleClient, "update">,
  offer: { ryo: number },
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ bank: sql`${userData.bank} + ${offer.ryo}`, updatedAt: new Date() })
    .where(eq(userData.userId, ctx.userId));

/** Build the `auctionOffer` lookup for `cancelAuctionOffer`, using predicates on `id` and `ownerId`. */
export const findAuctionOfferForCancelAuctionOffer = (
  client: Pick<DrizzleClient, "query">,
  input: { offerId: string },
  ctx: { userId: string },
) =>
  client.query.auctionOffer.findFirst({
    where: and(
      eq(auctionOffer.id, input.offerId),
      eq(auctionOffer.ownerId, ctx.userId),
    ),
  });

/**
 * Build the `auctionOffer` update for `cancelAuctionOffer`, setting `status` and
 * `updatedAt`, using predicates on `id`, `ownerId`, `status`.
 */
export const updateAuctionOfferForCancelAuctionOffer = (
  client: Pick<DrizzleClient, "update">,
  offer: { id: string },
  ctx: { userId: string },
) =>
  client
    .update(auctionOffer)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(
      and(
        eq(auctionOffer.id, offer.id),
        eq(auctionOffer.ownerId, ctx.userId),
        eq(auctionOffer.status, "ACTIVE"),
      ),
    );

/**
 * Build the `userItem` update for `cancelAuctionOffer`, setting `isInAuction` and
 * `updatedAt`, using predicates on `id`, `userId`, `isInAuction`.
 */
export const updateUserItemForCancelAuctionOffer = (
  client: Pick<DrizzleClient, "update">,
  offer: { offeredUserItemId: null | string },
  ctx: { userId: string },
) =>
  client
    .update(userItem)
    .set({ isInAuction: false, updatedAt: new Date() })
    .where(
      and(
        eq(userItem.id, offer.offeredUserItemId ?? ""),
        eq(userItem.userId, ctx.userId),
        eq(userItem.isInAuction, true),
      ),
    );

/** Build the `userData` update for `claimOfferUser`, setting `updatedAt`, using the configured predicates. */
export const updateUserDataForClaimOfferUser = (
  client: Pick<DrizzleClient, "update">,

  id: string,
) =>
  client
    .update(userData)
    .set({
      updatedAt: sql`GREATEST(CURRENT_TIMESTAMP(3), TIMESTAMPADD(MICROSECOND, 1000, ${userData.updatedAt}))`,
    })
    .where(eligibleOfferUser(id));

/** Build the `userItem` update for `moveOfferItem`, including predicates on `id`, `userId`, `itemId`. */
export const updateUserItemForMoveOfferItem = (
  client: Pick<DrizzleClient, "update">,
  isPartial: false | true,
  quantity: number,
  recipientId: string,
  reserve: false | true,
  row: {
    userId: string;
    activeVariantId: null | string;
    id: string;
    itemId: string;
    quantity: number;
    level: number;
    experience: number;
    durability: number;
  },
  wasReserved: false | true,
) =>
  client
    .update(userItem)
    .set(
      isPartial
        ? { quantity: sql`${userItem.quantity} - ${quantity}`, updatedAt: new Date() }
        : {
            userId: recipientId,
            isInAuction: reserve,
            activeVariantId: recipientId === row.userId ? row.activeVariantId : null,
            ...(recipientId !== row.userId
              ? { homeX: null, homeY: null, homeRotation: 0 }
              : {}),
            updatedAt: new Date(),
          },
    )
    .where(
      and(
        eq(userItem.id, row.id),
        eq(userItem.userId, row.userId),
        eq(userItem.itemId, row.itemId),
        eq(userItem.quantity, row.quantity),
        gt(userItem.quantity, 0),
        eq(userItem.isInAuction, wasReserved),
        eq(userItem.equipped, "NONE"),
        eq(userItem.storedAtHome, false),
        eq(userItem.level, row.level),
        eq(userItem.experience, row.experience),
        eq(userItem.durability, row.durability),
        or(
          isNull(userItem.craftingFinishedAt),
          lte(userItem.craftingFinishedAt, new Date()),
        ),
        sql`EXISTS (SELECT 1 FROM Item WHERE Item.id = ${row.itemId} AND Item.canBeTraded = 1)`,
        // Completed imbuements follow a whole item; splitting one would duplicate them.
        sql`NOT EXISTS (SELECT 1 FROM UserItemImbuement WHERE UserItemImbuement.userItemId = ${row.id} ${isPartial ? sql`` : sql`AND UserItemImbuement.craftingFinishedAt > CURRENT_TIMESTAMP(3)`})`,
      ),
    );

/** Build the `userItem` insert for `moveOfferItem`. */
export const insertUserItemForMoveOfferItem = (
  client: Pick<DrizzleClient, "insert">,
  snapshot: import("@/drizzle/schema").UserItem,
  destinationId: string,
  recipientId: string,
  quantity: number,
  reserve: false | true,
  row: { userId: string; activeVariantId: null | string },
) =>
  client.insert(userItem).values({
    ...snapshot,
    id: destinationId,
    userId: recipientId,
    quantity,
    isInAuction: reserve,
    activeVariantId: recipientId === row.userId ? row.activeVariantId : null,
    homeX: null,
    homeY: null,
    homeRotation: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies UserItem);

/** Build the action-log insert for an offer event; the caller controls when the offer and log commit. */
export const logOffer = (
  tx: DrizzleTransaction,
  userId: string,
  id: string,
  action: string,
  changes: unknown,
) =>
  tx.insert(actionLog).values({
    id: nanoid(),
    userId,
    tableName: "auctionOffer",
    relatedId: id,
    changes: JSON.stringify({ action, details: changes }),
  });

/** Require an eligible account and reject aliases before claiming auction funds. */
const eligibleOfferUser = (id: string) =>
  and(
    eq(userData.userId, id),
    sql`NOT EXISTS (SELECT 1 FROM StoreUserIdAlias WHERE StoreUserIdAlias.oldUserId = ${id})`,
    eq(userData.isBanned, false),
    eq(userData.isTradeBanned, false),
    gte(userData.level, AUCTION_HOUSE_MIN_LEVEL),
  );
