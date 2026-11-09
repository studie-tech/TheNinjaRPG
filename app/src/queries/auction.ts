/**
 * Database access for auction; authorization and transaction scopes stay in callers.
 */

import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  actionLog,
  auctionBid,
  auctionListing,
  item,
  userData,
  userItem,
  userItemImbuement,
} from "@/drizzle/schema";
import { getAuctionSellerPayout } from "@/libs/itemEconomy";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";

/**
 * Fetch an auction listing with bids
 * @param drizzle - Drizzle client
 * @param auctionId - Auction ID
 * @returns - Auction listing with bids
 */
export const fetchAuctionListing = async (
  drizzle: Pick<DrizzleClient, "query">,
  auctionId: string,
) => {
  const auction = await drizzle.query.auctionListing.findFirst({
    where: eq(auctionListing.id, auctionId),
    with: {
      bids: true,
      userItem: {
        with: {
          item: {
            columns: { name: true },
          },
        },
      },
      targetUser: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
        },
      },
    },
  });

  return auction;
};

/** Table alias for other bid joins, keeping its columns distinct from other participants. */
const otherBid = alias(auctionBid, "auctionSettlementOtherBid");

/** Table alias for seller joins, keeping its columns distinct from other participants. */
const seller = alias(userData, "auctionSettlementSeller");

/** Build the `auctionListing` lookup for `getAuctionListing`, using predicates on `id`. */
export const findAuctionListingForGetAuctionListing = (
  client: Pick<DrizzleClient, "query">,
  auctionId: string,
) =>
  client.query.auctionListing.findFirst({
    where: eq(auctionListing.id, auctionId),
    with: {
      ...auctionListingRelations,
      bids: {
        with: {
          bidder: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
            },
          },
        },
        orderBy: desc(auctionBid.createdAt),
      },
    },
  });

/** Relations every auction listing read loads; each query adds its own `bids`. */
const auctionListingRelations = {
  userItem: { with: { item: true, imbuements: { with: { item: true } } } },
  seller: { columns: { userId: true, username: true, avatar: true } },
  targetUser: { columns: { userId: true, username: true, avatar: true } },
} as const;

/** Build the `auctionBid` selection for `getAuctionListings`, using predicates on `auctionId`, `id`, `bidderId`. */
export const selectAuctionBidForGetAuctionListings = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({ id: auctionBid.id })
    .from(auctionBid)
    .where(
      and(
        eq(auctionBid.auctionId, auctionListing.id),
        eq(auctionBid.bidderId, ctx.userId),
      ),
    );

/** Build the `auctionListing` selection for `getAuctionListings`. */
export const selectAuctionListingForGetAuctionListings = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({ id: auctionListing.id })
    .from(auctionListing)
    .innerJoin(userItem, eq(auctionListing.userItemId, userItem.id))
    .innerJoin(item, eq(userItem.itemId, item.id));

/** Build the `auctionListing` listing for `getAuctionListings`, using predicates on `id`. */
export const listAuctionListingForGetAuctionListings = (
  client: Pick<DrizzleClient, "query">,
  listingIds: string[],
) =>
  client.query.auctionListing.findMany({
    where: inArray(auctionListing.id, listingIds),
    with: {
      ...auctionListingRelations,
      bids: {
        orderBy: desc(auctionBid.amount),
        limit: 1,
      },
    },
    orderBy: desc(auctionListing.expiresAt),
  });

/** Build the `userItem` lookup for `createAuctionListing`, including predicates on `id`, `userId`, `quantity`. */
export const findUserItemForCreateAuctionListing = (
  client: Pick<DrizzleClient, "query">,
  userItemId: string,
  ctx: { userId: string },
) =>
  client.query.userItem.findFirst({
    where: and(
      eq(userItem.id, userItemId),
      eq(userItem.userId, ctx.userId),
      gt(userItem.quantity, 0),
      eq(userItem.equipped, "NONE"),
      eq(userItem.isInAuction, false),
      or(
        isNull(userItem.craftingFinishedAt),
        lt(userItem.craftingFinishedAt, new Date()),
      ),
    ),
    with: {
      item: true,
      imbuements: true,
    },
  });

/**
 * Build the `userItem` update for `createAuctionListing`, setting `isInAuction` and
 * `updatedAt`, including predicates on `id`, `userId`, `quantity`.
 *
 * Escrow takes the row out of home storage and off any furniture placement, matching
 * settlement and trade escrow: a reserved row stays carried so home storage, layout
 * saves and the store/retrieve toggle never act on it.
 */
