"use client";

import { AlertCircle, Gavel, Hammer, Info, Loader2, Timer } from "lucide-react";
import { useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import {
  AUCTION_HOUSE_MIN_LEVEL,
  auctionHouseLevelMessage,
  IMG_AVATAR_DEFAULT,
} from "@/drizzle/constants";
import { useAvatarRenditionWidth } from "@/layout/Avatar";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import Table from "@/layout/Table";
import { finishedImbuementItems } from "@/libs/item";
import { showMutationToast } from "@/libs/toast";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  auctionCurrencyUnit,
  formatAuctionCurrency,
  formatAuctionPerUnitLine,
} from "./format";

/**
 * @param auctionId - Auction ID
 * @param isOpen - Whether the dialog is open
 * @param setIsOpen - Function to set the dialog open state
 * @returns Auction details dialog
 */
export const AuctionDetailsDialog: React.FC<AuctionDetailsDialogProps> = ({
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
  const placeBidInFlightRef = useRef(false);
  const avatarWidth = useAvatarRenditionWidth(24);

  // Utils
  const utils = api.useUtils();

  // Query single auction listing
  const { data: listing, isLoading } = api.auction.getAuctionListing.useQuery(
    { auctionId },
    { enabled: isOpen && !!auctionId },
  );

  // Mutations
  const {
    mutate: placeBid,
    isPending: isPlacingBid,
    variables: placeBidVariables,
  } = api.auction.placeBid.useMutation({
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
    onSettled: () => {
      placeBidInFlightRef.current = false;
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
      <Modal title="Auction Details" isOpen={isOpen} setIsOpen={setIsOpen}>
        <Loader />
      </Modal>
    );
  }
  if (!listing.userItem?.item) {
    return (
      <Modal title="Auction Details" isOpen={isOpen} setIsOpen={setIsOpen}>
        <div className="p-4 text-center">
          <p className="text-red-600">This auction is no longer available.</p>
          <p className="mt-2 text-muted-foreground text-sm">
            The item associated with this auction could not be found.
          </p>
        </div>
      </Modal>
    );
  }
  if (!userData) return null;

  // Derived
  const userBid = listing.bids.find((bid) => bid.bidderId === userData.userId);
  const spendBalanceForListing =
    listing.currencyType === "MONEY" ? userData.bank : userData.reputationPoints;
  const availableFunds = userBid
    ? spendBalanceForListing + userBid.amount
    : spendBalanceForListing;
  const spendCurrencyLabel = listing.currencyType === "MONEY" ? "bank" : "reputation";
  const spendCurrencyUnit = auctionCurrencyUnit(listing.currencyType);
  const isExpired = new Date(listing.expiresAt) < new Date();
  const isOwner = listing.sellerId === userData.userId;
  const isActive = listing.status === "ACTIVE";
  const stackQuantity = listing.userItem.quantity;
  const showPerUnitPricing = listing.userItem.item.canStack && stackQuantity > 1;

  const { bidderMinLevel, bidderMaxLevel } = listing;
  const meetsAuctionHouseMinLevel = userData.level >= AUCTION_HOUSE_MIN_LEVEL;
  const canBidByLevel =
    listing.listingType !== "AUCTION" ||
    (userData.level >= bidderMinLevel && userData.level <= bidderMaxLevel);
  const canBid = meetsAuctionHouseMinLevel && canBidByLevel;
  const canSellerCancel = isOwner && isActive && listing.bids.length === 0;
  const viewerCanAct =
    isActive &&
    !isExpired &&
    !isOwner &&
    (!listing.targetUserId || listing.targetUserId === userData.userId);

  const minIntegerBid = Math.floor(listing.currentPrice) + 1;
  const parsedBidAmount = bidAmount.trim() === "" ? Number.NaN : Number(bidAmount);
  const isBidInputValid =
    Number.isInteger(parsedBidAmount) &&
    parsedBidAmount > listing.currentPrice &&
    parsedBidAmount <= availableFunds;
  const isSubmittingThisAuction =
    isPlacingBid && placeBidVariables?.auctionId === auctionId;
  const submittedBidAmount = isSubmittingThisAuction
    ? placeBidVariables.amount
    : pendingBidAmount;

  // Handlers
  const handlePlaceBid = (auctionId: string, amount: number) => {
    if (placeBidInFlightRef.current || isPlacingBid) return;
    placeBidInFlightRef.current = true;
    placeBid({ auctionId, amount });
  };

  const handleBid = () => {
    if (bidAmount && isBidInputValid) {
      setPendingBidAmount(parsedBidAmount);
      setShowBidConfirmation(true);
    }
  };

  const handleBuyoutClick = () => {
    if (listing.buyoutPrice) {
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
    if (pendingBidAmount !== null && listing.buyoutPrice) {
      handlePlaceBid(auctionId, listing.buyoutPrice);
    }
  };

  return (
    <Modal
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
              imbuements: finishedImbuementItems(listing.userItem),
              curDurability: listing.userItem.durability,
            }}
            showStatistic="item"
          />
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="space-y-0.5 p-3 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <CardTitle className="flex items-center gap-1.5 font-semibold text-xs">
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
                  <span className="shrink-0 text-[10px] text-muted-foreground uppercase tracking-wide">
                    Seller
                  </span>
                  <Image
                    src={listing.seller?.avatar ?? IMG_AVATAR_DEFAULT}
                    alt=""
                    width={avatarWidth}
                    height={avatarWidth}
                    className="size-6 shrink-0 rounded-full border object-cover"
                    unoptimized
                  />
                  <span className="truncate font-medium text-xs">
                    {listing.seller?.username ?? "Deleted User"}
                  </span>
                </div>
                {listing.listingType === "DIRECT" && listing.targetUser ? (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-[10px] text-muted-foreground uppercase tracking-wide">
                      Buyer
                    </span>
                    <Image
                      src={listing.targetUser.avatar ?? IMG_AVATAR_DEFAULT}
                      alt=""
                      width={avatarWidth}
                      height={avatarWidth}
                      className="size-6 shrink-0 rounded-full border object-cover"
                      unoptimized
                    />
                    <span className="truncate font-medium text-xs">
                      {listing.targetUser.username}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 border-emerald-500/20 border-t pt-1.5 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Current
                </p>
                <p className="font-bold text-base text-emerald-800 tabular-nums leading-tight sm:text-right dark:text-emerald-300">
                  {formatAuctionCurrency(listing.currentPrice, listing.currencyType)}
                </p>
                {showPerUnitPricing ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground leading-tight sm:text-right">
                    {formatAuctionPerUnitLine(
                      listing.currentPrice,
                      stackQuantity,
                      listing.currencyType,
                    )}
                  </p>
                ) : null}
                {listing.buyoutPrice != null ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-right">
                    Buyout{" "}
                    {formatAuctionCurrency(listing.buyoutPrice, listing.currencyType)}
                  </p>
                ) : null}
                {listing.buyoutPrice != null && showPerUnitPricing ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground leading-tight sm:text-right">
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

        {viewerCanAct && canBid && (
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
                <NumberInput
                  inputMode="numeric"
                  placeholder="Bid amount (whole numbers)"
                  value={bidAmount}
                  onTextChange={setBidAmount}
                  min={minIntegerBid}
                  step={1}
                  className="h-9 flex-1"
                  disabled={isSubmittingThisAuction}
                  aria-busy={isSubmittingThisAuction}
                />
                <Button
                  onClick={handleBid}
                  disabled={!isBidInputValid || isSubmittingThisAuction}
                  aria-busy={isSubmittingThisAuction}
                  className="h-9 shrink-0"
                  size="sm"
                >
                  {isSubmittingThisAuction ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Hammer className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {isSubmittingThisAuction
                    ? "Submitting"
                    : userBid
                      ? "Raise to"
                      : "Place bid"}
                </Button>
              </div>
              {listing.buyoutPrice && availableFunds >= listing.buyoutPrice && (
                <Button
                  onClick={handleBuyoutClick}
                  disabled={isSubmittingThisAuction}
                  aria-busy={isSubmittingThisAuction}
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
              <p className="text-center text-[10px] text-muted-foreground">
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

        {viewerCanAct && !meetsAuctionHouseMinLevel && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50/90 p-2.5 dark:border-amber-900 dark:bg-amber-950/40">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800 dark:text-amber-200" />
            <p className="text-amber-950 text-xs leading-snug dark:text-amber-100">
              {auctionHouseLevelMessage}
            </p>
          </div>
        )}

        {viewerCanAct &&
          listing.listingType === "AUCTION" &&
          meetsAuctionHouseMinLevel &&
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
      <ConfirmPurchaseDialog
        open={showBidConfirmation}
        onOpenChange={setShowBidConfirmation}
        title="Confirm Bid"
        confirmLabel="Confirm Bid"
        pendingLabel="Submitting"
        isPending={isSubmittingThisAuction}
        onConfirm={confirmBid}
      >
        Are you sure you want to place a bid of{" "}
        <span className="font-semibold">
          {submittedBidAmount?.toLocaleString()}{" "}
          {auctionCurrencyUnit(listing.currencyType)}
        </span>{" "}
        on this auction?
        {showPerUnitPricing &&
        submittedBidAmount != null &&
        listing.currencyType != null ? (
          <span className="mt-2 block text-muted-foreground text-sm">
            {formatAuctionPerUnitLine(
              submittedBidAmount,
              stackQuantity,
              listing.currencyType,
            )}
          </span>
        ) : null}
        {userBid && (
          <span className="mt-2 block text-sm">
            Your current bid of {userBid.amount.toLocaleString()} will be replaced.
          </span>
        )}
      </ConfirmPurchaseDialog>

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
              {isCancellingAuction ? "Cancelling" : "Cancel listing"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Buyout Confirmation Dialog */}
      <ConfirmPurchaseDialog
        open={showBuyoutConfirmation}
        onOpenChange={setShowBuyoutConfirmation}
        title="Confirm Buyout"
        confirmLabel="Confirm Buyout"
        pendingLabel="Purchasing"
        isPending={isSubmittingThisAuction}
        onConfirm={confirmBuyout}
      >
        Are you sure you want to buyout this auction for{" "}
        <span className="font-semibold">
          {listing.buyoutPrice?.toLocaleString()}{" "}
          {auctionCurrencyUnit(listing.currencyType)}
        </span>
        ? This will immediately complete the auction and transfer the item to you.
        {showPerUnitPricing &&
        listing.buyoutPrice != null &&
        listing.currencyType != null ? (
          <span className="mt-2 block text-muted-foreground text-sm">
            {formatAuctionPerUnitLine(
              listing.buyoutPrice,
              stackQuantity,
              listing.currencyType,
            )}
          </span>
        ) : null}
      </ConfirmPurchaseDialog>
    </Modal>
  );
};

/** Confirm spending on a listing; the dialog stays open while the purchase is in flight. */
const ConfirmPurchaseDialog: React.FC<ConfirmPurchaseDialogProps> = ({
  open,
  onOpenChange,
  title,
  confirmLabel,
  pendingLabel,
  isPending,
  onConfirm,
  children,
}) => (
  <AlertDialog
    open={open}
    onOpenChange={(next) => {
      if (!isPending) onOpenChange(next);
    }}
  >
    <AlertDialogContent aria-busy={isPending}>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>
          {children}
          {isPending ? (
            <span
              className="mt-3 flex items-center gap-2 font-medium text-foreground"
              role="status"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {pendingLabel}
            </span>
          ) : null}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          disabled={isPending}
          aria-busy={isPending}
          onClick={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {pendingLabel}
            </>
          ) : (
            confirmLabel
          )}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

interface AuctionDetailsDialogProps {
  auctionId: string;
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

interface ConfirmPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  pendingLabel: string;
  isPending: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
}
