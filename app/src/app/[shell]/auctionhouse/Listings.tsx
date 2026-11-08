"use client";

import {
  Landmark,
  Search,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserSearch,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { api, type RouterInputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Separator } from "@/components/ui/separator";
import {
  AUCTION_BIDDER_LEVEL_MAX,
  AUCTION_BIDDER_LEVEL_MIN,
  type AuctionListingState,
  IMG_AVATAR_DEFAULT,
} from "@/drizzle/constants";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAvatarRenditionWidth } from "@/layout/Avatar";
import { getRarityBackground } from "@/layout/ContentImage";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { useInfinitePagination } from "@/libs/pagination";
import { cn } from "@/libs/shadui";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  type AuctionListingRow,
  auctionCurrencyUnit,
  formatAuctionCurrency,
  formatAuctionPerUnitLine,
} from "./format";
import { AuctionDetailsDialog } from "./ListingDetailsDialog";

export const AuctionListing: React.FC<AuctionListingProps> = ({
  selectedStatus,
  browseTab,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sellerSearchTerm, setSellerSearchTerm] = useState("");
  const { timeDiff, data: userData } = useRequiredUserData();

  // State
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm);
  const debouncedSellerSearchTerm = useDebouncedValue(sellerSearchTerm);
  const debouncedMinPrice = useDebouncedValue(minPrice);
  const debouncedMaxPrice = useDebouncedValue(maxPrice);
  const isDebouncing =
    searchTerm !== debouncedSearchTerm ||
    sellerSearchTerm !== debouncedSellerSearchTerm ||
    minPrice !== debouncedMinPrice ||
    maxPrice !== debouncedMaxPrice;
  const [selectedAuction, setSelectedAuction] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Queries
  const parsedMinPrice = Number.parseFloat(debouncedMinPrice);
  const parsedMaxPrice = Number.parseFloat(debouncedMaxPrice);
  const {
    data: listings,
    isLoading,
    isPlaceholderData,
    isError,
    isFetching,
    isFetchNextPageError,
    refetch,
    fetchNextPage,
    hasNextPage,
  } = api.auction.getAuctionListings.useInfiniteQuery(
    {
      itemName: debouncedSearchTerm.trim() || undefined,
      sellerSearch: debouncedSellerSearchTerm.trim() || undefined,
      minPrice:
        debouncedMinPrice && Number.isFinite(parsedMinPrice)
          ? Math.max(0, parsedMinPrice)
          : undefined,
      maxPrice:
        debouncedMaxPrice && Number.isFinite(parsedMaxPrice)
          ? Math.max(0, parsedMaxPrice)
          : undefined,
      ...(browseTab === "MINE"
        ? { onlyMine: true as const, listingType: undefined, onlyBidOn: undefined }
        : browseTab === "MY_BIDS"
          ? { onlyBidOn: true as const, listingType: undefined, onlyMine: undefined }
          : {
              onlyMine: undefined,
              onlyBidOn: undefined,
              listingType: browseTab,
            }),
      status: selectedStatus,
      limit: 10,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData, previousQuery) => {
        const previousInput = previousQuery?.queryKey[1]?.input as
          | RouterInputs["auction"]["getAuctionListings"]
          | undefined;
        const isSameScope =
          browseTab === "MINE"
            ? previousInput?.onlyMine === true
            : browseTab === "MY_BIDS"
              ? previousInput?.onlyBidOn === true
              : previousInput?.listingType === browseTab;
        return previousInput?.status === selectedStatus && isSameScope
          ? previousData
          : undefined;
      },
      refetchInterval: 10000,
      refetchIntervalInBackground: false,
    },
  );

  // Infinite pagination
  const isUpdatingFilters = isDebouncing || isPlaceholderData;
  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement: isUpdatingFilters ? null : lastElement,
  });

  // Flatten all pages data and filter out listings with missing userItem data
  // (can happen if item was deleted between query time and render time)
  const allListings =
    listings?.pages
      .flatMap((page) => page.data)
      .filter((listing) => listing.userItem?.item) ?? [];

  return (
    <div>
      <div className="border-b py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="search">Search catalog</Label>
              <div className="relative mt-1">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder={
                    browseTab === "AUCTION"
                      ? "Search by item name…"
                      : browseTab === "DIRECT"
                        ? "Search by item name…"
                        : browseTab === "MINE"
                          ? "Search your listings by item…"
                          : "Search by item name…"
                  }
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="min-w-0">
              <Label htmlFor="search-seller">Search seller</Label>
              <div className="relative mt-1">
                <UserSearch className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search-seller"
                  placeholder="Seller username…"
                  value={sellerSearchTerm}
                  onChange={(e) => setSellerSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:gap-3">
            <div className="w-[7.5rem]">
              <Label htmlFor="minPrice">Min</Label>
              <NumberInput
                id="minPrice"
                optional
                min={0}
                placeholder="0"
                value={minPrice}
                onTextChange={setMinPrice}
                className="mt-1"
              />
            </div>
            <div className="w-[7.5rem]">
              <Label htmlFor="maxPrice">Max</Label>
              <NumberInput
                id="maxPrice"
                optional
                min={0}
                placeholder="∞"
                value={maxPrice}
                onTextChange={setMaxPrice}
                className="mt-1"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="pt-3" aria-busy={isLoading || isUpdatingFilters}>
        {isUpdatingFilters && allListings.length > 0 && (
          <p role="status" className="text-muted-foreground text-sm">
            Updating lots…
          </p>
        )}
        {(isLoading || isUpdatingFilters) && allListings.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader explanation={isLoading ? "Loading lots…" : "Updating lots…"} />
          </div>
        ) : allListings.length === 0 && !isError ? (
          <div className="flex min-h-[36vh] flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 py-16 text-center">
            <Landmark className="mb-3 h-12 w-12 text-muted-foreground opacity-60" />
            <p className="font-medium text-lg">No lots match your filters</p>
            <p className="mt-1 max-w-sm text-muted-foreground text-sm">
              {browseTab === "MINE"
                ? debouncedSellerSearchTerm.trim()
                  ? "No listings match the seller search. Try clearing the seller filter."
                  : "You have no listings in this status. Use the + button to create one, or switch status above."
                : browseTab === "MY_BIDS"
                  ? debouncedSellerSearchTerm.trim()
                    ? "No bids match the seller search. Try clearing the seller filter."
                    : "You have no bids in this status. Open Auctions and place a bid to see it here."
                  : debouncedSearchTerm.trim() || debouncedSellerSearchTerm.trim()
                    ? "Try clearing the item or seller search, widening the price range, or switch to another tab."
                    : "Try widening the price range, or switch to another tab."}
            </p>
          </div>
        ) : allListings.length > 0 ? (
          <>
            <ul className="grid list-none gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {allListings.map((listing) => (
                <li key={listing.id} className="flex min-h-0 min-w-0">
                  <AuctionLotCard
                    listing={listing}
                    timeDiff={timeDiff}
                    bidStanding={
                      browseTab === "MY_BIDS" && userData?.userId
                        ? getAuctionBidStanding(listing, userData.userId)
                        : undefined
                    }
                    onOpen={() => {
                      setSelectedAuction(listing.id);
                      setShowDialog(true);
                    }}
                  />
                </li>
              ))}
            </ul>
            <div ref={setLastElement} className="h-4" />
            {isLoading && allListings.length > 0 && (
              <div className="flex justify-center py-8">
                <Loader explanation="Loading more lots…" />
              </div>
            )}
          </>
        ) : null}
        {isError && !isUpdatingFilters && (
          <p role="alert">
            Could not load lots.{" "}
            <Button
              variant="outline"
              disabled={isFetching}
              onClick={() =>
                isFetchNextPageError ? void fetchNextPage() : void refetch()
              }
            >
              Retry
            </Button>
          </p>
        )}
      </div>

      {selectedAuction && (
        <AuctionDetailsDialog
          auctionId={selectedAuction}
          isOpen={showDialog}
          setIsOpen={setShowDialog}
        />
      )}
    </div>
  );
};

