import { and, desc, eq, gte, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  actionLog,
  auctionBid,
  auctionListing,
  item,
  userData,
  userItem,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import {
  createAuctionListingSchema,
  getAuctionListingsSchema,
} from "@/validators/auction";
import { createTRPCRouter, errorResponse, protectedProcedure } from "../trpc";
import { splitItemStack } from "./item";
import { fetchUser } from "./profile";

export const auctionRouter = createTRPCRouter({
  // Get single auction listing with all bids
  getAuctionListing: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get auction listing details and bids" },
    })
    .input(z.object({ auctionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { auctionId } = input;

      const listing = await ctx.drizzle.query.auctionListing.findFirst({
        where: eq(auctionListing.id, auctionId),
        with: {
          userItem: {
            with: {
              item: true,
              imbuements: {
                with: {
                  item: true,
                },
              },
            },
          },
          seller: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
            },
          },
          targetUser: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
            },
          },
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

      return listing;
    }),

  // Get auction listings with pagination and filters
  getAuctionListings: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get paginated auction listings" } })
    .input(getAuctionListingsSchema)
    .query(async ({ ctx, input }) => {
      const {
        cursor,
        limit = 20,
        itemName,
        listingType,
        minPrice,
        maxPrice,
        status,
      } = input;

      // Build where conditions
      const whereConditions = [eq(auctionListing.status, status || "ACTIVE")];

      // Only filter by expire time for ACTIVE listings
      // Other statuses (SOLD, EXPIRED, CANCELLED) should show even after expiration
      if (status === "ACTIVE" || !status) {
        whereConditions.push(gte(auctionListing.expiresAt, new Date()));
      }

      if (listingType) {
        whereConditions.push(eq(auctionListing.listingType, listingType));
      }

      if (minPrice) {
        whereConditions.push(gte(auctionListing.currentPrice, minPrice));
      }

      if (maxPrice) {
        whereConditions.push(sql`${auctionListing.currentPrice} <= ${maxPrice}`);
      }

      // Add item name filter if provided
      if (itemName) {
        whereConditions.push(like(item.name, `%${itemName}%`));
      }

      // Get auction listings with joins for filtering
      const currentCursor = cursor ?? 0;
      const skip = currentCursor * limit;
      const listings = await ctx.drizzle
        .select({ id: auctionListing.id })
        .from(auctionListing)
        .innerJoin(userItem, eq(auctionListing.userItemId, userItem.id))
        .innerJoin(item, eq(userItem.itemId, item.id))
        .where(and(...whereConditions))
        .orderBy(desc(auctionListing.expiresAt))
        .limit(limit)
        .offset(skip);

      // Fetch full related data for the filtered results
      const listingIds = listings.map((listing) => listing.id);
      const fullListings =
        listingIds.length > 0
          ? await ctx.drizzle.query.auctionListing.findMany({
              where: inArray(auctionListing.id, listingIds),
              with: {
                userItem: {
                  with: {
                    item: true,
                    imbuements: {
                      with: {
                        item: true,
                      },
                    },
                  },
                },
                seller: {
                  columns: {
                    userId: true,
                    username: true,
                    avatar: true,
                  },
                },
                bids: {
                  orderBy: desc(auctionBid.amount),
                  limit: 1,
                },
              },
              orderBy: desc(auctionListing.expiresAt),
            })
          : [];

      const nextCursor = listings.length < limit ? null : currentCursor + 1;
      return {
        data: fullListings,
        nextCursor,
      };
    }),

  // Create new auction listing
  createAuctionListing: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Create new auction listing for item" },
    })
    .input(createAuctionListingSchema)
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
      } = input;

      // Check if user item exists and get the item data
      const [userItemData, user] = await Promise.all([
        ctx.drizzle.query.userItem.findFirst({
          where: and(
            eq(userItem.id, userItemId),
            eq(userItem.userId, ctx.userId),
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
        }),
        fetchUser(ctx.drizzle, ctx.userId),
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
      if (userItemData.equipped !== "NONE") {
        return errorResponse("Item is currently equipped");
      }
      if (userItemData.isInAuction) {
        return errorResponse("Item is already in auction");
      }
      const hasActiveImbue = userItemData.imbuements?.some(
        (imb) =>
          imb.craftingFinishedAt && new Date(imb.craftingFinishedAt) > new Date(),
      );
      if (hasActiveImbue) {
        return errorResponse(
          "Cannot list item for auction or direct sale while it is being imbued",
        );
      }
      if (!userItemData.item.canBeTraded) {
        return errorResponse("Item is not tradable");
      }
      if (buyoutPrice && buyoutPrice < startingPrice) {
        return errorResponse("Buyout price must be greater than starting price");
      }

      // Handle quantity splitting for stackable items
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

        // If quantity equals the full stack, use the existing item
        if (quantity === userItemData.quantity) {
          // Use the existing item, no splitting needed
          auctionUserItemId = userItemId;
        } else {
          // Use the convenience method to split the stack
          const quantityToKeep = userItemData.quantity - quantity;
          const result = await splitItemStack(
            ctx.drizzle,
            userItemId,
            ctx.userId,
            quantityToKeep,
          );

          if (!result.success) {
            return errorResponse(result.message);
          }

          // Use the new item for the auction
          auctionUserItemId = result.newUserItemId;
        }
      }

      // Validate target user for DIRECT listings
      if (listingType === "DIRECT") {
        if (!targetUserId) {
          return errorResponse("Target user must be specified for direct listings");
        }
        const targetUser = await ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, targetUserId),
        });
        if (!targetUser) {
          return errorResponse("Target user not found");
        }
        if (targetUserId === ctx.userId) {
          return errorResponse("You cannot create a direct listing for yourself");
        }
      }

      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + durationHours);

      // Create the auction listing
      const auctionId = nanoid();
      await Promise.all([
        ctx.drizzle.insert(auctionListing).values({
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
        }),
        ctx.drizzle
          .update(userItem)
          .set({
            isInAuction: true,
            updatedAt: new Date(),
          })
          .where(eq(userItem.id, auctionUserItemId)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "auctionListing",
          changes: JSON.stringify({
            action: "CREATE_AUCTION",
            userItemId: auctionUserItemId,
            originalUserItemId: userItemId,
            itemId: userItemData.itemId,
            quantity: quantity || userItemData.quantity,
            startingPrice,
            buyoutPrice,
            expiresAt,
          }),
          relatedId: auctionId,
        }),
      ]);

      return { success: true, message: "Auction listing created successfully" };
    }),

  // Place bid on auction
  placeBid: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Place bid on auction listing" } })
    .input(
      z.object({
        auctionId: z.string(),
        amount: z.number().min(0.01),
      }),
    )
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
      if (amount <= auction.currentPrice) {
        return errorResponse("Bid must be higher than current price");
      }

      // Check if user has an existing bid
      const existingBid = auction.bids.find((bid) => bid.bidderId === ctx.userId);
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
      const isBuyoutBid = auction.buyoutPrice && amount >= auction.buyoutPrice;

      // Deduct currency from the user (or full amount if first bid)
      const result = await ctx.drizzle
        .update(userData)
        .set(
          auction.currencyType === "MONEY"
            ? { bank: sql`${userData.bank} - ${amountToDeduct}` }
            : {
                reputationPoints: sql`${userData.reputationPoints} - ${amountToDeduct}`,
              },
        )
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return errorResponse(
          `Failed to deduct ${auction.currencyType === "MONEY" ? "money" : "reputation"} from user`,
        );
      }

      // Either update existing bid or create new one
      if (existingBid) {
        // Update existing bid
        await Promise.all([
          ctx.drizzle
            .update(auctionBid)
            .set({
              amount,
            })
            .where(eq(auctionBid.id, existingBid.id)),
          ctx.drizzle
            .update(auctionListing)
            .set({
              currentPrice: amount,
              updatedAt: new Date(),
            })
            .where(eq(auctionListing.id, auction.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "auctionBid",
            changes: JSON.stringify({
              action: "RAISE_BID",
              auctionId,
              previousAmount: existingBid.amount,
              newAmount: amount,
            }),
            relatedId: existingBid.id,
          }),
        ]);
      } else {
        // Create new bid
        const bidId = nanoid();
        await Promise.all([
          ctx.drizzle.insert(auctionBid).values({
            id: bidId,
            auctionId,
            bidderId: ctx.userId,
            amount,
          }),
          ctx.drizzle
            .update(auctionListing)
            .set({
              currentPrice: amount,
              updatedAt: new Date(),
            })
            .where(eq(auctionListing.id, auction.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "auctionBid",
            changes: JSON.stringify({
              action: "PLACE_BID",
              auctionId,
              amount,
            }),
            relatedId: bidId,
          }),
        ]);
        // Force insert bid into auction object
        auction.bids.push({
          id: bidId,
          auctionId,
          bidderId: ctx.userId,
          amount,
          createdAt: new Date(),
          status: "ACTIVE",
        });
      }

      // If this is a buyout bid, complete the auction immediately
      if (isBuyoutBid) {
        const winningBid = await completeAuctionInternal(
          ctx.drizzle,
          auction,
          ctx.userId,
        );
        return {
          success: true,
          message: winningBid
            ? "Buyout successful - auction completed"
            : "Buyout failed - auction expired",
        };
      }

      return {
        success: true,
        message: existingBid ? "Bid raised successfully" : "Bid placed successfully",
        amountToDeduct,
      };
    }),

  // Complete auction (transfer userItem to winner)
  completeAuction: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Complete expired auction" } })
    .input(z.object({ auctionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { auctionId } = input;

      // Query
      const auction = await fetchAuctionListing(ctx.drizzle, auctionId);

      // Guard
      if (!auction) {
        return errorResponse("Auction not found");
      }
      if (auction.status !== "ACTIVE") {
        return errorResponse("Auction is not active");
      }
      if (auction.expiresAt > new Date()) {
        return errorResponse("Auction has not expired yet");
      }

      // Use the internal completion function
      const winningBid = await completeAuctionInternal(ctx.drizzle, auction);

      // Determine the result message
      return {
        success: true,
        message: winningBid
          ? "Auction completed successfully"
          : "Auction expired with no bids",
      };
    }),

  // Cancel auction (only by seller)
  cancelAuction: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Cancel your auction listing" } })
    .input(z.object({ auctionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { auctionId } = input;

      // Query
      const auction = await fetchAuctionListing(ctx.drizzle, auctionId);

      // Guard
      if (!auction) {
        return errorResponse("Auction not found");
      }
      if (auction.sellerId !== ctx.userId) {
        return errorResponse("You can only cancel your own auctions");
      }
      if (auction.status !== "ACTIVE") {
        return errorResponse("Auction is not active");
      }
      if (auction.bids.length > 0) {
        return errorResponse("Cannot cancel auction with existing bids");
      }
      // Return item to seller and update auction status in parallel
      await Promise.all([
        ctx.drizzle
          .update(userItem)
          .set({
            isInAuction: false,
            updatedAt: new Date(),
          })
          .where(eq(userItem.id, auction.userItemId)),
        ctx.drizzle
          .update(auctionListing)
          .set({
            status: "CANCELLED",
            updatedAt: new Date(),
          })
          .where(eq(auctionListing.id, auction.id)),
      ]);

      return { success: true, message: "Auction cancelled successfully" };
    }),
});