export const updateUserItemForCreateAuctionListing = (
  client: Pick<DrizzleClient, "update" | "select">,
  auctionUserItemId: string,
  ctx: { userId: string },
  listingQuantity: number,
) =>
  client
    .update(userItem)
    .set({
      isInAuction: true,
      storedAtHome: false,
      homeX: null,
      homeY: null,
      homeRotation: 0,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userItem.id, auctionUserItemId),
        eq(userItem.userId, ctx.userId),
        eq(userItem.quantity, listingQuantity),
        gt(userItem.quantity, 0),
        eq(userItem.equipped, "NONE"),
        eq(userItem.isInAuction, false),
        notExists(
          client
            .select({ id: userItemImbuement.id })
            .from(userItemImbuement)
            .where(
              and(
                eq(userItemImbuement.userItemId, auctionUserItemId),
                gt(userItemImbuement.craftingFinishedAt, sql`NOW()`),
              ),
            ),
        ),
      ),
    );

/** Build the `auctionListing` insert for `createAuctionListing`. */
export const insertAuctionListingForCreateAuctionListing = (
  client: Pick<DrizzleClient, "insert">,
  auctionId: string,
  ctx: { userId: string },
  auctionUserItemId: string,
  listingType: "DIRECT" | "AUCTION",
  targetUserId: undefined | string,
  startingPrice: number,
  buyoutPrice: undefined | number,
  currencyType: "MONEY" | "REPUTATION",
  expiresAt: Date,
  storedBidderMinLevel: number,
  storedBidderMaxLevel: number,
) =>
  client.insert(auctionListing).values({
    id: auctionId,
    sellerId: ctx.userId,
    userItemId: auctionUserItemId,
    listingType,
    targetUserId: targetUserId || null,
    startingPrice,
    buyoutPrice: buyoutPrice || null,
    currentPrice: startingPrice,
    currencyType,
    expiresAt,
    bidderMinLevel: storedBidderMinLevel,
    bidderMaxLevel: storedBidderMaxLevel,
  });

/** Build the `actionLog` insert for `createAuctionListing`. */
export const insertActionLogForCreateAuctionListing = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  auctionUserItemId: string,
  userItemId: string,
  userItemData: { itemId: string },
  listingQuantity: number,
  startingPrice: number,
  buyoutPrice: undefined | number,
  expiresAt: Date,
  storedBidderMinLevel: number,
  storedBidderMaxLevel: number,
  auctionId: string,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "auctionListing",
    changes: JSON.stringify({
      action: "CREATE_AUCTION",
      userItemId: auctionUserItemId,
      originalUserItemId: userItemId,
      itemId: userItemData.itemId,
      quantity: listingQuantity,
      startingPrice,
      buyoutPrice,
      expiresAt,
      bidderMinLevel: storedBidderMinLevel,
      bidderMaxLevel: storedBidderMaxLevel,
    }),
    relatedId: auctionId,
  });

/**
 * Raise an existing bid with one guarded multi-table UPDATE. Preserve listing/bid/user
 * join order and the caller-captured updatedAt across retries; callers must check
 * rowsAffected.
 */
export const executeRaiseStatementForPlaceBid = (
  client: Pick<DrizzleClient, "execute">,
  existingBid: { id: string },
  auction: { currencyType: "MONEY" | "REPUTATION" },
  amount: number,
  updatedAt: Date,
  amountToDeduct: number,
  listingGuard: SQL<unknown> | undefined,
  bidderGuard: SQL<unknown> | undefined,
  bidGuard: SQL<unknown> | undefined,
) => {
  const balance =
    auction.currencyType === "MONEY" ? userData.bank : userData.reputationPoints;
  return client.execute(sql`
            UPDATE ${auctionListing}
            STRAIGHT_JOIN ${auctionBid} ON ${auctionBid.auctionId} = ${auctionListing.id}
              AND ${auctionBid.id} = ${existingBid.id}
            STRAIGHT_JOIN ${userData} ON ${userData.userId} = ${auctionBid.bidderId}
            SET ${auctionListing.currentPrice} = ${amount},
                ${auctionListing.updatedAt} = ${updatedAt},
                ${auctionBid.amount} = ${amount},
                ${balance} = ${balance} - ${amountToDeduct}
            WHERE ${and(listingGuard, bidderGuard, bidGuard)}
          `);
};

/**
 * Build the `auctionListing` update for `placeBid`, setting `currentPrice` and
 * `updatedAt`, using the configured predicates.
 */
