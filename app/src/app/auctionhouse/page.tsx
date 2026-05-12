"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  Gavel,
  Hammer,
  Handshake,
  Info,
  Landmark,
  List,
  Plus,
  Search,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserSearch,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  AUCTION_BIDDER_LEVEL_MAX,
  AUCTION_BIDDER_LEVEL_MIN,
  AUCTION_LISTING_STATES,
  AUCTION_LISTING_TYPES,
  IMG_AVATAR_DEFAULT,
  ItemRarities,
  TRADEABLE_CURRENCY_TYPES,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { getRarityBackground } from "@/layout/ContentImage";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import Table from "@/layout/Table";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useInfinitePagination } from "@/libs/pagination";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { useRequiredUserData, useRequireInVillage } from "@/utils/UserContext";
import type { CreateAuctionListingSchema } from "@/validators/auction";
import { createAuctionListingSchema } from "@/validators/auction";
import { getSearchValidator } from "@/validators/register";

type AuctionListingRow = RouterOutputs["auction"]["getAuctionListings"]["data"][number];

function formatAuctionCurrency(
  amount: number,
  currencyType: AuctionListingRow["currencyType"],
) {
  return `${amount.toLocaleString()} ${currencyType === "MONEY" ? "ryo" : "reputation"}`;
}