/**
 * Fetch an auction listing with bids
 * @param drizzle - Drizzle client
 * @param auctionId - Auction ID
 * @returns - Auction listing with bids
 */
export const fetchAuctionListing = async (
  drizzle: DrizzleClient,
  auctionId: string,
) => {
  const auction = await drizzle.query.auctionListing.findFirst({
    where: eq(auctionListing.id, auctionId),
    with: {
      bids: true,
      userItem: true,
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

/**
 * Internal function to complete an auction (used for both expiration and buyout)
 * @param drizzle - Drizzle client
 * @param auction - Auction data with bids
 * @param winnerId - Optional specific winner ID (for buyout)
 * @returns - Winning bid if auction was sold, null if expired with no bids
 */
export const completeAuctionInternal = async (
  drizzle: DrizzleClient,
  auction: NonNullable<Awaited<ReturnType<typeof fetchAuctionListing>>>,
  winnerId?: string,
) => {
  // Derived
  const winningBid = winnerId
    ? auction.bids.find((b) => b.bidderId === winnerId)
    : auction.bids.sort((a, b) => b.amount - a.amount)[0];

  const bidsToRefund =
    auction.bids.filter((b) => b.bidderId !== winningBid?.bidderId) || [];

  // Either the auction has a winning bid or it has expired
  if (winningBid) {
    await Promise.all([
      drizzle
        .update(userItem)
        .set({
          userId: winningBid.bidderId,
          isInAuction: false,
          updatedAt: new Date(),
        })
        .where(eq(userItem.id, auction.userItemId)),
      // Update seller based on currency type
      auction.currencyType === "MONEY"
        ? drizzle
            .update(userData)
            .set({
              bank: sql`${userData.bank} + ${winningBid.amount}`,
              updatedAt: new Date(),
            })
            .where(eq(userData.userId, auction.sellerId))
        : drizzle
            .update(userData)
            .set({
              reputationPoints: sql`${userData.reputationPoints} + ${winningBid.amount}`,
              updatedAt: new Date(),
            })
            .where(eq(userData.userId, auction.sellerId)),
      drizzle
        .update(auctionBid)
        .set({ status: "WON" })
        .where(eq(auctionBid.id, winningBid.id)),
      drizzle
        .update(auctionListing)
        .set({
          status: "SOLD",
          buyerId: winningBid.bidderId,
          updatedAt: new Date(),
          expiresAt: new Date(),
        })
        .where(eq(auctionListing.id, auction.id)),
      ...(bidsToRefund.length > 0
        ? bidsToRefund.map((bid) =>
            auction.currencyType === "MONEY"
              ? drizzle
                  .update(userData)
                  .set({ bank: sql`${userData.bank} + ${bid.amount}` })
                  .where(eq(userData.userId, bid.bidderId))
              : drizzle
                  .update(userData)
                  .set({
                    reputationPoints: sql`${userData.reputationPoints} + ${bid.amount}`,
                  })
                  .where(eq(userData.userId, bid.bidderId)),
          )
        : []),
      ...(bidsToRefund.length > 0
        ? bidsToRefund.map((bid) =>
            drizzle
              .update(auctionBid)
              .set({ status: "REFUNDED" })
              .where(eq(auctionBid.id, bid.id)),
          )
        : []),
    ]);
  } else {
    // No bids, return item to seller and update auction status in parallel
    await Promise.all([
      drizzle
        .update(userItem)
        .set({
          isInAuction: false,
          updatedAt: new Date(),
        })
        .where(eq(userItem.id, auction.userItemId)),
      drizzle
        .update(auctionListing)
        .set({
          status: "EXPIRED",
          updatedAt: new Date(),
        })
        .where(eq(auctionListing.id, auction.id)),
    ]);
  }

  return winningBid || null;
};