export const updateAuctionListingForPlaceBid = (
  client: Pick<DrizzleClient, "update">,
  amount: number,
  updatedAt: Date,
  listingGuard: undefined | SQL<unknown>,
) =>
  client
    .update(auctionListing)
    .set({ currentPrice: amount, updatedAt })
    .where(listingGuard);

/** Build the `userData` update for `placeBid`, using the configured predicates. */
export const updateUserDataForPlaceBid = (
  client: Pick<DrizzleClient, "update">,
  auction: { currencyType: "MONEY" | "REPUTATION" },
  amountToDeduct: number,
  bidderGuard: undefined | SQL<unknown>,
) =>
  client
    .update(userData)
    .set(
      auction.currencyType === "MONEY"
        ? { bank: sql`${userData.bank} - ${amountToDeduct}` }
        : {
            reputationPoints: sql`${userData.reputationPoints} - ${amountToDeduct}`,
          },
    )
    .where(bidderGuard);

/** Build the `auctionBid` insert for `placeBid`. */
export const insertAuctionBidForPlaceBid = (
  client: Pick<DrizzleClient, "insert">,
  bidId: string,
  auctionId: string,
  ctx: { userId: string },
  amount: number,
) =>
  client
    .insert(auctionBid)
    .values({ id: bidId, auctionId, bidderId: ctx.userId, amount });

/**
 * Build the `auctionListing` lookup for `cancelAuction`, selecting only `userItemId`
 * and `status`, using predicates on `id` and `sellerId`.
 */
export const findAuctionListingForCancelAuction = (
  client: Pick<DrizzleClient, "query">,
  auctionId: string,
  ctx: { userId: string },
) =>
  client.query.auctionListing.findFirst({
    where: and(
      eq(auctionListing.id, auctionId),
      eq(auctionListing.sellerId, ctx.userId),
    ),
    columns: {
      userItemId: true,
      status: true,
    },
  });

/** Execute the database statement for `cancelAuction`. */
export const executeCancelResForCancelAuction = (
  client: Pick<DrizzleClient, "execute">,
  auctionId: string,
  ctx: { userId: string },
) =>
  client.execute(sql`
        UPDATE ${auctionListing}
        INNER JOIN ${userItem} ON ${userItem.id} = ${auctionListing.userItemId}
        SET ${auctionListing.status} = 'CANCELLED',
            ${auctionListing.updatedAt} = CURRENT_TIMESTAMP(3),
            ${userItem.isInAuction} = 0,
            ${userItem.updatedAt} = CURRENT_TIMESTAMP(3)
        WHERE ${auctionListing.id} = ${auctionId}
          AND ${auctionListing.sellerId} = ${ctx.userId}
          AND ${auctionListing.status} = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM ${auctionBid} WHERE ${auctionBid.auctionId} = ${auctionListing.id}
          )
      `);

/** Build the `auctionBid` lookup for `cancelAuction`, selecting only `id`, using predicates on `auctionId`. */
export const findAuctionBidForCancelAuction = (
  client: Pick<DrizzleClient, "query">,
  auctionId: string,
) =>
  client.query.auctionBid.findFirst({
    where: eq(auctionBid.auctionId, auctionId),
    columns: { id: true },
  });

/** Build the `actionLog` insert for `cancelAuction`. */
export const insertActionLogForCancelAuction = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  auctionId: string,
  auction: { userItemId: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "auctionListing",
    changes: JSON.stringify({
      action: "CANCEL_AUCTION",
      auctionId,
      userItemId: auction.userItemId,
    }),
    relatedId: auctionId,
  });

/** Execute the database statement for `settleAuctionWithoutRefunds`. */
export const executeResultForSettleAuctionWithoutRefunds = (
  client: Pick<DrizzleClient, "execute">,
  listingGuard: undefined | SQL<unknown>,
  itemGuard: undefined | SQL<unknown>,
) =>
  client.execute(sql`
      UPDATE ${auctionListing}
      STRAIGHT_JOIN ${userItem} ON ${userItem.id} = ${auctionListing.userItemId}
      SET ${auctionListing.status} = 'EXPIRED', ${auctionListing.buyerId} = NULL,
          ${auctionListing.updatedAt} = CURRENT_TIMESTAMP(3),
          ${userItem.isInAuction} = 0, ${userItem.updatedAt} = CURRENT_TIMESTAMP(3)
      WHERE ${and(listingGuard, itemGuard)}
        AND NOT EXISTS (SELECT 1 FROM ${auctionBid} WHERE ${auctionBid.auctionId} = ${auctionListing.id})
    `);

