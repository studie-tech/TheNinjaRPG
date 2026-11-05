"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import type { Item } from "@/drizzle/schema";
import Confirm from "@/layout/Confirm";
import ContentImage from "@/layout/ContentImage";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { rarityLabel, rarityTextClass } from "@/layout/items/ItemCard";
import Loader from "@/layout/Loader";
import { ShopPriceTag } from "@/layout/shop/ShopPriceTag";
import { cn } from "@/libs/shadui";
import type { ShopCurrency } from "@/libs/shop";
import {
  getMaxItemShopPurchaseQuantity,
  missingForPrices,
  shopItemPrices,
} from "@/libs/shop";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { parseHtml } from "@/utils/parse";
import { useUserData } from "@/utils/UserContext";

/**
 * Everything about one item for sale, laid out like the backpack's inspector: art and rarity,
 * a short description, a box with price, quantity, limits, discounts and Buy, then the full
 * stats folded away. Buying asks for confirmation; a rejected purchase keeps the dialog open
 * with the server's message.
 */
export function ShopInspector({
  item,
  userData,
  ryoFactor,
  discounts,
  silverCopy,
  onClose,
  onPurchased,
}: ShopInspectorProps) {
  const { prepareUserUpdate, updateUser } = useUserData();
  const utils = api.useUtils();
  const [requestedQuantity, setQuantity] = useState(1);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const allowance = api.item.getPurchaseAllowance.useQuery(
    { id: item.id },
    { staleTime: 0, refetchInterval: 30_000 },
  );
  const hasBloodlineRoll = item.effects.some(
    (effect) => effect.type === "rollbloodline",
  );
  const rollOdds = api.item.getBloodlineRollOdds.useQuery(
    { id: item.id },
    { enabled: hasBloodlineRoll, staleTime: 0 },
  );
  const { mutate: purchase, isPending: isPurchasing } = api.item.buy.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: (data, variables, revision) => {
      showMutationToast(data);
      if (data.success) {
        void updateUser(data.userPatch, { revision, delta: data.userDelta });
        void utils.item.getUserItems.invalidate();
        void utils.item.getPurchaseAllowance.invalidate();
        if (item.itemType === "FURNITURE") void utils.home.getUserHome.invalidate();
        onPurchased(variables.itemId);
      } else {
        setPurchaseError(data.message);
        void allowance.refetch();
      }
    },
    onError: (error) => setPurchaseError(error.message),
  });

  const maxQuantity = Math.min(
    item.canStack ? getMaxItemShopPurchaseQuantity(item.stackSize) : 1,
    allowance.data?.remaining ?? Number.POSITIVE_INFINITY,
  );
  // A cleared or invalid field reads as NaN: prices and the stepper use 1 meanwhile, while
  // the field keeps the player's draft and Buy stays off until the number is valid.
  const isQuantityEntered = Number.isFinite(requestedQuantity);
  const quantity = Math.min(
    isQuantityEntered ? requestedQuantity : 1,
    Math.max(1, maxQuantity),
  );
  const isQuantityValid =
    !!allowance.data &&
    !allowance.isError &&
    isQuantityEntered &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= maxQuantity;
  const canReviewRollOdds =
    !hasBloodlineRoll ||
    (!rollOdds.isFetching &&
      !rollOdds.isError &&
      !!rollOdds.data?.length &&
      rollOdds.data.every((roll) => roll.outcomes.length > 0));

  const wallet: Record<ShopCurrency, number> = {
    ryo: userData.money,
    rep: userData.reputationPoints,
    silver: userData.seichiSilver,
  };
  const prices = shopItemPrices(item, ryoFactor);
  const missing = missingForPrices(prices, wallet, quantity);
  const currencyName = (currency: ShopCurrency) =>
    currency === "ryo"
      ? "ryo"
      : currency === "rep"
        ? "reputation points"
        : silverCopy.purchase;
  const amounts = (list: typeof prices, times = 1) =>
    list
      .map(
        ({ currency, amount }) =>
          `${(amount * times).toLocaleString()} ${currencyName(currency)}`,
      )
      .join(", ");
  const costText = amounts(prices, quantity);
  const leftText = prices
    .map(
      ({ currency, amount }) =>
        `${(wallet[currency] - amount * quantity).toLocaleString()} ${currencyName(currency)}`,
    )
    .join(", ");
  const canBuy =
    missing.length === 0 && isQuantityValid && canReviewRollOdds && !isPurchasing;
  const hasRyoPrice = prices.some((price) => price.currency === "ryo");
  const totalDiscount = discounts.reduce((sum, discount) => sum + discount.value, 0);
  const buyLabel = isPurchasing
    ? "Buying…"
    : missing.length > 0
      ? `Need ${amounts(missing)} more`
      : `Buy for ${costText}`;

  return (
    <section aria-label={item.name} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="relative h-16 w-16 shrink-0">
          <ContentImage
            image={item.image}
            alt={item.name}
            rarity={item.rarity}
            className="h-full w-full"
          />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-lg font-bold">{item.name}</h2>
          <p className={cn("text-sm font-medium", rarityTextClass[item.rarity])}>
            {rarityLabel[item.rarity]} {item.itemType.toLowerCase()}
            {item.slot !== "NONE" &&
              ` · fits ${item.slot.charAt(0)}${item.slot.slice(1).toLowerCase()}`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close item"
          className="h-9 w-9 shrink-0"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      {item.description && (
        <div data-reading-text className="text-muted-foreground line-clamp-3 text-sm">
          {parseHtml(item.description)}
        </div>
      )}
      {item.itemType === "FURNITURE" && (
        <p className="text-sm">Furniture is delivered to your home storage.</p>
      )}
      {hasBloodlineRoll && <BloodlineOdds rollOdds={rollOdds} />}
      <div className="bg-card flex flex-col gap-2 rounded-lg border p-3">
        <ShopPriceTag
          prices={prices}
          wallet={wallet}
          quantity={quantity}
          silverLabel={silverCopy.catalog}
        />
        {maxQuantity > 1 && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-semibold">How many</span>
            <span className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                aria-label="One less"
                disabled={quantity <= 1}
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
              >
                −
              </Button>
              <NumberInput
                aria-label="How many to buy"
                className="h-9 w-16 text-center tabular-nums"
                min={1}
                max={maxQuantity}
                value={isQuantityEntered ? quantity : requestedQuantity}
                onValueChange={setQuantity}
              />
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                aria-label="One more"
                disabled={quantity >= maxQuantity}
                onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))}
              >
                +
              </Button>
            </span>
          </div>
        )}
        {allowance.isPending && (
          <p className="text-muted-foreground text-xs">Checking purchase limits…</p>
        )}
        {allowance.isError && (
          <p role="alert" className="text-sm">
            Could not load purchase limits.{" "}
            <Button
              variant="link"
              className="h-auto p-0"
              onClick={() => void allowance.refetch()}
            >
              Retry
            </Button>
          </p>
        )}
        {allowance.data?.limit != null && (
          <p className="text-muted-foreground text-xs">
            Bought {allowance.data.purchased} of {allowance.data.limit}{" "}
            {allowance.data.period === "WEEKLY"
              ? "this week · resets Monday (UTC)"
              : "today (UTC)"}
          </p>
        )}
        {hasRyoPrice && totalDiscount > 0 && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            Ryo discount −{totalDiscount}% ·{" "}
            {discounts.map((discount) => discount.label).join(", ")}
          </p>
        )}
        {purchaseError && (
          <p role="alert" className="text-destructive text-sm">
            {purchaseError}
          </p>
        )}
        <Confirm
          id="tutorial-itemshop-confirmPurchase"
          title={`Buy ${item.name}?`}
          proceed_label={`Buy for ${costText}`}
          proceed_loading_label="Buying…"
          isLoading={isPurchasing}
          keepOpenOnAccept
          disabled={!canBuy}
          confirmDisabled={!canBuy}
          button={
            <Button
              id="tutorial-itemshop-buy"
              className="h-11 w-full"
              disabled={!canBuy}
            >
              {buyLabel}
            </Button>
          }
          onAccept={(event) => {
            event.preventDefault();
            if (!canBuy) return;
            setPurchaseError(null);
            purchase({
              itemId: item.id,
              stack: quantity,
              villageId: userData.villageId,
            });
          }}
        >
          <p>
            Buy{" "}
            <b>
              {quantity > 1 ? `${quantity}× ` : ""}
              {item.name}
            </b>{" "}
            for <b>{costText}</b>?
          </p>
          <p className="text-muted-foreground text-sm">
            You will have {leftText} left. Purchases cannot be undone.
          </p>
          {purchaseError && (
            <p role="alert" className="text-destructive text-sm">
              {purchaseError}
            </p>
          )}
        </Confirm>
      </div>
      <section aria-label="Details" className="bg-card rounded-lg border">
        <h3 className="px-3 pt-2 text-sm font-semibold">Details</h3>
        <div className="p-2">
          {/* The header above already shows the description. */}
          <ItemWithEffects
            item={{ ...item, description: "" }}
            key={item.id}
            hideTitle
            hideImage
            hideDates
          />
        </div>
      </section>
    </section>
  );
}

