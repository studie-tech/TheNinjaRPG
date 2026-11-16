import type { InfiniteData } from "@tanstack/react-query";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import type { AuctionBid, UserData } from "@/drizzle/schema";

/** Debit a committed bid raise or buyout from the balance its listing trades in. */
export const getPlaceBidUserUpdate = ({
  currencyType,
  amountToDeduct,
}: {
  currencyType: "MONEY" | "REPUTATION";
  amountToDeduct: number;
}) => ({
  userDelta:
    currencyType === "MONEY"
      ? { bank: -amountToDeduct }
      : { reputationPoints: -amountToDeduct },
});

/**
 * Describe a committed bid for the listing views: the guarded price it replaced, the new
 * price and the bidder's active bid with its public identity.
 */
export const getPlacedBid = ({
  auction,
  existingBid,
  bidId,
  bidder,
  amount,
  updatedAt,
}: {
  auction: { id: string; currentPrice: number };
  existingBid: AuctionBid | undefined;
  bidId: string;
  bidder: Pick<UserData, "userId" | "username" | "avatar">;
  amount: number;
  updatedAt: Date;
}): PlacedBid => ({
  listingId: auction.id,
  previousPrice: auction.currentPrice,
  currentPrice: amount,
  updatedAt,
  bid: {
    id: bidId,
    auctionId: auction.id,
    bidderId: bidder.userId,
    amount,
    status: "ACTIVE",
    createdAt: existingBid?.createdAt ?? updatedAt,
  },
  bidder: { userId: bidder.userId, username: bidder.username, avatar: bidder.avatar },
});

/**
 * Apply a committed bid to the open listing. A listing priced differently from the bid's
 * guarded price changed in between and requires a read.
 */
export const getBidAuctionListing = (
  current: AuctionListing,
  update: PlacedBid | undefined,
): AuctionListing | undefined => {
  if (
    !update ||
    !current ||
    current.id !== update.listingId ||
    current.status !== "ACTIVE" ||
    current.currentPrice !== update.previousPrice
  )
    return;
  const bid = { ...update.bid, bidder: update.bidder };
  const isRaise = current.bids.some((entry) => entry.id === bid.id);
  return {
    ...current,
    currentPrice: update.currentPrice,
    updatedAt: update.updatedAt,
    // Bids are listed newest first; a raise keeps its original position.
    bids: isRaise
      ? current.bids.map((entry) =>
          entry.id === bid.id ? { ...entry, amount: bid.amount } : entry,
        )
      : [bid, ...current.bids],
  };
};

/**
 * Apply a committed bid to a loaded listing search; listings outside the loaded pages stay
 * as they are. A changed price, or a bid that moves the listing outside the search's price
 * range, requires a read.
 */
export const getBidAuctionListings = (
  current: AuctionListingPages,
  update: PlacedBid | undefined,
  input: Pick<AuctionListingsInput, "minPrice" | "maxPrice">,
): AuctionListingPages | undefined => {
  if (!update) return;
  const rows = current.pages.flatMap((page) => page.data);
  if (
    rows.some(
      (row) =>
        row.id === update.listingId &&
        (row.status !== "ACTIVE" || row.currentPrice !== update.previousPrice),
    ) ||
    (input.minPrice && update.currentPrice < input.minPrice) ||
    (input.maxPrice && update.currentPrice > input.maxPrice)
  )
    return;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      // Each row carries only its highest bid, which a higher committed bid replaces.
      data: page.data.map((row) =>
        row.id === update.listingId
          ? {
              ...row,
              currentPrice: update.currentPrice,
              updatedAt: update.updatedAt,
              bids: [update.bid],
            }
          : row,
      ),
    })),
  };
};

type AuctionListing = RouterOutputs["auction"]["getAuctionListing"];
type AuctionListingsInput = RouterInputs["auction"]["getAuctionListings"];
type AuctionListingPages = InfiniteData<
  RouterOutputs["auction"]["getAuctionListings"],
  AuctionListingsInput["cursor"]
>;
/** A committed bid, guarded by the listing price it replaced. */
type PlacedBid = {
  listingId: string;
  previousPrice: number;
  currentPrice: number;
  updatedAt: Date;
  bid: AuctionBid;
  bidder: Pick<UserData, "userId" | "username" | "avatar">;
};
