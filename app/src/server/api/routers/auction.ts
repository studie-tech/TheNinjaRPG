import * as Sentry from "@sentry/nextjs";
import {
  and,
  eq,
  exists,
  gt,
  gte,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  AUCTION_BIDDER_LEVEL_MAX,
  AUCTION_BIDDER_LEVEL_MIN,
  AUCTION_HOUSE_MIN_LEVEL,
  AUCTION_LISTING_STATES,
  AUCTION_LISTING_TYPES,
  auctionHouseLevelMessage,
} from "@/drizzle/constants";
import {
  type actionLog,
  auctionBid,
  auctionListing,
  item,
  userData,
  userItem,
} from "@/drizzle/schema";
import { getAuctionPriceError, getAuctionSellerPayout } from "@/libs/itemEconomy";
import {
  executeCancelResForCancelAuction,
  executeRaiseStatementForPlaceBid,
  executeResultForSettleAuctionWithoutRefunds,
  executeResultForSettleAuctionWithoutRefunds2,
  fetchAuctionListing,
  fetchAuctionListingIds,
  findAuctionBidForCancelAuction,
  findAuctionListingForCancelAuction,
  findAuctionListingForGetAuctionListing,
  findUserItemForCreateAuctionListing,
  insertActionLogForCancelAuction,
  insertActionLogForCreateAuctionListing,
  insertActionLogForRecordBidActivity,
  insertAuctionBidForPlaceBid,
  insertAuctionListingForCreateAuctionListing,
  listAuctionListingForGetAuctionListings,
  selectAuctionBidForGetAuctionListings,
  updateAuctionBidForSettleAuction,
  updateAuctionBidForSettleAuction2,
  updateAuctionListingForPlaceBid,
  updateAuctionListingForSettleAuction,
  updateAuctionListingForSettleAuction2,
  updateUserDataForPlaceBid,
  updateUserDataForSettleAuction,
  updateUserItemForCreateAuctionListing,
  updateUserItemForSettleAuction,
} from "@/queries/auction";
import { fetchUser, findUserIdentityById, findUserRoleById } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient, DrizzleTransaction } from "@/server/db";
import { mergeUserItemStacks, ownerOutOfBattle } from "@/server/utils/itemStacks";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { offsetPage } from "@/server/utils/pagination";
import { deferPushToUsers } from "@/server/utils/push/defer";
import { auctionOutbid, tradeUpdate } from "@/server/utils/push/messages";
import type { QueryCondition } from "@/utils/typeutils";
import { createAuctionListingSchema } from "@/validators/auction";
import { auctionOfferProcedures } from "./auctionOffers";
import { splitItemStack } from "./item";

const getAuctionListingsSchema = z.object({
  limit: z.number().min(1).max(100).prefault(10),
  cursor: z.number().nullish(),
  itemName: z.string().optional(),
  /** Partial match on listing seller username (case-insensitive per DB collation). */
  sellerSearch: z.string().optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  listingType: z.enum(AUCTION_LISTING_TYPES).optional(),
  onlyMine: z.boolean().optional(),
  onlyBidOn: z.boolean().optional(),
  status: z.enum(AUCTION_LISTING_STATES).optional(),
});

