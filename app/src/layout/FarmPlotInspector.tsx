"use client";

import { Droplets, Leaf, PackageOpen, Shovel, Wheat, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import Countdown from "@/layout/Countdown";
import { FarmItemCount } from "@/layout/FarmItemCount";
import Image from "@/layout/Image";
import {
  canWaterPlot,
  getFarmPlotStatus,
  getFarmPrimaryAction,
  getNextWateringAt,
} from "@/libs/farming";
import { cn } from "@/libs/shadui";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";
import type { FarmPlotState, FarmStateResponse } from "@/validators/farming";

type FarmPlotInspectorProps = {
  plot: FarmPlotState;
  /** Floats above the page on phones instead of sitting in the layout. */
  docked?: boolean;
  farmState: FarmStateResponse;
  now: Date;
  pending: boolean;
  onClose: () => void;
  onPlant: (plot: FarmPlotState, seedItemId: string) => void;
  onWater: (plot: FarmPlotState) => void;
  onFertilize: (plot: FarmPlotState, userItemId: string) => void;
  onHarvest: (plot: FarmPlotState) => void;
  onBrowseSeeds: () => void;
};

const formatDuration = (seconds: number) => {
  if (seconds < 60) return formatSecondsToTimeDisplay(seconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes > 0 ? `${minutes}m` : ""}`.trim();
  return `${Math.max(1, minutes)}m`;
};

/** Shows plot actions and base XP estimates with explicit harvest controls. */
export function FarmPlotInspector({
  plot,
  docked = false,
  farmState,
  now,
  pending,
  onClose,
  onPlant,
  onWater,
  onFertilize,
  onHarvest,
  onBrowseSeeds,
}: FarmPlotInspectorProps) {
  const { timeDiff } = useRequiredUserData();
  const [selectedSeedId, setSelectedSeedId] = useState<string | null>(null);
  const [selectedFertilizerId, setSelectedFertilizerId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSeedId(null);
    setSelectedFertilizerId(null);
  }, [plot.id]);

  const status = getFarmPlotStatus(plot, now);
  const canWater = status === "growing" && canWaterPlot(plot.lastWateredAt, now);
  const nextWateringAt = canWater ? null : getNextWateringAt(plot.lastWateredAt, now);
  const selectedSeed =
    farmState.availableSeeds.find((seed) => seed.itemId === selectedSeedId) ??
    farmState.availableSeeds[0];
  const selectedFertilizer =
    farmState.availableFertilizers.find(
      (fertilizer) => fertilizer.userItemId === selectedFertilizerId,
    ) ?? farmState.availableFertilizers[0];
  const primaryAction = getFarmPrimaryAction(
    plot,
    !!selectedFertilizer && !plot.fertilizerApplied,
    now,
  );

  const runPrimaryAction = () => {
    if (primaryAction === "plant" && selectedSeed) onPlant(plot, selectedSeed.itemId);
    else if (primaryAction === "water") onWater(plot);
    else if (primaryAction === "fertilize" && selectedFertilizer) {
      onFertilize(plot, selectedFertilizer.userItemId);
    } else if (primaryAction === "harvest") onHarvest(plot);
  };

  const primaryDisabled =
    pending ||
    (primaryAction === "plant" &&
      (!selectedSeed || farmState.farmingLevel < selectedSeed.minLevel)) ||
    (primaryAction === "water" && !canWater) ||
    (primaryAction === "fertilize" && !selectedFertilizer);

  return (
    <Card
      data-mobile-dock={docked ? "farm-plot-inspector" : undefined}
      className={cn(
        "overflow-y-auto",
        docked
          ? "fixed inset-x-2 bottom-[calc(5rem+env(safe-area-inset-bottom)+0.5rem)] z-30 max-h-[min(55dvh,32rem)] shadow-xl md:inset-x-auto md:right-4 md:bottom-4 md:w-[360px]"
          : "max-h-[min(80dvh,40rem)]",
      )}
      aria-label={`Farm plot ${plot.slotIndex + 1} inspector`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Leaf
            className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
          Plot {plot.slotIndex + 1}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-medium text-xs",
              status === "ready"
                ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                : status === "growing"
                  ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {status === "ready" ? "Ready" : status === "growing" ? "Growing" : "Empty"}
          </span>
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close plot inspector"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {status !== "empty" && (
          <div className="flex items-center gap-3 rounded-md border p-3">
            {plot.cropImage && (
              <Image
                src={plot.cropImage}
                alt={plot.cropName ?? "Growing crop"}
                width={52}
                height={52}
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-sm">
                {plot.cropName ?? plot.seedName}
              </p>
              <div className="mt-1 flex items-center justify-between text-muted-foreground text-xs">
                <span>
                  {Math.round(status === "ready" ? 100 : plot.growthProgress)}% grown
                </span>
                {plot.fertilizerApplied && <span>Fertilized</span>}
              </div>
              <Progress
                value={status === "ready" ? 100 : plot.growthProgress}
                className="mt-1 h-2"
              />
            </div>
          </div>
        )}

        {status === "empty" && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Choose the crop for this plot.
            </p>
            {farmState.availableSeeds.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-center">
                <PackageOpen className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <p className="mb-3 text-sm">You have no seeds to plant.</p>
                <Button size="sm" variant="outline" onClick={onBrowseSeeds}>
                  Buy seeds
                </Button>
              </div>
            ) : (
              <div className="grid gap-2" role="radiogroup" aria-label="Seeds">
                {farmState.availableSeeds.map((seed) => {
                  const selected = selectedSeed?.itemId === seed.itemId;
                  const locked = farmState.farmingLevel < seed.minLevel;
                  return (
                    <label
                      key={seed.itemId}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-md border p-2 text-left text-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
                        selected
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "hover:bg-muted",
                        locked && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <input
                        type="radio"
                        name={`plot-${plot.id}-seed`}
                        value={seed.itemId}
                        checked={selected}
                        disabled={locked || pending}
                        onChange={() => setSelectedSeedId(seed.itemId)}
                        className="sr-only"
                      />
                      <Image src={seed.image} alt="" width={36} height={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{seed.name}</span>
                        <span className="block text-muted-foreground text-xs">
                          {formatDuration(seed.growTimeSeconds)} → {seed.yieldQuantity}{" "}
                          {seed.yieldName}
                        </span>
                        <span className="block text-muted-foreground text-xs">
                          {locked
                            ? `Requires farming level ${seed.minLevel}`
                            : seed.harvestExperience > 0
                              ? `+${seed.plantExperience} XP planting, +${seed.harvestExperience} XP harvest`
                              : `+${seed.plantExperience} XP planting`}
                        </span>
                      </span>
                      <FarmItemCount count={seed.quantity} />
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {status === "growing" && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md bg-muted p-3">
              <p className="font-medium">Expected effect</p>
              {primaryAction === "water" ? (
                <p className="text-muted-foreground">
                  Watering reduces the remaining grow time and grants farming XP.
                </p>
              ) : selectedFertilizer ? (
                <p className="text-muted-foreground">
                  {selectedFertilizer.name} removes up to{" "}
                  {formatDuration(selectedFertilizer.timeReductionSeconds)} from the
                  ready time.
                </p>
              ) : (
                <p className="text-muted-foreground">
                  This plot has no action available yet.
                </p>
              )}
            </div>
            <p>
              Ready in:{" "}
              {plot.finishAt && (
                <Countdown targetDate={plot.finishAt} timeDiff={timeDiff} />
              )}
            </p>
            {!canWater && nextWateringAt && (
              <p className="text-muted-foreground text-xs">
                Watering available in{" "}
                <Countdown targetDate={nextWateringAt} timeDiff={timeDiff} />
              </p>
            )}
            {!plot.fertilizerApplied && farmState.availableFertilizers.length > 1 && (
              <label className="block text-xs">
                Fertilizer
                <select
                  className="mt-1 w-full rounded-md border bg-background p-2"
                  value={selectedFertilizer?.userItemId}
                  onChange={(event) => setSelectedFertilizerId(event.target.value)}
                  disabled={pending}
                >
                  {farmState.availableFertilizers.map((fertilizer) => (
                    <option key={fertilizer.userItemId} value={fertilizer.userItemId}>
                      {fertilizer.name} (−
                      {formatDuration(fertilizer.timeReductionSeconds)})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {status === "ready" && (
          <div className="rounded-md bg-amber-500/10 p-3 text-sm">
            Ready to harvest {plot.yieldQuantity ?? 1} {plot.cropName}
            {(plot.harvestExperience ?? 0) > 0
              ? ` for +${plot.harvestExperience} base farming XP, plus bonuses active at harvest.`
              : "."}
          </div>
        )}

        <Button
          className="w-full"
          disabled={primaryDisabled}
          onClick={runPrimaryAction}
        >
          {primaryAction === "plant" && <Wheat className="mr-2 h-4 w-4" />}
          {primaryAction === "water" && <Droplets className="mr-2 h-4 w-4" />}
          {primaryAction === "fertilize" && <Shovel className="mr-2 h-4 w-4" />}
          {primaryAction === "harvest" && <Leaf className="mr-2 h-4 w-4" />}
          {pending
            ? "Working…"
            : primaryAction[0]?.toUpperCase() + primaryAction.slice(1)}
        </Button>
      </CardContent>
    </Card>
  );
}
