"use client";

import { Coins } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FARM_MAX_PLOTS } from "@/drizzle/constants";
import { FARM_CARD_GRID } from "@/layout/FarmInventory";
import { FarmQuantityStepper } from "@/layout/FarmQuantityStepper";
import Image from "@/layout/Image";
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
      <li
        key={key}
        className="flex flex-col justify-between gap-2 rounded-md border bg-card p-2.5"
      >
        <div className="flex min-w-0 items-start gap-3">
          {entry.itemImage && (
            <Image src={entry.itemImage} alt="" width={40} height={40} />
          )}
          <div className="min-w-0">
            <p className="font-medium text-sm">
              {entry.label}{" "}
              <span className="font-normal text-muted-foreground">
                {entry.cost.toLocaleString()} coins{consumable ? " each" : ""}
              </span>
            </p>
            {entry.type === "SEED" && (
              <p className="text-muted-foreground text-xs">
                {duration(entry.growTimeSeconds)} → {entry.yieldQuantity}{" "}
                {entry.yieldName} · +{entry.experience ?? 0} XP
              </p>
            )}
            {entry.type === "FERTILIZER" && (
              <p className="text-muted-foreground text-xs">
                Reduces grow time by {duration(entry.fertilizerTimeReductionSeconds)}
              </p>
            )}
            {entry.lockedReason ? (
              <p className="text-destructive text-xs">{entry.lockedReason}</p>
            ) : (
              entry.minLevel > 1 && (
                <p className="text-muted-foreground text-xs">
                  Farming level {entry.minLevel}+
                </p>
              )
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
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
            className="min-w-28"
            disabled={!entry.canPurchase || pending || !validQuantity}
            onClick={() => {
              if (validQuantity) void onBuy(entry, quantity);
            }}
          >
            {pending ? (
              "Buying…"
            ) : (
              <>
                <Coins className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Buy for {total.toLocaleString()}
              </>
            )}
          </Button>
        </div>
      </li>
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