export const auctionRouter = createTRPCRouter({
  ...auctionOfferProcedures,
  // Get single auction listing with all bids
  getAuctionListing: protectedProcedure
    .meta({
      mcp: { description: "Get auction listing details and bids" },
    })
    .input(z.object({ auctionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { auctionId } = input;

      const [listing, caller] = await Promise.all([
        findAuctionListingForGetAuctionListing(ctx.drizzle, auctionId),
        findUserRoleById(ctx.drizzle, ctx.userId),
      ]);

      if (
        listing &&
        caller?.role === "USER" &&
        listing.listingType === "DIRECT" &&
        listing.sellerId !== ctx.userId &&
        listing.targetUserId !== ctx.userId
      ) {
        return null;
      }

      return listing;
    }),

  // Get auction listings with pagination and filters
  getAuctionListings: protectedProcedure
    .meta({ mcp: { description: "Get paginated auction listings" } })
    .input(getAuctionListingsSchema)
    .query(async ({ ctx, input }) => {
      const {
        cursor,
        limit,
        itemName,
        sellerSearch,
        listingType,
        minPrice,
        maxPrice,
        onlyMine,
        onlyBidOn,
        status,
      } = input;

      const listingCallerUser = alias(userData, "auctionListingCaller");
      const applyUserListingPrivacy = !onlyMine && !onlyBidOn;

      // Build where conditions
      const whereConditions: QueryCondition[] = [
        eq(auctionListing.status, status || "ACTIVE"),
      ];

      // Only filter by expire time for ACTIVE listings
      // Other statuses (SOLD, EXPIRED, CANCELLED) should show even after expiration
      if (status === "ACTIVE" || !status) {
        whereConditions.push(gte(auctionListing.expiresAt, new Date()));
      }

      if (onlyMine) {
        whereConditions.push(eq(auctionListing.sellerId, ctx.userId));
      }

      if (onlyBidOn) {
        whereConditions.push(eq(auctionListing.listingType, "AUCTION"));
        whereConditions.push(
          exists(selectAuctionBidForGetAuctionListings(ctx.drizzle, ctx)),
        );
      } else if (listingType) {
        whereConditions.push(eq(auctionListing.listingType, listingType));
      }

      if (minPrice) {
        whereConditions.push(gte(auctionListing.currentPrice, minPrice));
      }

      if (maxPrice) {
        whereConditions.push(lte(auctionListing.currentPrice, maxPrice));
      }

      // Add item name filter if provided
      if (itemName) {
        whereConditions.push(like(item.name, `%${itemName}%`));
      }

      const sellerSearchTrimmed = sellerSearch?.trim();
      const filterSellerByUsername = !!sellerSearchTrimmed;
      if (filterSellerByUsername) {
        whereConditions.push(like(userData.username, `%${sellerSearchTrimmed}%`));
      }

      if (applyUserListingPrivacy) {
        // Role/level read via join (no extra round-trip). Non-USER roles bypass both filters.
        // Direct: only parties. Auctions: level band or own listing.
        whereConditions.push(
          or(
            ne(listingCallerUser.role, "USER"),
            ne(auctionListing.listingType, "DIRECT"),
            eq(auctionListing.sellerId, ctx.userId),
            eq(auctionListing.targetUserId, ctx.userId),
          ),
        );
        whereConditions.push(
          or(
            ne(listingCallerUser.role, "USER"),
            ne(auctionListing.listingType, "AUCTION"),
            eq(auctionListing.sellerId, ctx.userId),
            and(
              eq(auctionListing.listingType, "AUCTION"),
              lte(auctionListing.bidderMinLevel, listingCallerUser.level),
              gte(auctionListing.bidderMaxLevel, listingCallerUser.level),
            ),
          ),
        );
      }

      // Get auction listings with joins for filtering
      const { skip, cursorAfter } = offsetPage({ cursor, limit });
      const whereClause = and(...whereConditions);

      const listings = await fetchAuctionListingIds(ctx.drizzle, {
        filterSellerByUsername,
        applyUserListingPrivacy,
        userId: ctx.userId,
        where: whereClause,
        limit,
        offset: skip,
      });

      // Fetch full related data for the filtered results
      const listingIds = listings.map((listing) => listing.id);
      const fullListings =
        listingIds.length > 0
          ? await listAuctionListingForGetAuctionListings(ctx.drizzle, listingIds)
          : [];

      const nextCursor = cursorAfter(listings);
      return {
        data: fullListings,
        nextCursor,
      };
    }),

  // Create new auction listing
  createAuctionListing: protectedProcedure
    .meta({
      mcp: { description: "Create new auction listing for item" },
    })
    .input(createAuctionListingSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const {
        userItemId,
        listingType,
        startingPrice,
        buyoutPrice,
        durationHours,
        targetUserId,
        currencyType,
        quantity,
        bidderMinLevel,
        bidderMaxLevel,
      } = input;

      const storedBidderMinLevel =
        listingType === "AUCTION" ? bidderMinLevel : AUCTION_BIDDER_LEVEL_MIN;
      const storedBidderMaxLevel =
        listingType === "AUCTION" ? bidderMaxLevel : AUCTION_BIDDER_LEVEL_MAX;

      // Check if user item exists and get the item data
      const [userItemData, user, targetUser] = await Promise.all([
        findUserItemForCreateAuctionListing(ctx.drizzle, userItemId, ctx),
        fetchUser(ctx.drizzle, ctx.userId),
        listingType === "DIRECT" && targetUserId
          ? findUserIdentityById(ctx.drizzle, targetUserId)
          : Promise.resolve(undefined),
      ]);
      // Guard
      if (!userItemData) {
        return errorResponse("User item not found or not available");
      }
      if (user.isBanned) {
        return errorResponse("You are banned");
      }
      if (user.isTradeBanned) {
        return errorResponse("You are banned from trading");
      }
      if (user.level < AUCTION_HOUSE_MIN_LEVEL) {
        return errorResponse(auctionHouseLevelMessage);
      }
      if (!userItemData.item.canBeTraded) {
        return errorResponse("Item is not tradable");
      }

      // Validate the recipient before splitting any of the sender's inventory.
      if (listingType === "DIRECT") {
        if (!targetUserId) {
          return errorResponse("Target user must be specified for direct listings");
        }
        if (!targetUser) {
          return errorResponse("Target user not found");
        }
        if (targetUserId === ctx.userId) {
          return errorResponse("You cannot create a direct listing for yourself");
        }
      }

      // Handle quantity splitting for stackable items
      const listingQuantity = quantity ?? userItemData.quantity;
      for (const price of [startingPrice, buyoutPrice]) {
        if (price === undefined) continue;
        const priceError = getAuctionPriceError(
          userItemData.item,
          listingType,
          price,
          listingQuantity,
          currencyType,
        );
        if (priceError) return errorResponse(priceError);
      }
      let auctionUserItemId = userItemId;
      if (quantity !== undefined) {
        // Validate quantity is provided for stackable items
        if (!userItemData.item.canStack) {
          return errorResponse("Quantity can only be specified for stackable items");
        }

        // Validate quantity range
        if (quantity < 1 || quantity > userItemData.quantity) {
          return errorResponse(
            `Quantity must be between 1 and ${userItemData.quantity}`,
          );
        }

        // A partial stack is split off; the full stack is listed as is
        if (quantity < userItemData.quantity) {
          const quantityToKeep = userItemData.quantity - quantity;
          const result = await splitItemStack(
            ctx.drizzle,
            userItemId,
            ctx.userId,
            quantityToKeep,
            userItemData.quantity,
          );

          if (!result.success) {
            return errorResponse(result.message);
          }

          // Use the new item for the auction
          auctionUserItemId = result.newUserItemId;
        }
      }

      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + durationHours);

      // Reserve only unequipped items; combat can have captured an item equipped since preload.
      // Also require no active imbuement at write time.
      // Pin the reservation to the priced quantity, including the actual split result.
      // This also excludes negative merge claims and zero-quantity merge tombstones.
      const markInAuctionResult = await updateUserItemForCreateAuctionListing(
        ctx.drizzle,
        auctionUserItemId,
        ctx,
        listingQuantity,
      );
      if (markInAuctionResult.rowsAffected === 0) {
        return errorResponse(
          "Item quantity or availability changed, or item is being imbued; please refresh and try again",
        );
      }

      // Create the auction listing
      const auctionId = nanoid();
      await Promise.all([
        insertAuctionListingForCreateAuctionListing(
          ctx.drizzle,
          auctionId,
          ctx,
          auctionUserItemId,
          { itemId: userItemData.itemId, quantity: listingQuantity },
          listingType,
          targetUserId,
          startingPrice,
          buyoutPrice,
          currencyType,
          expiresAt,
          storedBidderMinLevel,
          storedBidderMaxLevel,
        ),
        insertActionLogForCreateAuctionListing(
          ctx.drizzle,
          ctx,
          auctionUserItemId,
          userItemId,
          userItemData,
          listingQuantity,
          startingPrice,
          buyoutPrice,
          expiresAt,
          storedBidderMinLevel,
          storedBidderMaxLevel,
          auctionId,
        ),
      ]);

      return { success: true, message: "Auction listing created successfully" };
    }),

  // Place bid on auction
  placeBid: protectedProcedure
    .meta({ mcp: { description: "Place bid on auction listing" } })
    .input(
      z.object({
        auctionId: z.string(),
        amount: z.number().int().min(1),
      }),
    )
    .output(baseServerResponse.extend({ amountToDeduct: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { auctionId, amount } = input;

      // Query
      const [auction, user] = await Promise.all([
        fetchAuctionListing(ctx.drizzle, auctionId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);

      // Guard
      if (!auction) {
        return errorResponse("Auction not found");
      }
      if (auction.status !== "ACTIVE" || auction.expiresAt < new Date()) {
        return errorResponse("Auction has expired or is not active");
      }
      if (auction.sellerId === ctx.userId) {
        return errorResponse("You cannot bid on your own auction");
      }
      if (auction.targetUserId && auction.targetUserId !== ctx.userId) {
        return errorResponse("This auction is restricted to a specific user");
      }
      if (user.isBanned) {
        return errorResponse("You are banned");
      }
      if (user.isTradeBanned) {
        return errorResponse("You are banned from trading");
      }
      if (user.level < AUCTION_HOUSE_MIN_LEVEL) {
        return errorResponse(auctionHouseLevelMessage);
      }
      if (auction.listingType === "AUCTION") {
        if (
          user.level < auction.bidderMinLevel ||
          user.level > auction.bidderMaxLevel
        ) {
          return errorResponse(
            `This auction is only open to characters between level ${auction.bidderMinLevel} and ${auction.bidderMaxLevel}.`,
          );
        }
      }
      if (amount <= auction.currentPrice) {
        return errorResponse("Bid must be higher than current price");
      }

      // Check if user has an existing bid
      const existingBid = auction.bids.find((bid) => bid.bidderId === ctx.userId);
      if (
        existingBid &&
        (existingBid.status !== "ACTIVE" || amount <= existingBid.amount)
      ) {
        return errorResponse("Bid must raise your existing active bid; please refresh");
      }
      const amountToDeduct = existingBid ? amount - existingBid.amount : amount;

      // Validate user has enough currency for the bid raise
      if (auction.currencyType === "MONEY") {
        if (user.bank < amountToDeduct) {
          return errorResponse("Insufficient funds in bank");
        }
      } else {
        if (user.reputationPoints < amountToDeduct) {
          return errorResponse("Insufficient reputation points");
        }
      }

      // Check if bid meets or exceeds buyout price
      const isBuyoutBid = auction.buyoutPrice != null && amount >= auction.buyoutPrice;

      let outbidUserId: string | null = null;
      if (auction.bids.length > 0) {
        const sortedBids = [...auction.bids].sort((a, b) => b.amount - a.amount);
        const [previousTopBid] = sortedBids;
        if (
          previousTopBid !== undefined &&
          previousTopBid.bidderId !== ctx.userId &&
          (amount > previousTopBid.amount || isBuyoutBid)
        ) {
          outbidUserId = previousTopBid.bidderId;
        }
      }

      const bidId = existingBid?.id ?? nanoid();
      const updatedAt = new Date();
      const bidLog = {
        id: nanoid(),
        userId: ctx.userId,
        tableName: "auctionBid",
        changes: JSON.stringify(
          existingBid
            ? {
                action: "RAISE_BID",
                auctionId,
                previousAmount: existingBid.amount,
                newAmount: amount,
              }
            : { action: "PLACE_BID", auctionId, amount },
        ),
        relatedId: bidId,
      };
      // Buyouts notify every participant through their settlement instead.
      const notifyOutbid = () => {
        if (outbidUserId)
          deferPushToUsers(ctx.drizzle, [outbidUserId], auctionOutbid(auction.id));
      };
      const listingGuard = and(
        eq(auctionListing.id, auction.id),
        eq(auctionListing.status, "ACTIVE"),
        eq(auctionListing.currentPrice, auction.currentPrice),
        eq(auctionListing.currencyType, auction.currencyType),
        gt(auctionListing.expiresAt, sql`CURRENT_TIMESTAMP(3)`),
        // A committed buyout cannot be overtaken while settlement starts.
        or(
          isNull(auctionListing.buyoutPrice),
          lt(auctionListing.currentPrice, auctionListing.buyoutPrice),
        ),
      );
      const bidderGuard = and(
        eq(userData.userId, ctx.userId),
        eq(userData.isBanned, false),
        eq(userData.isTradeBanned, false),
        gte(userData.level, AUCTION_HOUSE_MIN_LEVEL),
        auction.listingType === "AUCTION"
          ? and(
              gte(userData.level, auction.bidderMinLevel),
              lte(userData.level, auction.bidderMaxLevel),
            )
          : undefined,
        auction.currencyType === "MONEY"
          ? gte(userData.bank, amountToDeduct)
          : gte(userData.reputationPoints, amountToDeduct),
      );
      const bidGuard = existingBid
        ? and(
            eq(auctionBid.id, existingBid.id),
            eq(auctionBid.auctionId, auction.id),
            eq(auctionBid.bidderId, ctx.userId),
            eq(auctionBid.status, "ACTIVE"),
            eq(auctionBid.amount, existingBid.amount),
          )
        : undefined;

      // Drizzle has no multi-table UPDATE builder. Keep the listing first to match
      // settlement's lock order; one statement couples all three existing rows.
      if (existingBid && !isBuyoutBid) {
        const raised = await retryOnDeadlock(() =>
          executeRaiseStatementForPlaceBid(
            ctx.drizzle,
            existingBid,
            auction,
            amount,
            updatedAt,
            amountToDeduct,
            listingGuard,
            bidderGuard,
            bidGuard,
          ),
        );
        if (raised.rowsAffected === 0)
          return errorResponse(
            "Auction, bid or balance changed; please refresh and try again",
          );

        // Activity failures must not turn a committed raise into a failed response.
        // Report them separately, as with training logs.
        await recordBidActivity(ctx.drizzle, bidLog, true);
        notifyOutbid();
        return { success: true, message: "Bid raised successfully", amountToDeduct };
      }

      try {
        if (isBuyoutBid && existingBid && auction.bids.length === 1) {
          // With no losing bids, the claim, debit, delivery and seller payment are one joined row.
          const settlement = await retryOnDeadlock(() =>
            settleAuctionWithoutRefunds(ctx.drizzle, auction, ctx.userId, {
              amount,
              amountToDeduct,
              listingGuard,
              bidderGuard,
            }),
          );
          await Promise.all([
            recordBidActivity(ctx.drizzle, bidLog, true),
            mergeDeliveredItems(ctx.drizzle, [
              { ownerId: ctx.userId, itemId: auction.itemId },
            ]),
          ]);
          notifyAuctionSettlement(ctx.drizzle, settlement);
          return { success: true, message: "Buyout successful - auction completed" };
        }
        // A first bid must INSERT AuctionBid and UPDATE its balance/listing together;
        // MySQL cannot combine that INSERT and those UPDATEs in one statement.
        // A buyout with losing bids also needs the complete-refund checks in settleAuction.
        const settlement = await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            if (existingBid) {
              const raised = await executeRaiseStatementForPlaceBid(
                tx,
                existingBid,
                auction,
                amount,
                updatedAt,
                amountToDeduct,
                listingGuard,
                bidderGuard,
                bidGuard,
              );
              requireBidWrite(
                raised.rowsAffected,
                "Auction, bid or balance changed; please refresh and try again",
              );
            } else {
              const claim = await updateAuctionListingForPlaceBid(
                tx,
                amount,
                updatedAt,
                listingGuard,
              );
              requireBidWrite(
                claim.rowsAffected,
                "Auction changed; please refresh and try again",
              );

              const debit = await updateUserDataForPlaceBid(
                tx,
                auction,
                amountToDeduct,
                bidderGuard,
              );
              requireBidWrite(
                debit.rowsAffected,
                "Balance or trading access changed; please refresh and try again",
              );

              await insertAuctionBidForPlaceBid(tx, bidId, auctionId, ctx, amount);
            }
            await recordBidActivity(tx, bidLog);
            // Buyout escrow, delivery and every payment share this commit.
            return isBuyoutBid ? settleAuction(tx, auction.id, ctx.userId) : null;
          }),
        );
        if (settlement) {
          await mergeDeliveredItems(ctx.drizzle, [
            { ownerId: ctx.userId, itemId: auction.itemId },
          ]);
          notifyAuctionSettlement(ctx.drizzle, settlement);
          return { success: true, message: "Buyout successful - auction completed" };
        }
        notifyOutbid();
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "AuctionBidConflict" ||
            error.name === "AuctionSettlementConflict")
        )
          return errorResponse(error.message);
        throw error;
      }

      return {
        success: true,
        message: existingBid ? "Bid raised successfully" : "Bid placed successfully",
        amountToDeduct,
      };
    }),

  // Cancel listing (seller only, no bids — atomic guard so a race cannot cancel after a bid)
  cancelAuction: protectedProcedure
    .meta({
      mcp: { description: "Cancel your auction listing with no bids" },
    })
    .input(z.object({ auctionId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { auctionId } = input;

      const auction = await findAuctionListingForCancelAuction(
        ctx.drizzle,
        auctionId,
        ctx,
      );

      if (!auction) {
        return errorResponse("Listing not found");
      }
      if (auction.status !== "ACTIVE") {
        return errorResponse("Listing is not active");
      }

      // One guarded statement cancels the listing and clears isInAuction atomically.
      const cancelRes = await executeCancelResForCancelAuction(
        ctx.drizzle,
        auctionId,
        ctx,
      );

      const cancelledRows = Number(cancelRes.rowsAffected ?? 0);
      if (cancelledRows === 0) {
        const anyBid = await findAuctionBidForCancelAuction(ctx.drizzle, auctionId);
        if (anyBid) {
          return errorResponse("Cannot cancel: a bid was placed on this listing");
        }
        return errorResponse("Could not cancel listing");
      }

      await Promise.all([
        insertActionLogForCancelAuction(ctx.drizzle, ctx, auctionId, auction),
        mergeDeliveredItems(ctx.drizzle, [
          { ownerId: ctx.userId, itemId: auction.itemId },
        ]),
      ]);

      return {
        success: true,
        message: "Listing cancelled — the item is back in your inventory.",
      };
    }),
});

