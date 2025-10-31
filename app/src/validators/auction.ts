import { z } from "zod";
import { AUCTION_LISTING_STATES, AUCTION_LISTING_TYPES, RYO_FOR_REP_MIN_REPS, TRADEABLE_CURRENCY_TYPES } from "@/drizzle/constants";

// Auction listing schemas
export const createAuctionListingSchema = z.object({
  userItemId: z.string(),
  listingType: z.enum(AUCTION_LISTING_TYPES),
  startingPrice: z.number().min(0.01),
  buyoutPrice: z.number().min(0.01).optional(),
  buyerId: z.string().optional(), // For direct sales
  targetUserId: z.string().optional(), // For direct auctions to specific users
  durationHours: z.number().min(1).max(168), // 1 hour to 7 days
  currencyType: z.enum(TRADEABLE_CURRENCY_TYPES).default("MONEY"),
}).refine((data) => {
  // For reputation auctions, ensure minimum reputation amount
  if (data.currencyType === "REPUTATION") {
    return data.startingPrice >= RYO_FOR_REP_MIN_REPS;
  }
  return true;
}, {
  message: `Reputation auctions must have a starting price of at least ${RYO_FOR_REP_MIN_REPS} reputation points`,
  path: ["startingPrice"]
}).refine((data) => {
  // For reputation auctions, ensure buyout price meets minimum if provided
  if (data.currencyType === "REPUTATION" && data.buyoutPrice) {
    return data.buyoutPrice >= RYO_FOR_REP_MIN_REPS;
  }
  return true;
}, {
  message: `Reputation auctions must have a buyout price of at least ${RYO_FOR_REP_MIN_REPS} reputation points`,
  path: ["buyoutPrice"]
}).refine((data) => {
  // Ensure buyout price is higher than starting price
  if (data.buyoutPrice) {
    return data.buyoutPrice > data.startingPrice;
  }
  return true;
}, {
  message: "Buyout price must be higher than the starting price",
  path: ["buyoutPrice"]
});

export const getAuctionListingsSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
  itemName: z.string().optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  listingType: z.enum(AUCTION_LISTING_TYPES).optional(),
  sellerId: z.string().optional(),
  status: z.enum(AUCTION_LISTING_STATES).optional(),
});

// Type exports
export type CreateAuctionListingSchema = z.infer<typeof createAuctionListingSchema>;
export type GetAuctionListingsSchema = z.infer<typeof getAuctionListingsSchema>;