const AuctionLotCard: React.FC<AuctionLotCardProps> = ({
  listing,
  timeDiff,
  bidStanding,
  onOpen,
}) => {
  const item = listing.userItem.item;
  const currencyLabel = auctionCurrencyUnit(listing.currencyType);
  const stackQuantity = listing.userItem.quantity;
  const showPerUnitPricing = item.canStack && stackQuantity > 1;
  const { bidderMinLevel, bidderMaxLevel } = listing;
  const showBidderLevelHint =
    listing.listingType === "AUCTION" &&
    (bidderMinLevel > AUCTION_BIDDER_LEVEL_MIN ||
      bidderMaxLevel < AUCTION_BIDDER_LEVEL_MAX);
  const avatarWidth = useAvatarRenditionWidth(26);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex h-full w-full flex-col rounded-xl border bg-card text-left shadow-sm transition-all",
        "hover:border-primary/50 hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-black">
          <Image
            src={getRarityBackground(item.rarity)}
            alt=""
            width={80}
            height={80}
            className="pointer-events-none absolute inset-0 h-full w-full rounded-[10px] object-cover"
            unoptimized
          />
          {item.image ? (
            <div className="absolute inset-0 z-[1] flex items-center justify-center p-1">
              <Image
                src={item.image}
                alt={item.name}
                width={80}
                height={80}
                className="max-h-full max-w-full object-contain"
                unoptimized
              />
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <p className="line-clamp-2 font-semibold text-sm leading-snug">{item.name}</p>
          {bidStanding ? (
            <div className="mt-1.5">
              {bidStanding === "winning" && (
                <Badge
                  variant="outline"
                  className="gap-1 border-emerald-500/50 bg-emerald-500/10 font-medium text-[10px] text-emerald-900 dark:text-emerald-100"
                >
                  <TrendingUp className="h-3 w-3" />
                  Winning
                </Badge>
              )}
              {bidStanding === "outbid" && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-500/50 bg-amber-500/10 font-medium text-[10px] text-amber-950 dark:text-amber-100"
                >
                  <TrendingDown className="h-3 w-3" />
                  Outbid
                </Badge>
              )}
              {bidStanding === "won" && (
                <Badge
                  variant="outline"
                  className="gap-1 border-primary/40 bg-primary/10 font-medium text-[10px]"
                >
                  <Trophy className="h-3 w-3" />
                  Won
                </Badge>
              )}
              {bidStanding === "lost" && (
                <Badge
                  variant="outline"
                  className="gap-1 border-muted-foreground/30 bg-muted/50 font-medium text-[10px] text-muted-foreground"
                >
                  <XCircle className="h-3 w-3" />
                  Lost
                </Badge>
              )}
            </div>
          ) : null}
          <div className="mt-1.5 space-y-1.5 text-xs">
            <div>
              <p className="mb-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                Seller
              </p>
              <div className="flex min-w-0 items-center gap-2">
                <Image
                  src={listing.seller?.avatar ?? IMG_AVATAR_DEFAULT}
                  alt={`${listing.seller?.username ?? "Seller"} avatar`}
                  width={avatarWidth}
                  height={avatarWidth}
                  className="size-[26px] shrink-0 rounded-full border border-border object-cover"
                  unoptimized
                />
                <span className="truncate font-medium text-foreground">
                  {listing.seller?.username ?? "Unknown"}
                </span>
              </div>
            </div>
            {showBidderLevelHint ? (
              <p className="text-[10px] text-muted-foreground leading-snug">
                Bidders: levels {bidderMinLevel}–{bidderMaxLevel}
              </p>
            ) : null}
            {listing.listingType === "DIRECT" && (
              <div>
                <p className="mb-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  Offered to
                </p>
                <div className="flex min-w-0 items-center gap-2">
                  {listing.targetUser ? (
                    <>
                      <Image
                        src={listing.targetUser.avatar ?? IMG_AVATAR_DEFAULT}
                        alt={`${listing.targetUser.username} avatar`}
                        width={avatarWidth}
                        height={avatarWidth}
                        className="size-[26px] shrink-0 rounded-full border border-border object-cover"
                        unoptimized
                      />
                      <span className="truncate font-medium text-foreground">
                        {listing.targetUser.username}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground italic">Unknown buyer</span>
                  )}
                </div>
              </div>
            )}
          </div>
          {item.canStack && listing.userItem.quantity > 1 ? (
            <p className="mt-1.5 text-muted-foreground text-xs">
              Qty {listing.userItem.quantity}
            </p>
          ) : null}
        </div>
      </div>
      <Separator className="shrink-0 opacity-60" />
      <div className="flex shrink-0 items-end justify-between gap-2 p-3 pt-2">
        <div className="min-h-[4.25rem]">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Current
          </p>
          <p className="font-bold text-base text-emerald-700 tabular-nums dark:text-emerald-400">
            {listing.currentPrice.toLocaleString()}{" "}
            <span className="font-semibold text-muted-foreground text-xs">
              {currencyLabel}
            </span>
          </p>
          {showPerUnitPricing ? (
            <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums leading-tight">
              {formatAuctionPerUnitLine(
                listing.currentPrice,
                stackQuantity,
                listing.currencyType,
              )}
            </p>
          ) : null}
          <p
            className={cn(
              "text-muted-foreground text-xs leading-tight",
              listing.buyoutPrice == null && "invisible",
            )}
            aria-hidden={listing.buyoutPrice == null}
          >
            {listing.buyoutPrice != null
              ? `Buyout ${formatAuctionCurrency(listing.buyoutPrice, listing.currencyType)}`
              : "—"}
          </p>
          {listing.buyoutPrice != null && showPerUnitPricing ? (
            <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums leading-tight">
              {formatAuctionPerUnitLine(
                listing.buyoutPrice,
                stackQuantity,
                listing.currencyType,
              )}
            </p>
          ) : null}
        </div>
        <div className="flex min-h-[4.25rem] flex-col items-end justify-end gap-0.5 text-right">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wide">
            <Timer className="h-3 w-3" />
            Ends
          </div>
          <div className="font-medium text-foreground text-xs tabular-nums">
            <Countdown targetDate={listing.expiresAt} timeDiff={timeDiff} />
          </div>
        </div>
      </div>
    </button>
  );
};

function getAuctionBidStanding(
  listing: AuctionListingRow,
  userId: string,
): BidStanding {
  if (listing.listingType !== "AUCTION") {
    return "lost";
  }
  if (listing.status === "ACTIVE") {
    const lead = listing.bids[0];
    return lead?.bidderId === userId ? "winning" : "outbid";
  }
  if (listing.buyerId === userId) {
    return "won";
  }
  return "lost";
}

type BidStanding = "winning" | "outbid" | "won" | "lost";

export type BrowseTab = "AUCTION" | "DIRECT" | "REQUEST" | "TRADE" | "MINE" | "MY_BIDS";

interface AuctionListingProps {
  selectedStatus: AuctionListingState;
  browseTab: Exclude<BrowseTab, "REQUEST" | "TRADE">;
}

type AuctionLotCardProps = {
  listing: AuctionListingRow;
  timeDiff: number;
  bidStanding?: BidStanding;
  onOpen: () => void;
};
