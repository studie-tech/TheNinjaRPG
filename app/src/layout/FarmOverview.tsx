"use client";

import { Droplets, Leaf, ShoppingBag, Shovel, Wheat } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import Countdown from "@/layout/Countdown";
import { getFarmBulkToolAvailability, getNextFarmEvents } from "@/libs/farming";
import { cn } from "@/libs/shadui";
import type { FarmStateResponse } from "@/validators/farming";

type FarmOverviewProps = {
  state: FarmStateResponse;
  summary: {
    ready: number;
    growing: number;
    empty: number;
    waterable: number;
    fertilizable: number;
  };
  now: Date;
  timeDiff: number;
  pendingAction: string | null;
  onPlantAll: (seedItemId: string) => void;
  onWaterAll: () => void;
  onFertilizeAll: (userItemId: string) => void;
  onHarvestAll: () => void;
  onOpenMarket: () => void;
};

/**
 * Whole-farm panel shown while no plot is selected: field counts, the next timed
 * event and only the bulk actions that can run now.
 */
export function FarmOverview({
  state,
  summary,
  now,
  timeDiff,
  pendingAction,
  onPlantAll,
  onWaterAll,
  onFertilizeAll,
  onHarvestAll,
  onOpenMarket,
}: FarmOverviewProps) {
  const eligibleSeeds = state.availableSeeds.filter(
    (seed) => state.farmingLevel >= seed.minLevel,
  );
  const [seedId, setSeedId] = useState(eligibleSeeds[0]?.itemId ?? "");
  const [fertilizerId, setFertilizerId] = useState(
    state.availableFertilizers[0]?.userItemId ?? "",
  );

  useEffect(() => {
    if (!eligibleSeeds.some((seed) => seed.itemId === seedId)) {
      setSeedId(eligibleSeeds[0]?.itemId ?? "");
    }
  }, [eligibleSeeds, seedId]);

  useEffect(() => {
    if (
      !state.availableFertilizers.some(
        (fertilizer) => fertilizer.userItemId === fertilizerId,
      )
    ) {
      setFertilizerId(state.availableFertilizers[0]?.userItemId ?? "");
    }
  }, [fertilizerId, state.availableFertilizers]);

  const isPending = pendingAction !== null;
  const tools = getFarmBulkToolAvailability({
    selectedSeedId: seedId,
    selectedFertilizerId: fertilizerId,
    emptyCount: summary.empty,
    waterableCount: summary.waterable,
    fertilizableCount: summary.fertilizable,
    readyCount: summary.ready,
    pending: isPending,
  });
  const { nextHarvestAt, nextWateringAt } = getNextFarmEvents(state.plots, now);
  const isNewFarm =
    summary.growing + summary.ready === 0 && state.availableSeeds.length === 0;
  const showPlant = summary.empty > 0 && eligibleSeeds.length > 0;
  const showFertilize =
    summary.fertilizable > 0 && state.availableFertilizers.length > 0;
  const hasAction =
    summary.ready > 0 || summary.waterable > 0 || showPlant || showFertilize;
  const label = (action: string, text: string) =>
    pendingAction === action ? "Working…" : text;

  return (
    <section
      aria-labelledby="farm-overview-title"
      className="space-y-4 rounded-lg border bg-card p-3"
    >
      <div className="space-y-1">
        <h2 id="farm-overview-title" className="font-semibold text-base">
          Your fields
        </h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <FieldCount count={summary.ready} label="ready" dot="bg-amber-500" />
          <FieldCount count={summary.growing} label="growing" dot="bg-emerald-500" />
          <FieldCount
            count={summary.empty}
            label="empty"
            dot="bg-muted-foreground/50"
          />
        </ul>
        {nextHarvestAt && (
          <p className="text-muted-foreground text-sm">
            Next harvest in <Countdown targetDate={nextHarvestAt} timeDiff={timeDiff} />
          </p>
        )}
        {summary.growing > 0 && summary.waterable === 0 && nextWateringAt && (
          <p className="text-muted-foreground text-sm">
            Water again in <Countdown targetDate={nextWateringAt} timeDiff={timeDiff} />
          </p>
        )}
      </div>

      {isNewFarm ? (
        <div className="space-y-3">
          <p className="font-medium text-sm">Start your first crop</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            <li>Buy seeds in the market.</li>
            <li>Select an empty plot and plant a seed.</li>
            <li>Water growing crops once each day to speed them up.</li>
            <li>Harvest when a crop is ready, then sell or cook it.</li>
          </ol>
          <Button type="button" className="w-full" onClick={onOpenMarket}>
            <ShoppingBag className="mr-2 h-4 w-4" aria-hidden />
            Buy seeds
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {summary.ready > 0 && (
            <Button
              type="button"
              className="w-full"
              disabled={!tools.canHarvestAll}
              onClick={onHarvestAll}
            >
              <Leaf className="mr-2 h-4 w-4" aria-hidden />
              {label("harvest", `Harvest all (${summary.ready})`)}
            </Button>
          )}
          {summary.waterable > 0 && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!tools.canWaterAll}
              onClick={onWaterAll}
            >
              <Droplets
                className="mr-2 h-4 w-4 text-sky-600 dark:text-sky-400"
                aria-hidden
              />
              {label("water", `Water all (${summary.waterable})`)}
            </Button>
          )}
          {showPlant && (
            <div className="flex gap-2">
              <select
                aria-label="Seed to plant in every empty plot"
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                value={seedId}
                onChange={(event) => setSeedId(event.target.value)}
                disabled={isPending}
              >
                {eligibleSeeds.map((seed) => (
                  <option key={seed.itemId} value={seed.itemId}>
                    {seed.name} ×{seed.quantity}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={!tools.canPlantAll}
                onClick={() => onPlantAll(seedId)}
              >
                <Wheat
                  className="mr-2 h-4 w-4 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
                {label("plant", `Plant all (${summary.empty})`)}
              </Button>
            </div>
          )}
          {summary.empty > 0 && eligibleSeeds.length === 0 && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
              <span>
                {summary.empty} empty {summary.empty === 1 ? "plot" : "plots"}, no seeds
                to plant.
              </span>
              <Button type="button" variant="outline" size="sm" onClick={onOpenMarket}>
                Buy seeds
              </Button>
            </div>
          )}
          {showFertilize && (
            <div className="flex gap-2">
              <select
                aria-label="Fertilizer for every growing crop"
                className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                value={fertilizerId}
                onChange={(event) => setFertilizerId(event.target.value)}
                disabled={isPending}
              >
                {state.availableFertilizers.map((fertilizer) => (
                  <option key={fertilizer.userItemId} value={fertilizer.userItemId}>
                    {fertilizer.name} ×{fertilizer.quantity}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={!tools.canFertilizeAll}
                onClick={() => onFertilizeAll(fertilizerId)}
              >
                <Shovel
                  className="mr-2 h-4 w-4 text-orange-600 dark:text-orange-400"
                  aria-hidden
                />
                {label("fertilize", `Fertilize all (${summary.fertilizable})`)}
              </Button>
            </div>
          )}
          {!hasAction && summary.empty === 0 && (
            <p className="text-muted-foreground text-sm">
              Nothing to do right now. Your crops are growing.
            </p>
          )}
        </div>
      )}

      <p className="border-t pt-3 text-muted-foreground text-xs">
        Select a plot on the farm to plant, water, fertilize or harvest it on its own.
      </p>
    </section>
  );
}

const FieldCount = ({ count, label, dot }: FieldCountProps) => (
  <li className="flex items-center gap-1.5">
    <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", dot)} />
    <span className="font-semibold">{count}</span> {label}
  </li>
);

type FieldCountProps = { count: number; label: string; dot: string };
