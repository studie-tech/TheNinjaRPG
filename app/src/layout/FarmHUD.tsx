"use client";

import {
  BookOpen,
  Coins,
  Droplets,
  Leaf,
  Shovel,
  Sprout,
  Star,
  Wheat,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { DayNightIndicator } from "@/layout/DayNightIndicator";
import { getFarmBulkToolAvailability, getFarmingLevelProgress } from "@/libs/farming";
import type { FarmStateResponse } from "@/validators/farming";

type FarmHUDProps = {
  state: FarmStateResponse;
  summary: { ready: number; growing: number; empty: number; waterable: number };
  pendingAction: string | null;
  onPlantAll: (seedItemId: string) => void;
  onWaterAll: () => void;
  onFertilizeAll: (userItemId: string) => void;
  onHarvestAll: () => void;
  onOpenCollection: () => void;
};

export function FarmHUD({
  state,
  summary,
  pendingAction,
  onPlantAll,
  onWaterAll,
  onFertilizeAll,
  onHarvestAll,
  onOpenCollection,
}: FarmHUDProps) {
  const eligibleSeeds = state.availableSeeds.filter(
    (seed) => state.farmingLevel >= seed.minLevel,
  );
  const [selectedSeedId, setSelectedSeedId] = useState(eligibleSeeds[0]?.itemId ?? "");
  const [selectedFertilizerId, setSelectedFertilizerId] = useState(
    state.availableFertilizers[0]?.userItemId ?? "",
  );
  const levelInfo = useMemo(
    () => getFarmingLevelProgress(state.farmingExperience),
    [state.farmingExperience],
  );
  const fertilizableCount = state.plots.filter(
    (plot) => plot.seedItemId && !plot.isReady && !plot.fertilizerApplied,
  ).length;

  useEffect(() => {
    if (!eligibleSeeds.some((seed) => seed.itemId === selectedSeedId)) {
      setSelectedSeedId(eligibleSeeds[0]?.itemId ?? "");
    }
  }, [eligibleSeeds, selectedSeedId]);

  useEffect(() => {
    if (
      !state.availableFertilizers.some(
        (fertilizer) => fertilizer.userItemId === selectedFertilizerId,
      )
    ) {
      setSelectedFertilizerId(state.availableFertilizers[0]?.userItemId ?? "");
    }
  }, [selectedFertilizerId, state.availableFertilizers]);

  const isPending = pendingAction !== null;
  const bulkTools = getFarmBulkToolAvailability({
    selectedSeedId,
    selectedFertilizerId,
    emptyCount: summary.empty,
    waterableCount: summary.waterable,
    fertilizableCount,
    readyCount: summary.ready,
    pending: isPending,
  });

  return (
    <div className="flex w-full flex-wrap items-center gap-2 border-b bg-background/95 p-2 backdrop-blur-sm">
      <div className="min-w-36 flex-1 px-2 py-1 sm:min-w-[210px]">
        <div className="mb-1 flex items-center gap-2 font-medium text-xs sm:text-sm">
          <Star className="h-4 w-4 text-amber-500" />
          Farming Level {levelInfo.level}
        </div>
        <Progress value={levelInfo.progress} className="mb-1 h-2" />
        <div className="hidden text-muted-foreground text-xs sm:block">
          {levelInfo.experienceNeededForLevel === null
            ? "Max level"
            : `${levelInfo.experienceIntoLevel.toLocaleString()} / ${levelInfo.experienceNeededForLevel.toLocaleString()} XP`}
        </div>
      </div>

      <div className="hidden sm:block">
        <DayNightIndicator />
      </div>
      <div className="flex flex-wrap items-center gap-1 sm:gap-2">
        <div className="rounded-md border px-2 py-1.5">
          <div className="flex items-center gap-1.5 font-medium text-xs sm:text-sm">
            <Coins className="h-4 w-4 text-yellow-600" />
            {state.farmCurrency.toLocaleString()} farm coins
          </div>
        </div>
        <div className="hidden rounded-md border px-2 py-1.5 md:block">
          <div className="flex items-center gap-1.5 font-medium text-sm">
            <Sprout className="h-4 w-4 text-emerald-600" />
            {state.totalPlots} plots · {state.farmExtractorsOwned} extractors
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenCollection}
          className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 font-medium text-xs sm:text-sm"
        >
          <BookOpen className="h-4 w-4 text-emerald-600" />
          Collection Log — {state.collectionLog.collected}/{state.collectionLog.total}
        </button>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2">
        <span className="px-1 font-medium text-xs">Bulk tools</span>
        <div className="flex min-w-52 flex-1 items-stretch">
          <select
            aria-label="Seed for plant all"
            className="min-w-0 flex-1 rounded-l-md border bg-background px-2 text-xs"
            value={selectedSeedId}
            onChange={(event) => setSelectedSeedId(event.target.value)}
            disabled={eligibleSeeds.length === 0 || isPending}
          >
            {eligibleSeeds.length === 0 ? (
              <option value="">No seeds available</option>
            ) : (
              eligibleSeeds.map((seed) => (
                <option key={seed.itemId} value={seed.itemId}>
                  {seed.name} ×{seed.quantity}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => onPlantAll(selectedSeedId)}
            disabled={!bulkTools.canPlantAll}
            className="flex items-center gap-1 rounded-r-md border border-emerald-500/40 border-l-0 bg-emerald-500/10 px-2 py-1.5 font-medium text-xs disabled:opacity-50"
          >
            <Wheat className="h-4 w-4 text-emerald-600" /> Plant all ({summary.empty})
          </button>
        </div>
        <button
          type="button"
          onClick={onWaterAll}
          disabled={!bulkTools.canWaterAll}
          className="flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 font-medium text-xs disabled:opacity-50"
        >
          <Droplets className="h-4 w-4 text-sky-600" /> Water all ({summary.waterable})
        </button>
        <div className="flex min-w-56 flex-1 items-stretch">
          <select
            aria-label="Fertilizer for fertilize all"
            className="min-w-0 flex-1 rounded-l-md border bg-background px-2 text-xs"
            value={selectedFertilizerId}
            onChange={(event) => setSelectedFertilizerId(event.target.value)}
            disabled={state.availableFertilizers.length === 0 || isPending}
          >
            {state.availableFertilizers.length === 0 ? (
              <option value="">No fertilizer available</option>
            ) : (
              state.availableFertilizers.map((fertilizer) => (
                <option key={fertilizer.userItemId} value={fertilizer.userItemId}>
                  {fertilizer.name} ×{fertilizer.quantity}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => onFertilizeAll(selectedFertilizerId)}
            disabled={!bulkTools.canFertilizeAll}
            className="flex items-center gap-1 rounded-r-md border border-orange-500/40 border-l-0 bg-orange-500/10 px-2 py-1.5 font-medium text-xs disabled:opacity-50"
          >
            <Shovel className="h-4 w-4 text-orange-600" /> Fertilize all (
            {fertilizableCount})
          </button>
        </div>
        <button
          type="button"
          onClick={onHarvestAll}
          disabled={!bulkTools.canHarvestAll}
          className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 font-medium text-xs disabled:opacity-50"
        >
          <Leaf className="h-4 w-4 text-amber-600" /> Harvest all ({summary.ready})
        </button>
      </div>
    </div>
  );
}
