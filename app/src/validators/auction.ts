import { z } from "zod";
import {
  AUCTION_BIDDER_LEVEL_MAX,
  AUCTION_BIDDER_LEVEL_MIN,
  AUCTION_LISTING_STATES,
  AUCTION_LISTING_TYPES,
  RYO_FOR_REP_MIN_REPS,
  TRADEABLE_CURRENCY_TYPES,
} from "@/drizzle/constants";

// Auction listing schemas
export const createAuctionListingSchema = z
  .object({
    userItemId: z.string(),
    listingType: z.enum(AUCTION_LISTING_TYPES),
    startingPrice: z.number().int().min(1),
    buyoutPrice: z.number().int().min(1).optional(),
    buyerId: z.string().optional(), // For direct sales
    targetUserId: z.string().optional(), // For direct auctions to specific users
    durationHours: z.number().min(1).max(168), // 1 hour to 7 days
    currencyType: z.enum(TRADEABLE_CURRENCY_TYPES).prefault("MONEY"),
    quantity: z.int().min(1).optional(), // Quantity to auction from stack
    bidderMinLevel: z
      .number()
      .int()
      .min(AUCTION_BIDDER_LEVEL_MIN)
      .max(AUCTION_BIDDER_LEVEL_MAX)
      .default(AUCTION_BIDDER_LEVEL_MIN),
    bidderMaxLevel: z
      .number()
      .int()
      .min(AUCTION_BIDDER_LEVEL_MIN)
      .max(AUCTION_BIDDER_LEVEL_MAX)
      .default(AUCTION_BIDDER_LEVEL_MAX),
  })
  .refine((data) => data.bidderMinLevel <= data.bidderMaxLevel, {
    message: "Minimum bidder level cannot exceed maximum bidder level",
    path: ["bidderMinLevel"],
  })
  .refine(
    (data) => {
      // For reputation auctions, ensure minimum reputation amount
      if (data.currencyType === "REPUTATION") {
        return data.startingPrice >= RYO_FOR_REP_MIN_REPS;
      }
      return true;
    },
    {
      message: `Reputation auctions must have a starting price of at least ${RYO_FOR_REP_MIN_REPS} reputation points`,
      path: ["startingPrice"],
    },
  )
  .refine(
    (data) => {
      // For reputation auctions, ensure buyout price meets minimum if provided
      if (data.currencyType === "REPUTATION" && data.buyoutPrice) {
        return data.buyoutPrice >= RYO_FOR_REP_MIN_REPS;
      }
      return true;
    },
    {
      message: `Reputation auctions must have a buyout price of at least ${RYO_FOR_REP_MIN_REPS} reputation points`,
      path: ["buyoutPrice"],
    },
  )
  .refine(
    (data) => {
      // Ensure buyout price is higher than starting price
      if (data.buyoutPrice) {
        return data.buyoutPrice > data.startingPrice;
      }
      return true;
    },
    {
      path: ["buyoutPrice"],
      error: "Buyout price must be higher than the starting price",
    },
  );

export const getAuctionListingsSchema = z.object({
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
  sellerId: z.string().optional(),
  status: z.enum(AUCTION_LISTING_STATES).optional(),
});

// Type exports
export type CreateAuctionListingSchema = z.infer<typeof createAuctionListingSchema>;
export type GetAuctionListingsSchema = z.infer<typeof getAuctionListingsSchema>;

// Black market offer schema
export const blackMarketOfferSchema = z.object({
  reps: z.coerce.number().int().min(1),
  ryo: z.coerce.number().int().min(1),
});
export type BlackMarketOfferSchemaInput = z.input<typeof blackMarketOfferSchema>;
export type BlackMarketOfferSchema = z.infer<typeof blackMarketOfferSchema>;
