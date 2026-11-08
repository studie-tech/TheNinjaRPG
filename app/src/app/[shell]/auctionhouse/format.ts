import type { RouterOutputs } from "@/app/_trpc/client";

export function formatAuctionCurrency(
  amount: number,
  currencyType: AuctionListingRow["currencyType"],
) {
  return `${amount.toLocaleString()} ${currencyType === "MONEY" ? "ryo" : "reputation"}`;
}

export function formatAuctionPerUnitLine(
  totalAmount: number,
  quantity: number,
  currencyType: AuctionListingRow["currencyType"],
) {
  if (quantity <= 1) return null;
  const per = totalAmount / quantity;
  const suffix = currencyType === "MONEY" ? "ryo" : "reputation";
  const perStr = per.toLocaleString(undefined, {
    maximumFractionDigits: 4,
    minimumFractionDigits: Number.isInteger(per) ? 0 : 2,
  });
  return `${perStr} ${suffix}/unit · ×${quantity.toLocaleString()}`;
}

export type AuctionListingRow =
  RouterOutputs["auction"]["getAuctionListings"]["data"][number];
