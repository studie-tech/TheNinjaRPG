"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api, type RouterOutputs } from "@/app/_trpc/client";
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
import { NumberInput } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUCTION_BIDDER_LEVEL_MAX,
  AUCTION_BIDDER_LEVEL_MIN,
  AUCTION_LISTING_TYPES,
  AUCTION_SALES_TAX_PERCENT,
} from "@/drizzle/constants";
import { useKessenCardMoves } from "@/hooks/kessen/useKessenHubCache";
import ContentImage from "@/layout/ContentImage";
import { rarityLabel, rarityTextClass } from "@/layout/items/ItemCard";
import Loader from "@/layout/Loader";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { isImbuing } from "@/libs/item";
import { getAuctionSellerPayout, hasAuctionPriceBounds } from "@/libs/itemEconomy";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { formatAuctionCurrency } from "@/screens/auctionhouse/format";
import { useUserPicker } from "@/utils/search";
import type { CreateAuctionListingSchema } from "@/validators/auction";
import {
  auctionListingSchemaForItem,
  type createAuctionListingSchema,
} from "@/validators/auction";

/** Create auction or fixed-price listings from eligible inventory and listing terms. */
export const NewAuctionListingDialog: React.FC<{
  defaultListingType?: CreateAuctionListingSchema["listingType"];
  onCreated?: () => void;
  /** A stack to open the dialog on, such as a card sent from the Items page. */
  initialUserItemId?: string | null;
  /** Called once the initial stack has been opened or found unlistable. */
  onInitialHandled?: () => void;
}> = ({
  defaultListingType = "AUCTION",
  onCreated,
  initialUserItemId,
  onInitialHandled,
}) => {
  const { data: userItems, isFetchedAfterMount: isInventoryFresh } =
    api.item.getUserItemsWithVariants.useQuery(undefined, {
      refetchOnMount: "always",
    });
  const { reconcileCardMoves } = useKessenCardMoves();
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
    mode: "onChange",
    resolver: (values, context, options) => {
      const selected = userItems?.find((row) => row.id === values.userItemId);
      return zodResolver(
        auctionListingSchemaForItem(selected?.item, selected?.quantity),
      )(values, context, options);
    },
    defaultValues: {
      listingType: defaultListingType,
      durationHours: 24,
      currencyType: "MONEY",
      bidderMinLevel: AUCTION_BIDDER_LEVEL_MIN,
      bidderMaxLevel: AUCTION_BIDDER_LEVEL_MAX,
    },
  });

  // Search Form for DIRECT auctions
  const maxUsers = 1;
  const { methods: userSearchMethods } = useUserPicker(maxUsers);

  // Item search
  const [itemSearchTerm, setItemSearchTerm] = useState("");

  const resetDialog = () => {
    createForm.reset();
    setItemSearchTerm("");
    setDropdownOpen(false);
    userSearchMethods.reset();
  };

  // Selecting an item refocuses the picker, which must not reopen the dropdown.
  const openDropdown = () => {
    if (ignoreNextPopoverOpenRef.current) {
      ignoreNextPopoverOpenRef.current = false;
      return;
    }
    setDropdownOpen(true);
  };

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
        !item.isInAuction &&
        !isImbuing(item)
      );
    }) || [];

  // Kessen cards list after other goods, Forbidden variants after their base cards.
  const filteredItemsForDropdown = filteredItems
    .filter((userItem) => {
      const name = (userItem.item?.name || "").trim().toLowerCase();
      const search = itemSearchTerm.trim().toLowerCase();
      return name.includes(search);
    })
    .sort((a, b) => listingOrder(a.item) - listingOrder(b.item));

  const { mutate: createListing, isPending: isCreating } =
    api.auction.createAuctionListing.useMutation({
      onMutate: (input) => ({
        itemType: userItems?.find((row) => row.id === input.userItemId)?.item.itemType,
      }),
      onSuccess: async (data, _input, context) => {
        showMutationToast(data);
        if (data.success) {
          setIsOpen(false);
          resetDialog();
          onCreated?.();
          await Promise.all([
            utils.auction.getAuctionListings.invalidate(),
            utils.item.getUserItems.invalidate(),
            utils.item.getUserItemsWithVariants.invalidate(),
            utils.auction.getAuctionListing.invalidate(),
            reconcileCardMoves([context?.itemType]),
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
  const [watchedQuantity, watchedStartingPrice] = useWatch({
    control: createForm.control,
    name: ["quantity", "startingPrice"],
  });
  const listingQuantity =
    watchedQuantity !== undefined && Number.isFinite(watchedQuantity)
      ? watchedQuantity
      : (selectedItem?.quantity ?? 1);
  const hasRyoBounds =
    !!selectedItem &&
    hasAuctionPriceBounds(selectedItem.item, watchedListingType, "MONEY");
  const minimum = hasRyoBounds ? selectedItem?.item.auctionMinPrice : null;
  const maximum = hasRyoBounds ? selectedItem?.item.auctionMaxPrice : null;
  const minimumTotal = Math.max(1, (minimum ?? 0) * listingQuantity);
  const maximumTotal = maximum == null ? undefined : maximum * listingQuantity;
  useEffect(() => {
    // Changing the item or quantity changes both price fields' bounds.
    if (watchedUserItemId && createForm.getValues("startingPrice") !== undefined) {
      void createForm.trigger(["startingPrice", "buyoutPrice"]);
    }
  }, [watchedUserItemId, watchedQuantity, watchedListingType, createForm]);
  const showQuantityInput = selectedItem?.item?.canStack && selectedItem.quantity > 1;
  // Listed cards leave the copies saved decks can use, so name the decks that hold one.
  const isCardSelected = selectedItem?.item.itemType === "CARD";
  const { data: kessenHub } = api.kessen.getHub.useQuery(undefined, {
    enabled: isOpen && isCardSelected,
  });
  const affectedDecks = isCardSelected
    ? (kessenHub?.decks ?? []).filter((deck) =>
        deck.cards.some((card) => card.itemId === selectedItem.itemId),
      )
    : [];
  const unit = isCardSelected ? "card" : "unit";

  // Start each selected stack at its full quantity so the amount sent is explicit.
  useEffect(() => {
    createForm.setValue(
      "quantity",
      selectedItem?.item.canStack && selectedItem.quantity > 1
        ? selectedItem.quantity
        : undefined,
      { shouldValidate: true },
    );
  }, [
    selectedItem?.id,
    selectedItem?.quantity,
    selectedItem?.item.canStack,
    createForm,
  ]);

  // Open on a stack sent from elsewhere once the inventory read on this visit says it
  // can be listed; a cached inventory can predate the stack (a split or a new card).
  const initialListable =
    !!initialUserItemId && filteredItems.some((row) => row.id === initialUserItemId);
  useEffect(() => {
    if (!initialUserItemId || !userItems || !isInventoryFresh) return;
    if (initialListable) {
      setIsOpen(true);
      ignoreNextPopoverOpenRef.current = true;
      setDropdownOpen(false);
      createForm.setValue("userItemId", initialUserItemId, { shouldValidate: true });
    } else {
      showMutationToast({
        success: false,
        message:
          "That stack cannot be listed now: it may be listed already, equipped or no longer carried.",
      });
    }
    onInitialHandled?.();
  }, [
    initialUserItemId,
    initialListable,
    userItems,
    isInventoryFresh,
    createForm,
    onInitialHandled,
  ]);

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
          // Inventory can change while this page stays mounted (e.g. unequipping in
          // another tab), so re-read it whenever the picker is opened.
          void utils.item.getUserItemsWithVariants.invalidate();
          // Show the item search dropdown when opening the dialog,
          // then let `autoFocus` handle focusing the actual CommandInput.
          setItemSearchTerm("");
          setDropdownOpen(true);
        } else {
          resetDialog();
          ignoreNextPopoverOpenRef.current = false;
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon" aria-label="List item" hoverText="List item">
          <Plus aria-hidden="true" className="h-4 w-4" />
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
                          onFocus={openDropdown}
                          onClick={openDropdown}
                          className="mb-2 w-full cursor-text border border-input bg-background text-left font-semibold text-foreground placeholder:font-bold placeholder:text-muted-foreground"
                        />
                      </FormControl>
                    </PopoverTrigger>
                    {selectedItem && (
                      <div className="flex items-center gap-2 rounded-md border bg-card p-1.5">
                        <ListingItemLabel userItem={selectedItem} />
                      </div>
                    )}
                    {affectedDecks.length > 0 && (
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        Listed copies leave your decks:{" "}
                        {affectedDecks.map((deck) => deck.name).join(", ")}{" "}
                        {affectedDecks.length === 1 ? "uses" : "use"} this card.
                      </p>
                    )}

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
                          className="max-h-[300px] w-full overflow-y-auto"
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
                                  <ListingItemLabel userItem={userItem} />
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
                    <FormLabel>Quantity to send</FormLabel>
                    <FormControl>
                      <NumberInput
                        min="1"
                        step={1}
                        max={selectedItem?.quantity || 1}
                        placeholder={`1-${selectedItem?.quantity || 1}`}
                        {...field}
                        onValueChange={field.onChange}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <p className="text-muted-foreground text-sm">
                      Current stack: {selectedItem?.quantity} items.
                      {Number.isInteger(field.value) &&
                        (field.value ?? 0) >= 1 &&
                        (field.value ?? 0) <= (selectedItem?.quantity ?? 0) && (
                          <>
                            {" "}
                            Sending {field.value}; keeping{" "}
                            {(selectedItem?.quantity ?? 0) - (field.value ?? 0)}.
                          </>
                        )}
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
                        <NumberInput
                          inputMode="numeric"
                          step={1}
                          min={AUCTION_BIDDER_LEVEL_MIN}
                          max={AUCTION_BIDDER_LEVEL_MAX}
                          value={field.value}
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          onValueChange={field.onChange}
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
                        <NumberInput
                          inputMode="numeric"
                          step={1}
                          min={AUCTION_BIDDER_LEVEL_MIN}
                          max={AUCTION_BIDDER_LEVEL_MAX}
                          value={field.value}
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          onValueChange={field.onChange}
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

            {selectedItem && hasRyoBounds && (
              <p className="text-muted-foreground text-sm">
                {priceBoundsLine(minimum, maximum, unit)}
                {listingQuantity > 1 &&
                  ` Prices below are totals for ${listingQuantity} ${unit}s.`}
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              A {AUCTION_SALES_TAX_PERCENT}% sales tax is deducted from your proceeds
              when an auction or direct sale completes. Your payout is rounded down to a
              whole number. Unsold listings are not taxed.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={createForm.control}
                name="startingPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starting Price</FormLabel>
                    <FormControl>
                      <NumberInput
                        inputMode="numeric"
                        step={1}
                        min={minimumTotal}
                        max={maximumTotal}
                        placeholder={`Whole number, e.g. ${minimumTotal.toLocaleString()}`}
                        value={field.value ?? ""}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        onValueChange={field.onChange}
                      />
                    </FormControl>
                    {field.value != null &&
                      Number.isFinite(field.value) &&
                      field.value > 0 && (
                        <p className="text-muted-foreground text-xs">
                          Estimated proceeds at starting price:{" "}
                          {formatAuctionCurrency(
                            getAuctionSellerPayout(field.value),
                            "MONEY",
                          )}
                        </p>
                      )}
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
                      <NumberInput
                        optional
                        inputMode="numeric"
                        step={1}
                        min={Math.max(minimumTotal, (watchedStartingPrice ?? 0) + 1)}
                        max={maximumTotal}
                        placeholder="Leave empty for no buyout"
                        value={field.value ?? ""}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        onOptionalValueChange={field.onChange}
                      />
                    </FormControl>
                    {field.value != null &&
                      Number.isFinite(field.value) &&
                      field.value > 0 && (
                        <p className="text-muted-foreground text-xs">
                          Estimated proceeds at buyout:{" "}
                          {formatAuctionCurrency(
                            getAuctionSellerPayout(field.value),
                            "MONEY",
                          )}
                        </p>
                      )}
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
                  resetDialog();
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

/** An inventory stack in the listing picker: art, name, rarity, kind and stack size. */
function ListingItemLabel({ userItem }: { userItem: ListingPickerItem }) {
  const { item } = userItem;
  const isCard = item.itemType === "CARD";
  const isForbidden = isCard && item.cardData?.variant === "FORBIDDEN";
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="relative h-8 w-8 shrink-0">
        <ContentImage
          image={item.image}
          alt=""
          rarity={item.rarity}
          className="h-8 w-8"
        />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-semibold">{item.name}</span>
        <span className={cn("block text-xs", rarityTextClass[item.rarity])}>
          {rarityLabel[item.rarity]}
          {isCard ? (isForbidden ? " Forbidden card" : " Kessen card") : ""}
          {userItem.quantity > 1 ? ` · ×${userItem.quantity}` : ""}
          {userItem.imbuements.length > 0
            ? ` · ${userItem.imbuements.length} imbuement${userItem.imbuements.length === 1 ? "" : "s"}`
            : ""}
        </span>
      </span>
    </span>
  );
}

/** "Minimum 20,000 ryo per card.", with the maximum when the item has one. */
const priceBoundsLine = (
  minimum: number | null | undefined,
  maximum: number | null | undefined,
  unit: string,
) => {
  if (minimum != null && maximum != null) {
    return `Allowed: ${minimum.toLocaleString()} – ${maximum.toLocaleString()} ryo per ${unit}. Bids may exceed the maximum.`;
  }
  if (minimum != null) return `Minimum ${minimum.toLocaleString()} ryo per ${unit}.`;
  if (maximum != null) {
    return `Maximum ${maximum.toLocaleString()} ryo per ${unit}. Bids may exceed it.`;
  }
  return "No price bounds for this item.";
};

/** Other goods first, then Kessen cards, then their Forbidden variants. */
const listingOrder = (item: ListingPickerItem["item"]) =>
  item.itemType !== "CARD" ? 0 : item.cardData?.variant === "FORBIDDEN" ? 2 : 1;

type ListingPickerItem = NonNullable<
  RouterOutputs["item"]["getUserItemsWithVariants"]
>[number];
