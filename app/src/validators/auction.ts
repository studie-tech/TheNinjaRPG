import { z } from "zod";
import { AUCTION_LISTING_STATES, AUCTION_LISTING_TYPES } from "@/drizzle/constants";

// Auction listing schemas
export const createAuctionListingSchema = z.object({
  userItemId: z.string(),
  listingType: z.enum(AUCTION_LISTING_TYPES),
  startingPrice: z.number().min(0.01),
  buyoutPrice: z.number().min(0.01).optional(),
  buyerId: z.string().optional(), // For direct sales
  targetUserId: z.string().optional(), // For direct auctions to specific users
  durationHours: z.number().min(1).max(168), // 1 hour to 7 days
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
