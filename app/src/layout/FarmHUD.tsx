"use client";

import { BookOpen, Coins, Star } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DayNightIndicator } from "@/layout/DayNightIndicator";
import { getFarmingLevelProgress } from "@/libs/farming";
import type { FarmStateResponse } from "@/validators/farming";

type FarmHUDProps = {
  state: FarmStateResponse;
  onOpenCollection: () => void;
};

/** Farm status: farming level progress, time of day, farm coins and the collection log. */
export function FarmHUD({ state, onOpenCollection }: FarmHUDProps) {
  const levelInfo = useMemo(
    () => getFarmingLevelProgress(state.farmingExperience),
    [state.farmingExperience],
  );

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border bg-card px-3 py-2.5">
      <div className="min-w-48 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex items-center gap-1.5 font-semibold text-sm">
            <Star className="h-4 w-4 text-amber-500" aria-hidden />
            Farming level {levelInfo.level}
          </p>
          <p className="text-muted-foreground text-xs">
            {levelInfo.experienceNeededForLevel === null
              ? "Max level"
              : `${levelInfo.experienceIntoLevel.toLocaleString()} / ${levelInfo.experienceNeededForLevel.toLocaleString()} XP`}
          </p>
        </div>
        <Progress
          value={levelInfo.progress}
          className="mt-1.5 h-2"
          aria-label="Progress to the next farming level"
        />
      </div>
      <DayNightIndicator className="leading-tight" />
      <p className="flex items-center gap-1.5 text-sm">
        <Coins className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
        <span className="font-semibold">{state.farmCurrency.toLocaleString()}</span>
        <span className="text-muted-foreground">farm coins</span>
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onOpenCollection}>
        <BookOpen className="mr-1.5 h-4 w-4" aria-hidden />
        Collection {state.collectionLog.collected}/{state.collectionLog.total}
      </Button>
    </div>
  );
}
