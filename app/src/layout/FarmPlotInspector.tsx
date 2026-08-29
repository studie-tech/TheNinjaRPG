"use client";

import { Droplets, Leaf, PackageOpen, Shovel, Wheat, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import {
  canWaterPlot,
  getFarmPlotStatus,
  getFarmPrimaryAction,
  getNextWateringAt,
} from "@/libs/farming";
import { useRequiredUserData } from "@/utils/UserContext";
import type { FarmPlotState, FarmStateResponse } from "@/validators/farming";

type FarmPlotInspectorProps = {
  plot: FarmPlotState | null;
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
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes > 0 ? `${minutes}m` : ""}`.trim();
  return `${Math.max(1, minutes)}m`;
};

export function FarmPlotInspector({
  plot,
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
  }, [plot?.id]);

  if (!plot) {
    return (
      <Card className="lg:sticky lg:top-4">
        <CardContent className="flex min-h-40 items-center justify-center py-6 text-center text-muted-foreground text-sm">
          Select any plot to inspect it. Harvesting always requires a separate action.
        </CardContent>
      </Card>
    );
  }

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
      data-mobile-dock="farm-plot-inspector"
      className="fixed inset-x-2 bottom-[calc(5rem+env(safe-area-inset-bottom)+0.5rem)] z-30 max-h-[calc(100dvh-6rem-env(safe-area-inset-bottom))] overflow-y-auto shadow-xl md:bottom-2 md:max-h-[72vh] lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:shadow-sm"
      aria-label={`Farm plot ${plot.slotIndex + 1} inspector`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Leaf className="h-4 w-4 text-emerald-600" /> Plot {plot.slotIndex + 1}
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
                <p className="mb-3 text-sm">No seeds in your inventory.</p>
                <Button size="sm" variant="outline" onClick={onBrowseSeeds}>
                  Browse seeds
                </Button>
              </div>
            ) : (
              <div
                className="grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label="Seeds"
              >
                {farmState.availableSeeds.map((seed) => {
                  const selected = selectedSeed?.itemId === seed.itemId;
                  const locked = farmState.farmingLevel < seed.minLevel;
                  return (
                    <label
                      key={seed.itemId}
                      className={`rounded-md border p-2 text-left text-xs transition-colors focus-within:ring-2 focus-within:ring-ring ${
                        selected
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "hover:bg-muted"
                      }`}
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
                      <span className="flex items-center gap-2 font-medium">
                        <Image src={seed.image} alt="" width={28} height={28} />
                        {seed.name} ×{seed.quantity}
                      </span>
                      <span className="mt-1 block text-muted-foreground">
                        {formatDuration(seed.growTimeSeconds)} → {seed.yieldQuantity}{" "}
                        {seed.yieldName}
                      </span>
                      <span className="block text-muted-foreground">
                        Lv {seed.minLevel} · +{seed.plantExperience} plant XP · +
                        {seed.harvestExperience} harvest XP
                      </span>
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
              ? ` for +${plot.harvestExperience} farming XP.`
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
