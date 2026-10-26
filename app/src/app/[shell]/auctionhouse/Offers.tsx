"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  AUCTION_HOUSE_MIN_LEVEL,
  AUCTION_OFFER_MAX_RYO,
  type AuctionListingState,
  MAX_ITEM_STACK_SIZE,
} from "@/drizzle/constants";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import { isEquippableUserItem, isImbuing } from "@/libs/item";
import { showMutationToast } from "@/libs/toast";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";
import { createAuctionOfferSchema } from "@/validators/auction";

export function AuctionOffers({
  offerType,
  status,
}: {
  offerType: OfferType;
  status: AuctionListingState;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [onlyMine, setOnlyMine] = useState(false);
  const query = api.auction.getAuctionOffers.useInfiniteQuery(
    { offerType, status, search: debouncedSearch, onlyMine, limit: 10 },
    {
      getNextPageParam: (page) => page.nextCursor,
      refetchInterval: 10000,
      placeholderData: (previousData) => previousData,
    },
  );
  const inventory = api.item.getUserItems.useQuery(undefined, {
    refetchOnMount: "always",
  });
  const offers = query.data?.pages.flatMap((page) => page.data) ?? [];
  const isUpdatingFilters = search !== debouncedSearch || query.isPlaceholderData;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 border-b py-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="offer-search">Search requested items</Label>
          <div className="relative mt-1">
            <Search
              aria-hidden="true"
              className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="offer-search"
              placeholder="Search by item name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        <Button
          variant={onlyMine ? "default" : "outline"}
          onClick={() => setOnlyMine(!onlyMine)}
          aria-pressed={onlyMine}
        >
          {offerType === "REQUEST" ? "My requests" : "My trades"}
        </Button>
      </div>
      <div className="space-y-4 pt-3" aria-busy={query.isLoading || isUpdatingFilters}>
        {isUpdatingFilters && offers.length > 0 && (
          <p role="status" className="text-muted-foreground text-sm">
            Updating offers…
          </p>
        )}
        {query.isLoading || (isUpdatingFilters && offers.length === 0) ? (
          <Loader
            explanation={query.isLoading ? "Loading offers" : "Updating offers…"}
          />
        ) : query.isError ? (
          <p role="alert">
            Could not load offers.{" "}
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </p>
        ) : offers.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            No {status === "SOLD" ? "completed" : status.toLowerCase()}{" "}
            {offerType === "REQUEST" ? "requests" : "trades"} found.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                inventory={inventory.data ?? []}
                inventoryLoading={inventory.isPending}
                inventoryError={inventory.isError}
                retryInventory={() => void inventory.refetch()}
              />
            ))}
          </div>
        )}
        {query.hasNextPage && (
          <Button
            variant="outline"
            disabled={query.isFetching || isUpdatingFilters}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}

export function NewOfferDialog({
  offerType,
  onCreated,
}: {
  offerType: OfferType;
  onCreated: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");
  const catalog = api.auction.getAuctionOfferItems.useQuery(undefined, {
    enabled: isOpen,
  });
  const inventory = api.item.getUserItems.useQuery(undefined, { enabled: isOpen });
  const utils = api.useUtils();
  const form = useForm<z.infer<typeof createAuctionOfferSchema>>({
    resolver: zodResolver(createAuctionOfferSchema),
    defaultValues:
      offerType === "REQUEST"
        ? { offerType, requestedItemId: "", requestedQuantity: 1, ryo: 1 }
        : {
            offerType,
            requestedItemId: "",
            requestedQuantity: 1,
            offeredUserItemId: "",
            offeredQuantity: 1,
          },
  });
  const requestedId = useWatch({ control: form.control, name: "requestedItemId" });
  const offeredId = useWatch({ control: form.control, name: "offeredUserItemId" });
  const create = api.auction.createAuctionOffer.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        setIsOpen(false);
        setError("");
        form.reset();
        onCreated();
        await Promise.all([
          utils.auction.getAuctionOffers.invalidate(),
          utils.item.getUserItems.invalidate(),
          utils.profile.getUser.invalidate(),
        ]);
      } else setError(result.message);
    },
    onError: (error) => setError(error.message),
  });
  const requested = catalog.data?.find((row) => row.id === requestedId);
  const offered = inventory.data?.find((row) => row.id === offeredId);
  const requestedOptions =
    catalog.data
      ?.filter((row) => offerType === "TRADE" || row.itemType === "MATERIAL")
      .map((row) => ({ value: row.id, label: row.name })) ?? [];
  const offeredOptions =
    inventory.data
      ?.filter(isOfferInventoryAvailable)
      .map((row) => ({ value: row.id, label: inventoryLabel(row) })) ?? [];
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // Re-read the inventory on open; it may have changed since it was last cached.
        if (open) void utils.item.getUserItems.invalidate();
        setIsOpen(open);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="icon"
          aria-label={offerType === "REQUEST" ? "New request" : "New trade"}
          hoverText={offerType === "REQUEST" ? "New request" : "New trade"}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {offerType === "REQUEST" ? "Request materials" : "Offer an item trade"}
          </DialogTitle>
          <DialogDescription>
            {offerType === "REQUEST"
              ? "The total ryo payment is reserved from your bank."
              : "The offered quantity is reserved from your inventory."}{" "}
            Offers remain open until accepted or cancelled. Acceptance exchanges the
            entire quantity from one available inventory stack.
            {offerType === "TRADE" &&
              " Requested equipment can be supplied at any level or durability."}
          </DialogDescription>
        </DialogHeader>
        {catalog.isPending || inventory.isPending ? (
          <Loader explanation="Loading items" />
        ) : catalog.isError || inventory.isError ? (
          <p role="alert">
            Could not load items.{" "}
            <Button
              onClick={() => {
                void catalog.refetch();
                void inventory.refetch();
              }}
            >
              Retry
            </Button>
          </p>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => {
                setError("");
                create.mutate(values);
              })}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="requestedItemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Wanted item</FormLabel>
                    <FormControl>
                      <OfferItemPicker
                        label="Choose wanted item"
                        value={field.value}
                        onChange={field.onChange}
                        options={requestedOptions}
                      />
                    </FormControl>
                    <FormMessage aria-live="polite" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="requestedQuantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Wanted quantity</FormLabel>
                    <FormControl>
                      <NumberInput
                        {...field}
                        onValueChange={field.onChange}
                        min={1}
                        max={requested?.canStack === false ? 1 : MAX_ITEM_STACK_SIZE}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {offerType === "REQUEST" ? (
                <FormField
                  control={form.control}
                  name="ryo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total payment (ryo)</FormLabel>
                      <FormControl>
                        <NumberInput
                          {...field}
                          onValueChange={field.onChange}
                          min={1}
                          max={AUCTION_OFFER_MAX_RYO}
                        />
                      </FormControl>
                      <FormMessage />
                      {requested &&
                        (requested.auctionMinPrice != null ||
                          requested.auctionMaxPrice != null) && (
                          <p className="text-muted-foreground text-xs">
                            Price per unit: {requested.auctionMinPrice ?? 0}–
                            {requested.auctionMaxPrice ?? "unlimited"} ryo.
                          </p>
                        )}
                    </FormItem>
                  )}
                />
              ) : (
                <>
                  <FormField
                    control={form.control}
                    name="offeredUserItemId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Offered item</FormLabel>
                        <FormControl>
                          <OfferItemPicker
                            label="Choose offered item"
                            value={field.value}
                            onChange={field.onChange}
                            options={offeredOptions}
                          />
                        </FormControl>
                        <FormMessage aria-live="polite" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="offeredQuantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Offered quantity</FormLabel>
                        <FormControl>
                          <NumberInput
                            {...field}
                            onValueChange={field.onChange}
                            min={1}
                            max={
                              offered?.item.canStack === false
                                ? 1
                                : Math.min(
                                    offered?.quantity ?? MAX_ITEM_STACK_SIZE,
                                    MAX_ITEM_STACK_SIZE,
                                  )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={create.isPending}>
                {create.isPending
                  ? "Posting…"
                  : offerType === "REQUEST"
                    ? "Post request"
                    : "Post trade"}
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OfferCard({
  offer,
  inventory,
  inventoryLoading,
  inventoryError,
  retryInventory,
}: {
  offer: Offer;
  inventory: InventoryItem[];
  inventoryLoading: boolean;
  inventoryError: boolean;
  retryInventory: () => void;
}) {
  const { data: user } = useRequiredUserData();
  const utils = api.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const [suppliedId, setSuppliedId] = useState("");
  const [error, setError] = useState("");
  const refresh = async () => {
    await Promise.all([
      utils.auction.getAuctionOffers.invalidate(),
      utils.item.getUserItems.invalidate(),
      utils.profile.getUser.invalidate(),
    ]);
  };
  const accept = api.auction.acceptAuctionOffer.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        setIsOpen(false);
        setError("");
        await refresh();
      } else setError(result.message);
    },
    onError: (error) => setError(error.message),
  });
  const cancel = api.auction.cancelAuctionOffer.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        setError("");
        await refresh();
      } else setError(result.message);
    },
    onError: (error) => setError(error.message),
  });
  const available = inventory.filter(
    (row) =>
      isOfferInventoryAvailable(row) &&
      row.itemId === offer.requestedItemId &&
      row.quantity >= offer.requestedQuantity &&
      (row.quantity === offer.requestedQuantity || row.imbuements.length === 0),
  );
  const selected = available.find((row) => row.id === suppliedId);
  const isOwner = offer.ownerId === user?.userId;
  const offered = offer.offeredUserItem;
  const offeredItem = offered && {
    ...offered.item,
    level: offered.level,
    experience: offered.experience,
    curDurability: offered.durability,
    imbuements: offered.imbuements.map((entry) => entry.item),
  };
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            Wanted: {offer.requestedQuantity.toLocaleString()} ×{" "}
            {offer.requestedItem?.name ?? "Unavailable item"}
          </CardTitle>
          <Badge variant="outline">
            {offer.status === "SOLD"
              ? "Completed"
              : capitalizeFirstLetter(offer.status)}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Posted by {offer.owner?.username ?? "Unknown player"}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {offer.requestedItem && (
          <div className="flex items-center gap-3">
            <Image
              src={offer.requestedItem.image}
              alt={offer.requestedItem.name}
              width={48}
              height={48}
              className="rounded-lg"
            />
            <p className="font-semibold">
              Payment:{" "}
              {offer.offerType === "REQUEST"
                ? `${offer.ryo.toLocaleString()} ryo (total)`
                : `${offer.offeredQuantity?.toLocaleString()} × ${offered?.item.name ?? "Unavailable item"}`}
            </p>
          </div>
        )}
        {offeredItem && (
          <ItemWithEffects
            item={offeredItem}
            hideDetails
            hideData
            hideEffects
            imageExtra={
              offeredItem.itemType !== "MATERIAL" && (
                <p className="text-muted-foreground text-xs">
                  Level {offeredItem.level} · Durability {offeredItem.curDurability} /{" "}
                  {offeredItem.maxDurability}
                </p>
              )
            }
          />
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {offer.status === "ACTIVE" &&
          (isOwner ? (
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ offerId: offer.id })}
            >
              {cancel.isPending
                ? "Cancelling…"
                : offer.offerType === "REQUEST"
                  ? "Cancel request"
                  : "Cancel trade"}
            </Button>
          ) : (
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button disabled={(user?.level ?? 0) < AUCTION_HOUSE_MIN_LEVEL}>
                  {offer.offerType === "REQUEST"
                    ? "Review & fulfil"
                    : "Review & accept"}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {offer.offerType === "REQUEST" ? "Fulfil request" : "Accept trade"}
                  </DialogTitle>
                  <DialogDescription>
                    Deliver {offer.requestedQuantity.toLocaleString()} ×{" "}
                    {offer.requestedItem?.name}. You receive{" "}
                    {offer.offerType === "REQUEST"
                      ? `${offer.ryo.toLocaleString()} ryo in your bank`
                      : `${offer.offeredQuantity} × ${offered?.item.name}`}
                    .
                  </DialogDescription>
                </DialogHeader>
                {offeredItem && (
                  <div>
                    <p className="mb-2 font-semibold text-sm">Item you receive</p>
                    <ItemWithEffects item={offeredItem} hideDates />
                  </div>
                )}
                {inventoryLoading ? (
                  <Loader explanation="Loading inventory" />
                ) : inventoryError ? (
                  <p role="alert">
                    Could not load your inventory.{" "}
                    <Button variant="outline" onClick={retryInventory}>
                      Retry
                    </Button>
                  </p>
                ) : available.length === 0 ? (
                  <p>
                    You need the full quantity in one available, unequipped inventory
                    stack. Items stored at home, reserved for auction, or being crafted
                    or imbued are unavailable.
                  </p>
                ) : (
                  <>
                    <Label htmlFor={`supply-${offer.id}`}>Item to deliver</Label>
                    <OfferItemPicker
                      id={`supply-${offer.id}`}
                      label="Choose your item"
                      value={suppliedId}
                      onChange={setSuppliedId}
                      options={available.map((row) => ({
                        value: row.id,
                        label: inventoryLabel(row),
                      }))}
                    />
                    {selected && (
                      <ItemWithEffects
                        item={{
                          ...selected.item,
                          level: selected.level,
                          experience: selected.experience,
                          curDurability: selected.durability,
                          imbuements: selected.imbuements.map((entry) => entry.item),
                        }}
                        hideDetails
                      />
                    )}
                    {error && (
                      <p role="alert" className="text-destructive text-sm">
                        {error}
                      </p>
                    )}
                    <Button
                      disabled={!selected || accept.isPending}
                      onClick={() =>
                        accept.mutate({ offerId: offer.id, userItemId: suppliedId })
                      }
                    >
                      {accept.isPending
                        ? "Accepting…"
                        : offer.offerType === "REQUEST"
                          ? "Deliver items & collect ryo"
                          : "Confirm trade"}
                    </Button>
                  </>
                )}
              </DialogContent>
            </Dialog>
          ))}
      </CardContent>
    </Card>
  );
}

function OfferItemPicker({
  label,
  value,
  onChange,
  options,
  ...props
}: Omit<ComponentProps<typeof Button>, "value" | "onChange"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          {...props}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={isOpen}
          aria-label={label}
          className="w-full justify-between"
        >
          <span className="truncate">
            {options.find((row) => row.value === value)?.label ?? label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,85vw)] p-0">
        <Command>
          <CommandInput placeholder="Search items…" />
          <CommandList>
            <CommandEmpty>No items found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  keywords={[option.label]}
                  onSelect={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${value === option.value ? "opacity-100" : "opacity-0"}`}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const inventoryLabel = (row: InventoryItem) =>
  `${row.item.name} × ${row.quantity.toLocaleString()} · level ${row.level} · durability ${row.durability} · ${row.id.slice(-5)}`;
const isOfferInventoryAvailable = (row: InventoryItem) =>
  row.item.canBeTraded &&
  row.quantity > 0 &&
  row.equipped === "NONE" &&
  isEquippableUserItem(row) &&
  !isImbuing(row);

type OfferType = "REQUEST" | "TRADE";
type Offer = RouterOutputs["auction"]["getAuctionOffers"]["data"][number];
type InventoryItem = RouterOutputs["item"]["getUserItems"][number];
