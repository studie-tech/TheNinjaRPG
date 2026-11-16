import { hashKey, type InfiniteData } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs, type RouterOutputs } from "@/app/_trpc/client";
import { getBidAuctionListing, getBidAuctionListings } from "@/deltas/auction";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

type ListingsInput = RouterInputs["auction"]["getAuctionListings"];
type ListingSearch = Omit<ListingsInput, "cursor">;

/**
 * Reconcile the open listing and the search it was opened from with a committed bid. Other
 * searches refresh when they are shown again; a buyout or a changed listing reads both views
 * again.
 */
export const useAuctionBidCacheUpdate = (
  auctionId: string,
  search: ListingSearch | undefined,
) => {
  const utils = api.useUtils();
  const listing = useQueryCacheUpdate<RouterOutputs["auction"]["getAuctionListing"]>(
    getQueryKey(api.auction.getAuctionListing, { auctionId }, "query"),
  );
  const listings = useQueryCacheUpdate<
    InfiniteData<
      RouterOutputs["auction"]["getAuctionListings"],
      ListingsInput["cursor"]
    >
  >(getQueryKey(api.auction.getAuctionListings, search, "infinite"));
  /** Capture the listing, the search and both revisions before sending the bid. */
  const prepareBidUpdate = () => ({
    listing: listing.prepareUpdate(),
    listings: listings.prepareUpdate(),
    search,
  });
  const updateBid = async (
    result: RouterOutputs["auction"]["placeBid"],
    snapshot: ReturnType<typeof prepareBidUpdate>,
  ) => {
    const update = result.success ? result.placedBid : undefined;
    const patchedKey = hashKey(snapshot.listings.key);
    await Promise.all([
      listing.updateCache(
        (current) => getBidAuctionListing(current, update),
        snapshot.listing,
      ),
      snapshot.search &&
        listings.updateCache(
          (current) => getBidAuctionListings(current, update, snapshot.search ?? {}),
          snapshot.listings,
        ),
      utils.auction.getAuctionListings.invalidate(undefined, {
        predicate: (query) =>
          !snapshot.search || hashKey(query.queryKey) !== patchedKey,
      }),
    ]);
  };
  return { prepareBidUpdate, updateBid };
};