/** The bloodlines a roll item can give with the player's current village and roll history. */
function BloodlineOdds({
  rollOdds,
}: {
  rollOdds: {
    data?: RouterOutputs["item"]["getBloodlineRollOdds"];
    isFetching: boolean;
    isError: boolean;
    refetch: () => unknown;
  };
}) {
  return (
    <div className="bg-card rounded-lg border p-3 text-sm" aria-live="polite">
      <h3 className="font-semibold">Bloodline odds</h3>
      {rollOdds.isFetching ? (
        <Loader explanation="Loading your possible bloodlines" />
      ) : rollOdds.isError || !rollOdds.data?.length ? (
        <div className="space-y-2">
          <p>Could not load the odds. Please retry before buying.</p>
          <Button variant="outline" onClick={() => void rollOdds.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            Odds per use with your current village and roll history. Each use rolls
            again; changing villages or rolling bloodlines can change the pool. A
            successful roll replaces your equipped bloodline.
          </p>
          {rollOdds.data.length > 1 && (
            <p>
              Rolls run in order; the last successful roll determines your bloodline.
            </p>
          )}
          {rollOdds.data.map((roll, index) => (
            <div key={`${roll.rank}-${index}`}>
              <p className="font-medium">
                {roll.rank}-rank roll
                {roll.outcomes.length > 0 && `: ${roll.successChance}% success`}
              </p>
              {roll.outcomes.length === 0 ? (
                <p role="alert">No bloodlines are currently available for this roll.</p>
              ) : (
                <ul>
                  {roll.outcomes.map((outcome) => (
                    <li key={outcome.id} className="flex justify-between gap-3">
                      <span className="min-w-0 break-words">{outcome.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {outcome.chance.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}
                        %
                      </span>
                    </li>
                  ))}
                  {roll.successChance < 100 && (
                    <li>No new bloodline: {100 - roll.successChance}%</li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ShopInspectorProps {
  item: Item;
  userData: NonNullable<UserWithRelations>;
  /** Ryo price factor after the player's discounts. */
  ryoFactor: number;
  discounts: { label: string; value: number }[];
  silverCopy: { catalog: string; purchase: string };
  onClose: () => void;
  onPurchased: (itemId: string) => void;
}
