"use client";

import { Coins } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FARM_MAX_PLOTS } from "@/drizzle/constants";
import { FARM_CARD_GRID, FarmItemCard } from "@/layout/FarmItemCard";
import { FarmQuantityStepper } from "@/layout/FarmQuantityStepper";
import { getFarmQuantityPrice } from "@/libs/farming";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import type { FarmShopEntryState, FarmStateResponse } from "@/validators/farming";

type FarmMarketProps = {
  farmState: FarmStateResponse;
  pendingKeys: Set<string>;
  onBuy: (entry: FarmShopEntryState, quantity: number) => Promise<boolean>;
  /** Seeds and supplies, or plot and extractor upgrades. */
  section?: "market" | "upgrades";
};

const duration = (seconds?: number) => {
  if (!seconds) return null;
  if (seconds < 60) return formatSecondsToTimeDisplay(seconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

/** Farm shop rows with quantity, total price and purchase in one line per item. */
export function FarmMarket({
  farmState,
  pendingKeys,
  onBuy,
  section = "market",
}: FarmMarketProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [unlockedOnly, setUnlockedOnly] = useState(false);

  const filtersActive = affordableOnly || unlockedOnly;
  const entries = farmState.shopEntries.filter(
    (entry) =>
      (!affordableOnly || entry.canAfford) &&
      (!unlockedOnly || farmState.farmingLevel >= entry.minLevel),
  );
  const groups =
    section === "market"
      ? [
          {
            title: "Seeds",
            items: entries.filter((entry) => entry.type === "SEED"),
            empty: "No seeds are for sale right now.",
          },
          {
            title: "Supplies",
            items: entries.filter((entry) => entry.type === "FERTILIZER"),
            empty: "No supplies are for sale right now.",
          },
        ]
      : [
          {
            title: "Upgrades",
            items: entries.filter(
              (entry) => entry.type === "PLOT" || entry.type === "EXTRACTOR",
            ),
            empty: "No upgrades are available right now.",
          },
        ];

  const renderEntry = (entry: FarmShopEntryState) => {
    const key = `${entry.type}:${entry.itemId ?? "upgrade"}`;
    const pending = pendingKeys.has(`buy:${key}`);
    const consumable = entry.type === "SEED" || entry.type === "FERTILIZER";
    const max = consumable
      ? Math.max(1, Math.min(99, Math.floor(farmState.farmCurrency / entry.cost)))
      : 1;
    const quantity = Math.min(quantities[key] ?? 1, max);
    const validQuantity =
      Number.isInteger(quantity) && quantity >= 1 && quantity <= max;
    const total = getFarmQuantityPrice(entry.cost, validQuantity ? quantity : 1);
    return (
      <FarmItemCard
        key={key}
        image={entry.itemImage}
        title={entry.label}
        aside={<FarmPriceTag cost={entry.cost} each={consumable} />}
        details={
          <>
            {entry.type === "SEED" && (
              <p>
                {duration(entry.growTimeSeconds)} → {entry.yieldQuantity}{" "}
                {entry.yieldName} · +{entry.experience ?? 0} XP
              </p>
            )}
            {entry.type === "FERTILIZER" && (
              <p>
                Reduces grow time by {duration(entry.fertilizerTimeReductionSeconds)}
              </p>
            )}
            {entry.lockedReason ? (
              <p className="text-destructive">{entry.lockedReason}</p>
            ) : (
              entry.minLevel > 1 && <p>Farming level {entry.minLevel}+</p>
            )}
          </>
        }
        actions={
          <>
            {consumable && (
              <FarmQuantityStepper
                value={quantity}
                max={max}
                disabled={pending || !entry.canPurchase}
                onChange={(value) =>
                  setQuantities((current) => ({ ...current, [key]: value }))
                }
                label={`${entry.label} quantity`}
                showMax
              />
            )}
            <Button
              size="sm"
              className="flex-1"
              disabled={!entry.canPurchase || pending || !validQuantity}
              onClick={() => {
                if (validQuantity) void onBuy(entry, quantity);
              }}
            >
              {pending
                ? "Buying…"
                : validQuantity && quantity > 1
                  ? `Buy ${quantity} for ${total.toLocaleString()}`
                  : `Buy for ${total.toLocaleString()}`}
            </Button>
          </>
        }
      />
    );
  };

  return (
    <div id={section === "market" ? "farm-market" : undefined} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {section === "upgrades" &&
            `You have ${farmState.totalPlots} of ${FARM_MAX_PLOTS} plots and ${farmState.farmExtractorsOwned} seed ${farmState.farmExtractorsOwned === 1 ? "extractor" : "extractors"}.`}
        </p>
        <fieldset className="flex gap-1">
          <legend className="sr-only">Market filters</legend>
          <Button
            size="sm"
            variant={affordableOnly ? "default" : "outline"}
            aria-pressed={affordableOnly}
            onClick={() => setAffordableOnly((value) => !value)}
          >
            Affordable
          </Button>
          <Button
            size="sm"
            variant={unlockedOnly ? "default" : "outline"}
            aria-pressed={unlockedOnly}
            onClick={() => setUnlockedOnly((value) => !value)}
          >
            Unlocked
          </Button>
        </fieldset>
      </div>
      {groups.map((group) => (
        <section key={group.title} className="space-y-2">
          {groups.length > 1 && (
            <h3 className="font-semibold text-sm">{group.title}</h3>
          )}
          {group.items.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-3 text-muted-foreground text-sm">
              {filtersActive ? "Nothing matches these filters." : group.empty}
              {filtersActive && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAffordableOnly(false);
                    setUnlockedOnly(false);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <ul className={FARM_CARD_GRID}>{group.items.map(renderEntry)}</ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** Unit price shown in a card's corner. */
const FarmPriceTag = ({ cost, each }: { cost: number; each: boolean }) => (
  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-900 text-xs tabular-nums dark:text-amber-200">
    <Coins className="h-3.5 w-3.5" aria-hidden />
    {cost.toLocaleString()}
    <span className="sr-only">farm coins{each ? " each" : ""}</span>
  </span>
);
