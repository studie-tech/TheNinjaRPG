"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Hammer, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
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
import { Button } from "@/components/ui/button";
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
import {
  AUCTION_LISTING_STATES,
  AUCTION_LISTING_TYPES,
  IMG_AVATAR_DEFAULT,
  TRADEABLE_CURRENCY_TYPES,
} from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import type { ColumnDefinitionType } from "@/layout/Table";
import Table from "@/layout/Table";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useInfinitePagination } from "@/libs/pagination";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData, useRequireInVillage } from "@/utils/UserContext";
import type { CreateAuctionListingSchema } from "@/validators/auction";
import { createAuctionListingSchema } from "@/validators/auction";
import { getSearchValidator } from "@/validators/register";
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
      subtitle="Trade items with other players"
      defaultBackHref="/village"
      padding={false}
      topRightContent={
        <div className="flex items-center gap-2">
          <div>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-32">
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
          </div>
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

const AuctionListing: React.FC<AuctionListingProps> = ({ selectedStatus }) => {
  const [searchTerm, setSearchTerm] = useState("");
  // User data
  const { timeDiff } = useRequiredUserData();

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
      itemName: searchTerm || undefined,
      minPrice:
        minPrice && Number.isFinite(parsedMinPrice)
          ? Math.max(0, parsedMinPrice)
          : undefined,
      maxPrice:
        maxPrice && Number.isFinite(parsedMaxPrice)
          ? Math.max(0, parsedMaxPrice)
          : undefined,
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

  // Transform data to include JSX directly in the objects
  const transformedData =
    allListings.map((listing) => ({
      ...listing,
      itemIcon: listing.userItem.item.image,
      itemName: (
        <div>
          <p>{listing.userItem.item.name}</p>
          {listing.userItem.item.canStack && listing.userItem.quantity > 1 && (
            <p className="text-muted-foreground text-sm">
              Quantity: {listing.userItem.quantity}
            </p>
          )}
        </div>
      ),
      currentPrice: (
        <div>
          <p className="font-bold text-green-600">
            {listing.currentPrice.toLocaleString()}{" "}
            {listing.currencyType === "MONEY" ? "ryo" : "reputation"}
          </p>
          {listing.buyoutPrice && (
            <p className="text-muted-foreground text-sm">
              Buyout: {listing.buyoutPrice.toLocaleString()}{" "}
              {listing.currencyType === "MONEY" ? "ryo" : "reputation"}
            </p>
          )}
        </div>
      ),
      seller: listing.seller?.avatar ?? IMG_AVATAR_DEFAULT,
      listingType:
        listing.listingType === "AUCTION" ? (
          <span className="rounded-md bg-blue-100 px-2 py-1 font-medium text-blue-800 text-xs">
            Auction
          </span>
        ) : (
          <span className="rounded-md bg-amber-100 px-2 py-1 font-medium text-amber-800 text-xs">
            Direct
          </span>
        ),
      timeLeft: (
        <div className="flex items-center gap-1">
          <Countdown targetDate={listing.expiresAt} timeDiff={timeDiff} />
        </div>
      ),
    })) || [];

  type Listing = ArrayElement<typeof transformedData>;
  const columns: ColumnDefinitionType<Listing, keyof Listing>[] = [
    {
      key: "itemIcon",
      header: "Item",
      type: "avatar",
    },
    {
      key: "itemName",
      header: "Name",
      type: "jsx",
    },
    {
      key: "seller",
      header: "Seller",
      type: "avatar",
    },
    {
      key: "listingType",
      header: "Type",
      type: "jsx",
    },
    {
      key: "currentPrice",
      header: "Current Price",
      type: "jsx",
    },
    {
      key: "timeLeft",
      header: "Time Left",
      type: "jsx",
    },
  ];

  return (
    <div className="space-y-2">
      {/* Search and Filters */}
      <div className="flex flex-row items-end gap-2 p-3">
        <div className="min-w-[100px] flex-1">
          <Label htmlFor="search">Search Items</Label>
          <div className="relative">
            <Search className="absolute top-3 left-3 h-4 w-4 text-muted-foreground" />
            <Input
              id="search"
              placeholder="Search listings..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 mb-2 w-full border border-gray-400 bg-white font-semibold text-black placeholder:font-bold placeholder:text-gray-600"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <div>
            <Label htmlFor="minPrice">Min Price</Label>
            <Input
              id="minPrice"
              type="number"
              min={0}
              placeholder="0"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="w-24"
            />
          </div>
          <div>
            <Label htmlFor="maxPrice">Max Price</Label>
            <Input
              id="maxPrice"
              type="number"
              min={0}
              placeholder="∞"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-24"
            />
          </div>
        </div>
      </div>

      {/* Auction Listings Table */}
      <div>
        {isLoading && transformedData.length === 0 ? (
          <Loader />
        ) : (
          <>
            <Table
              data={transformedData}
              columns={columns}
              onRowClick={(row) => {
                setSelectedAuction(row.id);
                setShowDialog(true);
              }}
            />
            {/* Infinite scroll trigger */}
            <div ref={setLastElement} className="h-4" />
            {isLoading && transformedData.length > 0 && (
              <div className="flex justify-center p-4">
                <Loader explanation="Loading more auctions..." />
              </div>
            )}
          </>
        )}
      </div>

      {/* Auction Details Dialog */}
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
  const { data: userData, updateUser } = useRequiredUserData();

  // State
  const [bidAmount, setBidAmount] = useState("");
  const [showBidConfirmation, setShowBidConfirmation] = useState(false);
  const [showBuyoutConfirmation, setShowBuyoutConfirmation] = useState(false);
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
        if ("amountToDeduct" in data && data.amountToDeduct && userData) {
          await updateUser({
            bank: userData.bank - data.amountToDeduct,
          });
        }
        // Clear state after successful bid
        setBidAmount("");
        setPendingBidAmount(null);
        setShowBidConfirmation(false);
        setShowBuyoutConfirmation(false);
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
  const availableFunds = userBid ? userData.bank + userBid.amount : userData.bank;
  const isExpired = new Date(listing.expiresAt) < new Date();
  const isOwner = listing.sellerId === userData.userId;
  const isActive = listing.status === "ACTIVE";

  // Handlers
  const handlePlaceBid = (auctionId: string, amount: number) => {
    placeBid({ auctionId, amount });
  };

  const handleBid = () => {
    if (bidAmount && listing) {
      const amount = parseFloat(bidAmount);
      if (amount > availableFunds) {
        // This should be caught by the disabled state, but just in case
        return;
      }
      setPendingBidAmount(amount);
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
    >
      <div className="space-y-3">
        {/* Item Details */}
        <ItemWithEffects
          item={{
            ...listing.userItem.item,
            imbuements: listing.userItem.imbuements.map((imbuement) => imbuement.item),
            curDurability: listing.userItem.durability,
          }}
          showStatistic="item"
        />
        {listing.userItem.item.canStack && listing.userItem.quantity > 1 && (
          <div className="rounded-lg border bg-popover p-2">
            <p className="font-semibold text-sm">
              Quantity: <span className="font-normal">{listing.userItem.quantity}</span>
            </p>
          </div>
        )}

        {/* Auction Info */}
        <div className="rounded-lg border bg-popover p-2">
          <div
            className={cn(
              "grid items-center gap-4",
              listing.listingType === "DIRECT" ? "grid-cols-3" : "grid-cols-2",
            )}
          >
            <div>
              <h4 className="mb-2 text-center font-semibold">Seller</h4>
            </div>
            {listing.listingType === "DIRECT" && (
              <div>
                <h4 className="mb-2 text-center font-semibold">Sale for</h4>
              </div>
            )}
            <div>
              <h4 className="mb-2 text-center font-semibold">Current</h4>
            </div>
          </div>
          <div
            className={cn(
              "grid items-center gap-4",
              listing.listingType === "DIRECT" ? "grid-cols-3" : "grid-cols-2",
            )}
          >
            <div className="flex flex-col items-center">
              <div className="flex w-20 flex-col items-center gap-2">
                <AvatarImage
                  href={listing.seller?.avatar ?? IMG_AVATAR_DEFAULT}
                  alt={listing.seller?.username ?? "Deleted User"}
                  size={40}
                />
                <span>{listing.seller?.username ?? "Deleted User"}</span>
              </div>
            </div>
            {listing.listingType === "DIRECT" && listing.targetUser && (
              <div className="flex flex-col items-center">
                <div className="flex w-20 flex-col items-center gap-2">
                  <AvatarImage
                    href={listing.targetUser.avatar}
                    alt={listing.targetUser.username}
                    size={40}
                  />
                  <span>{listing.targetUser.username}</span>
                </div>
              </div>
            )}
            <div className="flex flex-col items-center">
              <p className="font-bold text-2xl text-green-600">
                {listing.currentPrice.toLocaleString()}{" "}
                {listing.currencyType === "MONEY" ? "ryo" : "reputation"}
              </p>
              {listing.buyoutPrice && (
                <p className="text-muted-foreground text-sm">
                  Buyout: {listing.buyoutPrice.toLocaleString()}{" "}
                  {listing.currencyType === "MONEY" ? "ryo" : "reputation"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bids */}
        <div className="rounded-lg border bg-popover">
          <h4 className="p-2 font-semibold">Bid History ({listing.bids.length})</h4>
          {listing.bids.length === 0 ? (
            <p className="p-2 text-muted-foreground">No bids yet</p>
          ) : (
            <Table
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
          )}
        </div>

        {/* Actions */}
        {isActive &&
          !isExpired &&
          !isOwner &&
          (!listing.targetUserId || listing.targetUserId === userData.userId) && (
            <div className="space-y-4">
              {/* Show current bid info */}
              <div className="rounded-lg p-3">
                <div className="flex justify-between text-sm">
                  <span>Your available bank funds:</span>
                  <span className="font-semibold">
                    {availableFunds.toLocaleString()} ryo
                  </span>
                </div>
                {userBid && (
                  <div className="flex justify-between text-blue-600 text-sm">
                    <span>Your current bid:</span>
                    <span className="font-semibold">
                      {userBid.amount.toLocaleString()} ryo
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Enter bid amount"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  min={listing.currentPrice + 0.01}
                  step="0.01"
                />
                <Button
                  onClick={handleBid}
                  disabled={
                    !bidAmount ||
                    parseFloat(bidAmount) <= listing.currentPrice ||
                    parseFloat(bidAmount) > availableFunds
                  }
                >
                  <Hammer className="mr-1 h-4 w-4" />
                  {userBid ? "Raise Bid To" : "Place Bid"}
                </Button>
              </div>
              {listing.buyoutPrice && availableFunds >= listing.buyoutPrice && (
                <Button
                  onClick={handleBuyoutClick}
                  variant="default"
                  className="w-full"
                >
                  Buy Now for {listing.buyoutPrice.toLocaleString()}
                </Button>
              )}
            </div>
          )}

        {isOwner && (
          <div className="rounded-lg bg-blue-50 p-4">
            <p className="text-blue-800">This is your auction listing</p>
          </div>
        )}

        {isExpired && (
          <div className="rounded-lg bg-red-50 p-4">
            <p className="text-red-800">This auction has expired</p>
          </div>
        )}

        {/* Message when user cannot bid on direct auction */}
        {isActive &&
          !isExpired &&
          !isOwner &&
          listing.targetUserId &&
          listing.targetUserId !== userData.userId && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-red-800 text-sm">
                This is a direct auction restricted to {listing.targetUser?.username}.
                You are not allowed to bid.
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
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Auction Listing</DialogTitle>
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
                        <div
                          className="max-h-[300px] overflow-y-auto w-full"
                          onWheel={(e) => {
                            // Allow wheel events to reach scrollable CommandList
                            e.currentTarget.scrollTop += e.deltaY;
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <CommandList className="w-full">
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
                                    {userItem.imbuements &&
                                    userItem.imbuements.length > 0
                                      ? ` (${userItem.imbuements.length} imbuement(s))`
                                      : ""}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            )}
                          </CommandList>
                        </div>
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
                        step="0.01"
                        min="0.01"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value))}
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
                        step="0.01"
                        min="0.01"
                        placeholder="Leave empty for no buyout"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value ? parseFloat(e.target.value) : undefined,
                          )
                        }
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
