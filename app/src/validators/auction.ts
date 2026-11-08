import { z } from "zod";
import {
  AUCTION_BIDDER_LEVEL_MAX,
  AUCTION_BIDDER_LEVEL_MIN,
  AUCTION_LISTING_TYPES,
  AUCTION_OFFER_MAX_RYO,
  MAX_ITEM_STACK_SIZE,
  RYO_FOR_REP_MIN_REPS,
  TRADEABLE_CURRENCY_TYPES,
} from "@/drizzle/constants";
import type { Item } from "@/drizzle/schema";
import { getAuctionPriceError } from "@/libs/itemEconomy";

// Auction listing schemas
export const createAuctionListingSchema = z
  .object({
    userItemId: z.string(),
    listingType: z.enum(AUCTION_LISTING_TYPES),
    startingPrice: z.number().int().min(1),
    buyoutPrice: z.number().int().min(1).optional(),
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

/** Item-specific validation for the listing form; the router checks fresh item data. */
export const auctionListingSchemaForItem = (
  item?: Pick<Item, "canBeTraded" | "auctionMinPrice" | "auctionMaxPrice"> &
    Partial<Pick<Item, "canStack">>,
  fullQuantity = 1,
) =>
  createAuctionListingSchema.superRefine((data, ctx) => {
    if (!item) return;
    if (item.canStack && fullQuantity > 1 && data.quantity === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Enter the quantity to send",
      });
    }
    if (data.quantity !== undefined && data.quantity > fullQuantity) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: `Quantity must be between 1 and ${fullQuantity}`,
      });
    }
    for (const field of ["startingPrice", "buyoutPrice"] as const) {
      const price = data[field];
      if (price === undefined) continue;
      const message = getAuctionPriceError(
        item,
        data.listingType,
        price,
        data.quantity ?? fullQuantity,
        data.currencyType,
      );
      if (message) ctx.addIssue({ code: "custom", path: [field], message });
    }
  });

// Type exports
export type CreateAuctionListingSchema = z.infer<typeof createAuctionListingSchema>;

const offerQuantity = z.int().min(1).max(MAX_ITEM_STACK_SIZE);
export const createAuctionOfferSchema = z.discriminatedUnion("offerType", [
  z.object({
    offerType: z.literal("REQUEST"),
    requestedItemId: z.string().min(1, "Choose a wanted item."),
    requestedQuantity: offerQuantity,
    ryo: z.int().min(1).max(AUCTION_OFFER_MAX_RYO),
  }),
  z.object({
    offerType: z.literal("TRADE"),
    requestedItemId: z.string().min(1, "Choose a wanted item."),
    requestedQuantity: offerQuantity,
    offeredUserItemId: z.string().min(1, "Choose an offered item."),
    offeredQuantity: offerQuantity,
  }),
]);
