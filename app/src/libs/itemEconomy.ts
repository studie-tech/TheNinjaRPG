import {
  AUCTION_SALES_TAX_PERCENT,
  type TradeableCurrencyType,
  type AuctionListingType,
} from "@/drizzle/constants";
import type { Item, ItemPurchaseCounter } from "@/drizzle/schema";
import { getItemPurchasePeriodStart } from "@/utils/time";

/** Net seller credit for auction and direct sales in either currency, rounded down. */
export const getAuctionSellerPayout = (salePrice: number) =>
  Math.floor((salePrice * (100 - AUCTION_SALES_TAX_PERCENT)) / 100);

export const getAuctionPriceError = (
  item: Pick<Item, "canBeTraded" | "auctionMinPrice" | "auctionMaxPrice">,
  listingType: AuctionListingType,
  price: number,
  quantity: number,
  currencyType: TradeableCurrencyType,
) => {
  if (listingType !== "AUCTION" || !item.canBeTraded || currencyType !== "MONEY")
    return null;
  if (item.auctionMinPrice != null && price < item.auctionMinPrice * quantity) {
    return `Price must be at least ${item.auctionMinPrice} ryo per unit`;
  }
  if (item.auctionMaxPrice != null && price > item.auctionMaxPrice * quantity) {
    return `Price must be at most ${item.auctionMaxPrice} ryo per unit`;
  }
  return null;
};

export const getItemPurchaseAllowance = (
  item: Pick<Item, "purchaseLimit" | "purchaseLimitPeriod">,
  counters: Pick<ItemPurchaseCounter, "period" | "periodStart" | "quantity">[],
  now = new Date(),
) => {
  const periodStart = getItemPurchasePeriodStart(item.purchaseLimitPeriod, now);
  // Period identity prevents overlapping UTC starts from sharing a quota and
  // preserves usage if staff disable a limit or switch away and back.
  const purchased = periodStart
    ? (counters.find(
        (row) =>
          row.period === item.purchaseLimitPeriod &&
          row.periodStart.getTime() === periodStart.getTime(),
      )?.quantity ?? 0)
    : 0;
  const limit = periodStart ? item.purchaseLimit : null;
  return {
    period: item.purchaseLimitPeriod,
    periodStart,
    limit,
    purchased,
    remaining: limit == null ? null : Math.max(0, limit - purchased),
  };
};

export const itemPurchaseLimitMessage = (
  allowance: ReturnType<typeof getItemPurchaseAllowance>,
) =>
  `Purchase limit: ${allowance.limit} units ${allowance.period.toLowerCase()}; ${allowance.remaining} remaining. Please refresh and try again.`;