function formatAuctionPerUnitLine(
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

type BidStanding = "winning" | "outbid" | "won" | "lost";

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

export default function AuctionHousePage() {
  // Settings
  const { userData, access } = useRequireInVillage("/auctionhouse");

  // State
  const [selectedStatus, setSelectedStatus] = useState<string>("ACTIVE");

  // Guards
  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!access) return <Loader explanation="Accessing Auction House" />;

  return (
    <ContentBox
      title="Auction House"
      subtitle="Live floor • Open bidding • Buy-it-now when listed"
      defaultBackHref="/village"
      padding={false}
      topRightContent={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="h-10 w-[9.5rem] rounded-full border-amber-500/40 bg-background/80 shadow-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUCTION_LISTING_STATES.map((status, i) => (
                <SelectItem key={`${status}-${i}`} value={status}>
                  {capitalizeFirstLetter(status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <NewAuctionListingDialog />
        </div>
      }
    >
      <AuctionListing selectedStatus={selectedStatus} />
    </ContentBox>
  );
}

interface AuctionListingProps {
  selectedStatus: string;
}

type BrowseTab = "AUCTION" | "DIRECT" | "MINE" | "MY_BIDS";

const BROWSE_TAB_OPTIONS: {
  key: BrowseTab;
  id: string;
  label: string;
  Icon: LucideIcon;
}[] = [
  { key: "AUCTION", id: "tab-auctions", label: "Auctions", Icon: Gavel },
  { key: "DIRECT", id: "tab-direct", label: "Direct sales", Icon: Handshake },
  { key: "MINE", id: "tab-mine", label: "My auctions", Icon: List },
  { key: "MY_BIDS", id: "tab-my-bids", label: "My bids", Icon: Hammer },
];

const AuctionListing: React.FC<AuctionListingProps> = ({ selectedStatus }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sellerSearchTerm, setSellerSearchTerm] = useState("");
  const [browseTab, setBrowseTab] = useState<BrowseTab>("AUCTION");
  const { timeDiff, data: userData } = useRequiredUserData();

  // State
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [selectedAuction, setSelectedAuction] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  // Queries
  const parsedMinPrice = Number.parseFloat(minPrice);
  const parsedMaxPrice = Number.parseFloat(maxPrice);
  const {
    data: listings,
    isLoading,
    fetchNextPage,
    hasNextPage,
  } = api.auction.getAuctionListings.useInfiniteQuery(
    {
      itemName: searchTerm.trim() || undefined,
      sellerSearch: sellerSearchTerm.trim() || undefined,
      minPrice:
        minPrice && Number.isFinite(parsedMinPrice)
          ? Math.max(0, parsedMinPrice)
          : undefined,
      maxPrice:
        maxPrice && Number.isFinite(parsedMaxPrice)
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
      status: selectedStatus as "ACTIVE" | "SOLD" | "EXPIRED" | "CANCELLED",
      limit: 10,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchInterval: 10000,
    },
  );

  // Infinite pagination
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Flatten all pages data and filter out listings with missing userItem data
  // (can happen if item was deleted between query time and render time)
  const allListings =
    listings?.pages
      .flatMap((page) => page.data)
      .filter((listing) => listing.userItem?.item) ?? [];

  return (
    <div>
      <div className="relative overflow-hidden border-b bg-linear-to-br from-amber-950/25 via-card to-card px-4 py-6 md:px-6 md:py-8">
        <div className="pointer-events-none absolute -top-24 right-0 h-48 w-48 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-amber-500/15 p-3 ring-1 ring-amber-500/35">
              <Gavel className="h-7 w-7 text-amber-700 dark:text-amber-400" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-lg tracking-tight md:text-xl">
                Village auction floor
              </p>
              <p className="max-w-xl text-muted-foreground text-sm leading-relaxed">
                Open lots with live timers. Tap a lot to inspect the item, review bids,
                and raise your paddle — or buy out at the listed price when available.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b bg-linear-to-b from-amber-950/10 to-muted/30 px-3 py-4 md:px-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-2">
          <div
            className="grid grid-cols-2 gap-1 rounded-xl bg-muted/90 p-1 shadow-inner ring-1 ring-border/50 sm:grid-cols-4 dark:bg-muted/40"
            role="tablist"
            aria-label="Listing type"
          >
            {BROWSE_TAB_OPTIONS.map(({ key, id, label, Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={browseTab === key}
                id={id}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-2.5 font-semibold text-[11px] transition-all sm:flex-row sm:gap-2 sm:py-3 sm:text-sm",
                  browseTab === key
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
                onClick={() => setBrowseTab(key)}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" />
                <span className="text-center leading-tight">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-balance text-center text-muted-foreground text-xs leading-relaxed">
            {browseTab === "AUCTION"
              ? "Open lots — anyone eligible can bid until the timer ends or someone buys out."
              : browseTab === "DIRECT"
                ? "Private listings — only the chosen player can accept the offer."
                : browseTab === "MINE"
                  ? "Everything you currently have listed — open auctions and direct offers together."
                  : "Auctions where you have placed a bid — see if you are leading or have been outbid."}
          </p>
        </div>
      </div>

      <div className="border-b bg-muted/25 px-3 py-4 md:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <Label
                htmlFor="search"
                className="text-muted-foreground text-xs uppercase"
              >
                Search catalog
              </Label>
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
                  className="h-11 rounded-xl border-border/80 bg-background pl-10 shadow-sm"
                />
              </div>
            </div>
            <div className="min-w-0">
              <Label
                htmlFor="search-seller"
                className="text-muted-foreground text-xs uppercase"
              >
                Search seller
              </Label>
              <div className="relative mt-1">
                <UserSearch className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search-seller"
                  placeholder="Seller username…"
                  value={sellerSearchTerm}
                  onChange={(e) => setSellerSearchTerm(e.target.value)}
                  className="h-11 rounded-xl border-border/80 bg-background pl-10 shadow-sm"
                />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:gap-3">
            <div className="w-[7.5rem]">
              <Label
                htmlFor="minPrice"
                className="text-muted-foreground text-xs uppercase"
              >
                Min
              </Label>
              <Input
                id="minPrice"
                type="number"
                min={0}
                placeholder="0"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="mt-1 h-11 rounded-xl shadow-sm"
              />
            </div>
            <div className="w-[7.5rem]">
              <Label
                htmlFor="maxPrice"
                className="text-muted-foreground text-xs uppercase"
              >
                Max
              </Label>
              <Input
                id="maxPrice"
                type="number"
                min={0}
                placeholder="∞"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="mt-1 h-11 rounded-xl shadow-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 md:p-5">
        {isLoading && allListings.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader explanation="Loading lots…" />
          </div>
        ) : allListings.length === 0 ? (
          <div className="flex min-h-[36vh] flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/20 px-6 py-16 text-center">
            <Landmark className="mb-3 h-12 w-12 text-muted-foreground opacity-60" />
            <p className="font-medium text-lg">No lots match your filters</p>
            <p className="mt-1 max-w-sm text-muted-foreground text-sm">
              {browseTab === "MINE"
                ? sellerSearchTerm.trim()
                  ? "No listings match the seller search. Try clearing the seller filter."
                  : "You have no listings in this status. Create one from List item, or switch status above."
                : browseTab === "MY_BIDS"
                  ? sellerSearchTerm.trim()
                    ? "No bids match the seller search. Try clearing the seller filter."
                    : "You have no bids in this status. Open Auctions and place a bid to see it here."
                  : searchTerm.trim() || sellerSearchTerm.trim()
                    ? "Try clearing the item or seller search, widening the price range, or switch to another tab."
                    : "Try widening the price range, or switch to another tab."}
            </p>
          </div>
        ) : (
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

type AuctionLotCardProps = {
  listing: AuctionListingRow;
  timeDiff: number;
  bidStanding?: BidStanding;
  onOpen: () => void;
};

const AuctionLotCard: React.FC<AuctionLotCardProps> = ({
  listing,
  timeDiff,
  bidStanding,
  onOpen,
}) => {
  const item = listing.userItem.item;
  const currencyLabel = listing.currencyType === "MONEY" ? "ryo" : "reputation";
  const stackQuantity = listing.userItem.quantity;
  const showPerUnitPricing = item.canStack && stackQuantity > 1;
  const showRarityBackdrop =
    !!item.rarity &&
    ItemRarities.includes(item.rarity as (typeof ItemRarities)[number]);
  const bidderMinLevel = listing.bidderMinLevel ?? AUCTION_BIDDER_LEVEL_MIN;
  const bidderMaxLevel = listing.bidderMaxLevel ?? AUCTION_BIDDER_LEVEL_MAX;
  const showBidderLevelHint =
    listing.listingType === "AUCTION" &&
    (bidderMinLevel > AUCTION_BIDDER_LEVEL_MIN ||
      bidderMaxLevel < AUCTION_BIDDER_LEVEL_MAX);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex h-full w-full flex-col rounded-2xl border border-border/80 bg-card text-left shadow-sm transition-all",
        "hover:border-amber-500/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60",
      )}
    >
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 border-black">
          {showRarityBackdrop ? (
            <Image
              src={getRarityBackground(item.rarity)}
              alt=""
              width={80}
              height={80}
              className="pointer-events-none absolute inset-0 h-full w-full rounded-[10px] object-cover"
              unoptimized
            />
          ) : (
            <div className="absolute inset-0 bg-muted/40" aria-hidden />
          )}
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
                  className="gap-1 border-emerald-500/50 bg-emerald-500/10 font-medium text-emerald-900 text-[10px] dark:text-emerald-100"
                >
                  <TrendingUp className="h-3 w-3" />
                  Winning
                </Badge>
              )}
              {bidStanding === "outbid" && (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-500/50 bg-amber-500/10 font-medium text-amber-950 text-[10px] dark:text-amber-100"
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
              <p className="mb-0.5 text-muted-foreground text-[10px] uppercase tracking-wide">
                Seller
              </p>
              <div className="flex min-w-0 items-center gap-2">
                <Image
                  src={listing.seller?.avatar ?? IMG_AVATAR_DEFAULT}
                  alt={`${listing.seller?.username ?? "Seller"} avatar`}
                  width={26}
                  height={26}
                  className="size-[26px] shrink-0 rounded-full border border-border object-cover"
                  unoptimized
                />
                <span className="truncate font-medium text-foreground">
                  {listing.seller?.username ?? "Unknown"}
                </span>
              </div>
            </div>
            {showBidderLevelHint ? (
              <p className="text-muted-foreground text-[10px] leading-snug">
                Bidders: levels {bidderMinLevel}–{bidderMaxLevel}
              </p>
            ) : null}
            {listing.listingType === "DIRECT" && (
              <div>
                <p className="mb-0.5 text-muted-foreground text-[10px] uppercase tracking-wide">
                  Offered to
                </p>
                <div className="flex min-w-0 items-center gap-2">
                  {listing.targetUser ? (
                    <>
                      <Image
                        src={listing.targetUser.avatar ?? IMG_AVATAR_DEFAULT}
                        alt={`${listing.targetUser.username} avatar`}
                        width={26}
                        height={26}
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
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
            Current
          </p>
          <p className="font-bold text-base text-emerald-700 tabular-nums dark:text-emerald-400">
            {listing.currentPrice.toLocaleString()}{" "}
            <span className="font-semibold text-muted-foreground text-xs">
              {currencyLabel}
            </span>
          </p>
          {showPerUnitPricing ? (
            <p className="mt-0.5 text-muted-foreground text-[10px] leading-tight tabular-nums">
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
            <p className="mt-0.5 text-muted-foreground text-[10px] leading-tight tabular-nums">
              {formatAuctionPerUnitLine(
                listing.buyoutPrice,
                stackQuantity,
                listing.currencyType,
              )}
            </p>
          ) : null}
        </div>
        <div className="flex min-h-[4.25rem] flex-col items-end justify-end gap-0.5 text-right">
          <div className="flex items-center gap-1 text-muted-foreground text-[10px] uppercase tracking-wide">
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

interface AuctionDetailsDialogProps {
  auctionId: string;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * @param auctionId - Auction ID
 * @param userData - User data
 * @param isOpen - Whether the dialog is open
 * @param setIsOpen - Function to set the dialog open state
 * @returns Auction details dialog
 */
const AuctionDetailsDialog: React.FC<AuctionDetailsDialogProps> = ({
  auctionId,
  isOpen,
  setIsOpen,
}) => {
  // User data
  const { data: userData, updateUser, timeDiff } = useRequiredUserData();

  // State
  const [bidAmount, setBidAmount] = useState("");
  const [showBidConfirmation, setShowBidConfirmation] = useState(false);
  const [showBuyoutConfirmation, setShowBuyoutConfirmation] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [pendingBidAmount, setPendingBidAmount] = useState<number | null>(null);

  // Utils
  const utils = api.useUtils();

  // Query single auction listing
  const { data: listing, isLoading } = api.auction.getAuctionListing.useQuery(
    { auctionId },
    { enabled: isOpen && !!auctionId },
  );

  // Mutations
  const { mutate: placeBid } = api.auction.placeBid.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.auction.getAuctionListings.invalidate(),
          utils.auction.getAuctionListing.invalidate(),
        ]);
        if ("amountToDeduct" in data && data.amountToDeduct && userData && listing) {
          const delta = data.amountToDeduct;
          if (listing.currencyType === "MONEY") {
            await updateUser({ bank: userData.bank - delta });
          } else {
            await updateUser({
              reputationPoints: userData.reputationPoints - delta,
            });
          }
        }
        // Clear state after successful bid
        setBidAmount("");
        setPendingBidAmount(null);
        setShowBidConfirmation(false);
        setShowBuyoutConfirmation(false);
      }
    },
  });

  const { mutate: cancelAuction, isPending: isCancellingAuction } =
    api.auction.cancelAuction.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.auction.getAuctionListings.invalidate(),
            utils.auction.getAuctionListing.invalidate(),
            utils.item.getUserItems.invalidate(),
          ]);
          setShowCancelConfirmation(false);
          setIsOpen(false);
        }
      },
    });

  // Guards
  if (isLoading || !listing) {
    return (
      <Modal2 title="Auction Details" isOpen={isOpen} setIsOpen={setIsOpen}>
        <Loader />
      </Modal2>
    );
  }
  if (!listing.userItem || !listing.userItem.item) {
    return (
      <Modal2 title="Auction Details" isOpen={isOpen} setIsOpen={setIsOpen}>
        <div className="p-4 text-center">
          <p className="text-red-600">This auction is no longer available.</p>
          <p className="mt-2 text-muted-foreground text-sm">
            The item associated with this auction could not be found.
          </p>
        </div>
      </Modal2>
    );
  }
  if (!userData) return null;

  // Derived
  const userBid = listing?.bids.find((bid) => bid.bidderId === userData.userId);
  const spendBalanceForListing =
    listing.currencyType === "MONEY" ? userData.bank : userData.reputationPoints;
  const availableFunds = userBid
    ? spendBalanceForListing + userBid.amount
    : spendBalanceForListing;
  const spendCurrencyLabel = listing.currencyType === "MONEY" ? "bank" : "reputation";
  const spendCurrencyUnit = listing.currencyType === "MONEY" ? "ryo" : "reputation";
  const isExpired = new Date(listing.expiresAt) < new Date();
  const isOwner = listing.sellerId === userData.userId;
  const isActive = listing.status === "ACTIVE";
  const stackQuantity = listing.userItem.quantity;
  const showPerUnitPricing = listing.userItem.item.canStack && stackQuantity > 1;
  const canSellerCancel = isOwner && isActive && listing.bids.length === 0;

  const bidderMinLevel = listing.bidderMinLevel ?? AUCTION_BIDDER_LEVEL_MIN;
  const bidderMaxLevel = listing.bidderMaxLevel ?? AUCTION_BIDDER_LEVEL_MAX;
  const canBidByLevel =
    listing.listingType !== "AUCTION" ||
    (userData.level >= bidderMinLevel && userData.level <= bidderMaxLevel);

  const minIntegerBid = Math.floor(listing.currentPrice) + 1;
  const parsedBidAmount = bidAmount.trim() === "" ? Number.NaN : Number(bidAmount);
  const isBidInputValid =
    Number.isInteger(parsedBidAmount) &&
    parsedBidAmount > listing.currentPrice &&
    parsedBidAmount <= availableFunds;

  // Handlers
  const handlePlaceBid = (auctionId: string, amount: number) => {
    placeBid({ auctionId, amount });
  };

  const handleBid = () => {
    if (bidAmount && listing && isBidInputValid) {
      setPendingBidAmount(parsedBidAmount);
      setShowBidConfirmation(true);
    }
  };

  const handleBuyoutClick = () => {
    if (listing?.buyoutPrice) {
      setPendingBidAmount(listing.buyoutPrice);
      setShowBuyoutConfirmation(true);
    }
  };

  const confirmBid = () => {
    if (pendingBidAmount !== null) {
      handlePlaceBid(auctionId, pendingBidAmount);
    }
  };

  const confirmBuyout = () => {
    if (pendingBidAmount !== null && listing?.buyoutPrice) {
      handlePlaceBid(auctionId, listing.buyoutPrice);
    }
  };

  return (
    <Modal2
      title={
        listing.userItem.item.canStack && listing.userItem.quantity > 1
          ? `${listing.userItem.item.name} (${listing.userItem.quantity})`
          : listing.userItem.item.name
      }
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      className="max-w-2xl"
      bodyClassName="!space-y-1 py-2 sm:py-3"
      footerExtra={
        canSellerCancel ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-red-200 text-red-800 hover:bg-red-50 hover:text-red-900 dark:border-red-900/60 dark:text-red-200 dark:hover:bg-red-950/40"
            onClick={() => setShowCancelConfirmation(true)}
          >
            Cancel listing
          </Button>
        ) : null
      }
    >
      <div className="space-y-2">
        <div className="[&>div]:!mb-1.5">
          <ItemWithEffects
            item={{
              ...listing.userItem.item,
              imbuements: listing.userItem.imbuements.map(
                (imbuement) => imbuement.item,
              ),
              curDurability: listing.userItem.durability,
            }}
            showStatistic="item"
          />
        </div>

        <Card className="overflow-hidden border-amber-500/25 bg-linear-to-br from-amber-950/10 via-card to-card shadow-sm">
          <CardHeader className="space-y-0.5 p-3 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <CardTitle className="flex items-center gap-1.5 text-xs font-semibold">
                <Gavel className="h-3 w-3 text-amber-600" />
                Lot & pricing
              </CardTitle>
              <div className="flex flex-wrap gap-1">
                <Badge
                  variant={listing.listingType === "AUCTION" ? "default" : "secondary"}
                  className="text-[10px]"
                >
                  {listing.listingType === "AUCTION" ? "Auction" : "Direct"}
                </Badge>
                <Badge variant="outline" className="font-normal text-[10px]">
                  {listing.status === "ACTIVE" && !isExpired ? (
                    <span className="flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      <Countdown targetDate={listing.expiresAt} timeDiff={timeDiff} />
                    </span>
                  ) : (
                    capitalizeFirstLetter(listing.status)
                  )}
                </Badge>
              </div>
            </div>
            <CardDescription className="text-[11px] leading-snug">
              {listing.listingType === "DIRECT" && listing.targetUser
                ? `Offered to ${listing.targetUser.username}`
                : listing.listingType === "AUCTION"
                  ? `Open to character levels ${bidderMinLevel}–${bidderMaxLevel}.`
                  : "Visible to all eligible bidders in the village."}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex flex-col gap-2 rounded-md border bg-background/60 p-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 text-muted-foreground text-[10px] uppercase tracking-wide">
                    Seller
                  </span>
                  <Image
                    src={listing.seller?.avatar ?? IMG_AVATAR_DEFAULT}
                    alt=""
                    width={24}
                    height={24}
                    className="size-6 shrink-0 rounded-full border object-cover"
                    unoptimized
                  />
                  <span className="truncate font-medium text-xs">
                    {listing.seller?.username ?? "Deleted User"}
                  </span>
                </div>
                {listing.listingType === "DIRECT" && listing.targetUser ? (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-muted-foreground text-[10px] uppercase tracking-wide">
                      Buyer
                    </span>
                    <Image
                      src={listing.targetUser.avatar ?? IMG_AVATAR_DEFAULT}
                      alt=""
                      width={24}
                      height={24}
                      className="size-6 shrink-0 rounded-full border object-cover"
                      unoptimized
                    />
                    <span className="truncate font-medium text-xs">
                      {listing.targetUser.username}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 border-t border-emerald-500/20 pt-1.5 sm:border-t-0 sm:border-l sm:pl-3 sm:pt-0">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
                  Current
                </p>
                <p className="font-bold text-base leading-tight text-emerald-800 tabular-nums sm:text-right dark:text-emerald-300">
                  {formatAuctionCurrency(listing.currentPrice, listing.currencyType)}
                </p>
                {showPerUnitPricing ? (
                  <p className="mt-0.5 text-muted-foreground text-[10px] leading-tight sm:text-right">
                    {formatAuctionPerUnitLine(
                      listing.currentPrice,
                      stackQuantity,
                      listing.currencyType,
                    )}
                  </p>
                ) : null}
                {listing.buyoutPrice != null ? (
                  <p className="mt-0.5 text-muted-foreground text-[11px] sm:text-right">
                    Buyout{" "}
                    {formatAuctionCurrency(listing.buyoutPrice, listing.currencyType)}
                  </p>
                ) : null}
                {listing.buyoutPrice != null && showPerUnitPricing ? (
                  <p className="mt-0.5 text-muted-foreground text-[10px] leading-tight sm:text-right">
                    {formatAuctionPerUnitLine(
                      listing.buyoutPrice,
                      stackQuantity,
                      listing.currencyType,
                    )}
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-0.5 p-3 pb-1.5">
            <CardTitle className="text-sm">Bid register</CardTitle>
            <CardDescription className="text-xs">
              {listing.bids.length} recorded{" "}
              {listing.bids.length === 1 ? "bid" : "bids"}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {listing.bids.length === 0 ? (
              <p className="px-3 pb-3 text-muted-foreground text-xs">
                No bids yet — be the first to open the lot.
              </p>
            ) : (
              <div className="overflow-x-auto border-t">
                <Table
                  compact
                  data={listing.bids.map((bid) => ({
                    ...bid,
                    bidder: bid.bidder?.avatar ?? IMG_AVATAR_DEFAULT,
                  }))}
                  columns={[
                    { key: "bidder", header: "Bidder", type: "avatar" },
                    { key: "amount", header: "Amount", type: "number" },
                    { key: "status", header: "Status", type: "capitalized" },
                    { key: "createdAt", header: "Date", type: "date" },
                  ]}
                  onRowClick={() => {}}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {isActive &&
          !isExpired &&
          !isOwner &&
          (!listing.targetUserId || listing.targetUserId === userData.userId) &&
          canBidByLevel && (
            <Card className="border-primary/20 bg-muted/20">
              <CardHeader className="space-y-0.5 p-3 pb-1.5">
                <CardTitle className="text-sm">Raise your bid</CardTitle>
                <CardDescription className="text-xs leading-snug">
                  {listing.currencyType === "MONEY"
                    ? "Above current price; bank holds ryo on confirm."
                    : "Above current price; reputation is held on confirm."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-3 pt-0">
                <div className="space-y-1 rounded-md border bg-background/80 p-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      Available {spendCurrencyLabel}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {availableFunds.toLocaleString()} {spendCurrencyUnit}
                    </span>
                  </div>
                  {userBid && (
                    <div className="flex justify-between gap-2 text-primary">
                      <span>Your bid</span>
                      <span className="font-semibold tabular-nums">
                        {userBid.amount.toLocaleString()} {spendCurrencyUnit}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5 sm:flex-row">
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="Bid amount (whole numbers)"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    min={minIntegerBid}
                    step={1}
                    className="h-9 flex-1"
                  />
                  <Button
                    onClick={handleBid}
                    disabled={!isBidInputValid}
                    className="h-9 shrink-0"
                    size="sm"
                  >
                    <Hammer className="mr-1.5 h-3.5 w-3.5" />
                    {userBid ? "Raise to" : "Place bid"}
                  </Button>
                </div>
                {listing.buyoutPrice && availableFunds >= listing.buyoutPrice && (
                  <Button
                    onClick={handleBuyoutClick}
                    variant="default"
                    size="sm"
                    className="h-9 w-full"
                  >
                    Buy it now —{" "}
                    {formatAuctionCurrency(listing.buyoutPrice, listing.currencyType)}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

        {isOwner ? (
          <div className="space-y-2">
            <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50/90 p-2.5 dark:border-blue-900 dark:bg-blue-950/40">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-700 dark:text-blue-300" />
              <p className="text-blue-900 text-xs leading-snug dark:text-blue-100">
                This is your listing — you cannot bid on your own lot.
              </p>
            </div>
            {!canSellerCancel && isActive ? (
              <p className="text-center text-muted-foreground text-[10px]">
                Bids have been placed — this listing can no longer be cancelled.
              </p>
            ) : null}
          </div>
        ) : null}

        {isExpired && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50/90 p-2.5 dark:border-red-900 dark:bg-red-950/40">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-300" />
            <p className="text-red-900 text-xs leading-snug dark:text-red-100">
              This auction has ended.
            </p>
          </div>
        )}

        {isActive &&
          !isExpired &&
          !isOwner &&
          listing.targetUserId &&
          listing.targetUserId !== userData.userId && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50/90 p-2.5 dark:border-red-900 dark:bg-red-950/40">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              <p className="text-red-900 text-xs leading-snug dark:text-red-100">
                Direct lot for {listing.targetUser?.username}. You are not eligible to
                bid.
              </p>
            </div>
          )}

        {isActive &&
          !isExpired &&
          !isOwner &&
          listing.listingType === "AUCTION" &&
          (!listing.targetUserId || listing.targetUserId === userData.userId) &&
          !canBidByLevel && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/90 p-2.5 dark:border-amber-900 dark:bg-amber-950/40">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800 dark:text-amber-200" />
              <p className="text-amber-950 text-xs leading-snug dark:text-amber-100">
                Your character is level {userData.level}. This auction only accepts
                levels {bidderMinLevel}–{bidderMaxLevel}.
              </p>
            </div>
          )}
      </div>

      {/* Bid Confirmation Dialog */}
      <AlertDialog open={showBidConfirmation} onOpenChange={setShowBidConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bid</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to place a bid of{" "}
              <span className="font-semibold">
                {pendingBidAmount?.toLocaleString()}{" "}
                {listing?.currencyType === "MONEY" ? "ryo" : "reputation"}
              </span>{" "}
              on this auction?
              {showPerUnitPricing &&
              pendingBidAmount != null &&
              listing?.currencyType != null ? (
                <span className="mt-2 block text-muted-foreground text-sm">
                  {formatAuctionPerUnitLine(
                    pendingBidAmount,
                    stackQuantity,
                    listing.currencyType,
                  )}
                </span>
              ) : null}
              {userBid && (
                <span className="mt-2 block text-sm">
                  Your current bid of {userBid.amount.toLocaleString()} will be
                  replaced.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBid}>Confirm Bid</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showCancelConfirmation}
        onOpenChange={setShowCancelConfirmation}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel listing?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end the listing and return{" "}
              <span className="font-semibold">{listing.userItem.item.name}</span> to
              your inventory. You can only do this while there are no bids.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancellingAuction}>
              Keep listing
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isCancellingAuction}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                cancelAuction({ auctionId });
              }}
            >
              {isCancellingAuction ? "Cancelling…" : "Cancel listing"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Buyout Confirmation Dialog */}
      <AlertDialog
        open={showBuyoutConfirmation}
        onOpenChange={setShowBuyoutConfirmation}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Buyout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to buyout this auction for{" "}
              <span className="font-semibold">
                {listing?.buyoutPrice?.toLocaleString()}{" "}
                {listing?.currencyType === "MONEY" ? "ryo" : "reputation"}
              </span>
              ? This will immediately complete the auction and transfer the item to you.
              {showPerUnitPricing &&
              listing?.buyoutPrice != null &&
              listing.currencyType != null ? (
                <span className="mt-2 block text-muted-foreground text-sm">
                  {formatAuctionPerUnitLine(
                    listing.buyoutPrice,
                    stackQuantity,
                    listing.currencyType,
                  )}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBuyout}>
              Confirm Buyout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Modal2>
  );
};

export const NewAuctionListingDialog: React.FC = () => {
  const ignoreNextPopoverOpenRef = useRef(false);
  const itemSearchInputRef = useRef<HTMLInputElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Utils
  const utils = api.useUtils();

  // Create Listing Form
  const createForm = useForm<
    z.input<typeof createAuctionListingSchema>,
    unknown,
    CreateAuctionListingSchema
  >({
    resolver: zodResolver(createAuctionListingSchema),
    defaultValues: {
      listingType: "AUCTION",
      durationHours: 24,
      currencyType: TRADEABLE_CURRENCY_TYPES[0],
      bidderMinLevel: AUCTION_BIDDER_LEVEL_MIN,
      bidderMaxLevel: AUCTION_BIDDER_LEVEL_MAX,
    },
  });

  // Search Form for DIRECT auctions
  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });

  // Queries
  const { data: userItems } = api.item.getUserItems.useQuery();

  // Mutations
  const [itemSearchTerm, setItemSearchTerm] = useState("");

  // Ensure keyboard focus is moved into the dialog's search field on every open.
  // (autoFocus only happens on mount, but some popover implementations may keep the input mounted)
  useEffect(() => {
    if (!isOpen || !dropdownOpen) return;
    const timer = setTimeout(() => itemSearchInputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen, dropdownOpen]);

  const filteredItems =
    userItems?.filter((item) => {
      return (
        item.item?.canBeTraded &&
        item.equipped === "NONE" &&
        (!item.craftingFinishedAt || new Date(item.craftingFinishedAt) < new Date()) &&
        !item.isInAuction
      );
    }) || [];

  const filteredItemsForDropdown = filteredItems.filter((userItem) => {
    const name = (userItem.item?.name || "").trim().toLowerCase();
    const search = itemSearchTerm.trim().toLowerCase();
    return name.includes(search);
  });

  const { mutate: createListing, isPending: isCreating } =
    api.auction.createAuctionListing.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          setIsOpen(false);
          createForm.reset();
          setItemSearchTerm("");
          setDropdownOpen(false);
          userSearchMethods.reset();
          await Promise.all([
            utils.auction.getAuctionListings.invalidate(),
            utils.item.getUserItems.invalidate(),
            utils.auction.getAuctionListing.invalidate(),
          ]);
        }
      },
    });

  const watchedListingType = useWatch({
    control: createForm.control,
    name: "listingType",
  });

  useEffect(() => {
    if (watchedListingType === "DIRECT") {
      createForm.setValue("bidderMinLevel", AUCTION_BIDDER_LEVEL_MIN);
      createForm.setValue("bidderMaxLevel", AUCTION_BIDDER_LEVEL_MAX);
    }
  }, [watchedListingType, createForm]);

  const watchedUserItemId = useWatch({
    control: createForm.control,
    name: "userItemId",
  });

  // Get the selected item to check if it's stackable
  const selectedItem = filteredItems.find((item) => item.id === watchedUserItemId);
  const showQuantityInput = selectedItem?.item?.canStack && selectedItem.quantity > 1;

  // Reset quantity when item selection changes
  useEffect(() => {
    if (!showQuantityInput) {
      createForm.setValue("quantity", undefined);
    }
  }, [showQuantityInput, createForm]);

  const onCreateSubmit = (data: CreateAuctionListingSchema) => {
    const userSearchData = userSearchMethods.getValues();
    const submissionData: CreateAuctionListingSchema = {
      ...data,
      targetUserId:
        data.listingType === "DIRECT" && userSearchData.users.length > 0
          ? userSearchData.users[0]?.userId
          : undefined,
    };
    createListing(submissionData);
  };
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          // Show the item search dropdown when opening the dialog,
          // then let `autoFocus` handle focusing the actual CommandInput.
          setItemSearchTerm("");
          setDropdownOpen(true);
        } else {
          createForm.reset();
          setItemSearchTerm("");
          setDropdownOpen(false);
          ignoreNextPopoverOpenRef.current = false;
          userSearchMethods.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button className="rounded-full shadow-sm">
          <Plus className="mr-2 h-4 w-4" />
          List item
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>List a new lot</DialogTitle>
          <DialogDescription>
            Choose an item from your inventory, set a starting price and optional
            buyout, then open the floor to bidders or send a direct offer.
          </DialogDescription>
        </DialogHeader>
        <Form {...createForm}>
          <form
            onSubmit={createForm.handleSubmit(onCreateSubmit)}
            className="space-y-4"
          >
            <FormField
              control={createForm.control}
              name="userItemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Item to List</FormLabel>
                  <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Input
                          id="user-item-search"
                          role="combobox"
                          aria-expanded={dropdownOpen}
                          aria-controls="user-item-list"
                          placeholder="Search your items..."
                          value={field.value ? selectedItem?.item?.name || "" : ""}
                          readOnly
                          onFocus={() => {
                            if (ignoreNextPopoverOpenRef.current) {
                              ignoreNextPopoverOpenRef.current = false;
                              return;
                            }
                            setDropdownOpen(true);
                          }}
                          onClick={() => {
                            if (ignoreNextPopoverOpenRef.current) {
                              ignoreNextPopoverOpenRef.current = false;
                              return;
                            }
                            setDropdownOpen(true);
                          }}
                          className="mb-2 w-full cursor-text border border-gray-400 bg-white font-semibold text-black placeholder:font-bold placeholder:text-gray-600"
                        />
                      </FormControl>
                    </PopoverTrigger>

                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command shouldFilter={false}>
                        <CommandInput
                          autoFocus
                          ref={itemSearchInputRef}
                          placeholder="Search your items..."
                          value={itemSearchTerm}
                          onValueChange={(value) => {
                            if (field.value) {
                              field.onChange("");
                            }
                            setItemSearchTerm(value);
                          }}
                          className="h-9"
                        />
                        <CommandList
                          className="w-full max-h-[300px] overflow-y-auto"
                          onWheel={(e) => {
                            const LINE_HEIGHT = 18;
                            const PAGE_HEIGHT = e.currentTarget.clientHeight;
                            const delta =
                              e.deltaMode === 1
                                ? e.deltaY * LINE_HEIGHT
                                : e.deltaMode === 2
                                  ? e.deltaY * PAGE_HEIGHT
                                  : e.deltaY;
                            e.currentTarget.scrollTop += delta;
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          {filteredItemsForDropdown.length === 0 ? (
                            <CommandEmpty>No items found</CommandEmpty>
                          ) : (
                            <CommandGroup>
                              {filteredItemsForDropdown.map((userItem) => (
                                <CommandItem
                                  key={userItem.id}
                                  value={userItem.id}
                                  onSelect={() => {
                                    ignoreNextPopoverOpenRef.current = true;
                                    field.onChange(userItem.id);
                                    setItemSearchTerm("");
                                    setDropdownOpen(false);
                                  }}
                                >
                                  {userItem.item?.name}
                                  {userItem.quantity > 1
                                    ? ` (${userItem.quantity})`
                                    : ""}
                                  {userItem.imbuements && userItem.imbuements.length > 0
                                    ? ` (${userItem.imbuements.length} imbuement(s))`
                                    : ""}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <FormMessage />
                </FormItem>
              )}
            />

            {showQuantityInput && (
              <FormField
                control={createForm.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity to Auction</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max={selectedItem?.quantity || 1}
                        placeholder={`1-${selectedItem?.quantity || 1}`}
                        {...field}
                        onChange={(e) => {
                          const value =
                            e.target.value === ""
                              ? undefined
                              : parseInt(e.target.value, 10);
                          field.onChange(Number.isNaN(value || 0) ? undefined : value);
                        }}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <p className="text-muted-foreground text-sm">
                      Current stack: {selectedItem?.quantity} items
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={createForm.control}
              name="listingType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Listing Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {AUCTION_LISTING_TYPES.map((type, i) => (
                        <SelectItem key={`${type}-${i}`} value={type}>
                          {type === "AUCTION" ? "Auction" : "Direct to User"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchedListingType === "AUCTION" && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={createForm.control}
                  name="bidderMinLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Min bidder level</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="numeric"
                          step={1}
                          min={AUCTION_BIDDER_LEVEL_MIN}
                          max={AUCTION_BIDDER_LEVEL_MAX}
                          value={field.value}
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          onChange={(e) => {
                            const n = Number.parseInt(e.target.value, 10);
                            const next = Number.isFinite(n)
                              ? Math.min(
                                  AUCTION_BIDDER_LEVEL_MAX,
                                  Math.max(AUCTION_BIDDER_LEVEL_MIN, n),
                                )
                              : AUCTION_BIDDER_LEVEL_MIN;
                            field.onChange(next);
                          }}
                        />
                      </FormControl>
                      <p className="text-muted-foreground text-xs">
                        Lowest character level that may bid (range{" "}
                        {AUCTION_BIDDER_LEVEL_MIN}–{AUCTION_BIDDER_LEVEL_MAX}).
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="bidderMaxLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max bidder level</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="numeric"
                          step={1}
                          min={AUCTION_BIDDER_LEVEL_MIN}
                          max={AUCTION_BIDDER_LEVEL_MAX}
                          value={field.value}
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          onChange={(e) => {
                            const n = Number.parseInt(e.target.value, 10);
                            const next = Number.isFinite(n)
                              ? Math.min(
                                  AUCTION_BIDDER_LEVEL_MAX,
                                  Math.max(AUCTION_BIDDER_LEVEL_MIN, n),
                                )
                              : AUCTION_BIDDER_LEVEL_MAX;
                            field.onChange(next);
                          }}
                        />
                      </FormControl>
                      <p className="text-muted-foreground text-xs">
                        Highest character level that may bid (must be ≥ min).
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={createForm.control}
              name="currencyType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TRADEABLE_CURRENCY_TYPES.map((currency, i) => (
                        <SelectItem key={`${currency}-${i}`} value={currency}>
                          {currency === "MONEY" ? "Money (Ryo)" : "Reputation Points"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={createForm.control}
                name="startingPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starting Price</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        step={1}
                        min={1}
                        placeholder="Whole numbers only (e.g. 100)"
                        value={field.value ?? ""}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            field.onChange(undefined);
                            return;
                          }
                          const n = Number(raw);
                          field.onChange(Number.isFinite(n) ? n : undefined);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={createForm.control}
                name="buyoutPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Buyout Price (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        step={1}
                        min={1}
                        placeholder="Whole numbers only — leave empty for no buyout"
                        value={field.value ?? ""}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            field.onChange(undefined);
                            return;
                          }
                          const n = Number(raw);
                          field.onChange(Number.isFinite(n) ? n : undefined);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={createForm.control}
              name="durationHours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Duration (Hours)</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(parseInt(value, 10))}
                    value={field.value ? field.value.toString() : "24"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="1">1 Hour</SelectItem>
                      <SelectItem value="6">6 Hours</SelectItem>
                      <SelectItem value="12">12 Hours</SelectItem>
                      <SelectItem value="24">24 Hours</SelectItem>
                      <SelectItem value="48">48 Hours</SelectItem>
                      <SelectItem value="72">72 Hours</SelectItem>
                      <SelectItem value="168">1 Week</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchedListingType === "DIRECT" && (
              <div>
                <Label>Target User</Label>
                <UserSearchSelect
                  useFormMethods={userSearchMethods}
                  showYourself={false}
                  label="Search for user to sell to"
                  maxUsers={1}
                  showAi={false}
                />
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <Button type="submit" disabled={isCreating}>
                {isCreating ? <Loader size={20} /> : "Create Listing"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsOpen(false);
                  createForm.reset();
                  setItemSearchTerm("");
                  setDropdownOpen(false);
                  userSearchMethods.reset();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