/** Execute the database statement for `settleAuctionWithoutRefunds`. */
export const executeResultForSettleAuctionWithoutRefunds2 = (
  client: Pick<DrizzleClient, "execute">,
  winningBid: { bidderId: string; amount: number },
  sellerBalance: (typeof seller)["bank"] | (typeof seller)["reputationPoints"],
  buyerBalance:
    | typeof import("@/drizzle/schema").userData["bank"]
    | typeof import("@/drizzle/schema").userData["reputationPoints"],
  raise:
    | {
        amountToDeduct: undefined | number;
        bidderGuard: import("@/utils/typeutils").QueryCondition;
      }
    | undefined,
  listingGuard: undefined | SQL<unknown>,
  itemGuard: undefined | SQL<unknown>,
  bid: { id: string; bidderId: string; amount: number },
) =>
  client.execute(sql`
      UPDATE ${auctionListing}
      STRAIGHT_JOIN ${userItem} ON ${userItem.id} = ${auctionListing.userItemId}
      STRAIGHT_JOIN ${auctionBid} ON ${auctionBid.auctionId} = ${auctionListing.id}
      STRAIGHT_JOIN ${userData} AS ${seller} ON ${seller.userId} = ${auctionListing.sellerId}
      STRAIGHT_JOIN ${userData} ON ${userData.userId} = ${auctionBid.bidderId}
      LEFT JOIN ${auctionBid} AS ${otherBid} ON ${otherBid.auctionId} = ${auctionListing.id} AND ${otherBid.id} <> ${auctionBid.id}
      SET ${auctionListing.status} = 'SOLD', ${auctionListing.buyerId} = ${winningBid.bidderId},
          ${auctionListing.currentPrice} = ${winningBid.amount},
          ${auctionListing.expiresAt} = CURRENT_TIMESTAMP(3), ${auctionListing.updatedAt} = CURRENT_TIMESTAMP(3),
          ${userItem.userId} = ${winningBid.bidderId}, ${userItem.isInAuction} = 0,
          ${userItem.activeVariantId} = NULL, ${userItem.storedAtHome} = 0,
          ${userItem.homeX} = NULL, ${userItem.homeY} = NULL, ${userItem.homeRotation} = 0,
          ${userItem.updatedAt} = CURRENT_TIMESTAMP(3),
          ${auctionBid.amount} = ${winningBid.amount}, ${auctionBid.status} = 'WON',
          ${sellerBalance} = ${sellerBalance} + ${getAuctionSellerPayout(winningBid.amount)},
          ${seller.updatedAt} = ${nextSnapshotSql(seller.updatedAt)},
          ${buyerBalance} = ${buyerBalance} - ${raise?.amountToDeduct ?? 0},
          ${userData.updatedAt} = ${nextSnapshotSql(userData.updatedAt)}
      WHERE ${and(
        listingGuard,
        itemGuard,
        raise?.bidderGuard,
        eq(auctionBid.id, bid.id),
        eq(auctionBid.bidderId, bid.bidderId),
        eq(auctionBid.amount, bid.amount),
        eq(auctionBid.status, "ACTIVE"),
        ne(userData.userId, seller.userId),
        isNull(otherBid.id),
      )}
    `);

/**
 * Build the `auctionListing` update for `settleAuction`, setting `updatedAt`, using
 * predicates on `id`, `status`, `expiresAt`.
 */
export const updateAuctionListingForSettleAuction = (
  client: Pick<DrizzleClient, "update">,
  auctionId: string,
  winnerId: undefined | string,
  now: Date,
) =>
  client
    .update(auctionListing)
    .set({
      updatedAt: nextSnapshotSql(auctionListing.updatedAt),
    })
    .where(
      and(
        eq(auctionListing.id, auctionId),
        eq(auctionListing.status, "ACTIVE"),
        winnerId ? undefined : lte(auctionListing.expiresAt, now),
      ),
    );

/**
 * Build the `userItem` update for `settleAuction`, setting `isInAuction` and
 * `updatedAt`, including predicates on `id`, `userId`, `isInAuction`.
 */
