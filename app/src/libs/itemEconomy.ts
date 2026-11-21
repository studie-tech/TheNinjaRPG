import {
  AUCTION_SALES_TAX_PERCENT,
  type AuctionListingType,
  type TradeableCurrencyType,
} from "@/drizzle/constants";
import type { Item, ItemPurchaseCounter } from "@/drizzle/schema";
import {
  KESSEN_VILLAGE_BUNDLE_LIMIT_KEY,
  kessenVillagePackFaction,
} from "@/libs/kessen/packs";
import { getItemPurchasePeriodStart } from "@/utils/time";

/** Net seller credit for auction and direct sales in either currency, rounded down. */
export const getAuctionSellerPayout = (salePrice: number) =>
  Math.floor((salePrice * (100 - AUCTION_SALES_TAX_PERCENT)) / 100);

/**
 * Whether a listing type and currency apply an item's per-unit ryo bounds. Cards apply
 * them to every ryo listing, direct sales included, so their floors cannot be bypassed.
 */
export const hasAuctionPriceBounds = (
  item: Pick<Item, "itemType">,
  listingType: AuctionListingType,
  currencyType: TradeableCurrencyType,
) =>
  currencyType === "MONEY" && (listingType === "AUCTION" || item.itemType === "CARD");

/** Price error of an auction or direct listing, or null when the price is allowed. */
export const getAuctionPriceError = (
  item: Pick<Item, "canBeTraded" | "itemType" | "auctionMinPrice" | "auctionMaxPrice">,
  listingType: AuctionListingType,
  price: number,
  quantity: number,
  currencyType: TradeableCurrencyType,
) => {
  if (!item.canBeTraded) return null;
  if (item.itemType === "CARD" && currencyType !== "MONEY") {
    return "Cards can only be listed for ryo";
  }
  if (!hasAuctionPriceBounds(item, listingType, currencyType)) return null;
  if (item.auctionMinPrice != null && price < item.auctionMinPrice * quantity) {
    return `Price must be at least ${item.auctionMinPrice} ryo per unit`;
  }
  if (item.auctionMaxPrice != null && price > item.auctionMaxPrice * quantity) {
    return `Price must be at most ${item.auctionMaxPrice} ryo per unit`;
  }
  return null;
};

/**
 * Whether an item may be requested or offered in an item-for-item trade offer. Cards are
 * excluded because a trade carries no ryo price their auction floors could check.
 */
export const isOfferTradeableItem = (item: Pick<Item, "canBeTraded" | "itemType">) =>
  item.canBeTraded && item.itemType !== "CARD";

/**
 * The key an item's purchases are counted under: its id, or the shared key of the Village
 * Bundles, which share one purchase limit.
 */
export const itemPurchaseLimitKey = (itemId: string) =>
  kessenVillagePackFaction(itemId) ? KESSEN_VILLAGE_BUNDLE_LIMIT_KEY : itemId;

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
  itemId: string,
) =>
  itemPurchaseLimitKey(itemId) === KESSEN_VILLAGE_BUNDLE_LIMIT_KEY &&
  allowance.remaining === 0
    ? "You already bought this week's Village Bundle. The six Village Bundles share one weekly purchase; the next goes on sale Monday 00:00 UTC."
    : `Purchase limit: ${allowance.limit} units ${allowance.period.toLowerCase()}; ${allowance.remaining} remaining. Please refresh and try again.`;