/** Settle an expired listing through the atomic listing claim that buyouts share. */
export const completeAuctionInternal = async (
  drizzle: DrizzleClient,
  auctionId: string,
) => {
  try {
    const auction = await fetchAuctionListing(drizzle, auctionId);
    if (!auction) return throwAuctionSettlementConflict("Auction not found");
    const settlement = await retryOnDeadlock(() =>
      auction.bids.length < 2
        ? settleAuctionWithoutRefunds(drizzle, auction)
        : drizzle.transaction((tx) => settleAuction(tx, auctionId)),
    );
    notifyAuctionSettlement(drizzle, settlement);
    return {
      ...settlement,
      // Who received the listed item; the caller merges deliveries once per player.
      delivery: {
        ownerId: settlement.winningBid?.bidderId ?? auction.sellerId,
        itemId: auction.itemId,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AuctionSettlementConflict")
      return { ...errorResponse(error.message), winningBid: null };
    throw error;
  }
};

/** Existing rows without refunds form one guarded join; no transaction is needed. */
const settleAuctionWithoutRefunds = async (
  database: Pick<DrizzleClient, "execute">,
  auction: AuctionSettlementSnapshot,
  winnerId?: string,
  raise?: {
    amount: number;
    amountToDeduct: number;
    listingGuard: QueryCondition;
    bidderGuard: QueryCondition;
  },
) => {
  const [bid] = auction.bids;
  if (auction.bids.length > 1 || (bid && (bid.status !== "ACTIVE" || bid.amount <= 0)))
    return throwAuctionSettlementConflict("Auction escrow changed; please refresh");
  const winningBid = bid ? { ...bid, amount: raise?.amount ?? bid.amount } : null;
  if (
    winnerId &&
    (!winningBid ||
      winningBid.bidderId !== winnerId ||
      auction.buyoutPrice === null ||
      winningBid.amount < auction.buyoutPrice)
  )
    return throwAuctionSettlementConflict(
      "Buyout bid is no longer available; please refresh",
    );
  const listingGuard = and(
    eq(auctionListing.id, auction.id),
    eq(auctionListing.status, "ACTIVE"),
    eq(auctionListing.currentPrice, auction.currentPrice),
    eq(auctionListing.currencyType, auction.currencyType),
    eq(auctionListing.sellerId, auction.sellerId),
    eq(auctionListing.userItemId, auction.userItemId),
    winnerId
      ? eq(auctionListing.buyoutPrice, auction.buyoutPrice ?? 0)
      : lte(auctionListing.expiresAt, sql`CURRENT_TIMESTAMP(3)`),
    raise?.listingGuard,
  );
  const itemGuard = and(
    eq(userItem.userId, auction.sellerId),
    eq(userItem.isInAuction, true),
    gt(userItem.quantity, 0),
  );
  let rowsAffected: number;
  if (!bid || !winningBid) {
    const result = await executeResultForSettleAuctionWithoutRefunds(
      database,
      listingGuard,
      itemGuard,
    );
    rowsAffected = result.rowsAffected;
  } else {
    const seller = alias(userData, "auctionSettlementSeller");

    const sellerBalance =
      auction.currencyType === "MONEY" ? seller.bank : seller.reputationPoints;
    const buyerBalance =
      auction.currencyType === "MONEY" ? userData.bank : userData.reputationPoints;
    // Separate seller and buyer aliases yield exactly one match. Constant prices avoid
    // depending on MySQL's unspecified multi-table assignment order during a bid raise.
    const result = await executeResultForSettleAuctionWithoutRefunds2(
      database,
      winningBid,
      sellerBalance,
      buyerBalance,
      raise,
      listingGuard,
      itemGuard,
      bid,
    );
    rowsAffected = result.rowsAffected;
  }
  if (rowsAffected === 0)
    return throwAuctionSettlementConflict(
      "Auction, bids, balance or reserved item changed; please refresh",
    );
  return {
    success: true,
    message: winningBid
      ? "Auction completed successfully"
      : "Auction expired with no bids",
    winningBid,
    auctionId: auction.id,
    participantIds: [auction.sellerId, ...(winningBid ? [winningBid.bidderId] : [])],
  };
};

/** Shares the bid transaction so a buyout debit and settlement commit together. */
const settleAuction = async (
  tx: DrizzleTransaction,
  auctionId: string,
  winnerId?: string,
) => {
  const now = new Date();
  // Refunds span a variable set of recipient matches. A joined UPDATE can change its
  // ACTIVE/reservation predicates before visiting every match; assignment order is
  // unspecified, so it cannot safely claim once and verify every refund in that form.
  // One alias per recipient would hit MySQL's 61-table join limit; bid counts are unbounded.
  // Claim once here, then check all credit/bid row counts and roll back any missing recipient.
  const claim = await updateAuctionListingForSettleAuction(
    tx,
    auctionId,
    winnerId,
    now,
  );
  requireAuctionSettlementWrite(
    claim.rowsAffected,
    "Auction is no longer active or has not expired yet; please refresh",
  );

  // Read only after claiming: callers may have fetched before another bid committed.
  const auction = await fetchAuctionListing(tx, auctionId);
  if (!auction) return throwAuctionSettlementConflict("Auction not found");
  if (auction.bids.length < 2)
    return settleAuctionWithoutRefunds(tx, auction, winnerId);
  if (auction.bids.some((bid) => bid.status !== "ACTIVE" || bid.amount <= 0))
    throwAuctionSettlementConflict("Auction escrow is inconsistent; contact support");
  const [winningBid] = [...auction.bids].sort(
    (a, b) =>
      b.amount - a.amount ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  if (
    winnerId &&
    (!winningBid ||
      winningBid.bidderId !== winnerId ||
      auction.buyoutPrice === null ||
      winningBid.amount < auction.buyoutPrice)
  )
    throwAuctionSettlementConflict("Buyout bid is no longer available; please refresh");

  const delivery = await updateUserItemForSettleAuction(tx, now, winningBid, auction);
  requireAuctionSettlementWrite(
    delivery.rowsAffected,
    "Reserved auction item is unavailable",
  );

  const refunds = auction.bids.filter((bid) => bid.id !== winningBid?.id);
  const credits = new Map<string, number>();
  if (winningBid)
    credits.set(auction.sellerId, getAuctionSellerPayout(winningBid.amount));
  for (const bid of refunds)
    credits.set(bid.bidderId, (credits.get(bid.bidderId) ?? 0) + bid.amount);
  if (winningBid && !credits.has(winningBid.bidderId))
    credits.set(winningBid.bidderId, 0);
  if (credits.size) {
    const accounts = [...credits].sort(([a], [b]) => a.localeCompare(b));
    const amounts = sql`CASE ${userData.userId} ${sql.join(
      accounts.map(([id, amount]) => sql`WHEN ${id} THEN ${amount}`),
      sql` `,
    )} ELSE 0 END`;
    // One payment statement keeps settlement bounded even with many losing bids.
    // Touch the winner too, so a missing recipient rolls back the item transfer.
    const payment = await updateUserDataForSettleAuction(
      tx,
      auction,
      amounts,
      accounts,
    );
    if (payment.rowsAffected !== credits.size)
      throwAuctionSettlementConflict("Auction recipient account is unavailable");
  }
  if (winningBid) {
    const won = await updateAuctionBidForSettleAuction(tx, winningBid);
    requireAuctionSettlementWrite(
      won.rowsAffected,
      "Winning bid changed; please refresh",
    );
  }
  if (refunds.length) {
    const refunded = await updateAuctionBidForSettleAuction2(tx, refunds);
    if (refunded.rowsAffected !== refunds.length)
      throwAuctionSettlementConflict("Refund bids changed; please refresh");
  }
  await updateAuctionListingForSettleAuction2(tx, winningBid, now, auctionId);

  return {
    success: true,
    message: winningBid
      ? "Auction completed successfully"
      : "Auction expired with no bids",
    winningBid: winningBid ?? null,
    auctionId,
    participantIds: [auction.sellerId, ...auction.bids.map((bid) => bid.bidderId)],
  };
};

const notifyAuctionSettlement = (
  drizzle: DrizzleClient,
  settlement: Awaited<ReturnType<typeof settleAuction>>,
) =>
  deferPushToUsers(
    drizzle,
    settlement.participantIds,
    tradeUpdate(settlement.auctionId),
  );

/**
 * Join items that listings returned or delivered to the stacks their owners carry, one merge
 * per owner so a player's deliveries never race each other's stack claims.
 */
export const mergeDeliveredItems = async (
  drizzle: DrizzleClient,
  deliveries: { ownerId: string; itemId: string | undefined }[],
) => {
  const byOwner = new Map<string, Set<string>>();
  for (const { ownerId, itemId } of deliveries) {
    if (!itemId) continue;
    byOwner.set(ownerId, (byOwner.get(ownerId) ?? new Set()).add(itemId));
  }
  await Promise.all(
    [...byOwner].map(([ownerId, itemIds]) =>
      mergeUserItemStacks(drizzle, ownerId, itemIds, false, ownerOutOfBattle()),
    ),
  );
};

const throwAuctionSettlementConflict = (message: string): never => {
  throw Object.assign(new Error(message), { name: "AuctionSettlementConflict" });
};

const requireBidWrite = (rowsAffected: number, message: string) => {
  // A successful joined raise changes three rows; first-bid writes target one primary key.
  if (rowsAffected === 0)
    throw Object.assign(new Error(message), { name: "AuctionBidConflict" });
};

/** Activity is ancillary after a standalone raise; inside a bid transaction errors abort it. */
const recordBidActivity = async (
  client: Pick<DrizzleClient, "insert">,
  log: typeof actionLog.$inferInsert,
  hasCommitted = false,
) => {
  if (!hasCommitted) {
    await insertActionLogForRecordBidActivity(client, log);
    return;
  }
  try {
    await insertActionLogForRecordBidActivity(client, log);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "auctionBidActivity" },
      extra: { bidId: log.relatedId },
    });
  }
};

const requireAuctionSettlementWrite = (rowsAffected: number, message: string) => {
  if (rowsAffected !== 1) throwAuctionSettlementConflict(message);
};

type AuctionSettlementSnapshot = NonNullable<
  Awaited<ReturnType<typeof fetchAuctionListing>>
>;
