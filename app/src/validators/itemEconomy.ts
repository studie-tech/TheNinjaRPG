import { z } from "zod";
import {
  AUCTION_OFFER_MAX_RYO,
  ItemPurchaseLimitPeriods,
  MAX_ITEM_PURCHASE_LIMIT,
} from "@/drizzle/constants";
import { makeCappedNullableNumber } from "@/validators/base";

export const itemEconomySchema = z.object({
  auctionMinPrice: makeCappedNullableNumber(AUCTION_OFFER_MAX_RYO),
  auctionMaxPrice: makeCappedNullableNumber(AUCTION_OFFER_MAX_RYO),
  purchaseLimit: makeCappedNullableNumber(MAX_ITEM_PURCHASE_LIMIT, 1),
  purchaseLimitPeriod: z.enum(ItemPurchaseLimitPeriods).default("NONE"),
});

export const refineItemEconomy = (
  data: z.output<typeof itemEconomySchema>,
  ctx: z.RefinementCtx,
) => {
  if (
    data.auctionMinPrice != null &&
    data.auctionMaxPrice != null &&
    data.auctionMinPrice > data.auctionMaxPrice
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["auctionMaxPrice"],
      message: "Maximum auction price must be at least the minimum",
    });
  }
  if (data.purchaseLimitPeriod !== "NONE" && data.purchaseLimit == null) {
    ctx.addIssue({
      code: "custom",
      path: ["purchaseLimit"],
      message: `A limited period requires a quantity from 1 to ${MAX_ITEM_PURCHASE_LIMIT}`,
    });
  }
};