export const updateUserItemForSettleAuction = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  winningBid: undefined | import("@/drizzle/schema").AuctionBid,
  auction: { userItemId: string; sellerId: string },
) =>
  client
    .update(userItem)
    .set({
      isInAuction: false,
      updatedAt: now,
      ...(winningBid
        ? {
            userId: winningBid.bidderId,
            // The recipient chooses their own unlocked cosmetic and room placement.
            activeVariantId: null,
            storedAtHome: false,
            homeX: null,
            homeY: null,
            homeRotation: 0,
          }
        : {}),
    })
    .where(
      and(
        eq(userItem.id, auction.userItemId),
        eq(userItem.userId, auction.sellerId),
        eq(userItem.isInAuction, true),
        gt(userItem.quantity, 0),
      ),
    );

/** Build the `userData` update for `settleAuction`, setting `updatedAt`, using predicates on `userId`. */
export const updateUserDataForSettleAuction = (
  client: Pick<DrizzleClient, "update">,
  auction: { currencyType: "MONEY" | "REPUTATION" },
  amounts: SQL<unknown>,
  accounts: [string, number][],
) =>
  client
    .update(userData)
    .set({
      ...(auction.currencyType === "MONEY"
        ? { bank: sql`${userData.bank} + ${amounts}` }
        : { reputationPoints: sql`${userData.reputationPoints} + ${amounts}` }),
      updatedAt: nextSnapshotSql(userData.updatedAt),
    })
    .where(
      inArray(
        userData.userId,
        accounts.map(([id]) => id),
      ),
    );

/** Build the `auctionBid` update for `settleAuction`, setting `status`, using predicates on `id` and `status`. */
export const updateAuctionBidForSettleAuction = (
  client: Pick<DrizzleClient, "update">,
  winningBid: { id: string },
) =>
  client
    .update(auctionBid)
    .set({ status: "WON" })
    .where(and(eq(auctionBid.id, winningBid.id), eq(auctionBid.status, "ACTIVE")));

/** Build the `auctionBid` update for `settleAuction`, setting `status`, using predicates on `id` and `status`. */
export const updateAuctionBidForSettleAuction2 = (
  client: Pick<DrizzleClient, "update">,
  refunds: import("@/drizzle/schema").AuctionBid[],
) =>
  client
    .update(auctionBid)
    .set({ status: "REFUNDED" })
    .where(
      and(
        inArray(
          auctionBid.id,
          refunds.map((bid) => bid.id),
        ),
        eq(auctionBid.status, "ACTIVE"),
      ),
    );

/** Build the `auctionListing` update for `settleAuction`, using predicates on `id`. */
export const updateAuctionListingForSettleAuction2 = (
  client: Pick<DrizzleClient, "update">,
  winningBid: undefined | import("@/drizzle/schema").AuctionBid,
  now: Date,
  auctionId: string,
) =>
  client
    .update(auctionListing)
    .set({
      status: winningBid ? "SOLD" : "EXPIRED",
      buyerId: winningBid?.bidderId ?? null,
      ...(winningBid ? { expiresAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(auctionListing.id, auctionId));

/** Build the `actionLog` insert for `recordBidActivity`. */
export const insertActionLogForRecordBidActivity = (
  client: Pick<DrizzleClient, "insert">,
  log: typeof actionLog.$inferInsert,
) => client.insert(actionLog).values(log);

/** Build the matching auction-ID subquery so callers can compose it without an extra database round trip. */
export const fetchAuctionListingIds = (
  client: Pick<DrizzleClient, "select">,
  options: {
    filterSellerByUsername: boolean;
    applyUserListingPrivacy: boolean;
    userId: string;
    where: SQL | undefined;
    limit: number;
    offset: number;
  },
) => {
  const listingCallerUser = alias(userData, "auctionListingCaller");
  let query = selectAuctionListingForGetAuctionListings(client);
  if (options.filterSellerByUsername) {
    query = query.innerJoin(userData, eq(auctionListing.sellerId, userData.userId));
  }
  if (options.applyUserListingPrivacy) {
    query = query.innerJoin(
      listingCallerUser,
      eq(listingCallerUser.userId, options.userId),
    );
  }
  return query
    .where(options.where)
    .orderBy(desc(auctionListing.expiresAt))
    .limit(options.limit)
    .offset(options.offset);
};

/** Build the `auctionListing` listing for `GET`, using predicates on `status` and `expiresAt`. */
export const listAuctionListingForGET = (
  client: Pick<DrizzleClient, "query">,
  now: Date,
) =>
  client.query.auctionListing.findMany({
    where: and(eq(auctionListing.status, "ACTIVE"), lt(auctionListing.expiresAt, now)),
  });
